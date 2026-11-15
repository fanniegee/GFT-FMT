import { randomBytes } from 'node:crypto';
import rateLimit from 'express-rate-limit';

export function installDepartmentAdmin(app, services) {
  const { query, withTransaction, getAuthenticatedAdmin, getCookie, sha256, createPasswordHash, verifyPassword } = services;
  const departments = ['tv', 'spotlight', 'library', 'trust'];
  const trustRoles = new Set(['Trustees','Family Council','Lawyer','Witness',"Founder's Executive Assistant",'Accountant','Secretary','Employee','Super Admin','Finance Admin','Companies Admin','Support']);
  const base = '/api/staff-admin/:department';
  const cookieName = 'gft_department_session';
  const secret = () => randomBytes(32).toString('base64url');
  let schema;
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });

  function route(method, suffix, handler) {
    const middleware = ['/login', '/accept'].includes(suffix) ? [authLimit] : [];
    app[method](base + suffix, ...middleware, async (req, res) => {
      const { department } = req.params;
      if (!departments.includes(department)) return res.sendStatus(404);
      if (method === 'post' && !req.is('application/json')) return res.sendStatus(415);
      res.set('Cache-Control', 'no-store');
      try {
        schema ??= withTransaction(async client => {
          await client.query("CREATE TABLE IF NOT EXISTS gft_department_staff (id TEXT PRIMARY KEY, department TEXT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL , password_hash TEXT, invite_hash TEXT UNIQUE, invite_expires TIMESTAMPTZ, invited_by TEXT NOT NULL, UNIQUE (department,email)); CREATE TABLE IF NOT EXISTS gft_department_sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES gft_department_staff ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL)");
          await client.query("ALTER TABLE gft_department_staff DROP CONSTRAINT IF EXISTS gft_department_staff_role_check");
          await client.query("CREATE TABLE IF NOT EXISTS gft_admin_password_resets (admin_id TEXT PRIMARY KEY REFERENCES gft_admin_accounts(admin_id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL)");
        }).catch(error => {
          schema = undefined;
          throw error;
        });
        await schema;
        return await handler(req, res, department);
      } catch (error) {
        console.error('Department admin request failed', error.code || error.name);
        return res.status(500).json({ error: 'Unable to complete the department administration request.' });
      }
    });
  }

  async function current(req, department) {
    const session = getCookie(req, cookieName);
    if (!session) return null;
    const result = await query(
      'SELECT a.id, a.name, a.email, a.role FROM gft_department_sessions s JOIN gft_department_staff a ON a.id = s.staff_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.department = $2',
      [sha256(session), department]
    );
    return result.rows[0] || null;
  }

  async function authority(req, department) {
    const admin = await getAuthenticatedAdmin(req);
    const staff = await current(req, department);
    const grant = 'INVITE_' + department.toUpperCase() + '_SUPER_ADMIN';
    const canInviteSuperAdmin = String(admin?.role).toUpperCase() === 'FOUNDER'
      || (Array.isArray(admin?.deployment?.permissions) && admin.deployment.permissions.includes(grant));
    const canInviteAdmin = staff?.role === 'SUPER_ADMIN' ||
      (department === 'spotlight' && String(admin?.role).toUpperCase() === 'FOUNDER');
    return { staff, admin, canInviteSuperAdmin, canInviteAdmin };
  }

  route('get', '/me', async (req, res, department) => {
    const { staff, admin, canInviteSuperAdmin, canInviteAdmin } = await authority(req, department);
    return res.json({ staff, canInviteSuperAdmin, canInviteAdmin, founder: String(admin?.role).toUpperCase() === 'FOUNDER' });
  });

  route('post', '/delegation', async (req, res, department) => {
    if (department === 'trust') return res.sendStatus(404);
    const actor = await getAuthenticatedAdmin(req);
    if (String(actor?.role).toUpperCase() !== 'FOUNDER') return res.sendStatus(403);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const enabled = req.body?.enabled;
    if (!email || typeof enabled !== 'boolean') return res.sendStatus(400);
    const grant = 'INVITE_' + department.toUpperCase() + '_SUPER_ADMIN';
    const updated = await withTransaction(async client => {
      const result = await client.query(
        "SELECT admin_id, deployment FROM gft_admin_accounts WHERE LOWER(email) = $1 AND UPPER(role) <> 'FOUNDER' FOR UPDATE",
        [email]
      );
      if (result.rows.length !== 1) return false;
      const target = result.rows[0];
      const deployment = target.deployment || {};
      const permissions = Array.isArray(deployment.permissions) ? deployment.permissions.filter(value => value !== grant) : [];
      if (enabled) permissions.push(grant);
      await client.query('UPDATE gft_admin_accounts SET deployment = $1::jsonb, updated_at = NOW() WHERE admin_id = $2',
        [JSON.stringify({ ...deployment, permissions }), target.admin_id]);
      await client.query(
        'INSERT INTO gft_admin_audit_events (event_id, admin_id, admin_email, action, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
        ['AUD-' + secret(), actor.admin_id, actor.email, 'DEPARTMENT_INVITE_AUTHORITY_CHANGED',
          JSON.stringify({ department, targetAdminId: target.admin_id, enabled })]
      );
      return true;
    });
    return updated ? res.json({ ok: true }) : res.status(404).json({ error: 'Trust Admin account not found.' });
  });

  route('post', '/invitations', async (req, res, department) => {
    const { staff, admin, canInviteSuperAdmin, canInviteAdmin } = await authority(req, department);
    const role = req.body?.role;
    if (department === 'trust') {
      if (String(admin?.role).toUpperCase() !== 'FOUNDER') return res.sendStatus(403);
      if (!trustRoles.has(role)) return res.status(400).json({ error: 'Choose a valid Trust role.' });
    }
    const inviter = department === 'trust' ? admin.admin_id : role === 'SUPER_ADMIN' && canInviteSuperAdmin ? admin.admin_id
      : role === 'ADMIN' && canInviteAdmin ? (staff?.role === 'SUPER_ADMIN' ? staff.id : admin.admin_id) : null;
    if (!inviter) return res.status(403).json({ error: 'Invitation authority is required.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 180 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid name and email.' });
    }
    if (department === 'trust' && (await query('SELECT 1 FROM gft_admin_accounts WHERE LOWER(email) = $1', [email])).rows.length) {
      return res.status(409).json({ error: 'A Trust Admin account already exists for this email.' });
    }
    const invitation = secret();
    const result = await query(
      "INSERT INTO gft_department_staff (id, department, email, name, role, invite_hash, invite_expires, invited_by) VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '48 hours',$7) ON CONFLICT (department,email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, invite_hash = EXCLUDED.invite_hash, invite_expires = EXCLUDED.invite_expires, invited_by = EXCLUDED.invited_by WHERE gft_department_staff.password_hash IS NULL AND gft_department_staff.role = EXCLUDED.role RETURNING id",
      [secret(), department, email, name, role, sha256(invitation), inviter]
    );
    if (!result.rows.length) return res.status(409).json({ error: 'An account or invitation already exists for this email.' });
    return res.status(201).json({ path: (department === 'trust' ? '/admin.html#invite=' : '/staff-admin.html?department=' + department + '#invite=') + invitation });
  });

  route('post', '/password-reset', async (req,res,department)=>{
    if(department!=='trust') return res.sendStatus(404);
    const founder=await getAuthenticatedAdmin(req);
    if(String(founder?.role).toUpperCase()!=='FOUNDER') return res.sendStatus(403);
    const adminId=typeof req.body?.adminId==='string'?req.body.adminId.trim():'';
    if(!adminId || adminId.length>180) return res.sendStatus(400);
    const token=secret();
    const saved=await withTransaction(async client=>{
      const {rows}=await client.query(
        "SELECT admin_id FROM gft_admin_accounts WHERE admin_id=$1 AND active AND UPPER(status)='ACTIVE' AND UPPER(role)<>'FOUNDER' FOR UPDATE",[adminId]);
      if(!rows.length) return false;
      await client.query(
        "INSERT INTO gft_admin_password_resets (admin_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour') ON CONFLICT(admin_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at",
        [adminId,sha256(token)]
      );
      await client.query("INSERT INTO gft_admin_audit_events(event_id,admin_id,admin_email,action,details) VALUES ($1,$2,$3,'ADMIN_PASSWORD_RESET_ISSUED',$4::jsonb)",
        ['AUD-'+secret(),founder.admin_id,founder.email,JSON.stringify({targetAdminId:adminId})]);
      return true;
    });
    return saved ? res.json({path:'/admin.html#invite='+token}) : res.status(404).json({error:'Active Trust Admin account unavailable.'});
  });

  route('post', '/accept', async (req, res, department) => {
    const invitation = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (!/^[\w-]{43}$/.test(invitation) || password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: 'Provide a valid invitation and a password of 12 to 200 characters.' });
    }
    const accepted = await withTransaction(async client => {
      if(department==='trust'){
        const {rows:[reset]}=await client.query('SELECT admin_id FROM gft_admin_password_resets WHERE token_hash=$1 AND expires_at>NOW()',[sha256(invitation)]);
        if(reset){
          const {rows:[admin]}=await client.query("SELECT admin_id,email FROM gft_admin_accounts WHERE admin_id=$1 AND active AND UPPER(status)='ACTIVE' AND UPPER(role)<>'FOUNDER' FOR UPDATE",[reset.admin_id]);
          if(!admin) return false;
          const consumed=await client.query('DELETE FROM gft_admin_password_resets WHERE admin_id=$1 AND token_hash=$2 AND expires_at>NOW() RETURNING admin_id',[admin.admin_id,sha256(invitation)]);
          if(!consumed.rows.length) return false;
          await client.query("UPDATE gft_admin_accounts SET password_hash=$1,password_algorithm='scrypt',updated_at=NOW() WHERE admin_id=$2",[await createPasswordHash(password),admin.admin_id]);
          await client.query('DELETE FROM gft_admin_sessions WHERE admin_id=$1',[admin.admin_id]);
          await client.query("INSERT INTO gft_admin_audit_events(event_id,admin_id,admin_email,action,details) VALUES ($1,$2,$3,'ADMIN_PASSWORD_RESET_COMPLETED','{}'::jsonb)",
            ['AUD-'+secret(),admin.admin_id,admin.email]);
          return true;
        }
      }
      const match = await client.query(
        'SELECT id, name, email, role FROM gft_department_staff WHERE department = $1 AND invite_hash = $2 AND invite_expires > NOW() AND password_hash IS NULL FOR UPDATE',
        [department, sha256(invitation)]
      );
      if (!match.rows.length) return false;
      if (department === 'trust') {
        const { id, name, email, role } = match.rows[0];
        if (!trustRoles.has(role)) return false;
        await client.query("INSERT INTO gft_admin_accounts (admin_id,name,email,role,permissions,tasks,deployment,password_hash,password_algorithm,status,active,invited_at,activated_at) VALUES ($1,$2,$3,$4,'[]','[]','{\"modules\":[\"dashboard\"],\"permissions\":[]}', $5,'scrypt','ACTIVE',TRUE,NOW(),NOW())",
          [id, name, email, role, await createPasswordHash(password)]);
        await client.query('DELETE FROM gft_department_staff WHERE id = $1', [id]);
        return true;
      }
      await client.query('UPDATE gft_department_staff SET password_hash = $1, invite_hash = NULL, invite_expires = NULL WHERE id = $2',
        [await createPasswordHash(password), match.rows[0].id]);
      return true;
    });
    return accepted ? res.json({ ok: true }) : res.status(400).json({ error: 'This invitation has expired or has already been used.' });
  });

  function cookie(department) {
    return { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/staff-admin/' + department };
  }

  route('post', '/login', async (req, res, department) => {
    if (department === 'trust') return res.sendStatus(404);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const result = await query('SELECT id,password_hash FROM gft_department_staff WHERE department = $1 AND email = $2', [department, email]);
    const admin = result.rows[0];
    if (!admin?.password_hash || !password || password.length > 200 || !await verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const session = secret();
    await query("INSERT INTO gft_department_sessions VALUES ($1,$2,NOW() + INTERVAL '8 hours')", [sha256(session), admin.id]);
    return res.cookie(cookieName, session, { ...cookie(department), maxAge: 28800000 }).json({ ok: true });
  });

  route('post', '/logout', async (req, res, department) => {
    const session = getCookie(req, cookieName);
    if (session) await query('DELETE FROM gft_department_sessions WHERE token_hash = $1', [sha256(session)]);
    return res.clearCookie(cookieName, cookie(department)).json({ ok: true });
  });
}

