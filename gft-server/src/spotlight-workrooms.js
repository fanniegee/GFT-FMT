import { randomUUID } from 'node:crypto';

const departments = new Set(['author', 'artist', 'music', 'film']);
const collaborationTypes = new Set(['Project partnership', 'Paid commission', 'Feedback exchange', 'Mentoring', 'Event or production', 'Other']);
const base = '/api/spotlight/workrooms';

function text(value, max) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}

export function installSpotlightWorkrooms(app, { query, withTransaction, getMember, ensureProfiles }) {
  let schema;
  function ensureSchema() {
    schema ??= (async () => {
      await ensureProfiles();
      await query(`
        ALTER TABLE spotlight_profiles ADD COLUMN IF NOT EXISTS workroom_listed BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS spotlight_profiles_workroom_idx ON spotlight_profiles (department, display_name)
          WHERE workroom_listed AND status = 'draft';
        CREATE TABLE IF NOT EXISTS spotlight_collaborations (
          collaboration_id TEXT PRIMARY KEY,
          department TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          recipient_name TEXT NOT NULL,
          kind TEXT NOT NULL,
          subject TEXT NOT NULL,
          proposal TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'closed')),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (sender_id <> recipient_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS spotlight_collaborations_open_pair_idx
          ON spotlight_collaborations (department, LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
          WHERE status IN ('pending', 'accepted');
        CREATE INDEX IF NOT EXISTS spotlight_collaborations_sender_idx
          ON spotlight_collaborations (sender_id, department, updated_at DESC);
        CREATE INDEX IF NOT EXISTS spotlight_collaborations_recipient_idx
          ON spotlight_collaborations (recipient_id, department, updated_at DESC);
        CREATE TABLE IF NOT EXISTS spotlight_collaboration_messages (
          message_id BIGSERIAL PRIMARY KEY,
          collaboration_id TEXT NOT NULL REFERENCES spotlight_collaborations (collaboration_id),
          sender_id TEXT NOT NULL,
          body TEXT NOT NULL,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS spotlight_collaboration_messages_thread_idx
          ON spotlight_collaboration_messages (collaboration_id, message_id);
      `);
    })().catch(error => {
      schema = undefined;
      throw error;
    });
    return schema;
  }

  function route(handler) {
    return async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        const member = await getMember(req);
        if (!member) return res.status(401).json({ error: 'Sign in to Spotlight to use the workrooms.' });
        const { department } = req.params;
        if (!departments.has(department)) return res.status(400).json({ error: 'Unknown department.' });
        await ensureSchema();
        return await handler(req, res, department, member.system_id);
      } catch (error) {
        console.error('Spotlight workroom error:', error);
        return res.status(500).json({ error: 'The workroom could not complete that request.' });
      }
    };
  }

  app.get(base + '/:department/creators', route(async (req, res, department, memberId) => {
    const search = text(req.query.q, 120);
    const result = await query(`
      SELECT profile_id, display_name, headline, biography,
             jsonb_build_object('portraitUrl', details->'portraitUrl', 'distinctions', details->'distinctions',
               'workTitle', details->'workTitle', 'workDescription', details->'workDescription',
               'website', details->'website', 'location', details->'location') AS details,
             owner_system_id = $2 AS is_mine, (status = 'published' OR workroom_listed) AS listed, status = 'draft' AS can_change_listing
      FROM spotlight_profiles
      WHERE department = $1 AND status <> 'archived'
        AND (status = 'published' OR workroom_listed OR owner_system_id = $2)
        AND (owner_system_id = $2 OR $3 = '' OR position(lower($3) IN lower(concat_ws(
          ' ', display_name, headline, biography, details->>'distinctions', details->>'location'
        ))) > 0)
      ORDER BY (owner_system_id = $2) DESC, display_name, profile_id
      LIMIT 101
    `, [department, memberId, search]);
    res.json({ profiles: result.rows.slice(0, 100), limited: result.rows.length > 100 });
  }));

  app.patch(base + '/:department/creators/:id/visibility', route(async (req, res, department, memberId) => {
    const listed = req.body?.listed;
    if (typeof listed !== 'boolean') return res.status(400).json({ error: 'Choose whether to list the profile.' });
    const result = await query(`
      UPDATE spotlight_profiles SET workroom_listed = $4
      WHERE department = $1 AND profile_id = $2 AND owner_system_id = $3 AND status = 'draft'
      RETURNING workroom_listed AS listed
    `, [department, req.params.id, memberId, listed]);
    if (!result.rowCount) return res.status(404).json({ error: 'Editable profile unavailable.' });
    res.json(result.rows[0]);
  }));

  app.get(base + '/:department/collaborations', route(async (req, res, department, memberId) => {
    const result = await query(`
      SELECT collaboration_id, sender_name, recipient_name, kind, subject, proposal, status, updated_at,
             sender_id = $2 AS outgoing
      FROM spotlight_collaborations
      WHERE department = $1 AND $2 IN (sender_id, recipient_id)
      ORDER BY (status IN ('pending', 'accepted')) DESC, updated_at DESC
      LIMIT 100
    `, [department, memberId]);
    res.json({ collaborations: result.rows });
  }));

  app.post(base + '/:department/collaborations', route(async (req, res, department, memberId) => {
    const sender = text(req.body?.senderProfile, 100);
    const recipient = text(req.body?.recipientProfile, 100);
    const kind = req.body?.kind;
    const subject = text(req.body?.subject, 120);
    const proposal = text(req.body?.proposal, 2000);
    if (!sender || !recipient || !collaborationTypes.has(kind) || !subject || !proposal) {
      return res.status(400).json({ error: 'Choose two profiles, a collaboration type, and enter a subject and proposal.' });
    }
    const result = await query(`
      INSERT INTO spotlight_collaborations
        (collaboration_id, department, sender_id, recipient_id, sender_name, recipient_name, kind, subject, proposal)
      SELECT $1, $2, sender.owner_system_id, recipient.owner_system_id,
             sender.display_name, recipient.display_name, $6, $7, $8
      FROM spotlight_profiles sender CROSS JOIN spotlight_profiles recipient
      WHERE sender.profile_id = $3 AND recipient.profile_id = $4 AND sender.owner_system_id = $5
        AND sender.owner_system_id <> recipient.owner_system_id
        AND sender.department = $2 AND recipient.department = $2
        AND (sender.status = 'published' OR (sender.status = 'draft' AND sender.workroom_listed))
        AND (recipient.status = 'published' OR (recipient.status = 'draft' AND recipient.workroom_listed))
      ON CONFLICT DO NOTHING
      RETURNING collaboration_id
    `, [randomUUID(), department, sender, recipient, memberId, kind, subject, proposal]);
    if (!result.rowCount) return res.status(409).json({
      error: 'Both profiles must be listed in this department, and only one open collaboration per pair is allowed.'
    });
    res.status(201).json(result.rows[0]);
  }));

  app.patch(base + '/:department/collaborations/:id', route(async (req, res, department, memberId) => {
    const action = req.body?.action;
    if (!['accepted', 'declined', 'withdrawn', 'closed'].includes(action)) {
      return res.status(400).json({ error: 'Unknown collaboration action.' });
    }
    const result = await query(`
      UPDATE spotlight_collaborations SET status = $4, updated_at = NOW()
      WHERE department = $1 AND collaboration_id = $2 AND (
        (status = 'pending' AND recipient_id = $3 AND $4 IN ('accepted', 'declined')) OR
        (status = 'pending' AND sender_id = $3 AND $4 = 'withdrawn') OR
        (status = 'accepted' AND $3 IN (sender_id, recipient_id) AND $4 = 'closed')
      )
      RETURNING status
    `, [department, req.params.id, memberId, action]);
    if (!result.rowCount) return res.status(409).json({ error: 'This action is no longer available.' });
    res.json(result.rows[0]);
  }));

  app.get(base + '/:department/collaborations/:id/messages', route(async (req, res, department, memberId) => {
    const result = await query(`
      SELECT c.status, COALESCE(messages.items, '[]'::jsonb) AS messages
      FROM spotlight_collaborations c
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.message_id) AS items
        FROM (
          SELECT message_id, body, sent_at, sender_id = $3 AS mine
          FROM spotlight_collaboration_messages
          WHERE collaboration_id = c.collaboration_id
          ORDER BY message_id DESC LIMIT 100
        ) recent
      ) messages ON true
      WHERE c.department = $1 AND c.collaboration_id = $2 AND $3 IN (c.sender_id, c.recipient_id)
    `, [department, req.params.id, memberId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Collaboration unavailable.' });
    res.json(result.rows[0]);
  }));

  app.post(base + '/:department/collaborations/:id/messages', route(async (req, res, department, memberId) => {
    const body = text(req.body?.body, 2000);
    if (!body) return res.status(400).json({ error: 'Enter a message of 1 to 2,000 characters.' });
    const saved = await withTransaction(async client => {
      const thread = await client.query(`
        UPDATE spotlight_collaborations SET updated_at = NOW()
        WHERE department = $1 AND collaboration_id = $2 AND status = 'accepted' AND $3 IN (sender_id, recipient_id)
        RETURNING collaboration_id
      `, [department, req.params.id, memberId]);
      if (!thread.rowCount) return false;
      await client.query(`
        INSERT INTO spotlight_collaboration_messages (collaboration_id, sender_id, body)
        VALUES ($1, $2, $3)
      `, [req.params.id, memberId, body]);
      return true;
    });
    if (!saved) return res.status(409).json({ error: 'Messaging is available in accepted collaborations.' });
    res.status(201).json({ ok: true });
  }));

  return ensureSchema;
}
