import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { query } from './db.js';

const app = express();

const PORT = Number(process.env.PORT || 3000);

const allowedOrigins = String(
  process.env.FRONTEND_ORIGINS || 'http://localhost:3000'
)
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

app.use(helmet());

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('CORS origin not allowed'));
  }
}));

app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));


// ------------------------------------------------------------
// HEALTH
// ------------------------------------------------------------

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');

    res.json({
      ok: true,
      service: 'gft-server',
      database: 'connected',
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check database error:', error);

    res.status(503).json({
      ok: false,
      service: 'gft-server',
      database: 'disconnected'
    });
  }
});


// ------------------------------------------------------------
// VERSION
// ------------------------------------------------------------

app.get('/api/version', (_req, res) => {
  res.json({
    service: 'gft-server',
    apiVersion: '1.0',
    stage: 'database-api-foundation'
  });
});


// ------------------------------------------------------------
// FAMILY API
// PostgreSQL is the source for these reads.
// ------------------------------------------------------------

app.get('/api/family', async (req, res) => {
  try {
    const parent =
      typeof req.query.parent === 'string'
        ? req.query.parent.trim()
        : '';

    const result = parent
      ? await query(
          `SELECT
             system_id,
             parent_system_id,
             full_name,
             gender,
             generation,
             branch_code,
             date_of_birth,
             profile,
             created_at,
             updated_at
           FROM family_people
           WHERE parent_system_id = $1
           ORDER BY generation, system_id`,
          [parent]
        )
      : await query(
          `SELECT
             system_id,
             parent_system_id,
             full_name,
             gender,
             generation,
             branch_code,
             date_of_birth,
             profile,
             created_at,
             updated_at
           FROM family_people
           ORDER BY generation, system_id`
        );

    res.json({
      ok: true,
      count: result.rows.length,
      people: result.rows
    });

  } catch (error) {
    console.error('Family API error:', error);

    res.status(500).json({
      ok: false,
      error: 'Unable to load family data'
    });
  }
});


app.get('/api/family/:systemId', async (req, res) => {
  try {
    const systemId = String(req.params.systemId || '').trim();

    if (!systemId) {
      return res.status(400).json({
        ok: false,
        error: 'systemId is required'
      });
    }

    const result = await query(
      `SELECT
         system_id,
         parent_system_id,
         full_name,
         gender,
         generation,
         branch_code,
         date_of_birth,
         profile,
         created_at,
         updated_at
       FROM family_people
       WHERE system_id = $1
       LIMIT 1`,
      [systemId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Family person not found'
      });
    }

    res.json({
      ok: true,
      person: result.rows[0]
    });

  } catch (error) {
    console.error('Family person API error:', error);

    res.status(500).json({
      ok: false,
      error: 'Unable to load family person'
    });
  }
});


// ------------------------------------------------------------
// PUBLIC CONFIGURATION API
// ------------------------------------------------------------

app.get('/api/config/public', async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         config_key,
         config_value,
         version,
         updated_at
       FROM configuration
       WHERE config_key = 'public_site'
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Public configuration not found'
      });
    }

    res.json({
      ok: true,
      config: result.rows[0].config_value,
      version: result.rows[0].version,
      updatedAt: result.rows[0].updated_at
    });

  } catch (error) {
    console.error('Public configuration API error:', error);

    res.status(500).json({
      ok: false,
      error: 'Unable to load public configuration'
    });
  }
});

// ------------------------------------------------------------
// Registration submission
// Registration is stored as PENDING.
// It does NOT automatically create a beneficiary or wallet.
// ------------------------------------------------------------

app.post('/api/registrations', async (req, res) => {
  try {
    const record = req.body?.record;

    if (!record || typeof record !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Registration record is required'
      });
    }

    const fullName = String(record.fullName || '').trim();
    const username = String(record.username || '').trim() || null;
    const phone = String(record.phone || '').trim() || null;
    const parentName = String(record.parentName || '').trim() || null;
    const grandparentName =
      String(record.grandparentName || '').trim() || null;

    if (!fullName) {
      return res.status(400).json({
        ok: false,
        error: 'Full name is required'
      });
    }

    if (record.emailVerified !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Email verification is required'
      });
    }

    const result = await query(
      `INSERT INTO registrations (
         applicant_system_id,
         full_name,
         username,
         phone,
         parent_full_name,
         grandparent_full_name,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING registration_id, applicant_system_id, status, submitted_at`,
      [
        String(record.systemId || '').trim() || null,
        fullName,
        username,
        phone,
        parentName,
        grandparentName
      ]
    );

    const saved = result.rows[0];

    return res.status(201).json({
      ok: true,
      registrationId: saved.registration_id,
      systemId: saved.applicant_system_id,
      registrationStatus: saved.status,
      submittedAt: saved.submitted_at
    });

  } catch (error) {
    console.error('Registration submission error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to submit registration'
    });
  }
});

// ------------------------------------------------------------
// API 404
// ------------------------------------------------------------

app.use('/api', (_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'API route not found'
  });
});


// ------------------------------------------------------------
// ERROR HANDLER
// ------------------------------------------------------------

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error);

  if (error?.message === 'CORS origin not allowed') {
    return res.status(403).json({
      ok: false,
      error: 'CORS origin not allowed'
    });
  }

  return res.status(500).json({
    ok: false,
    error: 'Internal server error'
  });
});


// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`GFT server listening on http://localhost:${PORT}`);
});