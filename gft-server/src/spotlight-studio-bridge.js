import { createHash, randomBytes } from 'node:crypto';

const departments = new Set(['author', 'artist', 'music', 'film']);
const opaque = /^[A-Za-z0-9_-]{43}$/;
const collaborationId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(value).digest('base64url');

export function installSpotlightStudioBridge(app, { query, getMember, ensureProfiles, ensureWorkrooms }) {
  const callback = new URL('/auth/gft/callback', process.env.SPOTLIGHT_STUDIO_ORIGIN || 'https://gft-spotlight-studio.onrender.com');
  app.get('/api/spotlight/studio/launch', (req, res) => {
    const { department, collaboration } = req.query;
    if ((department !== undefined && !departments.has(department)) ||
        (collaboration !== undefined && (!department || typeof collaboration !== 'string' || !collaborationId.test(collaboration)))) {
      return res.status(400).json({ error: 'invalid_handoff' });
    }
    const entrance = new URL('/enter', callback);
    if (department) entrance.searchParams.set('department', department);
    if (collaboration) entrance.searchParams.set('collaboration', collaboration);
    return res.set('Cache-Control', 'no-store').redirect(303, entrance.href);
  });

  let schema;
  function ensureSchema() {
    schema ??= query(`
      CREATE TABLE IF NOT EXISTS spotlight_studio_codes (
        code_hash TEXT PRIMARY KEY,
        challenge TEXT NOT NULL,
        state TEXT NOT NULL,
        owner_system_id TEXT NOT NULL,
        department TEXT,
        collaboration_id TEXT,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS spotlight_studio_codes_expiry_idx ON spotlight_studio_codes (expires_at);
    `).catch(error => {
      schema = undefined;
      throw error;
    });
    return schema;
  }

  async function access(memberId, department, collaboration) {
    await ensureProfiles();
    const { rows } = await query(`
      SELECT DISTINCT p.department
      FROM spotlight_profiles p JOIN spotlight_member_accounts a ON a.system_id = p.owner_system_id
      WHERE p.owner_system_id = $1 AND a.status = 'ACTIVE' AND p.status IN ('draft', 'published')
      ORDER BY p.department
    `, [memberId]);
    const rooms = rows.map(row => row.department);
    if (!rooms.length) return { error: 'profile_required' };
    if (department && !rooms.includes(department)) return { error: 'department_required' };
    let context = null;
    if (collaboration) {
      await ensureWorkrooms();
      const result = await query(`
        SELECT collaboration_id AS id, subject,
          CASE WHEN sender_id = $1 THEN recipient_name ELSE sender_name END AS collaborator
        FROM spotlight_collaborations
        WHERE collaboration_id = $2 AND department = $3 AND status = 'accepted'
          AND $1 IN (sender_id, recipient_id)
      `, [memberId, collaboration, department]);
      if (!result.rowCount) return { error: 'collaboration_unavailable' };
      context = { ...result.rows[0], department };
    }
    return { rooms, preferred: department || rooms[0], collaboration: context };
  }

  app.get('/api/spotlight/studio/authorize', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const { state, challenge, department, collaboration } = req.query;
    if (typeof state !== 'string' || !opaque.test(state) || typeof challenge !== 'string' || !opaque.test(challenge)) {
      return res.status(400).json({ error: 'invalid_handoff' });
    }
    const redirect = new URL(callback);
    redirect.searchParams.set('state', state);
    function returnToStudio(key, value) {
      redirect.searchParams.set(key, value);
      return res.redirect(303, redirect.href);
    }
    if ((department !== undefined && !departments.has(department)) ||
        (collaboration !== undefined && (!department || typeof collaboration !== 'string' || !collaborationId.test(collaboration)))) {
      return returnToStudio('error', 'invalid_handoff');
    }
    try {
      const member = await getMember(req);
      if (!member) return returnToStudio('error', 'sign_in_required');
      const scope = await access(member.system_id, department, collaboration);
      if (scope.error) return returnToStudio('error', scope.error);
      await ensureSchema();
      await query('DELETE FROM spotlight_studio_codes WHERE expires_at <= NOW()');
      const code = randomBytes(32).toString('base64url');
      await query(`
        INSERT INTO spotlight_studio_codes
          (code_hash, challenge, state, owner_system_id, department, collaboration_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '90 seconds')
      `, [digest(code), challenge, state, member.system_id, department || null, collaboration || null]);
      return returnToStudio('code', code);
    } catch (error) {
      console.error('Spotlight Studio handoff authorization failed:', error);
      return returnToStudio('error', 'handoff_unavailable');
    }
  });

  app.post('/api/spotlight/studio/exchange', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { code, verifier, state } = req.body || {};
    if (![code, verifier, state].every(value => typeof value === 'string' && opaque.test(value))) {
      return res.status(400).json({ error: 'invalid_handoff' });
    }
    try {
      await ensureSchema();
      const result = await query(`
        DELETE FROM spotlight_studio_codes
        WHERE code_hash = $1 AND challenge = $2 AND state = $3 AND expires_at > NOW()
        RETURNING owner_system_id, department, collaboration_id
      `, [digest(code), digest(verifier), state]);
      if (!result.rowCount) return res.status(400).json({ error: 'invalid_handoff' });
      const grant = result.rows[0];
      const scope = await access(grant.owner_system_id, grant.department, grant.collaboration_id);
      if (scope.error) return res.status(403).json(scope);
      return res.json(scope);
    } catch (error) {
      console.error('Spotlight Studio handoff exchange failed:', error);
      return res.status(500).json({ error: 'handoff_unavailable' });
    }
  });
}
