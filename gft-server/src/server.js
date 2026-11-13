import 'dotenv/config';
import { installDepartmentAdmin } from './department-admin.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, withTransaction } from './db.js';
import { Resend } from 'resend';

import {
  randomBytes,
  createHash,
  createHmac,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';

import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const app = express();

const registrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 3
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png'
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PDF, JPG, and PNG files are allowed'));
    }

    cb(null, true);
  }
});

const beneficiaryPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }

    cb(null, true);
  }
});

const resend = new Resend(process.env.RESEND_API_KEY);

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GFT-FMT is the public website root
const publicRoot = path.resolve(__dirname, '..', '..');
console.log("GFT PUBLIC ROOT:", publicRoot);

app.use(express.static(publicRoot));
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(publicRoot, 'register.html'));
});

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
   // REGISTRATION OTP SEND RATE LIMIT
   // ------------------------------------------------------------
   const registrationOtpSendLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 3,
     standardHeaders: true,
     legacyHeaders: false,
     message: {
       ok: false,
       error: 'Too many verification-code requests. Please wait before trying again.'
     }
   }); 

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
// CANONICAL FAMILY API
// ------------------------------------------------------------

app.get('/api/family', async (req, res) => {
  try {
    const parent = typeof req.query.parent === 'string'
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
// PUBLIC BENEFICIARY LINEAGE API
// Safe lineage fields only.
// No phone numbers, ID numbers, emails, or documents.
// ------------------------------------------------------------

app.get('/api/beneficiaries/lineage', async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         system_id,
         full_name,
         identity_status,
         lineage_status,
         status,
         profile
       FROM beneficiaries
       ORDER BY system_id`
    );

    const beneficiaries = result.rows.map(row => {
      const profile =
        row.profile && typeof row.profile === 'object'
          ? row.profile
          : {};

      return {
        systemId: row.system_id,
        fullName: row.full_name,
        parentId: profile.parentId || profile.parentSystemId || null,
        generation: profile.generation || null,
        branch: profile.branch || profile.branchCode || null,
        gender: profile.gender || null,
        rootSurname: profile.rootSurname || 'Guvaza',
        currentSurname:
          profile.currentSurname ||
          profile.rootSurname ||
          'Guvaza',
        wifeNo: profile.wifeNo || null,
        isPlaceholder: Boolean(profile.isPlaceholder),

        identityStatus: row.identity_status,
        lineageStatus: row.lineage_status,
        beneficiaryStatus: row.status
      };
    });

    return res.json({
      ok: true,
      count: beneficiaries.length,
      beneficiaries,
      serverAuthoritative: true
    });

  } catch (error) {
    console.error(
      'Public beneficiary lineage API error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to load beneficiary lineage data'
    });
  }
});

// ------------------------------------------------------------
// PUBLIC CONFIGURATION API
// ------------------------------------------------------------

app.get('/api/config/public', async (_req, res) => {
  try {
    const result = await query(
      `SELECT config_key, config_value, version, updated_at
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
// ADMIN PUBLIC-SITE CONFIGURATION
// ------------------------------------------------------------

app.put('/api/admin/config/public', requireAdmin, async (req, res) => {
  try {
    const config = req.body?.config;

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({
        ok: false,
        error: 'Configuration object is required'
      });
    }

    const result = await query(
      `INSERT INTO configuration (
         config_key,
         config_value,
         version
       )
       VALUES (
         'public_site',
         $1::jsonb,
         1
       )
       ON CONFLICT (config_key)
       DO UPDATE SET
         config_value = EXCLUDED.config_value,
         version = configuration.version + 1,
         updated_at = NOW()
       RETURNING
         config_key,
         config_value,
         version,
         updated_at`,
      [JSON.stringify(config)]
    );

    await query(
      `INSERT INTO gft_admin_audit_events (
         event_id,
         admin_id,
         admin_email,
         action,
         details,
         ip_address,
         user_agent
       )
       VALUES (
         $1,
         $2,
         $3,
         'PUBLIC_CONFIG_UPDATED',
         $4::jsonb,
         $5,
         $6
       )`,
      [
        `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        req.admin.admin_id,
        req.admin.email,
        JSON.stringify({
          configKey: 'public_site',
          version: result.rows[0].version
        }),
        req.ip || null,
        req.get('user-agent') || null
      ]
    );

    return res.json({
      ok: true,
      config: result.rows[0].config_value,
      version: result.rows[0].version,
      updatedAt: result.rows[0].updated_at
    });

  } catch (error) {
    console.error('Admin public configuration update error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to save public configuration'
    });
  }
});

// ------------------------------------------------------------
// SERVER-SIDE REGISTRATION LINEAGE VERIFICATION
// ------------------------------------------------------------


// ------------------------------------------------------------
// SERVER-SIDE REGISTRATION LINEAGE VERIFICATION
// Both parent and grandparent must be verified.
// ------------------------------------------------------------

let descendantRegistrationSchema;

function ensureDescendantRegistrationSchema() {
  descendantRegistrationSchema ??= withTransaction(async client => {
    await client.query(`ALTER TABLE beneficiary_family_members
      ADD COLUMN IF NOT EXISTS registration_code_hash TEXT,
      ADD COLUMN IF NOT EXISTS registration_code_expires_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS uses_descendant_reservation BOOLEAN NOT NULL DEFAULT FALSE`);
  }).catch(error => {
    descendantRegistrationSchema = undefined;
    throw error;
  });
  return descendantRegistrationSchema;
}

async function matchDescendantReservation(record, runQuery, lock = false) {
  const systemId = String(record.reservedSystemId || '').trim().toUpperCase();
  const code = String(record.registrationCode || '').trim();
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (!/^GFT-GEN\d+-\d+$/.test(systemId) || !/^[A-Za-z0-9_-]{32}$/.test(code)) return null;

  const result = await runQuery(
    `SELECT child.member_id, child.system_id, child.full_name, child.generation,
            parent.system_id AS parent_system_id, parent.full_name AS parent_name,
            parent.generation AS parent_generation, parent.branch_code, parent.gender,
            grandparent.system_id AS grandparent_system_id, grandparent.full_name AS grandparent_name
     FROM beneficiary_family_members child
     JOIN beneficiaries owner ON owner.beneficiary_id = child.beneficiary_id
       AND owner.system_id = child.parent_system_id AND UPPER(owner.status) = 'ACTIVE'
     JOIN family_people parent ON parent.system_id = owner.system_id
       AND parent.profile->>'isPlaceholder' IS DISTINCT FROM 'true'
     LEFT JOIN family_people grandparent ON grandparent.system_id = parent.parent_system_id
     WHERE child.system_id = $1 AND child.member_type = 'DESCENDANT'
       AND child.parent_member_id IS NULL AND child.registration_code_hash = $2
       AND child.registration_code_expires_at > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM family_people existing
         WHERE existing.system_id = child.system_id
            OR (existing.parent_system_id = parent.system_id
              AND REGEXP_REPLACE(UPPER(TRIM(existing.full_name)), '[[:space:]]+', ' ', 'g') = $3)
       )
     LIMIT 2 ${lock ? 'FOR UPDATE OF child' : ''}`,
    [systemId, sha256(code), normalize(record.fullName)]
  );
  if (result.rows.length !== 1) return null;
  const child = result.rows[0];
  const relationship = normalize(record.parentRelationship);
  const gender = normalize(child.gender);
  const relationshipMatches = relationship === 'FATHER' && ['M', 'MALE'].includes(gender)
    || relationship === 'MOTHER' && ['F', 'FEMALE'].includes(gender);
  if (!relationshipMatches || normalize(child.full_name) !== normalize(record.fullName)
      || normalize(child.parent_name) !== normalize(record.parentName)
      || normalize(child.grandparent_name) !== normalize(record.grandparentName)
      || (record.parentId && child.parent_system_id !== record.parentId)
      || !Number.isInteger(child.parent_generation) || child.parent_generation < 1
      || child.generation !== child.parent_generation + 1
      || !systemId.startsWith(`GFT-GEN${child.generation}-`)) return null;
  return child;
}

const invalidReservationMessage = 'The reserved GFT ID, private code, or family details could not be verified. Ask your parent to check the details or issue a new code.';

app.post('/api/registration/verify-lineage', async (req, res) => {
  try {
    if (req.body?.reservedSystemId || req.body?.registrationCode) {
      await ensureDescendantRegistrationSchema();
      const child = await matchDescendantReservation(req.body, query);
      if (!child) return res.status(400).json({ ok: false, error: invalidReservationMessage });
      return res.json({
        ok: true,
        status: 'LINEAGE_CONFIRMED',
        reservationConfirmed: true,
        parent: { systemId: child.parent_system_id, fullName: child.parent_name, generation: child.parent_generation, branch: child.branch_code },
        grandparent: child.grandparent_system_id
          ? { systemId: child.grandparent_system_id, fullName: child.grandparent_name }
          : null
      });
    }

    const parentName = String(req.body?.parentName || '').trim();
    const grandparentName = String(req.body?.grandparentName || '').trim();
    const relationship = String(
      req.body?.parentRelationship || ''
    ).trim().toUpperCase();

    const normalize = value =>
      String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();

    if (
      !parentName ||
      !grandparentName ||
      !['FATHER', 'MOTHER'].includes(relationship)
    ) {
      return res.status(400).json({
        ok: false,
        status: 'LINEAGE_REVIEW_REQUIRED',
        error: 'Parent relationship, parent name and grandparent name are required.'
      });
    }

    // 1. Find exactly one parent.
    const parentResult = await query(
      `SELECT
         person_id,
         system_id,
         parent_system_id,
         full_name,
         gender,
         generation,
         branch_code
       FROM family_people
       WHERE REGEXP_REPLACE(
         UPPER(TRIM(full_name)), '\\s+', ' ', 'g'
       ) = $1
       LIMIT 2`,
      [normalize(parentName)]
    );

    if (parentResult.rows.length !== 1) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: parentResult.rows.length === 0
          ? 'PARENT_NOT_FOUND'
          : 'PARENT_NOT_UNIQUE',
        error: parentResult.rows.length === 0
          ? 'The selected parent was not found in the family register.'
          : 'The parent name matches more than one person. Please check the name.'
      });
    }

    const parent = parentResult.rows[0];

    // 2. Check Father/Mother against recorded gender.
    const gender = String(parent.gender || '').trim().toUpperCase();

    const genderMatches = relationship === 'FATHER'
      ? ['M', 'MALE'].includes(gender)
      : ['F', 'FEMALE'].includes(gender);

    if (!genderMatches) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: gender
          ? 'PARENT_RELATIONSHIP_MISMATCH'
          : 'PARENT_GENDER_NOT_VERIFIABLE',
        error: gender
          ? 'The selected Father/Mother relationship does not match the family register.'
          : 'The parent gender is not recorded clearly enough to verify this relationship.'
      });
    }

    // 3. The parent must have a linked grandparent.
    if (!parent.parent_system_id) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_NOT_LINKED',
        error: 'The selected parent has no linked grandparent in the family register.'
      });
    }

    // 4. Retrieve the actual grandparent using the parent's link.
    const grandparentResult = await query(
      `SELECT
         person_id,
         system_id,
         parent_system_id,
         full_name,
         gender,
         generation,
         branch_code
       FROM family_people
       WHERE system_id = $1
       LIMIT 2`,
      [parent.parent_system_id]
    );

    if (grandparentResult.rows.length !== 1) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_NOT_FOUND_OR_NOT_UNIQUE',
        error: 'The linked grandparent could not be uniquely verified.'
      });
    }

    const grandparent = grandparentResult.rows[0];

    // 5. Compare the applicant's selected grandparent with
    // the actual grandparent linked to the parent.
    if (
      normalize(grandparent.full_name) !==
      normalize(grandparentName)
    ) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_MISMATCH',
        error: 'The selected grandparent does not match the family register.'
      });
    }

    return res.json({
      ok: true,
      status: 'LINEAGE_CONFIRMED',
      parent: {
        systemId: parent.system_id,
        fullName: parent.full_name,
        gender: parent.gender,
        generation: parent.generation,
        branch: parent.branch_code
      },
      grandparent: {
        systemId: grandparent.system_id,
        fullName: grandparent.full_name,
        gender: grandparent.gender,
        generation: grandparent.generation,
        branch: grandparent.branch_code
      }
    });

  } catch (error) {
    console.error('Server-side lineage verification error:', error);

    return res.status(500).json({
      ok: false,
      status: 'LINEAGE_VERIFICATION_ERROR',
      error: 'Unable to verify lineage. Please try again.'
    });
  }
});


// ------------------------------------------------------------
// SERVER-SIDE FAMILY STRUCTURE / WIFE VERIFICATION
// ------------------------------------------------------------

// ------------------------------------------------------------
// SERVER-SIDE FAMILY STRUCTURE / WIFE VERIFICATION
// Server-enforced two-attempt limit.
// Only confirmed wife-number mismatches count as attempts.
// ------------------------------------------------------------

let registrationWifeAttemptsSchemaReady;

async function ensureRegistrationWifeAttemptsSchema() {
  if (!registrationWifeAttemptsSchemaReady) {
    registrationWifeAttemptsSchemaReady = query(`
      CREATE TABLE IF NOT EXISTS registration_wife_attempts (
        attempt_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        parent_system_id TEXT NOT NULL,
        attempts_used INTEGER NOT NULL DEFAULT 0
          CHECK (attempts_used BETWEEN 0 AND 2),
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
          CHECK (status IN ('IN_PROGRESS', 'VERIFIED', 'FROZEN')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `).then(() => true);
  }

  return registrationWifeAttemptsSchemaReady;
}

app.post('/api/registration/verify-structure', async (req, res) => {
  try {
    await ensureRegistrationWifeAttemptsSchema();

    const fullName = String(req.body?.fullName || '').trim();
    const parentSystemId = String(req.body?.parentSystemId || '').trim();
    const selectedWifeNo = Number(req.body?.wifeNo);
    const attemptId = String(req.body?.attemptId || '').trim();

    if (!fullName || !parentSystemId || !Number.isInteger(selectedWifeNo)) {
      return res.status(400).json({
        ok: false,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        error: 'Applicant name, parent ID and wife number are required'
      });
    }

    if (selectedWifeNo < 1 || selectedWifeNo > 8) {
      return res.status(400).json({
        ok: false,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        error: 'Invalid wife number'
      });
    }

    const normalize = value =>
      String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();

    // Confirm that the applicant is uniquely listed under this parent.
    const childResult = await query(
      `SELECT
         child.system_id,
         child.full_name,
         child.parent_system_id,
         child.generation,
         child.branch_code,
         parent.profile->>'wifeNo' AS wife_no,
         parent.full_name AS parent_full_name
       FROM family_people child
       LEFT JOIN family_people parent
         ON parent.system_id = child.parent_system_id
       WHERE child.parent_system_id = $1
         AND UPPER(TRIM(child.full_name)) = $2
       LIMIT 10`,
      [parentSystemId, normalize(fullName)]
    );

    // Preserve existing handling for unresolved family-register issues.
    if (childResult.rows.length === 0) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        reason: 'APPLICANT_NOT_FOUND_UNDER_PARENT'
      });
    }

    if (childResult.rows.length > 1) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        reason: 'APPLICANT_RECORD_NOT_UNIQUE'
      });
    }

    const child = childResult.rows[0];

    if (!child.wife_no) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        reason: 'MOTHER_WIFE_NUMBER_NOT_RECORDED'
      });
    }

    const wifeMatch = String(child.wife_no).match(/^WIFE(\d+)(?:_|$)/i);

    if (!wifeMatch) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        reason: 'INVALID_STORED_WIFE_NUMBER'
      });
    }

    const expectedWifeNo = Number(wifeMatch[1]);

    // First selection: create a server-side attempt record.
    if (!attemptId) {
      if (selectedWifeNo === expectedWifeNo) {
        return res.json({
          ok: true,
          status: 'FAMILY_STRUCTURE_CONFIRMED',
          applicant: {
            systemId: child.system_id,
            fullName: child.full_name,
            parentSystemId: child.parent_system_id,
            generation: child.generation,
            branch: child.branch_code
          },
          wifeNo: expectedWifeNo,
          attemptsUsed: 0
        });
      }

      const newAttemptId =
        `WIFE-${randomBytes(24).toString('hex')}`;

      await query(
        `INSERT INTO registration_wife_attempts (
           attempt_id,
           full_name,
           parent_system_id,
           attempts_used,
           status,
           expires_at
         )
         VALUES ($1, $2, $3, 1, 'IN_PROGRESS', NOW() + INTERVAL '2 hours')`,
        [newAttemptId, normalize(fullName), parentSystemId]
      );

      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_NOT_CONFIRMED',
        reason: 'WIFE_NUMBER_MISMATCH',
        attemptsUsed: 1,
        attemptsRemaining: 1,
        attemptId: newAttemptId
      });
    }

    // Second selection: lock and validate the existing attempt record.
    const attemptResult = await query(
      `SELECT
         attempt_id,
         full_name,
         parent_system_id,
         attempts_used,
         status,
         expires_at
       FROM registration_wife_attempts
       WHERE attempt_id = $1
       LIMIT 1`,
      [attemptId]
    );

    if (!attemptResult.rows.length) {
      return res.status(400).json({
        ok: false,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        error: 'Wife verification session is invalid. Please restart verification.'
      });
    }

    const attempt = attemptResult.rows[0];

    if (
      attempt.expires_at <= new Date() ||
      normalize(attempt.full_name) !== normalize(fullName) ||
      attempt.parent_system_id !== parentSystemId
    ) {
      return res.status(400).json({
        ok: false,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        error: 'Wife verification session has expired or does not match this applicant.'
      });
    }

    if (attempt.status === 'FROZEN' || Number(attempt.attempts_used) >= 2) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_FROZEN',
        attemptsUsed: 2,
        reason: 'SECOND_WIFE_NUMBER_MISMATCH'
      });
    }

    if (attempt.status === 'VERIFIED') {
      return res.status(409).json({
        ok: false,
        status: 'FAMILY_STRUCTURE_REVIEW_REQUIRED',
        error: 'Wife selection has already been verified.'
      });
    }

    if (selectedWifeNo === expectedWifeNo) {
      await query(
        `UPDATE registration_wife_attempts
         SET status = 'VERIFIED',
             updated_at = NOW()
         WHERE attempt_id = $1
           AND status = 'IN_PROGRESS'`,
        [attemptId]
      );

      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_CONFIRMED',
        applicant: {
          systemId: child.system_id,
          fullName: child.full_name,
          parentSystemId: child.parent_system_id,
          generation: child.generation,
          branch: child.branch_code
        },
        wifeNo: expectedWifeNo,
        attemptsUsed: 1
      });
    }

    // The second confirmed mismatch freezes wife selection.
    await query(
      `UPDATE registration_wife_attempts
       SET attempts_used = 2,
           status = 'FROZEN',
           updated_at = NOW()
       WHERE attempt_id = $1
         AND status = 'IN_PROGRESS'`,
      [attemptId]
    );

    return res.json({
      ok: true,
      status: 'FAMILY_STRUCTURE_FROZEN',
      reason: 'SECOND_WIFE_NUMBER_MISMATCH',
      attemptsUsed: 2,
      attemptsRemaining: 0,
      founderReviewRequired: true,
      attemptId
    });

  } catch (error) {
    console.error('Server-side family structure verification error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to verify family structure'
    });
  }
});

// ------------------------------------------------------------
// REGISTRATION OTP
// ------------------------------------------------------------

app.post(
  '/api/registration/send-otp',
  registrationOtpSendLimiter,
  async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false,
        error: 'A valid email address is required'
      });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: 'Email service is not configured'
      });
    }

    if (!process.env.RESEND_FROM_EMAIL) {
      return res.status(503).json({
        ok: false,
        error: 'Registration email sender is not configured'
      });
    }

    if (!process.env.OTP_HASH_SECRET) {
      return res.status(503).json({
        ok: false,
        error: 'OTP security is not configured'
      });
    }

    const otp = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');

    const codeHash = createHash('sha256')
      .update(`${email}:${otp}:${process.env.OTP_HASH_SECRET}`)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await query(
      `DELETE FROM registration_otps
       WHERE email = $1`,
      [email]
    );

    await query(
      `INSERT INTO registration_otps
       (email, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [email, codeHash, expiresAt]
    );

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      subject: 'Guvaza Family Trust Registration OTP',
      html: `
        <p>Your Guvaza Family Trust registration verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px;">
          ${otp}
        </p>
        <p>This code expires in 3 minutes.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      `
    });

    if (error) {
      console.error('Registration OTP email error:', error);

      await query(
        `DELETE FROM registration_otps
         WHERE email = $1`,
        [email]
      );

      return res.status(502).json({
        ok: false,
        error: 'Unable to send verification email'
      });
    }

    return res.json({
      ok: true,
      expiresInSeconds: 180
    });

  } catch (error) {
    console.error('Registration OTP error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to send verification code'
    });
  }
});

app.post('/api/registration/verify-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false,
        error: 'A valid email address is required'
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        ok: false,
        error: 'A valid 6-digit verification code is required'
      });
    }

    if (!process.env.OTP_HASH_SECRET) {
      return res.status(503).json({
        ok: false,
        error: 'OTP security is not configured'
      });
    }

    const result = await query(
      `SELECT otp_id, code_hash, expires_at, attempts, verified_at
       FROM registration_otps
       WHERE email = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (!result.rows.length) {
      return res.status(400).json({
        ok: false,
        error: 'No verification code was found'
      });
    }

    const record = result.rows[0];

    if (record.verified_at) {
      return res.json({
        ok: true,
        verified: true,
        email
      });
    }

    if (new Date(record.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({
        ok: false,
        error: 'This verification code has expired'
      });
    }

    if (Number(record.attempts) >= 5) {
      return res.status(429).json({
        ok: false,
        error: 'Too many incorrect attempts. Please request a new code.'
      });
    }

    const expectedHash = createHash('sha256')
      .update(`${email}:${otp}:${process.env.OTP_HASH_SECRET}`)
      .digest('hex');

    const suppliedBuffer = Buffer.from(expectedHash, 'hex');
    const storedBuffer = Buffer.from(String(record.code_hash), 'hex');

    const valid =
      suppliedBuffer.length === storedBuffer.length &&
      timingSafeEqual(suppliedBuffer, storedBuffer);

    if (!valid) {
      await query(
        `UPDATE registration_otps
         SET attempts = attempts + 1
         WHERE otp_id = $1`,
        [record.otp_id]
      );

      return res.status(400).json({
        ok: false,
        error: 'Incorrect verification code'
      });
    }

    await query(
      `UPDATE registration_otps
       SET verified_at = NOW()
       WHERE otp_id = $1`,
      [record.otp_id]
    );

    return res.json({
      ok: true,
      verified: true,
      email
    });

  } catch (error) {
    console.error('Registration OTP verification error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to verify the code'
    });
  }
});

async function generateGftSystemId(generation, client) {
  const gen = Number(generation);

  if (!Number.isInteger(gen) || gen < 1) {
    throw new Error('Invalid generation for GFT System ID');
  }

  const prefix = `GFT-GEN${gen}-`;

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [prefix]
  );

  const result = await client.query(
    `
    SELECT COALESCE(MAX(number_part), 0) AS max_number
    FROM (
      SELECT SUBSTRING(system_id FROM LENGTH($1) + 1)::INTEGER AS number_part
      FROM family_people
      WHERE system_id LIKE $1 || '%'
        AND SUBSTRING(system_id FROM LENGTH($1) + 1) ~ '^[0-9]+$'

      UNION ALL

      SELECT SUBSTRING(applicant_system_id FROM LENGTH($1) + 1)::INTEGER
      FROM registrations
      WHERE applicant_system_id LIKE $1 || '%'
        AND SUBSTRING(applicant_system_id FROM LENGTH($1) + 1) ~ '^[0-9]+$'

      UNION ALL

      SELECT SUBSTRING(system_id FROM LENGTH($1) + 1)::INTEGER
      FROM beneficiary_family_members
      WHERE system_id LIKE $1 || '%'
        AND SUBSTRING(system_id FROM LENGTH($1) + 1) ~ '^[0-9]+$'
    ) ids
    `,
    [prefix]
  );

  const nextNumber = Number(result.rows[0]?.max_number || 0) + 1;

  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

// ------------------------------------------------------------
// REGISTRATION SUBMISSION
//
// Registration goes into PostgreSQL as PENDING.
// It does NOT create a beneficiary or wallet.
// ------------------------------------------------------------

app.post(
  '/api/registrations',
  registrationUpload.fields([
    { name: 'applicantDocument', maxCount: 1 },
    { name: 'parentDocument', maxCount: 1 },
    { name: 'additionalDocument', maxCount: 1 }
  ]),
  async (req, res) => {
  try {
    const record = JSON.parse(req.body?.record || '{}');

    if (!record || typeof record !== 'object') {
      return res.status(400).json({
        ok: false,
        error: 'Registration record is required'
      });
    }

    const fullName = String(record.fullName || '').trim();
    const username = String(record.username || '').trim() || null;
    const phone = String(record.phone || '').trim() || null;

    const parentName =
      String(record.parentName || '').trim() || null;

    const grandparentName =
      String(record.grandparentName || '').trim() || null;

    const idNumber =
      String(record.idNumber || record.id_number || record.documentNumber || '').trim() || null;

    if (!fullName) {
      return res.status(400).json({
        ok: false,
        error: 'Full name is required'
      });
    }

    if (!idNumber) {
      return res.status(400).json({
        ok: false,
        error: 'Applicant identity or birth-document number is required'
      });
    }

    // The browser's required attribute is not a security boundary.
    // Require the primary document again on the server before saving.
    const applicantDocument = req.files?.applicantDocument?.[0];
    if (!applicantDocument) {
      return res.status(400).json({
        ok: false,
        error: 'The applicant primary document must be uploaded'
      });
    }

    const registrationEmail =
  String(record.email || '').trim().toLowerCase();

if (!registrationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registrationEmail)) {
  return res.status(400).json({
    ok: false,
    error: 'A valid registration email is required'
  });
}

const verifiedEmailResult = await query(
  `SELECT otp_id
   FROM registration_otps
   WHERE email = $1
     AND verified_at IS NOT NULL
     AND expires_at > NOW()
   ORDER BY verified_at DESC
   LIMIT 1`,
  [registrationEmail]
);

if (verifiedEmailResult.rows.length === 0) {
  return res.status(400).json({
    ok: false,
    error: 'Email verification is required'
  });
}

// Confirm family structure against the authoritative family register.
// A second confirmed wife mismatch may proceed only with a valid server-frozen attempt.
const submittedParentId = String(record.parentId || '').trim();
const submittedWifeAttemptId = String(record.wifeAttemptId || '').trim();
const usesReservation = Boolean(record.reservedSystemId || record.registrationCode);
const wifeMismatchFrozen = !usesReservation && record.wifeMismatchFrozen === true;
let verifiedStructure = null;
let verifiedWifeNo = null;
let verifiedGeneration = null;
let verifiedBranch = null;
let verifiedParentId = null;
let verifiedGrandparentId = null;
let structureConfirmed = false;

if (wifeMismatchFrozen) {
  if (!submittedParentId || !submittedWifeAttemptId) {
    return res.status(400).json({ ok: false, error: 'Founder review requires a valid frozen wife-verification session.' });
  }
  await ensureRegistrationWifeAttemptsSchema();
  const frozenAttempt = await query(
    `SELECT attempt_id
     FROM registration_wife_attempts
     WHERE attempt_id = $1
       AND full_name = UPPER(REGEXP_REPLACE(TRIM($2), '\\s+', ' ', 'g'))
       AND parent_system_id = $3
       AND attempts_used = 2
       AND status = 'FROZEN'
       AND expires_at > NOW()
     LIMIT 1`,
    [submittedWifeAttemptId, fullName, submittedParentId]
  );
  if (!frozenAttempt.rows.length) {
    return res.status(400).json({ ok: false, error: 'The frozen wife-verification session is invalid or expired. Please restart verification.' });
  }
}

if (submittedParentId && !usesReservation) {
  const structureResult = await query(
    `SELECT
       child.system_id,
       child.full_name,
       child.parent_system_id,
       child.generation,
       child.branch_code,
       parent.profile->>'wifeNo' AS wife_no,
       parent.full_name AS verified_parent_name,
       parent.parent_system_id AS grandparent_system_id,
       grandparent.full_name AS verified_grandparent_name
     FROM family_people child
     LEFT JOIN family_people parent ON parent.system_id = child.parent_system_id
     LEFT JOIN family_people grandparent ON grandparent.system_id = parent.parent_system_id
     WHERE LOWER(TRIM(child.full_name)) = LOWER(TRIM($1))
       AND child.parent_system_id = $2
     LIMIT 2`,
    [fullName, submittedParentId]
  );

  if (structureResult.rows.length === 1) {
    const candidate = structureResult.rows[0];
    const wifeMatch = String(candidate.wife_no || '').match(/^WIFE(\d+)(?:_|$)/i);
    const storedWifeNo = wifeMatch ? Number(wifeMatch[1]) : null;
    const selectedWifeNo = Number(record.wifeNo);
    const candidateGeneration = Number(candidate.generation);
    const validLineage = Number.isInteger(candidateGeneration) && candidateGeneration >= 1;
    const wifeMatches = storedWifeNo !== null && Number.isInteger(selectedWifeNo) && selectedWifeNo === storedWifeNo;

    if (validLineage && (wifeMismatchFrozen || wifeMatches)) {
      verifiedStructure = candidate;
      verifiedWifeNo = wifeMismatchFrozen ? null : storedWifeNo;
      verifiedGeneration = candidateGeneration;
      verifiedBranch = candidate.branch_code || null;
      verifiedParentId = candidate.parent_system_id || null;
      verifiedGrandparentId = candidate.grandparent_system_id || null;
      structureConfirmed = true;
    }
  }
}

// A person already present in the authoritative family tree MUST keep
// their permanent existing System ID. Never mint a second ID for them.
let serverSystemId = structureConfirmed
  ? String(verifiedStructure.system_id)
  : null;

    let saved;
    const serverVerification = {
      emailStatus: 'VERIFIED',
      lineageStatus: structureConfirmed ? 'LINEAGE_CONFIRMED' : 'PENDING_REVIEW',
      familyStructureStatus: wifeMismatchFrozen ? 'FAMILY_STRUCTURE_FROZEN' : structureConfirmed ? 'VERIFIED' : 'PENDING_REVIEW',
      identityStatus: 'PENDING_DOCUMENT_VERIFICATION',
      beneficiaryStatus: 'PENDING_VERIFICATION',
      founderVerificationStatus: 'PENDING',
      walletEligible: false,
      payoutEligible: false
    };
    let registrationReviewNote = wifeMismatchFrozen
      ? 'WIFE_NUMBER_MISMATCH: Two server-confirmed incorrect wife-number selections. Wife selection is frozen. Founder correction is required; no wife number has been verified.'
      : null;

    const uploadedDocuments = [
      { field: 'applicantDocument', type: 'APPLICANT_DOCUMENT' },
      { field: 'parentDocument', type: 'PARENT_DOCUMENT' },
      { field: 'additionalDocument', type: 'ADDITIONAL_DOCUMENT' }
    ];

    if (usesReservation) await ensureDescendantRegistrationSchema();

    // Save the application, its documents, and OTP consumption atomically.
    await withTransaction(async (client) => {
      const otpResult = await client.query(
        `SELECT otp_id
         FROM registration_otps
         WHERE email = $1
           AND verified_at IS NOT NULL
           AND expires_at > NOW()
         ORDER BY verified_at DESC
         LIMIT 1
         FOR UPDATE`,
        [registrationEmail]
      );

      if (!otpResult.rows.length) {
        const otpError = new Error('Email verification is required or has already been used');
        otpError.code = 'REGISTRATION_OTP_REQUIRED';
        throw otpError;
      }

      let reservation;
      if (usesReservation) {
        reservation = await matchDescendantReservation(record, client.query.bind(client), true);
        if (!reservation) {
          const error = new Error(invalidReservationMessage);
          error.code = 'REGISTRATION_RESERVATION_INVALID';
          throw error;
        }
        serverSystemId = reservation.system_id;
        verifiedParentId = reservation.parent_system_id;
        verifiedGrandparentId = reservation.grandparent_system_id;
        verifiedGeneration = reservation.generation;
        verifiedBranch = reservation.branch_code;
        serverVerification.familyStructureStatus = 'PENDING_FOUNDER_REVIEW';
        registrationReviewNote = 'Reserved GFT ID claimed using a private code issued by the verified parent. Review the applicant’s identity documents, parentage and family structure before approval.';
      }

      // Prevent repeat submissions for the same identity or permanent GFT ID.
      // Existing historical duplicates are preserved for Founder reconciliation.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [idNumber]);
      const duplicateResult = await client.query(
        `SELECT registration_id, applicant_system_id, status
         FROM registrations
         WHERE (id_number = $1 OR ($2::text IS NOT NULL AND applicant_system_id = $2))
           AND UPPER(COALESCE(status, '')) <> 'REJECTED'
         ORDER BY submitted_at DESC
         LIMIT 1`,
        [idNumber, serverSystemId]
      );
      if (duplicateResult.rows.length) {
        const duplicate = duplicateResult.rows[0];
        const duplicateError = new Error('A registration for this identity or GFT family record already exists. Please contact the Founder/Admin; do not submit another application.');
        duplicateError.code = 'REGISTRATION_DUPLICATE';
        duplicateError.registrationId = duplicate.registration_id;
        duplicateError.systemId = duplicate.applicant_system_id || null;
        throw duplicateError;
      }

      const result = await client.query(
        `INSERT INTO registrations (
          applicant_system_id,
          full_name,
          username,
          phone,
          id_number,
          parent_full_name,
          grandparent_full_name,
          email,
          date_of_birth,
          gender,
          current_surname,
          generation,
          branch_code,
          wife_no,
          parent_system_id,
          grandparent_system_id,
          status,
          review_notes
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, 'PENDING', $17
        )
        RETURNING
          registration_id,
          applicant_system_id,
          status,
          submitted_at`,
        [
          serverSystemId,
          fullName,
          username,
          phone,
          idNumber,
          parentName,
          grandparentName,
          registrationEmail,
          record.dateOfBirth || null,
          record.gender || null,
          record.currentSurname || null,
          verifiedGeneration,
          verifiedBranch,
          verifiedWifeNo,
          verifiedParentId,
          verifiedGrandparentId,
          registrationReviewNote
        ]
      );

      saved = result.rows[0];

      if (reservation) {
        await client.query('UPDATE registrations SET uses_descendant_reservation = TRUE WHERE registration_id = $1', [saved.registration_id]);
        await client.query(
          `UPDATE beneficiary_family_members
           SET registration_code_hash = NULL, registration_code_expires_at = NULL
           WHERE member_id = $1`,
          [reservation.member_id]
        );
      }

      for (const document of uploadedDocuments) {
        const file = req.files?.[document.field]?.[0];
        if (!file) continue;

        await client.query(
          `INSERT INTO registration_documents
             (registration_id, document_type, file_name, mime_type, file_size, file_data)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            saved.registration_id,
            document.type,
            file.originalname,
            file.mimetype,
            file.size,
            file.buffer
          ]
        );
      }

      const consumedOtp = await client.query(
        `DELETE FROM registration_otps
         WHERE otp_id = $1
         RETURNING otp_id`,
        [otpResult.rows[0].otp_id]
      );

      if (!consumedOtp.rows.length) {
        throw new Error('Registration verification code could not be consumed');
      }
    });

    return res.status(201).json({
      ok: true,
      registrationId: saved.registration_id,
      systemId: saved.applicant_system_id || null,
      applicationReference: saved.registration_id,
      registrationStatus: saved.status,
      submittedAt: saved.submitted_at,
      registration: {
        registrationId: saved.registration_id,
        systemId: saved.applicant_system_id || null,
        fullName,
        dateOfBirth: record.dateOfBirth || null,
        gender: record.gender || null,
        rootSurname: 'Guvaza',
        currentSurname: record.currentSurname || null,
        email: registrationEmail,
        username,
        phone,
        parentName: verifiedStructure?.verified_parent_name || parentName,
        parentId: verifiedParentId,
        grandparentName: verifiedStructure?.verified_grandparent_name || grandparentName,
        grandparentId: verifiedGrandparentId,
        generation: verifiedGeneration,
        branch: verifiedBranch,
        wifeNo: verifiedWifeNo,
        status: saved.status,
        submittedAt: saved.submitted_at
      },
      verification: serverVerification,
      familyStructureStatus: serverVerification.familyStructureStatus,
      reviewNotes: registrationReviewNote,
      serverAuthoritative: true,
    });

  } catch (error) {
    if (error?.code === 'REGISTRATION_DUPLICATE') {
      return res.status(409).json({
        ok: false,
        code: error.code,
        error: error.message,
        existingRegistrationId: error.registrationId,
        systemId: error.systemId || null
      });
    }

    if (error?.code === 'REGISTRATION_RESERVATION_INVALID') {
      return res.status(400).json({ ok: false, error: error.message });
    }

    if (error?.code === 'REGISTRATION_OTP_REQUIRED') {
      return res.status(400).json({
        ok: false,
        error: 'Email verification is required. Please request and verify a new code.'
      });
    }

    console.error('Registration submission error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to submit registration'
    });
  }
});

// ------------------------------------------------------------
// REGISTRATION LIST
// Server-backed registration records for Admin/Founder views.
// Reads directly from PostgreSQL.
// ------------------------------------------------------------

app.get('/api/registrations', requireRegistrationReviewer, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         registration_id,
         applicant_system_id,
         full_name,
         username,
         phone,
         id_number,
         parent_full_name,
         grandparent_full_name,
         email,
         date_of_birth,
         gender,
         current_surname,
         generation,
         branch_code,
         wife_no,
         parent_system_id,
         grandparent_system_id,
         status,
         review_notes,
         submitted_at
       FROM registrations
       ORDER BY submitted_at DESC`
    );

    return res.json({
      ok: true,
      count: result.rows.length,
      registrations: result.rows,
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Registration list API error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load registrations'
    });
  }
});

// ------------------------------------------------------------
// FOUNDER — READ-ONLY PENDING REGISTRATION RECONCILIATION PREVIEW
// Compares pending applications with the canonical family_people
// table. This endpoint NEVER updates registrations or beneficiaries.
// ------------------------------------------------------------
app.get('/api/registrations/reconciliation-preview', requireRegistrationReviewer, async (_req, res) => {
  try {
    const [pendingResult, peopleResult] = await Promise.all([
      query(`SELECT registration_id, applicant_system_id, full_name,
                    parent_full_name, grandparent_full_name,
                    parent_system_id, grandparent_system_id,
                    generation, branch_code, wife_no, status, submitted_at,
                    id_number
             FROM registrations
             WHERE UPPER(status) = 'PENDING'
             ORDER BY submitted_at DESC`),
      query(`SELECT system_id, parent_system_id, full_name, generation,
                    branch_code, profile
             FROM family_people
             ORDER BY generation, system_id`)
    ]);

    const people = peopleResult.rows;
    const byId = new Map(people.map(person => [String(person.system_id), person]));
    const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const byName = new Map();
    for (const person of people) {
      const key = norm(person.full_name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(person);
    }

    const duplicateCounts = new Map();
    for (const row of pendingResult.rows) {
      const key = String(row.id_number || '').replace(/\s+/g, '').toUpperCase();
      if (key) duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
    }

    const results = pendingResult.rows.map(reg => {
      let candidates = [];
      const submittedId = String(reg.applicant_system_id || '').trim();
      if (submittedId) {
        const bySystemId = byId.get(submittedId);
        candidates = bySystemId ? [bySystemId] : [];
      } else {
        candidates = byName.get(norm(reg.full_name)) || [];
        if (reg.parent_system_id) {
          candidates = candidates.filter(person => String(person.parent_system_id || '') === String(reg.parent_system_id));
        } else if (reg.parent_full_name) {
          const parentMatches = byName.get(norm(reg.parent_full_name)) || [];
          const parentIds = new Set(parentMatches.map(person => String(person.system_id)));
          candidates = candidates.filter(person => parentIds.has(String(person.parent_system_id || '')));
        }
      }

      let status = 'NO_MATCH';
      let match = null;
      let parent = null;
      let grandparent = null;
      let grandmotherWifeNo = null;
      let notes = [];

      if (candidates.length > 1) {
        status = 'AMBIGUOUS_MATCH';
        notes.push('More than one family-tree person matches; Founder review is required.');
      } else if (candidates.length === 1) {
        match = candidates[0];
        const nameMatches = norm(match.full_name) === norm(reg.full_name);
        const submittedIdMatches = !submittedId || submittedId === String(match.system_id);
        if (!nameMatches || !submittedIdMatches) {
          status = 'CONFLICT_REVIEW';
          notes.push('Submitted identity and family-tree identity do not agree.');
        } else {
          parent = byId.get(String(match.parent_system_id || '')) || null;
          grandparent = parent ? byId.get(String(parent.parent_system_id || '')) || null : null;
          const parentNameMatches = !reg.parent_full_name || (parent && norm(reg.parent_full_name) === norm(parent.full_name));
          const grandparentNameMatches = !reg.grandparent_full_name || (grandparent && norm(reg.grandparent_full_name) === norm(grandparent.full_name));
          if (!parent) notes.push('Parent record is missing from the family tree.');
          if (parent && !grandparent) notes.push('Grandparent record is missing from the family tree.');
          if (!parentNameMatches || !grandparentNameMatches) {
            status = 'CONFLICT_REVIEW';
            notes.push('Submitted parent or grandparent name conflicts with the family tree.');
          } else if (match.profile && match.profile.isPlaceholder) {
            status = 'PLACEHOLDER_REVIEW';
            notes.push('The matching family-tree entry is marked as a placeholder.');
          } else if (parent && grandparent) {
            grandmotherWifeNo = parent.profile?.wifeNo || null;
            status = 'EXACT_MATCH';
            if (!grandmotherWifeNo) notes.push('Grandmother wife-number is not recorded on the parent family-tree entry.');
          } else {
            status = 'PARTIAL_MATCH';
          }
        }
      } else {
        notes.push('No exact family-tree match was found using the available applicant and parent details.');
      }

      const duplicateKey = String(reg.id_number || '').replace(/\s+/g, '').toUpperCase();
      const duplicateApplication = Boolean(duplicateKey && duplicateCounts.get(duplicateKey) > 1);
      if (duplicateApplication) notes.push('Another pending application uses the same identity number; retain both for Founder reconciliation.');

      return {
        registrationId: reg.registration_id,
        applicantName: reg.full_name,
        submittedSystemId: submittedId || null,
        matchedSystemId: match?.system_id || null,
        parentName: parent?.full_name || reg.parent_full_name || null,
        parentSystemId: parent?.system_id || match?.parent_system_id || null,
        grandparentName: grandparent?.full_name || reg.grandparent_full_name || null,
        grandparentSystemId: grandparent?.system_id || parent?.parent_system_id || null,
        generation: match?.generation ?? reg.generation ?? null,
        branch: match?.branch_code || reg.branch_code || null,
        grandmotherWifeNo,
        status,
        duplicateApplication,
        submittedAt: reg.submitted_at,
        notes
      };
    });

    const summary = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      if (item.duplicateApplication) acc.duplicateApplications += 1;
      return acc;
    }, { total: results.length, duplicateApplications: 0 });

    return res.json({ ok: true, summary, registrations: results, readOnly: true, serverAuthoritative: true });
  } catch (error) {
    console.error('Registration reconciliation preview error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to prepare reconciliation preview' });
  }
});

// ------------------------------------------------------------
// FOUNDER-ONLY WIFE CORRECTION
// Correction is validated against the authoritative family register.
// It never approves or activates the beneficiary.
// ------------------------------------------------------------
function requireFounderForWifeCorrection(req, res, next) {
  if (String(req.admin?.role || '').toUpperCase() !== FOUNDER_ROLE) {
    return res.status(403).json({ ok: false, error: 'Only the Founder may correct a frozen wife-number selection.' });
  }
  return next();
}

app.get('/api/registrations/:registrationId/wife-correction', requireRegistrationReviewer, requireFounderForWifeCorrection, async (req, res) => {
  try {
    const registrationId = String(req.params.registrationId || '').trim();
    const result = await query(
      `SELECT r.registration_id, r.applicant_system_id, r.full_name, r.parent_system_id,
              r.parent_full_name, r.grandparent_system_id, r.grandparent_full_name,
              r.wife_no, r.status, r.review_notes,
              child.system_id AS family_system_id, child.full_name AS family_full_name,
              child.generation, child.branch_code,
              parent.system_id AS verified_parent_system_id,
              parent.full_name AS verified_parent_name,
              parent.profile->>'wifeNo' AS family_register_wife_no,
              grandparent.system_id AS verified_grandparent_system_id,
              grandparent.full_name AS verified_grandparent_name
       FROM registrations r
       LEFT JOIN family_people child
         ON child.system_id = r.applicant_system_id
        AND child.parent_system_id = r.parent_system_id
       LEFT JOIN family_people parent ON parent.system_id = child.parent_system_id
       LEFT JOIN family_people grandparent ON grandparent.system_id = parent.parent_system_id
       WHERE r.registration_id = $1
       LIMIT 1`,
      [registrationId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Registration not found.' });
    const r = result.rows[0];
    const notes = String(r.review_notes || '');
    if (String(r.status || '').toUpperCase() !== 'PENDING' || !notes.includes('WIFE_NUMBER_MISMATCH') || notes.includes('WIFE_NUMBER_CORRECTED')) {
      return res.status(409).json({ ok: false, error: 'This application does not have an open wife-correction case.' });
    }
    if (!r.family_system_id || !r.verified_parent_system_id) {
      return res.status(409).json({ ok: false, error: 'The applicant or parent could not be matched uniquely to the family register. Founder must resolve the family-record discrepancy before correcting the wife number.' });
    }
    const wifeMatch = String(r.family_register_wife_no || '').match(/^WIFE(\d+)(?:_|$)/i);
    const expectedWifeNo = wifeMatch ? Number(wifeMatch[1]) : null;
    if (!Number.isInteger(expectedWifeNo) || expectedWifeNo < 1 || expectedWifeNo > 8) {
      return res.status(409).json({ ok: false, error: 'The authoritative parent family-register record has no valid WIFE1–WIFE8 value. No correction can be made automatically.' });
    }
    return res.json({
      ok: true,
      case: {
        registrationId: r.registration_id,
        applicantName: r.full_name,
        familySystemId: r.family_system_id,
        parentName: r.verified_parent_name,
        parentSystemId: r.verified_parent_system_id,
        grandparentName: r.verified_grandparent_name,
        grandparentSystemId: r.verified_grandparent_system_id,
        generation: r.generation,
        branch: r.branch_code,
        currentRegistrationWifeNo: r.wife_no,
        authoritativeWifeNo: expectedWifeNo,
        familyRegisterWifeValue: r.family_register_wife_no,
        status: r.status,
        reviewNotes: r.review_notes
      },
      serverAuthoritative: true
    });
  } catch (error) {
    console.error('Founder wife-correction case load error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load wife-correction case.' });
  }
});

app.post('/api/registrations/:registrationId/wife-correction', requireRegistrationReviewer, requireFounderForWifeCorrection, async (req, res) => {
  try {
    const registrationId = String(req.params.registrationId || '').trim();
    const selectedWifeNo = Number(req.body?.wifeNo);
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isInteger(selectedWifeNo) || selectedWifeNo < 1 || selectedWifeNo > 8) {
      return res.status(400).json({ ok: false, error: 'Select a valid wife number from 1 to 8.' });
    }
    if (reason.length < 8) return res.status(400).json({ ok: false, error: 'Enter a correction reason of at least 8 characters.' });

    const updated = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT r.registration_id, r.applicant_system_id, r.full_name, r.parent_system_id,
                r.wife_no, r.status, r.review_notes,
                child.system_id AS family_system_id,
                parent.profile->>'wifeNo' AS family_register_wife_value
         FROM registrations r
         LEFT JOIN family_people child
           ON child.system_id = r.applicant_system_id
          AND child.parent_system_id = r.parent_system_id
         LEFT JOIN family_people parent ON parent.system_id = child.parent_system_id
         WHERE r.registration_id = $1
         FOR UPDATE OF r`,
        [registrationId]
      );
      if (!locked.rows.length) { const e = new Error('Registration not found.'); e.httpStatus = 404; throw e; }
      const r = locked.rows[0];
      const notes = String(r.review_notes || '');
      if (String(r.status || '').toUpperCase() !== 'PENDING' || !notes.includes('WIFE_NUMBER_MISMATCH') || notes.includes('WIFE_NUMBER_CORRECTED')) {
        const e = new Error('This application does not have an open wife-correction case.'); e.httpStatus = 409; throw e;
      }
      if (!r.family_system_id) { const e = new Error('Applicant family-register record is missing or does not match the recorded parent.'); e.httpStatus = 409; throw e; }
      const wifeMatch = String(r.family_register_wife_value || '').match(/^WIFE(\d+)(?:_|$)/i);
      const authoritativeWifeNo = wifeMatch ? Number(wifeMatch[1]) : null;
      if (!Number.isInteger(authoritativeWifeNo) || authoritativeWifeNo < 1 || authoritativeWifeNo > 8) {
        const e = new Error('Authoritative family-register wife number is missing or invalid.'); e.httpStatus = 409; throw e;
      }
      if (selectedWifeNo !== authoritativeWifeNo) {
        const e = new Error('Selected wife number does not match the authoritative family register. No changes were saved.'); e.httpStatus = 409; throw e;
      }
      const reviewerEmail = req.admin?.email || 'Founder';
      const reviewerId = req.admin?.admin_id || null;
      const auditNote = `WIFE_NUMBER_CORRECTED: FAMILY_STRUCTURE_VERIFIED_BY_FOUNDER: Founder confirmed WIFE${selectedWifeNo} against the authoritative family register. Corrected by ${reviewerEmail}. Reason: ${reason}`;
      const saved = await client.query(
        `UPDATE registrations
         SET wife_no = $2,
             review_notes = COALESCE(review_notes, '') || E'\\n\\n' || $3
         WHERE registration_id = $1 AND UPPER(status) = 'PENDING'
         RETURNING registration_id, applicant_system_id, full_name, wife_no, status, review_notes`,
        [registrationId, selectedWifeNo, auditNote]
      );
      if (!saved.rows.length) { const e = new Error('Registration changed while correction was being saved.'); e.httpStatus = 409; throw e; }
      await client.query(
        `INSERT INTO gft_admin_audit_events (event_id, admin_id, admin_email, action, details, ip_address, user_agent)
         VALUES ($1, $2, $3, 'REGISTRATION_WIFE_NUMBER_CORRECTED', $4::jsonb, $5, $6)`,
        [`AUD-${randomBytes(10).toString('hex')}`, reviewerId, reviewerEmail,
         JSON.stringify({ registrationId, applicantSystemId: r.applicant_system_id, selectedWifeNo, authoritativeWifeNo, reason, registrationStatusRemains: 'PENDING' }),
         req.ip || null, req.get('user-agent') || null]
      );
      return saved.rows[0];
    });
    return res.json({ ok: true, registration: updated, message: 'Wife number corrected against the family register. Registration remains PENDING.', serverAuthoritative: true });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ ok: false, error: error.message });
    console.error('Founder wife-correction save error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to save wife-number correction.' });
  }
});

// ------------------------------------------------------------
// FOUNDER REGISTRATION REVIEW — APPLICATION DETAILS
// Returns submitted application fields and document metadata.
// File bytes are delivered only through the protected document route.
// ------------------------------------------------------------
app.get('/api/registrations/:registrationId/review', requireRegistrationReviewer, async (req, res) => {
  try {
    const registrationId = String(req.params.registrationId || '').trim();
    const registrationResult = await query(
      `SELECT registration_id, applicant_system_id, full_name, username,
              phone, id_number, email, date_of_birth, gender, current_surname,
              generation, branch_code, wife_no, parent_system_id,
              grandparent_system_id, parent_full_name, grandparent_full_name,
              status, submitted_at, reviewed_at, review_notes
       FROM registrations WHERE registration_id = $1 LIMIT 1`,
      [registrationId]
    );
    if (!registrationResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Registration not found' });
    }
    const documentsResult = await query(
      `SELECT document_id, document_type, file_name, mime_type, file_size, created_at
       FROM registration_documents WHERE registration_id = $1 ORDER BY created_at ASC`,
      [registrationId]
    );
    return res.json({
      ok: true,
      registration: registrationResult.rows[0],
      documents: documentsResult.rows,
      serverAuthoritative: true
    });
  } catch (error) {
    console.error('Registration review detail error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load registration details' });
  }
});

// ------------------------------------------------------------
// FOUNDER REGISTRATION REVIEW — SECURE DOCUMENT DELIVERY
// ------------------------------------------------------------
app.get('/api/registrations/:registrationId/documents/:documentId', requireRegistrationReviewer, async (req, res) => {
  try {
    const result = await query(
      `SELECT file_name, mime_type, file_data
       FROM registration_documents
       WHERE registration_id = $1 AND document_id = $2 LIMIT 1`,
      [String(req.params.registrationId || '').trim(), String(req.params.documentId || '').trim()]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Registration document not found' });
    }
    const document = result.rows[0];
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    const mimeType = allowedTypes.has(document.mime_type) ? document.mime_type : 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(document.file_name || 'registration-document')}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(document.file_data);
  } catch (error) {
    console.error('Registration document delivery error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to retrieve registration document' });
  }
});

// ------------------------------------------------------------
// FOUNDER REGISTRATION REVIEW — NON-APPROVAL DECISIONS
// A reason is required and the application remains server-recorded.
// ------------------------------------------------------------
app.post('/api/registrations/:registrationId/decision', requireRegistrationReviewer, async (req, res) => {
  try {
    const registrationId = String(req.params.registrationId || '').trim();
    const decision = String(req.body?.decision || '').trim().toUpperCase();
    const reason = String(req.body?.reason || '').trim();
    const allowedDecisions = new Set(['REJECTED', 'NEEDS_INFORMATION', 'REFERRED']);
    if (!registrationId) return res.status(400).json({ ok: false, error: 'Registration ID is required' });
    if (!allowedDecisions.has(decision)) return res.status(400).json({ ok: false, error: 'Choose a valid review decision' });
    if (reason.length < 5) return res.status(400).json({ ok: false, error: 'Please provide a review note of at least 5 characters' });

    // NEEDS_INFORMATION and REFERRED remain PENDING so they can be
    // revisited after the applicant responds or verification is completed.
    // REJECTED is the only terminal non-approval status used here.
    const nextStatus = decision === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const reviewerLabel = req.admin?.email || req.admin?.admin_id || 'Authorised Admin';
    const reviewerId = req.admin?.admin_id || null;
    const note = `Decision: ${decision}\nReviewed by: ${reviewerLabel}\nReviewer ID: ${reviewerId || 'Unavailable'}\nReason: ${reason}`;

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE registrations
         SET status = $2,
             reviewed_at = NOW(),
             review_notes = CASE WHEN COALESCE(review_notes, '') = '' THEN $3 ELSE review_notes || E'\n\n' || $3 END
         WHERE registration_id = $1 AND UPPER(status) = 'PENDING'
         RETURNING registration_id, applicant_system_id, status, reviewed_at, review_notes`,
        [registrationId, nextStatus, note]
      );
      if (!updated.rows.length) {
        const exists = await client.query('SELECT status FROM registrations WHERE registration_id = $1 LIMIT 1', [registrationId]);
        if (!exists.rows.length) {
          const err = new Error('Registration not found'); err.httpStatus = 404; throw err;
        }
        const err = new Error(`This application is not currently reviewable (current status: ${exists.rows[0].status})`); err.httpStatus = 409; throw err;
      }
      await client.query(
        `INSERT INTO gft_admin_audit_events (event_id, admin_id, admin_email, action, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [`AUD-${randomBytes(10).toString('hex')}`, reviewerId, req.admin?.email || null, `REGISTRATION_${decision}`, JSON.stringify({ registrationId, nextStatus, reason }), req.ip || null, req.get('user-agent') || null]
      );
      return updated.rows[0];
    });
    return res.json({ ok: true, registration: result, serverAuthoritative: true });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ ok: false, error: error.message });
    console.error('Registration review decision error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to save the review decision' });
  }
});

// ------------------------------------------------------------
// FOUNDER APPROVED BENEFICIARY POOL — SERVER SOURCE OF TRUTH
// Does not modify the legacy browser-stored pool or payout records.
// ------------------------------------------------------------
app.get('/api/beneficiaries/admin/pool', requireRegistrationReviewer, async (_req, res) => {
  try {
    const result = await query(
      `SELECT beneficiary_id, system_id, membership, full_name, username,
              phone, identity_status, lineage_status, status, created_at
       FROM beneficiaries ORDER BY created_at DESC, full_name ASC`
    );
    return res.json({ ok: true, count: result.rows.length, beneficiaries: result.rows, serverAuthoritative: true });
  } catch (error) {
    console.error('Founder approved beneficiary pool error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load approved beneficiaries' });
  }
});

// ------------------------------------------------------------
// GFT VISA CARD ISSUANCE
// ------------------------------------------------------------

async function issueGftVisaCard({
  beneficiaryId,
  systemId
}) {
  const existingResult = await query(
    `SELECT
       card_id,
       beneficiary_id,
       system_id,
       card_number,
       card_last4,
       card_status,
       issued_at,
       expires_at
     FROM gft_visa_cards
     WHERE beneficiary_id = $1
        OR system_id = $2
     LIMIT 1`,
    [
      beneficiaryId,
      systemId
    ]
  );

  if (existingResult.rows.length > 0) {
    return existingResult.rows[0];
  }

  const sequenceResult = await query(
    `SELECT nextval(
       'gft_visa_card_number_seq'
     ) AS card_number`
  );

  const serial =
    String(
      sequenceResult.rows[0].card_number
    ).padStart(6, '0');

  const cardNumber =
    `GFT VISA ${serial}`;

  const cardLast4 =
    serial.slice(-4);

  const cardResult = await query(
    `INSERT INTO gft_visa_cards
       (
         beneficiary_id,
         system_id,
         card_number,
         card_last4,
         card_status
       )
     VALUES
       (
         $1,
         $2,
         $3,
         $4,
         'ACTIVE'
       )
     RETURNING
       card_id,
       beneficiary_id,
       system_id,
       card_number,
       card_last4,
       card_status,
       issued_at,
       expires_at`,
    [
      beneficiaryId,
      systemId,
      cardNumber,
      cardLast4
    ]
  );

  return cardResult.rows[0];
}

// ------------------------------------------------------------
// ADMIN — APPROVE REGISTRATION
//
// Approval is the point where a PENDING registration becomes
// an official server-side beneficiary.
//
// IMPORTANT:
// This does NOT create a GFT VISA card yet.
// The card will only be created after successful beneficiary
// activation.
// ------------------------------------------------------------

app.post(
  '/api/registrations/:registrationId/approve',
  requireRegistrationReviewer,
  async (req, res) => {
    try {
      const registrationId = String(req.params.registrationId || '').trim();
      const reason = String(req.body?.reason || 'Approved after registration review').trim();
      if (!registrationId) return res.status(400).json({ ok: false, error: 'Registration ID is required' });

      let registration;
      let beneficiary;
      let updatedRegistration;
      const reviewerId = req.admin?.admin_id || null;
      const reviewerEmail = req.admin?.email || null;

      await withTransaction(async (client) => {
        const registrationResult = await client.query(
          `SELECT registration_id, applicant_system_id, full_name, username, phone, id_number,
                  email, date_of_birth, gender, current_surname, generation, branch_code,
                  wife_no, parent_system_id, grandparent_system_id, parent_full_name,
                  grandparent_full_name, status,
                  (to_jsonb(registrations)->>'uses_descendant_reservation')::boolean AS uses_descendant_reservation
           FROM registrations WHERE registration_id = $1 LIMIT 1 FOR UPDATE`,
          [registrationId]
        );
        if (!registrationResult.rows.length) {
          const err = new Error('Registration not found'); err.httpStatus = 404; throw err;
        }
        registration = registrationResult.rows[0];
        if (String(registration.status || '').toUpperCase() !== 'PENDING') {
          const err = new Error(`Registration cannot be approved because its current status is ${registration.status}`); err.httpStatus = 409; throw err;
        }
        const systemId = String(registration.applicant_system_id || '').trim();
        if (!systemId) {
          const err = new Error('Registration does not have a valid GFT System ID'); err.httpStatus = 400; throw err;
        }
        const existing = await client.query(
          `SELECT beneficiary_id, system_id, membership, full_name, status
           FROM beneficiaries WHERE system_id = $1 LIMIT 1`, [systemId]
        );
        if (existing.rows.length) {
          const err = new Error('This registration already has a beneficiary record'); err.httpStatus = 409; throw err;
        }

        if (registration.uses_descendant_reservation) {
          await client.query(
            'SELECT system_id FROM family_people WHERE system_id = $1 FOR UPDATE',
            [registration.parent_system_id]
          );
          const official = await client.query(
            `INSERT INTO family_people (system_id, parent_system_id, full_name, gender,
                                       generation, branch_code, date_of_birth)
             SELECT $1, parent.system_id, $2, $3, $4, $5, $6
             FROM family_people parent
             JOIN beneficiaries owner ON owner.system_id = parent.system_id AND UPPER(owner.status) = 'ACTIVE'
             WHERE parent.system_id = $7 AND parent.generation = $4::integer - 1
               AND parent.profile->>'isPlaceholder' IS DISTINCT FROM 'true'
               AND parent.parent_system_id IS NOT DISTINCT FROM $8
               AND NOT EXISTS (
                 SELECT 1 FROM family_people existing
                 WHERE existing.parent_system_id = parent.system_id
                   AND REGEXP_REPLACE(UPPER(TRIM(existing.full_name)), '[[:space:]]+', ' ', 'g')
                     = REGEXP_REPLACE(UPPER(TRIM($2)), '[[:space:]]+', ' ', 'g')
               )
             ON CONFLICT (system_id) DO NOTHING
             RETURNING system_id`,
            [systemId, registration.full_name, registration.gender, registration.generation,
             registration.branch_code, registration.date_of_birth, registration.parent_system_id,
             registration.grandparent_system_id]
          );
          if (!official.rows.length) {
            const error = new Error('The reserved ID or parent link conflicts with the official Family Lineage. Review the family record before approving.');
            error.httpStatus = 409;
            throw error;
          }
        }

        const membership = `GFT-MEM-${systemId}`;
        const profile = {
          parentId: registration.parent_system_id || null,
          grandparentId: registration.grandparent_system_id || null,
          parentName: registration.parent_full_name || null,
          grandparentName: registration.grandparent_full_name || null,
          generation: registration.generation || null,
          branch: registration.branch_code || null,
          wifeNo: registration.wife_no || null,
          gender: registration.gender || null,
          dateOfBirth: registration.date_of_birth || null,
          currentSurname: registration.current_surname || null,
          email: registration.email || null,
          registrationId: registration.registration_id,
          approvedAt: new Date().toISOString(),
          approvedByAdminId: reviewerId,
          approvedByAdminEmail: reviewerEmail
        };
        const beneficiaryResult = await client.query(
          `INSERT INTO beneficiaries (system_id, membership, full_name, username, phone, id_number,
             identity_status, lineage_status, status, profile)
           VALUES ($1, $2, $3, $4, $5, $6, 'VERIFIED', 'VERIFIED', 'ACTIVE', $7::jsonb)
           RETURNING beneficiary_id, system_id, membership, full_name, username, phone,
                     identity_status, lineage_status, status, profile, created_at`,
          [systemId, membership, registration.full_name, registration.username, registration.phone,
           registration.id_number, JSON.stringify(profile)]
        );
        beneficiary = beneficiaryResult.rows[0];

        const note = `Decision: APPROVED\nReviewed by: ${reviewerEmail || reviewerId || 'Authorised Admin'}\nReviewer ID: ${reviewerId || 'Unavailable'}\nReason: ${reason}`;
        const updatedResult = await client.query(
          `UPDATE registrations SET status = 'APPROVED', reviewed_at = NOW(),
             review_notes = CASE WHEN COALESCE(review_notes, '') = '' THEN $2 ELSE review_notes || E'\n\n' || $2 END
           WHERE registration_id = $1 AND UPPER(status) = 'PENDING'
           RETURNING registration_id, applicant_system_id, status, reviewed_at`,
          [registrationId, note]
        );
        if (!updatedResult.rows.length) {
          const err = new Error('Registration status changed before approval could be completed'); err.httpStatus = 409; throw err;
        }
        updatedRegistration = updatedResult.rows[0];
        await client.query(
          `INSERT INTO gft_admin_audit_events (event_id, admin_id, admin_email, action, details, ip_address, user_agent)
           VALUES ($1, $2, $3, 'REGISTRATION_APPROVED', $4::jsonb, $5, $6)`,
          [`AUD-${randomBytes(10).toString('hex')}`, reviewerId, reviewerEmail,
           JSON.stringify({ registrationId, beneficiaryId: beneficiary.beneficiary_id, systemId, reason }),
           req.ip || null, req.get('user-agent') || null]
        );
      });

      // Existing Visa-card issuance behaviour is preserved. It runs after
      // the atomic beneficiary/registration approval transaction completes.
      const gftVisaCard = await issueGftVisaCard({
        beneficiaryId: beneficiary.beneficiary_id,
        systemId: beneficiary.system_id
      });

      return res.json({
        ok: true,
        registration: {
          registrationId: updatedRegistration.registration_id,
          systemId: updatedRegistration.applicant_system_id,
          status: updatedRegistration.status,
          reviewedAt: updatedRegistration.reviewed_at
        },
        beneficiary: {
          beneficiaryId: beneficiary.beneficiary_id,
          systemId: beneficiary.system_id,
          membership: beneficiary.membership,
          fullName: beneficiary.full_name,
          username: beneficiary.username,
          identityStatus: beneficiary.identity_status,
          lineageStatus: beneficiary.lineage_status,
          status: beneficiary.status,
          profile: beneficiary.profile
        },
        gftVisaCard: {
          created: true,
          cardId: gftVisaCard.card_id,
          cardNumber: gftVisaCard.card_number,
          cardLast4: gftVisaCard.card_last4,
          cardStatus: gftVisaCard.card_status,
          issuedAt: gftVisaCard.issued_at,
          expiresAt: gftVisaCard.expires_at
        },
        serverAuthoritative: true
      });
    } catch (error) {
      if (error.httpStatus) return res.status(error.httpStatus).json({ ok: false, error: error.message });
      console.error('Registration approval error:', error);
      return res.status(500).json({ ok: false, error: 'Unable to approve registration' });
    }
  }
);

// ------------------------------------------------------------
// ADMIN AUTHENTICATION
// Server-controlled Admin sessions.
// ------------------------------------------------------------

const ADMIN_SESSION_COOKIE = 'gft_admin_session';
const ADMIN_SESSION_HOURS = 8;

// ------------------------------------------------------------
// FOUNDER CONTROLLER
// The Founder is a distinct server-level authority.
// This must never convert or replace an existing Admin role.
// ------------------------------------------------------------

const FOUNDER_EMAIL =
  String(
    process.env.GFT_FOUNDER_EMAIL ||
    'fanniegee3011@gmail.com'
  )
    .trim()
    .toLowerCase();

const FOUNDER_ROLE = 'FOUNDER';

function sha256(value) {
  return createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');

    if (separator === -1) continue;

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return '';
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax; ` +
    `${secure ? 'Secure; ' : ''}` +
    `Max-Age=${ADMIN_SESSION_HOURS * 60 * 60}`
  );
}

function clearAdminCookie(res) {
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax; ` +
    `${secure ? 'Secure; ' : ''}` +
    `Max-Age=0`
  );
}

// ------------------------------------------------------------
// BENEFICIARY AUTHENTICATION
// Server-controlled Beneficiary sessions.
// ------------------------------------------------------------

const BENEFICIARY_SESSION_COOKIE =
  'gft_beneficiary_session';

const BENEFICIARY_SESSION_HOURS = 8;

function setBeneficiaryCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader(
    'Set-Cookie',
    `${BENEFICIARY_SESSION_COOKIE}=${encodeURIComponent(token)}; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax; ` +
    `${secure ? 'Secure; ' : ''}` +
    `Max-Age=${BENEFICIARY_SESSION_HOURS * 60 * 60}`
  );
}

function clearBeneficiaryCookie(res) {
  const secure = process.env.NODE_ENV === 'production';

  res.setHeader(
    'Set-Cookie',
    `${BENEFICIARY_SESSION_COOKIE}=; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax; ` +
    `${secure ? 'Secure; ' : ''}` +
    `Max-Age=0`
  );
}

async function createBeneficiarySession(
  req,
  res,
  beneficiaryId
) {
  const rawToken =
    randomBytes(32).toString('hex');

  const tokenHash = sha256(rawToken);

  const expiresAt = new Date(
    Date.now() +
    BENEFICIARY_SESSION_HOURS *
    60 *
    60 *
    1000
  );

  await query(
    `INSERT INTO beneficiary_sessions
       (
         beneficiary_id,
         token_hash,
         expires_at
       )
     VALUES ($1, $2, $3)`,
    [
      beneficiaryId,
      tokenHash,
      expiresAt
    ]
  );

  setBeneficiaryCookie(res, rawToken);

  return {
    expiresAt
  };
}

async function getAuthenticatedBeneficiary(req) {
  const rawToken = getCookie(
    req,
    BENEFICIARY_SESSION_COOKIE
  );

  if (!rawToken) {
    return null;
  }

  const tokenHash = sha256(rawToken);

  const result = await query(
    `SELECT
       b.beneficiary_id,
       b.system_id,
       b.membership,
       b.full_name,
       b.username,
       b.phone,
       b.identity_status,
       b.lineage_status,
       b.status,
       b.profile,
       s.session_id,
       s.expires_at
     FROM beneficiary_sessions s
     JOIN beneficiaries b
       ON b.beneficiary_id = s.beneficiary_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND UPPER(b.status) = 'ACTIVE'
     LIMIT 1`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const beneficiary = result.rows[0];

  await query(
    `UPDATE beneficiary_sessions
     SET last_used_at = NOW()
     WHERE session_id = $1`,
    [beneficiary.session_id]
  );

  return beneficiary;
}

// ------------------------------------------------------------
// BENEFICIARY LOGIN
// Server-authoritative beneficiary authentication.
// ------------------------------------------------------------

app.post('/api/beneficiary/login', async (req, res) => {
  try {
    const loginIdentifier =
      String(
        req.body?.loginIdentifier ||
        req.body?.username ||
        req.body?.phone ||
        ''
      ).trim();

    const identityValue =
      String(
        req.body?.identityValue ||
        req.body?.idNumber ||
        req.body?.membership ||
        ''
      ).trim();

    if (!loginIdentifier || !identityValue) {
      return res.status(400).json({
        ok: false,
        error: 'Login details are required'
      });
    }

    const result = await query(
      `SELECT
         beneficiary_id,
         system_id,
         membership,
         full_name,
         username,
         phone,
         id_number,
         identity_status,
         lineage_status,
         status,
         profile
       FROM beneficiaries
       WHERE
         (
           LOWER(COALESCE(username, '')) = LOWER($1)
           OR LOWER(COALESCE(phone, '')) = LOWER($1)
           OR LOWER(COALESCE(profile->>'email', '')) = LOWER($1)
           OR EXISTS (
             SELECT 1
             FROM registrations r
             WHERE r.applicant_system_id = beneficiaries.system_id
               AND LOWER(COALESCE(r.email, '')) = LOWER($1)
           )
         )
         AND
         (
           id_number = $2
           OR membership = $2
         )
         AND UPPER(status) IN ('ACTIVE', 'APPROVED')
       LIMIT 1`,
      [
        loginIdentifier,
        identityValue
      ]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid beneficiary login details'
      });
    }

    const beneficiary = result.rows[0];

    const session =
      await createBeneficiarySession(
        req,
        res,
        beneficiary.beneficiary_id
      );

    return res.json({
      ok: true,
      authenticated: true,
      beneficiary: {
        systemId: beneficiary.system_id,
        membership: beneficiary.membership,
        fullName: beneficiary.full_name,
        username: beneficiary.username,
        identityStatus:
          beneficiary.identity_status,
        lineageStatus:
          beneficiary.lineage_status,
        status: beneficiary.status,
        profile: beneficiary.profile
      },
      session: {
        expiresAt: session.expiresAt
      },
      serverAuthoritative: true
    });

  } catch (error) {
    console.error(
      'Beneficiary login error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to complete beneficiary login'
    });
  }
});

// ------------------------------------------------------------
// CURRENT BENEFICIARY SESSION
// ------------------------------------------------------------

app.get('/api/beneficiary/me', async (req, res) => {
  try {
    const beneficiary =
      await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    return res.json({
      ok: true,
      authenticated: true,
      beneficiary: {
        systemId: beneficiary.system_id,
        membership: beneficiary.membership,
        fullName: beneficiary.full_name,
        username: beneficiary.username,
        identityStatus:
          beneficiary.identity_status,
        lineageStatus:
          beneficiary.lineage_status,
        status: beneficiary.status,
        profile: beneficiary.profile
      },
      serverAuthoritative: true
    });


  } catch (error) {
    console.error(
      'Beneficiary session lookup error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to check beneficiary session'
    });
  }
});

// ------------------------------------------------------------
// AUTHENTICATED BENEFICIARY — MY DIRECT LINEAGE
// Uses the signed-in beneficiary's own system ID.
// Returns only that person's ancestors and descendants.
// ------------------------------------------------------------

app.get('/api/beneficiary/generation-tree', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);
    if (!beneficiary) return res.status(401).json({ ok: false, error: 'Beneficiary authentication required' });

    const result = await query(`
      WITH RECURSIVE pending_descendants AS (
        SELECT child.member_id, child.beneficiary_id, child.system_id,
               parent.system_id AS parent_id, child.full_name,
               parent.generation + 1 AS generation, parent.branch_code,
               ARRAY[child.member_id] AS member_path
        FROM beneficiary_family_members child
        JOIN beneficiaries owner ON owner.beneficiary_id = child.beneficiary_id
          AND owner.system_id = child.parent_system_id AND UPPER(owner.status) = 'ACTIVE'
        JOIN family_people parent ON parent.system_id = owner.system_id
        WHERE child.member_type = 'DESCENDANT' AND child.parent_member_id IS NULL
          AND parent.profile->>'isPlaceholder' IS DISTINCT FROM 'true'

        UNION ALL

        SELECT child.member_id, child.beneficiary_id, child.system_id,
               parent.system_id, child.full_name, parent.generation + 1,
               parent.branch_code, parent.member_path || child.member_id
        FROM pending_descendants parent
        JOIN beneficiary_family_members child ON child.parent_member_id = parent.member_id
          AND child.beneficiary_id = parent.beneficiary_id
        WHERE child.member_type = 'DESCENDANT'
          AND NOT (child.member_id = ANY(parent.member_path))
      )
      SELECT child.system_id, child.parent_id, child.full_name,
             child.generation, child.branch_code, TRUE AS pending_registration
      FROM pending_descendants child
      WHERE NOT EXISTS (SELECT 1 FROM family_people official WHERE official.system_id = child.system_id)

      UNION ALL

      SELECT official.system_id, official.parent_system_id, official.full_name,
             official.generation, official.branch_code, FALSE
      FROM family_people official
      WHERE EXISTS (
        SELECT 1 FROM registrations registration
        WHERE registration.applicant_system_id = official.system_id
          AND UPPER(registration.status) = 'APPROVED'
          AND to_jsonb(registration)->>'uses_descendant_reservation' = 'true'
      )
    `);

    const members = result.rows.map(row => ({
      systemId: row.system_id,
      parentId: row.parent_id,
      fullName: row.full_name,
      generation: row.generation,
      branch: row.branch_code,
      pendingRegistration: row.pending_registration
    }));
    return res.set('Cache-Control', 'no-store').json({ ok: true, members });
  } catch (error) {
    console.error('Beneficiary generation tree error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load the latest family records' });
  }
});

app.get('/api/beneficiary/lineage', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const systemId = String(beneficiary.system_id || '').trim();

    if (!systemId) {
      return res.status(409).json({
        ok: false,
        error: 'Your beneficiary account does not have a valid System ID.'
      });
    }

    const result = await query(
      `WITH RECURSIVE
       ancestors AS (
         SELECT
           fp.system_id,
           fp.parent_system_id,
           ARRAY[fp.system_id]::text[] AS path
         FROM family_people fp
         WHERE fp.system_id = $1

         UNION ALL

         SELECT
           parent.system_id,
           parent.parent_system_id,
           ancestors.path || parent.system_id
         FROM family_people parent
         JOIN ancestors
           ON parent.system_id = ancestors.parent_system_id
         WHERE NOT parent.system_id = ANY(ancestors.path)
       ),
       descendants AS (
         SELECT
           fp.system_id,
           fp.parent_system_id,
           ARRAY[fp.system_id]::text[] AS path
         FROM family_people fp
         WHERE fp.system_id = $1

         UNION ALL

         SELECT
           child.system_id,
           child.parent_system_id,
           descendants.path || child.system_id
         FROM family_people child
         JOIN descendants
           ON child.parent_system_id = descendants.system_id
         WHERE NOT child.system_id = ANY(descendants.path)
       ),
       relevant_people AS (
         SELECT system_id FROM ancestors
         UNION
         SELECT system_id FROM descendants
       )
       SELECT
         fp.system_id,
         fp.parent_system_id,
         fp.full_name,
         fp.gender,
         fp.generation,
         fp.branch_code,
         fp.date_of_birth,
         fp.profile
       FROM family_people fp
       JOIN relevant_people rp
         ON rp.system_id = fp.system_id
       ORDER BY fp.generation, fp.system_id`,
      [systemId]
    );

    const people = result.rows.map(row => {
      const profile =
        row.profile && typeof row.profile === 'object'
          ? row.profile
          : {};

      return {
        systemId: row.system_id,
        parentId: row.parent_system_id || null,
        fullName: row.full_name,
        gender: row.gender || profile.gender || '',
        generation: row.generation || profile.generation || null,
        branch: row.branch_code || profile.branch || profile.branchCode || '',
        dateOfBirth: row.date_of_birth || null,
        rootSurname: profile.rootSurname || 'Guvaza',
        currentSurname:
          profile.currentSurname ||
          profile.rootSurname ||
          'Guvaza',
        wifeNo: profile.wifeNo || null,
        isPlaceholder: Boolean(profile.isPlaceholder)
      };
    });

    if (!people.some(person => person.systemId === systemId)) {
      return res.status(404).json({
        ok: false,
        error: 'Your account is not yet linked to a person in the family register.'
      });
    }

    return res.json({
      ok: true,
      systemId,
      people,
      count: people.length,
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary direct lineage API error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load your registered family lineage.'
    });
  }
});

// ------------------------------------------------------------
// BENEFICIARY — MY DIRECT LINEAGE COLOUR SETTINGS
// Stores panel and personal card colours per beneficiary.
// Settings follow the authenticated account across devices.
// ------------------------------------------------------------

let beneficiaryLineageSettingsSchemaReady;

async function ensureBeneficiaryLineageSettingsSchema() {
  if (!beneficiaryLineageSettingsSchemaReady) {
    beneficiaryLineageSettingsSchemaReady = query(`
      CREATE TABLE IF NOT EXISTS beneficiary_lineage_settings (
        beneficiary_id TEXT PRIMARY KEY,
        panel_colour TEXT NOT NULL DEFAULT '#ffffff',
        personal_card_colour TEXT NOT NULL DEFAULT '#e8f4ec',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => true);
  }

  return beneficiaryLineageSettingsSchemaReady;
}


// GET the authenticated beneficiary's saved lineage colours.

app.get('/api/beneficiary/lineage/settings', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    await ensureBeneficiaryLineageSettingsSchema();

    const result = await query(
      `SELECT panel_colour, personal_card_colour
       FROM beneficiary_lineage_settings
       WHERE beneficiary_id = $1
       LIMIT 1`,
      [beneficiary.beneficiary_id]
    );

    const settings = result.rows[0] || {};

    return res.json({
      ok: true,
      panelColour: settings.panel_colour || '#ffffff',
      personalCardColour:
        settings.personal_card_colour || '#e8f4ec'
    });

  } catch (error) {
    console.error('Beneficiary lineage settings load error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load lineage colour settings'
    });
  }
});


// SAVE one or both lineage colours for the authenticated beneficiary.

app.put('/api/beneficiary/lineage/settings', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const panelColour =
      req.body?.panelColour === undefined
        ? null
        : String(req.body.panelColour).trim();

    const personalCardColour =
      req.body?.personalCardColour === undefined
        ? null
        : String(req.body.personalCardColour).trim();

    if (panelColour === null && personalCardColour === null) {
      return res.status(400).json({
        ok: false,
        error: 'No colour setting was supplied'
      });
    }

    if (
      panelColour !== null &&
      !/^#[0-9a-fA-F]{6}$/.test(panelColour)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid panel colour'
      });
    }

    if (
      personalCardColour !== null &&
      !/^#[0-9a-fA-F]{6}$/.test(personalCardColour)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid personal card colour'
      });
    }

    await ensureBeneficiaryLineageSettingsSchema();

    const result = await query(
      `INSERT INTO beneficiary_lineage_settings (
         beneficiary_id,
         panel_colour,
         personal_card_colour,
         updated_at
       )
       VALUES (
         $1,
         COALESCE($2, '#ffffff'),
         COALESCE($3, '#e8f4ec'),
         NOW()
       )
       ON CONFLICT (beneficiary_id)
       DO UPDATE SET
         panel_colour = COALESCE(
           $2,
           beneficiary_lineage_settings.panel_colour
         ),
         personal_card_colour = COALESCE(
           $3,
           beneficiary_lineage_settings.personal_card_colour
         ),
         updated_at = NOW()
       RETURNING panel_colour, personal_card_colour`,
      [
        beneficiary.beneficiary_id,
        panelColour,
        personalCardColour
      ]
    );

    return res.json({
      ok: true,
      panelColour: result.rows[0].panel_colour,
      personalCardColour: result.rows[0].personal_card_colour,
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary lineage settings save error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to save lineage colour settings'
    });
  }
});

// ------------------------------------------------------------
// BENEFICIARY — PRIVATE OFFICIAL LINEAGE PHOTOS
// Photos are stored separately for each beneficiary.
// Official family_people records remain unchanged.
// ------------------------------------------------------------

let beneficiaryLineagePhotoSchemaReady;

async function ensureBeneficiaryLineagePhotoSchema() {
  if (!beneficiaryLineagePhotoSchemaReady) {
    beneficiaryLineagePhotoSchemaReady = query(`
      CREATE TABLE IF NOT EXISTS beneficiary_lineage_photos (
        beneficiary_id TEXT NOT NULL,
        system_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (beneficiary_id, system_id)
      )
    `).then(() => true);
  }

  return beneficiaryLineagePhotoSchemaReady;
}


// Upload or replace a private photograph for an official
// person in the authenticated beneficiary's own lineage.

app.post(
  '/api/beneficiary/lineage/:systemId/photo',
  beneficiaryPhotoUpload.single('photo'),
  async (req, res) => {
    try {
      const beneficiary = await getAuthenticatedBeneficiary(req);

      if (!beneficiary) {
        return res.status(401).json({
          ok: false,
          error: 'Beneficiary authentication required'
        });
      }

      const file = req.file;

      if (!file || !validFamilyPhoto(file)) {
        return res.status(400).json({
          ok: false,
          error: 'Please select a valid JPG, PNG, or WebP image'
        });
      }

      const systemId = String(req.params.systemId || '').trim();

      if (!systemId) {
        return res.status(400).json({
          ok: false,
          error: 'Family System ID is required'
        });
      }

      await ensureBeneficiaryLineagePhotoSchema();

      // Confirm that the requested person belongs to this
      // beneficiary's official ancestors or descendants.

      const access = await query(
        `WITH RECURSIVE
         ancestors AS (
           SELECT
             system_id,
             parent_system_id,
             ARRAY[system_id]::text[] AS path
           FROM family_people
           WHERE system_id = $1

           UNION ALL

           SELECT
             parent.system_id,
             parent.parent_system_id,
             ancestors.path || parent.system_id
           FROM family_people parent
           JOIN ancestors
             ON parent.system_id = ancestors.parent_system_id
           WHERE NOT parent.system_id = ANY(ancestors.path)
         ),
         descendants AS (
           SELECT
             system_id,
             parent_system_id,
             ARRAY[system_id]::text[] AS path
           FROM family_people
           WHERE system_id = $1

           UNION ALL

           SELECT
             child.system_id,
             child.parent_system_id,
             descendants.path || child.system_id
           FROM family_people child
           JOIN descendants
             ON child.parent_system_id = descendants.system_id
           WHERE NOT child.system_id = ANY(descendants.path)
         )
         SELECT system_id
         FROM ancestors
         WHERE system_id = $2

         UNION

         SELECT system_id
         FROM descendants
         WHERE system_id = $2
         LIMIT 1`,
        [beneficiary.system_id, systemId]
      );

      if (!access.rows.length) {
        return res.status(403).json({
          ok: false,
          error: 'This person is not within your registered direct lineage.'
        });
      }

      await query(
        `INSERT INTO beneficiary_lineage_photos (
           beneficiary_id,
           system_id,
           mime_type,
           original_name,
           file_data
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (beneficiary_id, system_id)
         DO UPDATE SET
           mime_type = EXCLUDED.mime_type,
           original_name = EXCLUDED.original_name,
           file_data = EXCLUDED.file_data,
           updated_at = NOW()`,
        [
          String(beneficiary.beneficiary_id),
          systemId,
          file.mimetype,
          file.originalname,
          file.buffer
        ]
      );

      res.set('Cache-Control', 'no-store');

      return res.json({
        ok: true,
        message: 'Lineage photograph saved successfully'
      });

    } catch (error) {
      console.error('Beneficiary lineage photo upload error:', error);

      return res.status(500).json({
        ok: false,
        error: 'Unable to save lineage photograph'
      });
    }
  }
);


// Deliver a lineage photograph only to the beneficiary
// who uploaded it.

app.get(
  '/api/beneficiary/lineage/:systemId/photo',
  async (req, res) => {
    try {
      const beneficiary = await getAuthenticatedBeneficiary(req);

      if (!beneficiary) {
        return res.status(401).end();
      }

      await ensureBeneficiaryLineagePhotoSchema();

      const result = await query(
        `SELECT mime_type, file_data
         FROM beneficiary_lineage_photos
         WHERE beneficiary_id = $1
           AND system_id = $2
         LIMIT 1`,
        [
          String(beneficiary.beneficiary_id),
          String(req.params.systemId || '').trim()
        ]
      );

      if (!result.rows.length || !result.rows[0].file_data) {
        return res.status(404).end();
      }

      const photo = result.rows[0];

      res.set({
        'Content-Type': photo.mime_type,
        'Content-Length': String(photo.file_data.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });

      return res.send(photo.file_data);

    } catch (error) {
      console.error('Beneficiary lineage photo delivery error:', error);
      return res.status(500).end();
    }
  }
);


// ============================================================
// BENEFICIARY — PERSONAL FAMILY EXTENSION
// Stores beneficiary-managed spouses and descendants.
// Official family_people records are never modified here.
// ============================================================


// ------------------------------------------------------------
// 1. LOAD PERSONAL FAMILY EXTENSION
// ------------------------------------------------------------

app.get('/api/beneficiary/family-extension', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const result = await query(
      `SELECT
         member_id,
         member_type,
         system_id,
         full_name,
         parent_system_id,
         parent_member_id,
         spouse_member_id,
         lineage_id,
         generation,
         family_position,
         card_colour,
         photo_document_id,
         profile,
         created_at,
         updated_at
       FROM beneficiary_family_members
       WHERE beneficiary_id = $1
       ORDER BY created_at ASC`,
      [beneficiary.beneficiary_id]
    );

    const members = result.rows.map(row => ({
      memberId: row.member_id,
      memberType: row.member_type,
      systemId: row.system_id,
      fullName: row.full_name,
      parentSystemId: row.parent_system_id,
      parentMemberId: row.parent_member_id,
      spouseMemberId: row.spouse_member_id,
      lineageId: row.lineage_id,
      generation: row.generation,
      familyPosition: row.family_position,
      cardColour: row.card_colour,
      photoDocumentId: row.photo_document_id,
photoUrl: row.photo_document_id
  ? `/api/beneficiary/family-extension/${row.member_id}/photo`
  : '',
      profile: row.profile || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return res.json({
      ok: true,
      members,
      spouses: members.filter(x => x.memberType === 'SPOUSE'),
      descendants: members.filter(x => x.memberType === 'DESCENDANT'),
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary family extension load error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load personal family records'
    });
  }
});

// ------------------------------------------------------------
// BENEFICIARY FAMILY PHOTOS — SERVER-SIDE STORAGE
// ------------------------------------------------------------

function validFamilyPhoto(file) {
  const b = file?.buffer;

  if (!b || b.length < 12) return false;

  if (
    file.mimetype === 'image/jpeg' &&
    b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  ) return true;

  if (
    file.mimetype === 'image/png' &&
    b.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) return true;

  if (
    file.mimetype === 'image/webp' &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) return true;

  return false;
}


// Upload or replace a personal family member's photograph.
app.post(
  '/api/beneficiary/family-extension/:memberId/photo',
  beneficiaryPhotoUpload.single('photo'),
  async (req, res) => {
    try {
      const beneficiary = await getAuthenticatedBeneficiary(req);

      if (!beneficiary) {
        return res.status(401).json({
          ok: false,
          error: 'Beneficiary authentication required'
        });
      }

      const file = req.file;

      if (!file || !validFamilyPhoto(file)) {
        return res.status(400).json({
          ok: false,
          error: 'Please select a valid JPG, PNG, or WebP image'
        });
      }

      const memberId = String(req.params.memberId || '').trim();

      const saved = await withTransaction(async (client) => {
        const memberResult = await client.query(
          `SELECT member_id, photo_document_id
           FROM beneficiary_family_members
           WHERE member_id = $1
             AND beneficiary_id = $2
           FOR UPDATE`,
          [memberId, beneficiary.beneficiary_id]
        );

        if (!memberResult.rows.length) {
          const error = new Error('Personal family member not found');
          error.statusCode = 404;
          throw error;
        }

        const currentDocumentId =
          memberResult.rows[0].photo_document_id;

        let documentId = currentDocumentId;

        if (documentId) {
          const existing = await client.query(
            `SELECT document_id
             FROM documents
             WHERE document_id = $1
               AND owner_system_id = $2
               AND document_type = 'BENEFICIARY_FAMILY_PHOTO'
             LIMIT 1`,
            [documentId, beneficiary.system_id]
          );

          if (!existing.rows.length) {
            documentId = null;
          }
        }

        if (documentId) {
          await client.query(
            `UPDATE documents
             SET storage_key = $1,
                 original_name = $2,
                 mime_type = $3,
                 size_bytes = $4,
                 file_data = $5
             WHERE document_id = $6
               AND owner_system_id = $7
               AND document_type = 'BENEFICIARY_FAMILY_PHOTO'`,
            [
              `beneficiary-family-photo/${randomBytes(16).toString('hex')}`,
              file.originalname,
              file.mimetype,
              file.size,
              file.buffer,
              documentId,
              beneficiary.system_id
            ]
          );
        } else {
          const inserted = await client.query(
            `INSERT INTO documents (
               owner_system_id,
               document_type,
               storage_key,
               original_name,
               mime_type,
               size_bytes,
               file_data
             )
             VALUES ($1, 'BENEFICIARY_FAMILY_PHOTO', $2, $3, $4, $5, $6)
             RETURNING document_id`,
            [
              beneficiary.system_id,
              `beneficiary-family-photo/${randomBytes(16).toString('hex')}`,
              file.originalname,
              file.mimetype,
              file.size,
              file.buffer
            ]
          );

          documentId = inserted.rows[0].document_id;

          await client.query(
            `UPDATE beneficiary_family_members
             SET photo_document_id = $1,
                 updated_at = NOW()
             WHERE member_id = $2
               AND beneficiary_id = $3`,
            [
              documentId,
              memberId,
              beneficiary.beneficiary_id
            ]
          );
        }

        return documentId;
      });

      res.set('Cache-Control', 'no-store');

      return res.json({
        ok: true,
        message: 'Family photograph saved successfully',
        photoDocumentId: saved
      });

    } catch (error) {
      console.error('Beneficiary family photo upload error:', error);

      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message || 'Unable to save family photograph'
      });
    }
  }
);


// Deliver a photograph only to its authenticated beneficiary.
app.get(
  '/api/beneficiary/family-extension/:memberId/photo',
  async (req, res) => {
    try {
      const beneficiary = await getAuthenticatedBeneficiary(req);

      if (!beneficiary) {
        return res.status(401).end();
      }

      const result = await query(
        `SELECT
           d.mime_type,
           d.file_data
         FROM beneficiary_family_members m
         JOIN documents d
           ON d.document_id = m.photo_document_id
         WHERE m.member_id = $1
           AND m.beneficiary_id = $2
           AND d.owner_system_id = $3
           AND d.document_type = 'BENEFICIARY_FAMILY_PHOTO'
         LIMIT 1`,
        [
          String(req.params.memberId || '').trim(),
          beneficiary.beneficiary_id,
          beneficiary.system_id
        ]
      );

      if (!result.rows.length || !result.rows[0].file_data) {
        return res.status(404).end();
      }

      const photo = result.rows[0];

      res.set({
        'Content-Type': photo.mime_type,
        'Content-Length': String(photo.file_data.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });

      return res.send(photo.file_data);

    } catch (error) {
      console.error('Beneficiary family photo delivery error:', error);
      return res.status(500).end();
    }
  }
);

// ------------------------------------------------------------
// 2. ADD A SPOUSE OR DESCENDANT
// The beneficiary identity always comes from the session.
// ------------------------------------------------------------

app.post('/api/beneficiary/family-extension/:memberId/registration-code', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);
    if (!beneficiary) return res.status(401).json({ ok: false, error: 'Beneficiary authentication required' });

    await ensureDescendantRegistrationSchema();
    const code = randomBytes(24).toString('base64url');
    const result = await withTransaction(async client => {
      const member = await client.query(
        'SELECT member_id FROM beneficiary_family_members WHERE member_id::text = $1 AND beneficiary_id = $2 FOR UPDATE',
        [req.params.memberId, beneficiary.beneficiary_id]
      );
      if (!member.rows.length) return member;
      return client.query(
      `UPDATE beneficiary_family_members child
       SET registration_code_hash = $1, registration_code_expires_at = NOW() + INTERVAL '30 days'
       FROM family_people parent
       WHERE child.member_id::text = $2 AND child.beneficiary_id = $3
         AND child.member_type = 'DESCENDANT' AND child.parent_member_id IS NULL
         AND child.parent_system_id = $4 AND parent.system_id = $4
         AND child.generation = parent.generation + 1
         AND parent.profile->>'isPlaceholder' IS DISTINCT FROM 'true'
         AND NOT EXISTS (SELECT 1 FROM family_people WHERE system_id = child.system_id)
         AND NOT EXISTS (SELECT 1 FROM registrations WHERE applicant_system_id = child.system_id
                         AND UPPER(status) <> 'REJECTED')
       RETURNING child.system_id`,
        [sha256(code), req.params.memberId, beneficiary.beneficiary_id, beneficiary.system_id]
      );
    });
    if (!result.rows.length) return res.status(409).json({
      ok: false, error: 'A code can only be issued by the verified parent for an unclaimed descendant reservation.'
    });
    return res.set('Cache-Control', 'no-store').json({ ok: true, systemId: result.rows[0].system_id, code });
  } catch (error) {
    console.error('Descendant registration code error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to issue the registration code' });
  }
});

app.post('/api/beneficiary/family-extension', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const memberType = String(req.body?.memberType || '')
      .trim()
      .toUpperCase();

    const fullName = String(req.body?.fullName || '').trim();

    const parentSystemId =
      String(req.body?.parentSystemId || '').trim() || null;

    const parentMemberId =
      String(req.body?.parentMemberId || '').trim() || null;

    const spouseMemberId =
      String(req.body?.spouseMemberId || '').trim() || null;

    const lineageId =
      String(req.body?.lineageId || '').trim() || null;

    const familyPosition =
      String(req.body?.familyPosition || '').trim() || null;

    const cardColour =
      String(req.body?.cardColour || '#e8f4ec').trim();

    let generation =
      req.body?.generation == null
        ? null
        : Number(req.body.generation);

    const profile =
      req.body?.profile &&
      typeof req.body.profile === 'object' &&
      !Array.isArray(req.body.profile)
        ? req.body.profile
        : {};

    if (!['SPOUSE', 'DESCENDANT'].includes(memberType)) {
      return res.status(400).json({
        ok: false,
        error: 'Member type must be SPOUSE or DESCENDANT'
      });
    }

    if (!fullName || fullName.length > 180) {
      return res.status(400).json({
        ok: false,
        error: 'Enter a valid full name'
      });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(cardColour)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid card colour'
      });
    }

    if (
      generation !== null &&
      (!Number.isInteger(generation) || generation < 1 || generation > 100)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid generation number'
      });
    }

    if (memberType === 'DESCENDANT') {
      if (!parentSystemId && !parentMemberId) {
        return res.status(400).json({
          ok: false,
          error: 'A descendant must have a parent'
        });
      }

      if (!lineageId || !/^FG-GEN\d+-\d+$/.test(lineageId)) {
        return res.status(400).json({
          ok: false,
          error: 'Enter a valid personal lineage ID'
        });
      }
    }

    if (memberType === 'SPOUSE' && !familyPosition) {
      return res.status(400).json({
        ok: false,
        error: 'A spouse family position is required'
      });
    }

    const memberId = randomBytes(16).toString('hex');

let systemId =
  memberType === 'SPOUSE'
    ? `S-${beneficiary.system_id}-${randomBytes(6).toString('hex').toUpperCase()}`
    : null;

    const saved = await withTransaction(async (client) => {

      // A personal parent must belong to this beneficiary.
      if (parentMemberId) {
        const parent = await client.query(
          `SELECT member_id
           FROM beneficiary_family_members
           WHERE member_id = $1
             AND beneficiary_id = $2
             AND member_type = 'DESCENDANT'
           LIMIT 1`,
          [parentMemberId, beneficiary.beneficiary_id]
        );

        if (!parent.rows.length) {
          const error = new Error('The selected personal parent was not found');
          error.statusCode = 400;
          throw error;
        }
      }

      // An official parent must exist in the official family register.
      if (parentSystemId) {
        const parent = await client.query(
          `SELECT system_id, generation
           FROM family_people
           WHERE system_id = $1
           LIMIT 1`,
          [parentSystemId]
        );

        if (!parent.rows.length) {
          const error = new Error('The selected official parent was not found');
          error.statusCode = 400;
          throw error;
        }
        const parentGeneration = parent.rows[0].generation;
        if (memberType === 'DESCENDANT' && !parentMemberId && Number.isInteger(parentGeneration) && parentGeneration >= 1) {
          generation = parentGeneration + 1;
        }
      }

      // A spouse association must point to this beneficiary's spouse.
      if (spouseMemberId) {
        const spouse = await client.query(
          `SELECT member_id
           FROM beneficiary_family_members
           WHERE member_id = $1
             AND beneficiary_id = $2
             AND member_type = 'SPOUSE'
           LIMIT 1`,
          [spouseMemberId, beneficiary.beneficiary_id]
        );

        if (!spouse.rows.length) {
          const error = new Error('The selected spouse was not found');
          error.statusCode = 400;
          throw error;
        }
      }

      // Check lineage ID against official and personal records.
      if (lineageId) {
        const duplicate = await client.query(
          `SELECT 1
           FROM beneficiary_family_members
           WHERE beneficiary_id = $1
             AND UPPER(lineage_id) = UPPER($2)

           UNION ALL

           SELECT 1
           FROM family_people
           WHERE UPPER(system_id) = UPPER($2)
           LIMIT 1`,
          [beneficiary.beneficiary_id, lineageId]
        );

        if (duplicate.rows.length) {
          const error = new Error('This lineage ID is already in use');
          error.statusCode = 409;
          throw error;
        }
      }

      if (memberType === 'DESCENDANT') {
  systemId = await generateGftSystemId(generation || 1, client);
}
       
      const inserted = await client.query(
        `INSERT INTO beneficiary_family_members (
           member_id,
           beneficiary_id,
           member_type,
           system_id,
           full_name,
           parent_system_id,
           parent_member_id,
           spouse_member_id,
           lineage_id,
           generation,
           family_position,
           card_colour,
           profile
         )
         VALUES (
           gen_random_uuid(),
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12::jsonb
         )
         RETURNING
           member_id,
           member_type,
           system_id,
           full_name,
           parent_system_id,
           parent_member_id,
           spouse_member_id,
           lineage_id,
           generation,
           family_position,
           card_colour,
           profile`,
        [
          beneficiary.beneficiary_id,
          memberType,
          systemId,
          fullName,
          parentSystemId,
          parentMemberId,
          spouseMemberId,
          lineageId,
          generation,
          familyPosition,
          cardColour,
          JSON.stringify(profile)
        ]
      );

      return inserted.rows[0];
    });

    return res.status(201).json({
      ok: true,
      message: 'Family member saved successfully',
      member: {
        memberId: saved.member_id,
        memberType: saved.member_type,
        systemId: saved.system_id,
        fullName: saved.full_name,
        parentSystemId: saved.parent_system_id,
        parentMemberId: saved.parent_member_id,
        spouseMemberId: saved.spouse_member_id,
        lineageId: saved.lineage_id,
        generation: saved.generation,
        familyPosition: saved.family_position,
        cardColour: saved.card_colour,
        profile: saved.profile || {}
      },
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary family extension save error:', error);

    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Unable to save family member'
    });
  }
});


// ------------------------------------------------------------
// 3. UPDATE A PERSONAL FAMILY MEMBER
// ------------------------------------------------------------

app.put('/api/beneficiary/family-extension/:memberId', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const memberId = String(req.params.memberId || '').trim();

    const fullName =
      req.body?.fullName === undefined
        ? null
        : String(req.body.fullName).trim();

    const cardColour =
      req.body?.cardColour === undefined
        ? null
        : String(req.body.cardColour).trim();

    const lineageId =
      req.body?.lineageId === undefined
        ? null
        : String(req.body.lineageId).trim();

    const familyPosition =
      req.body?.familyPosition === undefined
        ? null
        : String(req.body.familyPosition).trim();

    const spouseMemberId =
      req.body?.spouseMemberId === undefined
        ? null
        : String(req.body.spouseMemberId).trim() || null;

    const profile =
      req.body?.profile &&
      typeof req.body.profile === 'object' &&
      !Array.isArray(req.body.profile)
        ? req.body.profile
        : null;

    if (fullName !== null && (!fullName || fullName.length > 180)) {
      return res.status(400).json({
        ok: false,
        error: 'Enter a valid full name'
      });
    }

    if (cardColour !== null && !/^#[0-9a-fA-F]{6}$/.test(cardColour)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid card colour'
      });
    }

    if (lineageId !== null && lineageId && !/^FG-GEN\d+-\d+$/.test(lineageId)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid personal lineage ID'
      });
    }

    const updated = await withTransaction(async (client) => {

      const current = await client.query(
        `SELECT member_id, member_type
         FROM beneficiary_family_members
         WHERE member_id = $1
           AND beneficiary_id = $2
         FOR UPDATE`,
        [memberId, beneficiary.beneficiary_id]
      );

      if (!current.rows.length) {
        const error = new Error('Family member not found');
        error.statusCode = 404;
        throw error;
      }

      const memberType = current.rows[0].member_type;

      if (spouseMemberId) {
        const spouse = await client.query(
          `SELECT member_id
           FROM beneficiary_family_members
           WHERE member_id = $1
             AND beneficiary_id = $2
             AND member_type = 'SPOUSE'
           LIMIT 1`,
          [spouseMemberId, beneficiary.beneficiary_id]
        );

        if (!spouse.rows.length) {
          const error = new Error('The selected spouse was not found');
          error.statusCode = 400;
          throw error;
        }
      }

      const result = await client.query(
        `UPDATE beneficiary_family_members
         SET
           full_name = COALESCE($3, full_name),
           card_colour = COALESCE($4, card_colour),
           lineage_id = CASE
             WHEN $5::boolean THEN $6
             ELSE lineage_id
           END,
           family_position = CASE
             WHEN $7::boolean THEN $8
             ELSE family_position
           END,
           spouse_member_id = CASE
             WHEN $9::boolean THEN $10
             ELSE spouse_member_id
           END,
           profile = CASE
             WHEN $11::boolean THEN $12::jsonb
             ELSE profile
           END,
           updated_at = NOW()
         WHERE member_id = $1
           AND beneficiary_id = $2
         RETURNING
           member_id,
           member_type,
           system_id,
           full_name,
           parent_system_id,
           parent_member_id,
           spouse_member_id,
           lineage_id,
           generation,
           family_position,
           card_colour,
           profile`,
        [
          memberId,
          beneficiary.beneficiary_id,
          fullName,
          cardColour,
          lineageId !== null,
          lineageId,
          familyPosition !== null,
          familyPosition,
          req.body?.spouseMemberId !== undefined,
          spouseMemberId,
          profile !== null,
          JSON.stringify(profile || {})
        ]
      );

      return result.rows[0];
    });

    return res.json({
      ok: true,
      message: 'Family member updated successfully',
      member: updated,
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary family extension update error:', error);

    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Unable to update family member'
    });
  }
});


// ------------------------------------------------------------
// 4. DELETE A PERSONAL FAMILY MEMBER
// Deleting a parent also deletes its personal descendants
// through the migration's ON DELETE CASCADE relationship.
// ------------------------------------------------------------

app.delete('/api/beneficiary/family-extension/:memberId', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const memberId = String(req.params.memberId || '').trim();

    const result = await query(
      `DELETE FROM beneficiary_family_members
       WHERE member_id = $1
         AND beneficiary_id = $2
       RETURNING member_id, member_type, system_id`,
      [memberId, beneficiary.beneficiary_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'Family member not found'
      });
    }

    return res.json({
      ok: true,
      message: 'Family member deleted successfully',
      deleted: result.rows[0],
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Beneficiary family extension delete error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to delete family member'
    });
  }
});

// ------------------------------------------------------------
 // BENEFICIARY — WALLET BALANCE
 // ------------------------------------------------------------

app.get('/api/beneficiary/wallet', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const result = await query(
      `SELECT
         w.wallet_id,
         w.account_number,
         w.currency,
         COALESCE(
           SUM(
             CASE
               WHEN UPPER(le.entry_type) IN ('CREDIT', 'DEPOSIT')
                 THEN le.amount
               WHEN UPPER(le.entry_type) IN ('DEBIT', 'WITHDRAWAL')
                 THEN -le.amount
               ELSE 0
             END
           ),
           0
         ) AS balance
       FROM wallets w
       LEFT JOIN ledger_entries le
         ON le.wallet_id = w.wallet_id
       WHERE w.owner_system_id = $1
         AND UPPER(w.status) = 'ACTIVE'
       GROUP BY w.wallet_id, w.account_number, w.currency
       LIMIT 1`,
      [beneficiary.system_id]
    );

    const wallet = result.rows[0];

    return res.json({
      ok: true,
      wallet: wallet
        ? {
            walletId: wallet.wallet_id,
            accountNumber: wallet.account_number,
            currency: String(wallet.currency).trim(),
            balance: Number(wallet.balance)
          }
        : null,
      serverAuthoritative: true
    });
  } catch (error) {
    console.error('Beneficiary wallet API error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load beneficiary wallet'
    });
  }
});

// ------------------------------------------------------------
 // BENEFICIARY — PAYOUT REQUEST
 // ------------------------------------------------------------

app.post('/api/beneficiary/payouts', async (req, res) => {
  try {
    const beneficiary = await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || '').trim();
    const destination =
      req.body?.destination &&
      typeof req.body.destination === 'object' &&
      !Array.isArray(req.body.destination)
        ? req.body.destination
        : {};

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 1000000000 ||
      Math.round(amount * 100) !== amount * 100
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Enter a valid payout amount in USD'
      });
    }

    const walletResult = await query(
      `SELECT wallet_id, currency
       FROM wallets
       WHERE owner_system_id = $1
         AND UPPER(status) = 'ACTIVE'
         AND UPPER(TRIM(currency)) = 'USD'
       ORDER BY created_at ASC
       LIMIT 1`,
      [beneficiary.system_id]
    );

    if (!walletResult.rows.length) {
      return res.status(409).json({
        ok: false,
        error: 'No active USD wallet is available for this beneficiary'
      });
    }

    const wallet = walletResult.rows[0];

    const saved = await query(
      `INSERT INTO payout_requests
         (wallet_id, amount, currency, reason, destination, status)
       VALUES ($1, $2, 'USD', $3, $4::jsonb, 'PENDING_REVIEW')
       RETURNING
         payout_id, amount, currency, reason,
         destination, status, created_at`,
      [
        wallet.wallet_id,
        amount,
        reason || null,
        JSON.stringify(destination)
      ]
    );

    const payout = saved.rows[0];

    return res.status(201).json({
      ok: true,
      message: 'USD payout request submitted for Trust Office review',
      payout: {
        payoutId: payout.payout_id,
        amount: Number(payout.amount),
        currency: String(payout.currency).trim(),
        reason: payout.reason,
        destination: payout.destination,
        status: payout.status,
        createdAt: payout.created_at
      },
      serverAuthoritative: true
    });
  } catch (error) {
    console.error('Beneficiary payout request error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to submit payout request'
    });
  }
});

// ------------------------------------------------------------
// BENEFICIARY — GFT VISA CARD
// ------------------------------------------------------------

app.get('/api/beneficiary/card', async (req, res) => {
  try {
    const beneficiary =
      await getAuthenticatedBeneficiary(req);

    if (!beneficiary) {
      return res.status(401).json({
        ok: false,
        error: 'Beneficiary authentication required'
      });
    }

    const result = await query(
      `SELECT
         card_id,
         system_id,
         card_number,
         card_last4,
         card_status,
         issued_at,
         expires_at
       FROM gft_visa_cards
       WHERE beneficiary_id = $1
       LIMIT 1`,
      [beneficiary.beneficiary_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        card: null,
        issued: false,
        serverAuthoritative: true
      });
    }

    const card = result.rows[0];

    return res.json({
      ok: true,
      issued: true,
      card: {
        cardId: card.card_id,
        systemId: card.system_id,
        cardNumber: card.card_number,
        cardLast4: card.card_last4,
        cardStatus: card.card_status,
        issuedAt: card.issued_at,
        expiresAt: card.expires_at
      },
      serverAuthoritative: true
    });

  } catch (error) {
    console.error(
      'Beneficiary GFT VISA card API error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to load GFT VISA card'
    });
  }
});

// ------------------------------------------------------------
// BENEFICIARY LOGOUT
// ------------------------------------------------------------

app.post('/api/beneficiary/logout', async (req, res) => {
  try {
    const rawToken = getCookie(
      req,
      BENEFICIARY_SESSION_COOKIE
    );

    if (rawToken) {
      const tokenHash = sha256(rawToken);

      await query(
        `DELETE FROM beneficiary_sessions
         WHERE token_hash = $1`,
        [tokenHash]
      );
    }

    clearBeneficiaryCookie(res);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error(
      'Beneficiary logout error:',
      error
    );

    clearBeneficiaryCookie(res);

    return res.json({
      ok: true
    });
  }
});

async function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');

  const derivedKey = await scrypt(
    password,
    salt,
    64,
    {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    }
  );

  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

// ------------------------------------------------------------
// FOUNDER ACCOUNT CONTROLLER
// Ensures the designated Founder exists as a server account.
// The Founder remains separate from all Admin roles.
// ------------------------------------------------------------

async function ensureFounderAccount() {
  const founderPassword =
    String(
      process.env.GFT_FOUNDER_PASSWORD || ''
    );

  if (!founderPassword) {
    console.warn(
      'GFT_FOUNDER_PASSWORD is not set. Founder account was not created.'
    );
    return;
  }

  const existing = await query(
    `SELECT
       admin_id,
       email,
       role
     FROM gft_admin_accounts
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [FOUNDER_EMAIL]
  );

  if (existing.rows.length) {
    const founder = existing.rows[0];

    if (
      String(founder.role || '').toUpperCase() !==
      FOUNDER_ROLE
    ) {
      await query(
        `UPDATE gft_admin_accounts
         SET
           role = $1,
           status = 'ACTIVE',
           active = TRUE,
           updated_at = NOW()
         WHERE admin_id = $2`,
        [
          FOUNDER_ROLE,
          founder.admin_id
        ]
      );

      console.log(
        `Founder role established for ${FOUNDER_EMAIL}`
      );
    }

    return;
  }

  const passwordHash =
    await createPasswordHash(founderPassword);

  await query(
    `INSERT INTO gft_admin_accounts
       (
         admin_id,
         name,
         email,
         phone,
         role,
         permissions,
         tasks,
         deployment,
         password_hash,
         password_algorithm,
         status,
         active,
         invited_at,
         activated_at
       )
     VALUES
       (
         $1,
         $2,
         $3,
         NULL,
         $4,
         $5::jsonb,
         $6::jsonb,
         $7::jsonb,
         $8,
         'scrypt',
         'ACTIVE',
         TRUE,
         NOW(),
         NOW()
       )`,
    [
      'GFT-FOUNDER',
      'Founder',
      FOUNDER_EMAIL,
      FOUNDER_ROLE,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({}),
      passwordHash
    ]
  );

  console.log(
    `Founder account established: ${FOUNDER_EMAIL}`
  );
}

async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return false;
  }

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');

    if (parts.length !== 3) {
      return false;
    }

    const salt = parts[1];
    const expectedHex = parts[2];

    try {
      const derivedKey = await scrypt(
        password,
        salt,
        64,
        {
          N: 16384,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024
        }
      );

      const expected = Buffer.from(expectedHex, 'hex');
      const actual = Buffer.from(derivedKey);

      if (expected.length !== actual.length) {
        return false;
      }

      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  // Legacy GFT password format.
  // This is temporary and will only be used during migration.
  if (storedHash.startsWith('legacy_btoa_reverse$')) {
    const expected = storedHash.slice(
      'legacy_btoa_reverse$'.length
    );

    const actual = Buffer.from(
      Buffer.from(password, 'utf8')
        .toString('base64')
        .split('')
        .reverse()
        .join(''),
      'utf8'
    );

    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (actual.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actual, expectedBuffer);
  }

  return false;
}

async function createAdminSession(req, res, adminId) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);

  const sessionId = `GFT-SESSION-${randomBytes(12).toString('hex')}`;

  const expiresAt = new Date(
    Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000
  );

  await query(
    `INSERT INTO gft_admin_sessions
       (
         session_id,
         admin_id,
         token_hash,
         expires_at,
         ip_address,
         user_agent
       )
     VALUES
       ($1, $2, $3, $4, $5, $6)`,
    [
      sessionId,
      adminId,
      tokenHash,
      expiresAt,
      req.ip || null,
      req.get('user-agent') || null
    ]
  );

  setAdminCookie(res, rawToken);
}

async function getAuthenticatedAdmin(req) {
  const rawToken = getCookie(
    req,
    ADMIN_SESSION_COOKIE
  );

  if (!rawToken) {
    return null;
  }

  const tokenHash = sha256(rawToken);

  const result = await query(
    `SELECT
       a.admin_id,
       a.name,
       a.email,
       a.phone,
       a.role,
       a.permissions,
       a.tasks,
       a.deployment,
       a.status,
       a.active,
       a.last_login_at,
       s.session_id,
       s.expires_at
     FROM gft_admin_sessions s
     JOIN gft_admin_accounts a
       ON a.admin_id = s.admin_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND a.active = TRUE
       AND UPPER(a.status) = 'ACTIVE'
     LIMIT 1`,
    [tokenHash]
  );

  if (!result.rows.length) {
    return null;
  }

  await query(
    `UPDATE gft_admin_sessions
     SET last_seen_at = NOW()
     WHERE token_hash = $1`,
    [tokenHash]
  );

  return result.rows[0];
}

// ------------------------------------------------------------
// LEGACY ADMIN MIGRATION BRIDGE
// One-time protected migration of the existing LocalStorage Admin.
// ------------------------------------------------------------

app.post('/api/admin/migrate-legacy', async (req, res) => {
  try {
    const migrationSecret =
      process.env.GFT_ADMIN_MIGRATION_SECRET || '';

    const suppliedSecret =
      String(req.headers['x-gft-migration-secret'] || '');

    if (
      !migrationSecret ||
      !suppliedSecret ||
      suppliedSecret !== migrationSecret
    ) {
      return res.status(403).json({
        ok: false,
        error: 'Migration authorization failed'
      });
    }

    const body = req.body || {};

    const adminId = String(body.id || '').trim();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const role = String(body.role || '').trim();

    const passwordHash = String(
      body.passwordHash || ''
    ).trim();

    if (
      !adminId ||
      !name ||
      !email ||
      !role ||
      !passwordHash
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Required Admin migration data is missing'
      });
    }

    // Only accept the old GFT password verifier.
    // Never accept a plaintext password.
    const legacyVerifier =
      `legacy_btoa_reverse$${passwordHash}`;

    if (
      !passwordHash ||
      passwordHash.length > 1000
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid legacy password verifier'
      });
    }

    const permissions =
      Array.isArray(body.permissions)
        ? body.permissions
        : [];

    const tasks =
      Array.isArray(body.tasks)
        ? body.tasks
        : [];

    const deployment =
      body.deployment &&
      typeof body.deployment === 'object'
        ? body.deployment
        : {};

    await query('BEGIN');

    try {
      const existing = await query(
        `SELECT
           admin_id,
           email,
           password_hash,
           password_algorithm
         FROM gft_admin_accounts
         WHERE admin_id = $1
            OR LOWER(email) = $2
         LIMIT 1
         FOR UPDATE`,
        [
          adminId,
          email
        ]
      );

      if (existing.rows.length) {
        const current = existing.rows[0];

        // Do not silently overwrite an existing server Admin.
        // The migration is only allowed when it refers to
        // the same legacy account.
        if (
          current.admin_id !== adminId ||
          String(current.email).toLowerCase() !== email
        ) {
          await query('ROLLBACK');

          return res.status(409).json({
            ok: false,
            error: 'A different Admin account already exists'
          });
        }

        await query(
          `UPDATE gft_admin_accounts
           SET
             name = $1,
             phone = $2,
             role = $3,
             permissions = $4::jsonb,
             tasks = $5::jsonb,
             deployment = $6::jsonb,
             password_hash = $7,
             password_algorithm = 'legacy_btoa_reverse',
             status = $8,
             active = $9,
             invited_at = $10,
             activated_at = $11,
             updated_at = NOW()
           WHERE admin_id = $12`,
          [
            name,
            phone || null,
            role,
            JSON.stringify(permissions),
            JSON.stringify(tasks),
            JSON.stringify(deployment),
            legacyVerifier,
            body.status
              ? String(body.status).toUpperCase()
              : 'ACTIVE',
            body.active === true,
            body.dateInvited
              ? new Date(body.dateInvited)
              : null,
            body.active === true
              ? new Date()
              : null,
            adminId
          ]
        );
      } else {
        await query(
          `INSERT INTO gft_admin_accounts
             (
               admin_id,
               name,
               email,
               phone,
               role,
               permissions,
               tasks,
               deployment,
               password_hash,
               password_algorithm,
               status,
               active,
               invited_at,
               activated_at
             )
           VALUES
             (
               $1,
               $2,
               $3,
               $4,
               $5,
               $6::jsonb,
               $7::jsonb,
               $8::jsonb,
               $9,
               'legacy_btoa_reverse',
               $10,
               $11,
               $12,
               $13
             )`,
          [
            adminId,
            name,
            email,
            phone || null,
            role,
            JSON.stringify(permissions),
            JSON.stringify(tasks),
            JSON.stringify(deployment),
            legacyVerifier,
            body.status
              ? String(body.status).toUpperCase()
              : 'ACTIVE',
            body.active === true,
            body.dateInvited
              ? new Date(body.dateInvited)
              : null,
            body.active === true
              ? new Date()
              : null
          ]
        );
      }

      await query(
        `INSERT INTO gft_admin_audit_events
           (
             event_id,
             admin_id,
             admin_email,
             action,
             details,
             ip_address,
             user_agent
           )
         VALUES
           ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `AUD-${randomBytes(10).toString('hex')}`,
          adminId,
          email,
          'ADMIN_LEGACY_MIGRATED',
          JSON.stringify({
            source: 'localStorage',
            passwordFormat: 'legacy_btoa_reverse'
          }),
          req.ip || null,
          req.get('user-agent') || null
        ]
      );

      await query('COMMIT');

      return res.json({
        ok: true,
        migrated: true,
        adminId,
        email,
        message:
          'Legacy Admin account migrated successfully'
      });

    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error(
      'Legacy Admin migration error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to migrate legacy Admin account'
    });
  }
});

// ------------------------------------------------------------
// ADMIN LOGIN
// ------------------------------------------------------------

app.post('/api/admin/login', async (req, res) => {
  try {
    const email = String(
      req.body?.email || ''
    ).trim().toLowerCase();

    const password = String(
      req.body?.password || ''
    );

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Email and password are required'
      });
    }

    const result = await query(
      `SELECT
         admin_id,
         name,
         email,
         phone,
         role,
         permissions,
         tasks,
         deployment,
         password_hash,
         password_algorithm,
         status,
         active
       FROM gft_admin_accounts
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid email or password'
      });
    }

    const admin = result.rows[0];

    if (
      !admin.active ||
      String(admin.status).toUpperCase() !== 'ACTIVE'
    ) {
      return res.status(403).json({
        ok: false,
        error: 'Admin account is not active'
      });
    }

    const valid = await verifyPassword(
      password,
      admin.password_hash
    );

    if (!valid) {
      await query(
        `INSERT INTO gft_admin_audit_events
           (
             event_id,
             admin_id,
             admin_email,
             action,
             details,
             ip_address,
             user_agent
           )
         VALUES
           ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `AUD-${randomBytes(10).toString('hex')}`,
          admin.admin_id,
          admin.email,
          'ADMIN_LOGIN_FAILED',
          JSON.stringify({ reason: 'invalid_password' }),
          req.ip || null,
          req.get('user-agent') || null
        ]
      );

      return res.status(401).json({
        ok: false,
        error: 'Invalid email or password'
      });
    }

    // If this was a legacy password, immediately upgrade it
    // to the secure server-side scrypt format.
    if (
      admin.password_algorithm === 'legacy_btoa_reverse'
    ) {
      const newHash = await createPasswordHash(password);

      await query(
        `UPDATE gft_admin_accounts
         SET
           password_hash = $1,
           password_algorithm = 'scrypt',
           updated_at = NOW()
         WHERE admin_id = $2`,
        [
          newHash,
          admin.admin_id
        ]
      );
    }

    await query(
      `UPDATE gft_admin_accounts
       SET last_login_at = NOW(),
           updated_at = NOW()
       WHERE admin_id = $1`,
      [admin.admin_id]
    );

    await createAdminSession(
      req,
      res,
      admin.admin_id
    );

    await query(
      `INSERT INTO gft_admin_audit_events
         (
           event_id,
           admin_id,
           admin_email,
           action,
           details,
           ip_address,
           user_agent
         )
       VALUES
         ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `AUD-${randomBytes(10).toString('hex')}`,
        admin.admin_id,
        admin.email,
        'ADMIN_LOGIN_SUCCESS',
        JSON.stringify({
          role: admin.role
        }),
        req.ip || null,
        req.get('user-agent') || null
      ]
    );

    return res.json({
      ok: true,
      admin: {
        adminId: admin.admin_id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        permissions: admin.permissions,
        tasks: admin.tasks,
        deployment: admin.deployment,
        status: admin.status,
        active: admin.active
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to complete Admin login'
    });
  }
});


// ------------------------------------------------------------
// CURRENT ADMIN SESSION
// ------------------------------------------------------------

app.get('/api/admin/me', async (req, res) => {
  try {
    const admin = await getAuthenticatedAdmin(req);

    if (!admin) {
      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    return res.json({
      ok: true,
      authenticated: true,
      admin: {
        adminId: admin.admin_id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        permissions: admin.permissions,
        tasks: admin.tasks,
        deployment: admin.deployment,
        status: admin.status,
        active: admin.active,
        lastLoginAt: admin.last_login_at
      }
    });

  } catch (error) {
    console.error('Admin session lookup error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to check Admin session'
    });
  }
});


// ------------------------------------------------------------
// ADMIN LOGOUT
// ------------------------------------------------------------

app.post('/api/admin/logout', async (req, res) => {
  try {
    const rawToken = getCookie(
      req,
      ADMIN_SESSION_COOKIE
    );

    if (rawToken) {
      const tokenHash = sha256(rawToken);

      await query(
        `DELETE FROM gft_admin_sessions
         WHERE token_hash = $1`,
        [tokenHash]
      );
    }

    clearAdminCookie(res);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Admin logout error:', error);

    clearAdminCookie(res);

    return res.json({
      ok: true
    });
  }
});

// ------------------------------------------------------------
// FOUNDER — LOAD ADMIN ACCOUNTS
// ------------------------------------------------------------

// ------------------------------------------------------------
// ADMIN — SERVER-SIDE ADMIN COUNT
// Founder is not counted as an Admin.
// ------------------------------------------------------------

app.get('/api/admin/count', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS count
       FROM gft_admin_accounts
       WHERE UPPER(COALESCE(role, '')) <> 'FOUNDER'`
    );

    return res.json({
      ok: true,
      count: result.rows[0].count
    });

  } catch (error) {
    console.error('Admin count error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to load Admin count'
    });
  }
});

app.get('/api/founder/admins', requireAdmin, async (req, res) => {
  try {
    if (
      String(req.admin.role || '').toUpperCase() !== 'FOUNDER'
    ) {
      return res.status(403).json({
        ok: false,
        error: 'Founder authorization required'
      });
    }

    const result = await query(
      `SELECT
         admin_id,
         name,
         email,
         phone,
         role,
         permissions,
         tasks,
         deployment,
         status,
         active,
         invited_at,
         activated_at,
         last_login_at,
         created_at,
         updated_at
       FROM gft_admin_accounts
       ORDER BY created_at ASC`
    );

    return res.json({
      ok: true,
      admins: result.rows
    });

  } catch (error) {
    console.error(
      'Founder Admin list error:',
      error
    );

    return res.status(500).json({
      ok: false,
      error: 'Unable to load Admin accounts'
    });
  }
});


// ------------------------------------------------------------
// FOUNDER — GRANT / REVOKE REGISTRATION REVIEW AUTHORITY
// This permission is independent of role templates and controlled only
// by the Founder. It is stored in deployment.permissions.
// ------------------------------------------------------------
app.put('/api/founder/admins/:adminId/registration-review', requireAdmin, async (req, res) => {
  try {
    if (String(req.admin.role || '').toUpperCase() !== FOUNDER_ROLE) {
      return res.status(403).json({ ok: false, error: 'Founder authorization required' });
    }
    const adminId = String(req.params.adminId || '').trim();
    const enabled = req.body?.enabled === true;
    if (!adminId) return res.status(400).json({ ok: false, error: 'Admin ID is required' });
    const found = await query(
      `SELECT admin_id, email, role, deployment FROM gft_admin_accounts WHERE admin_id = $1 LIMIT 1`, [adminId]
    );
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Admin account not found' });
    if (String(found.rows[0].role || '').toUpperCase() === FOUNDER_ROLE) {
      return res.status(400).json({ ok: false, error: 'Founder authority is permanent and cannot be toggled here' });
    }
    const deployment = found.rows[0].deployment && typeof found.rows[0].deployment === 'object'
      ? found.rows[0].deployment : {};
    const permissions = Array.isArray(deployment.permissions) ? deployment.permissions.slice() : [];
    const permissionKey = 'REGISTRATION_REVIEW_APPROVE';
    const nextPermissions = enabled
      ? [...new Set([...permissions, permissionKey])]
      : permissions.filter(value => String(value).toUpperCase() !== permissionKey);
    const nextDeployment = { ...deployment, permissions: nextPermissions };
    await query(
      `UPDATE gft_admin_accounts SET deployment = $1::jsonb, updated_at = NOW() WHERE admin_id = $2`,
      [JSON.stringify(nextDeployment), adminId]
    );
    await query(
      `INSERT INTO gft_admin_audit_events (event_id, admin_id, admin_email, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [`AUD-${randomBytes(10).toString('hex')}`, req.admin.admin_id, req.admin.email,
       enabled ? 'REGISTRATION_REVIEW_AUTHORITY_GRANTED' : 'REGISTRATION_REVIEW_AUTHORITY_REVOKED',
       JSON.stringify({ targetAdminId: adminId, targetAdminEmail: found.rows[0].email, enabled }),
       req.ip || null, req.get('user-agent') || null]
    );
    return res.json({ ok: true, adminId, email: found.rows[0].email, registrationReviewApproval: enabled, serverAuthoritative: true });
  } catch (error) {
    console.error('Founder registration review authority update error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to update registration review authority' });
  }
});

// ------------------------------------------------------------
// ADMIN AUTHORIZATION HELPER
// ------------------------------------------------------------

async function requireAdmin(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);

    if (!admin) {
      return res.status(401).json({
        ok: false,
        error: 'Admin authentication required'
      });
    }

    req.admin = admin;
    next();

  } catch (error) {
    console.error('Admin authorization error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to verify Admin authorization'
    });
  }
}


// ------------------------------------------------------------
// REGISTRATION REVIEW AUTHORITY
// Founder always has authority. Other Admins require an explicit
// Founder-granted REGISTRATION_REVIEW_APPROVE deployment permission.
// ------------------------------------------------------------
function hasRegistrationReviewAuthority(admin) {
  if (String(admin?.role || '').toUpperCase() === 'FOUNDER') return true;
  const direct = Array.isArray(admin?.permissions) ? admin.permissions : [];
  const deployed = Array.isArray(admin?.deployment?.permissions)
    ? admin.deployment.permissions
    : [];
  return [...direct, ...deployed].some(value =>
    String(value || '').toUpperCase() === 'REGISTRATION_REVIEW_APPROVE'
  );
}

async function requireRegistrationReviewer(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) {
      return res.status(401).json({ ok: false, error: 'Admin authentication required' });
    }
    req.admin = admin;
    if (!hasRegistrationReviewAuthority(admin)) {
      return res.status(403).json({
        ok: false,
        error: 'Founder approval authority for beneficiary registration review has not been granted to this Admin'
      });
    }
    return next();
  } catch (error) {
    console.error('Registration reviewer authorization error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to verify registration review authority' });
  }
}

/* ============================================================
   GUVAZA GERIATRIC CLINIC — PUBLIC APPLICATION API
   Separate from GFT beneficiary registration.
   PostgreSQL is the source of truth.
   ============================================================ */

function getClinicTownCode(town) {
  const normalizedTown = String(town || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalizedTown) return '';

  const townKey = normalizedTown.toUpperCase();

  const specialCodes = {
    MASVINGO: 'MSV',
    HARARE: 'HRE',
    BULAWAYO: 'BYO'
  };

  return specialCodes[townKey] ||
    normalizedTown
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 3)
      .toUpperCase();
}

app.post('/api/clinic/applications', async (req, res) => {
  try {
    const body = req.body || {};

    const branchCode = getClinicTownCode(body.town);

const resident = body.residentDetails;
const medical = body.medicalHistory;
const consent = body.consentDetails;

if (!branchCode) {
  return res.status(400).json({
    ok: false,
    error: 'Please select a valid town or city.'
  });
}

    if (
      !resident ||
      typeof resident !== 'object' ||
      Array.isArray(resident) ||
      !medical ||
      typeof medical !== 'object' ||
      Array.isArray(medical) ||
      !consent ||
      typeof consent !== 'object' ||
      Array.isArray(consent)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Valid resident, medical and consent details are required.'
      });
    }

    const fullName = String(resident.fullName || '').trim();
    const nextOfKin = String(resident.nextOfKin || '').trim();
    const nextOfKinPhone = String(resident.phone || '').trim();

    if (!fullName || !nextOfKin || !nextOfKinPhone) {
      return res.status(400).json({
        ok: false,
        error: 'Resident name, next of kin and contact phone are required.'
      });
    }

    if (consent.agreed !== true) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation of consent is required before submission.'
      });
    }

   const applicationType = String(
  body.applicationType || 'RESIDENTIAL_CARE'
).trim().toUpperCase();

const treatmentAdmission = body.treatmentAdmission;

if (!['RESIDENTIAL_CARE', 'HOSPITAL_TREATMENT'].includes(applicationType)) {
  return res.status(400).json({
    ok: false,
    error: 'Please select a valid application type.'
  });
}

if (applicationType === 'HOSPITAL_TREATMENT') {
  const admissionDate = String(
    treatmentAdmission?.admissionDate || ''
  ).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissionDate)) {
    return res.status(400).json({
      ok: false,
      error: 'A valid treatment admission date is required.'
    });
  }
}     

    // Generate the application number on the server.
    // The sequence is shared across branches; numbers are unique
    // but are not reset independently for each branch.
    const sequenceResult = await query(
      `SELECT nextval('clinic_application_number_seq') AS serial`
    );

    const serial = String(sequenceResult.rows[0].serial)
      .padStart(6, '0');

    const applicationNumber = `GGC-${branchCode}-${serial}`;

    const result = await query(
      `INSERT INTO clinic_applications (
         application_number,
         branch_code,
         resident_details,
         medical_history,
         consent_details
       )
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       RETURNING
         application_id,
         application_number,
         branch_code,
         application_status,
         submitted_at`,
      [
        applicationNumber,
        branchCode,
        JSON.stringify({
  ...resident,
  applicationType: body.applicationType || 'RESIDENTIAL_CARE',
  applicantLocation: body.applicantLocation || '',
  country: body.country || '',
  town: body.town || '',
  treatmentAdmission: body.treatmentAdmission || null
}),
        JSON.stringify(medical),
        JSON.stringify(consent)
      ]
    );

    const saved = result.rows[0];

    return res.status(201).json({
      ok: true,
      message: 'Clinic application received for review.',
      application: {
        applicationId: saved.application_id,
        applicationNumber: saved.application_number,
        branchCode: saved.branch_code,
        status: saved.application_status,
        submittedAt: saved.submitted_at
      },
      serverAuthoritative: true
    });

  } catch (error) {
    console.error('Clinic application submission error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Unable to submit the Clinic application. Please try again later.'
    });
  }
});


/* ============================================================
   GGC CLINIC STAFF AUTHENTICATION & INVITATIONS
   Separate identities and sessions from GFT Trust administrators.
   ============================================================ */

const GGC_SESSION_COOKIE = 'ggc_staff_session';
const GGC_SESSION_HOURS = 8;
let ggcSchemaReady;

async function ensureGgcStaffSchema() {
  if (!ggcSchemaReady) {
    ggcSchemaReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS clinic_staff_users (
          staff_id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK (role IN ('GGC_SUPER_ADMIN','CLINIC_ADMIN','DEPARTMENT_STAFF')),
          department TEXT,
          permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
          password_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
          invited_by TEXT,
          invited_by_role TEXT,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS clinic_staff_invitations (
          invitation_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('GGC_SUPER_ADMIN','CLINIC_ADMIN','DEPARTMENT_STAFF')),
          department TEXT,
          permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          invited_by TEXT NOT NULL,
          invited_by_role TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS clinic_staff_sessions (
          session_id TEXT PRIMARY KEY,
          staff_id TEXT NOT NULL REFERENCES clinic_staff_users(staff_id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ip_address TEXT,
          user_agent TEXT
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS clinic_staff_invites_email_idx ON clinic_staff_invitations (LOWER(email))`);
      await query(`CREATE INDEX IF NOT EXISTS clinic_staff_sessions_staff_idx ON clinic_staff_sessions (staff_id)`);
    })().catch(error => { ggcSchemaReady = null; throw error; });
  }
  return ggcSchemaReady;
}

function setGgcCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${GGC_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=${GGC_SESSION_HOURS * 60 * 60}`);
}
function clearGgcCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${GGC_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=0`);
}

async function getAuthenticatedClinicStaff(req) {
  const token = getCookie(req, GGC_SESSION_COOKIE);
  if (!token) return null;
  await ensureGgcStaffSchema();
  const result = await query(`
    SELECT u.staff_id, u.full_name, u.email, u.role, u.department,
           u.permissions, u.status, u.last_login_at, s.token_hash
    FROM clinic_staff_sessions s
    JOIN clinic_staff_users u ON u.staff_id = s.staff_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'ACTIVE'
    LIMIT 1
  `, [sha256(token)]);
  return result.rows[0] || null;
}

async function requireClinicStaff(req, res, next) {
  try {
    const staff = await getAuthenticatedClinicStaff(req);
    if (!staff) return res.status(401).json({ ok: false, error: 'Clinic staff authentication required' });
    req.clinicStaff = staff;
    next();
  } catch (error) {
    console.error('Clinic staff authorization error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to verify clinic staff authorization' });
  }
}

function clinicRoleCanInvite(role) {
  return ['GGC_SUPER_ADMIN', 'CLINIC_ADMIN'].includes(String(role || '').toUpperCase());
}

async function createClinicStaffInvitation({ email, fullName, role, department, permissions, invitedBy, invitedByRole }) {
  await ensureGgcStaffSchema();
  const token = randomBytes(32).toString('base64url');
  const invitationId = `GGC-INV-${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await query(`UPDATE clinic_staff_invitations SET used_at = NOW() WHERE LOWER(email) = $1 AND used_at IS NULL`, [email]);
  await query(`INSERT INTO clinic_staff_invitations
    (invitation_id,email,full_name,role,department,permissions,token_hash,expires_at,invited_by,invited_by_role)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
    [invitationId,email,fullName,role,department || null,JSON.stringify(permissions),sha256(token),expiresAt,invitedBy,invitedByRole]);
  return { invitationId, token, expiresAt };
}

// Founder-only: create GGC Super Admin or subordinate clinic invitations.
app.post('/api/clinic/staff/founder-invitations', requireAdmin, async (req, res) => {
  try {
    if (String(req.admin.role || '').toUpperCase() !== FOUNDER_ROLE) {
      return res.status(403).json({ ok: false, error: 'Only the GFT Founder can use this invitation route' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || '').trim();
    const role = String(req.body?.role || '').trim().toUpperCase();
    const department = String(req.body?.department || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) {
      return res.status(400).json({ ok: false, error: 'A valid email and full name are required' });
    }
    if (!['GGC_SUPER_ADMIN','CLINIC_ADMIN','DEPARTMENT_STAFF'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Choose a valid clinic role' });
    }
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter(v => typeof v === 'string').slice(0,30) : [];
    const invite = await createClinicStaffInvitation({ email, fullName, role, department, permissions, invitedBy: req.admin.admin_id, invitedByRole: 'FOUNDER' });
    await query(`INSERT INTO gft_admin_audit_events (event_id,admin_id,admin_email,action,details,ip_address,user_agent)
      VALUES ($1,$2,$3,'GGC_STAFF_INVITED',$4::jsonb,$5,$6)`,
      [`AUD-${randomBytes(10).toString('hex')}`,req.admin.admin_id,req.admin.email,JSON.stringify({email,role,invitationId:invite.invitationId}),req.ip || null,req.get('user-agent') || null]);
    const base = `${req.protocol}://${req.get('host')}`;
    return res.status(201).json({ ok: true, invitation: { invitationId: invite.invitationId, email, role, expiresAt: invite.expiresAt, acceptUrl: `${base}/clinic-staff.html?invite=${encodeURIComponent(invite.token)}` }, message: 'Invitation created. Share the acceptance link securely with the invitee.' });
  } catch (error) {
    console.error('Founder clinic invitation error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to create clinic invitation' });
  }
});

// Clinic Super Admin / explicitly authorised Clinic Admin invitation route.
app.post('/api/clinic/staff/invitations', requireClinicStaff, async (req, res) => {
  try {
    const actor = req.clinicStaff;
    if (!clinicRoleCanInvite(actor.role) || (actor.role === 'CLINIC_ADMIN' && !actor.permissions?.includes('INVITE_STAFF'))) {
      return res.status(403).json({ ok: false, error: 'Your clinic role does not have staff invitation permission' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || '').trim();
    const role = String(req.body?.role || '').trim().toUpperCase();
    const department = String(req.body?.department || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) return res.status(400).json({ ok: false, error: 'A valid email and full name are required' });
    if (!['CLINIC_ADMIN','DEPARTMENT_STAFF'].includes(role)) return res.status(403).json({ ok: false, error: 'Clinic administrators cannot invite a Super Admin' });
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter(v => typeof v === 'string').slice(0,30) : [];
    const invite = await createClinicStaffInvitation({ email, fullName, role, department, permissions, invitedBy: actor.staff_id, invitedByRole: actor.role });
    return res.status(201).json({ ok: true, invitation: { invitationId: invite.invitationId, email, role, expiresAt: invite.expiresAt, acceptUrl: `${req.protocol}://${req.get('host')}/clinic-staff.html?invite=${encodeURIComponent(invite.token)}` } });
  } catch (error) {
    console.error('Clinic staff invitation error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to create clinic staff invitation' });
  }
});

app.post('/api/clinic/staff/accept-invitation', async (req, res) => {
  try {
    await ensureGgcStaffSchema();
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (token.length < 30 || password.length < 12 || password.length > 200) return res.status(400).json({ ok: false, error: 'A valid invitation and password of at least 12 characters are required' });
    const result = await query(`SELECT * FROM clinic_staff_invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() LIMIT 1`, [sha256(token)]);
    if (!result.rows.length) return res.status(400).json({ ok: false, error: 'Invitation is invalid, expired, or already used' });
    const invite = result.rows[0];
    const existing = await query(`SELECT staff_id FROM clinic_staff_users WHERE LOWER(email) = $1 LIMIT 1`, [invite.email]);
    if (existing.rows.length) return res.status(409).json({ ok: false, error: 'A clinic staff account already exists for this email' });
    const staffId = `GGC-${randomBytes(12).toString('hex').toUpperCase()}`;
    const passwordHash = await createPasswordHash(password);
    await query('BEGIN');
    try {
      await query(`INSERT INTO clinic_staff_users (staff_id,full_name,email,role,department,permissions,password_hash,invited_by,invited_by_role)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [staffId,invite.full_name,invite.email,invite.role,invite.department,JSON.stringify(invite.permissions || []),passwordHash,invite.invited_by,invite.invited_by_role]);
      const consumed = await query(`UPDATE clinic_staff_invitations SET used_at = NOW() WHERE invitation_id = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING invitation_id`, [invite.invitation_id]);
      if (!consumed.rows.length) throw new Error('Invitation was already consumed');
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK'); throw e; }
    return res.status(201).json({ ok: true, message: 'Clinic staff account activated. You can now sign in.' });
  } catch (error) {
    console.error('Clinic invitation acceptance error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to activate clinic staff account' });
  }
});

app.post('/api/clinic/staff/login', async (req, res) => {
  try {
    await ensureGgcStaffSchema();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required' });
    const result = await query(`SELECT staff_id,full_name,email,role,department,permissions,password_hash,status FROM clinic_staff_users WHERE LOWER(email) = $1 LIMIT 1`, [email]);
    if (!result.rows.length || result.rows[0].status !== 'ACTIVE' || !(await verifyPassword(password, result.rows[0].password_hash))) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }
    const staff = result.rows[0];
    const rawToken = randomBytes(32).toString('base64url');
    await query(`INSERT INTO clinic_staff_sessions (session_id,staff_id,token_hash,expires_at,ip_address,user_agent) VALUES ($1,$2,$3,$4,$5,$6)`,
      [`GGC-SES-${randomBytes(12).toString('hex')}`,staff.staff_id,sha256(rawToken),new Date(Date.now()+GGC_SESSION_HOURS*60*60*1000),req.ip || null,req.get('user-agent') || null]);
    await query(`UPDATE clinic_staff_users SET last_login_at = NOW(), updated_at = NOW() WHERE staff_id = $1`, [staff.staff_id]);
    setGgcCookie(res, rawToken);
    return res.json({ ok: true, staff: { staffId: staff.staff_id, fullName: staff.full_name, email: staff.email, role: staff.role, department: staff.department, permissions: staff.permissions } });
  } catch (error) {
    console.error('Clinic staff login error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to complete clinic staff login' });
  }
});

app.get('/api/clinic/staff/me', requireClinicStaff, (req, res) => {
  const s = req.clinicStaff;
  return res.json({ ok: true, authenticated: true, staff: { staffId: s.staff_id, fullName: s.full_name, email: s.email, role: s.role, department: s.department, permissions: s.permissions, lastLoginAt: s.last_login_at } });
});

app.post('/api/clinic/staff/logout', async (req, res) => {
  try {
    const token = getCookie(req, GGC_SESSION_COOKIE);
    if (token) {
      await ensureGgcStaffSchema();
      await query('DELETE FROM clinic_staff_sessions WHERE token_hash = $1', [sha256(token)]);
    }
  } catch (error) { console.error('Clinic staff logout error:', error); }
  clearGgcCookie(res);
  return res.json({ ok: true });
});

/* ============================================================
GGC PATIENT PORTAL AUTHENTICATION
Separate patient accounts and sessions from clinic staff.
Account activation requires authorized clinic verification.
============================================================ */

const GGC_PATIENT_COOKIE = 'ggc_patient_session';
const GGC_PATIENT_SESSION_HOURS = 8;
const GGC_PATIENT_ACTIVATION_MINUTES = 30;
let ggcPatientSchemaReady;

async function ensureGgcPatientSchema() {
if (!ggcPatientSchemaReady) {
ggcPatientSchemaReady = (async () => {
await query("CREATE TABLE IF NOT EXISTS clinic_patient_accounts ( patient_id TEXT PRIMARY KEY, application_number TEXT NOT NULL UNIQUE, login_email TEXT, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')), activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW() )");

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS clinic_patient_email_unique_idx
    ON clinic_patient_accounts (LOWER(login_email))
    WHERE login_email IS NOT NULL AND login_email <> ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clinic_patient_activation_tokens (
      activation_id TEXT PRIMARY KEY,
      application_number TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      issued_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clinic_patient_sessions (
      session_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL
        REFERENCES clinic_patient_accounts(patient_id)
        ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS clinic_patient_sessions_patient_idx
    ON clinic_patient_sessions (patient_id)
  `);
})().catch(error => {
  ggcPatientSchemaReady = null;
  throw error;
});

}

return ggcPatientSchemaReady;
}

function setGgcPatientCookie(res, token) {
const secure = process.env.NODE_ENV === 'production';
res.setHeader(
'Set-Cookie',
`${GGC_PATIENT_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=${GGC_PATIENT_SESSION_HOURS * 60 * 60}`
);
}

function clearGgcPatientCookie(res) {
const secure = process.env.NODE_ENV === 'production';
res.setHeader(
'Set-Cookie',
`${GGC_PATIENT_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=0`
);
}

async function getAuthenticatedGgcPatient(req) {
const token = getCookie(req, GGC_PATIENT_COOKIE);
if (!token) return null;

await ensureGgcPatientSchema();

const result = await query("SELECT a.patient_id, a.application_number, a.login_email, a.status, s.token_hash FROM clinic_patient_sessions s JOIN clinic_patient_accounts a ON a.patient_id = s.patient_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.status = 'ACTIVE' LIMIT 1", [sha256(token)]);

return result.rows[0] || null;
}

async function requireGgcPatient(req, res, next) {
try {
const patient = await getAuthenticatedGgcPatient(req);

if (!patient) {
  return res.status(401).json({
    ok: false,
    error: 'Patient authentication required'
  });
}

req.ggcPatient = patient;
next();

} catch (error) {
console.error('Patient authorization error:', error);
return res.status(500).json({
ok: false,
error: 'Unable to verify patient authorization'
});
}
}

function canManageGgcPatientAccounts(staff) {
const role = String(staff?.role || '').toUpperCase();
const permissions = Array.isArray(staff?.permissions)
? staff.permissions
: [];

return role === 'GGC_SUPER_ADMIN' ||
permissions.includes('MANAGE_PATIENT_ACCOUNTS');
}

/*

* Authorized staff issue an activation token only after checking

* the patient's identity. Application number alone grants no access.

* 

* The returned token must be shared with the verified patient through

* a suitable private channel. It expires after 30 minutes.
  */
  app.post(
  '/api/clinic/patient/issue-activation',
  requireClinicStaff,
  async (req, res) => {
  try {
  const staff = req.clinicStaff;
  
  if (!canManageGgcPatientAccounts(staff)) {
  return res.status(403).json({
  ok: false,
  error: 'Your clinic account is not authorized to activate patient accounts.'
  });
  }
  
  await ensureGgcPatientSchema();
  
  const applicationNumber = String(
  req.body?.applicationNumber || ''
  ).trim().toUpperCase();
  
  if (!applicationNumber || applicationNumber.length > 100) {
  return res.status(400).json({
  ok: false,
  error: 'A valid clinic application number is required.'
  });
  }
  
  const application = await query("SELECT application_number FROM clinic_applications WHERE UPPER(application_number) = $1 LIMIT 1", [applicationNumber]);
  
  if (!application.rows.length) {
  return res.status(404).json({
  ok: false,
  error: 'Clinic application not found.'
  });
  }
  
  const existing = await query("SELECT patient_id FROM clinic_patient_accounts WHERE application_number = $1 LIMIT 1", [applicationNumber]);
  
  if (existing.rows.length) {
  return res.status(409).json({
  ok: false,
  error: 'A patient portal account already exists for this application. Use the approved account recovery process.'
  });
  }
  
  const rawToken = randomBytes(32).toString('base64url');
  const activationId = `GGC-PAT-ACT-${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(
  Date.now() + GGC_PATIENT_ACTIVATION_MINUTES * 60 * 1000
  );
  
 await withTransaction(async (client) => {
  await client.query(
    `UPDATE clinic_patient_activation_tokens
     SET used_at = NOW()
     WHERE application_number = $1
       AND used_at IS NULL`,
    [applicationNumber]
  );

  await client.query(
    `INSERT INTO clinic_patient_activation_tokens
      (activation_id, application_number, token_hash, expires_at, issued_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      activationId,
      applicationNumber,
      sha256(rawToken),
      expiresAt,
      staff.staff_id
    ]
  );
});
  
  return res.status(201).json({
  ok: true,
  message: 'Activation token created. Share it privately with the identity-verified patient.',
  activation: {
  applicationNumber,
  token: rawToken,
  expiresAt,
  expiresInMinutes: GGC_PATIENT_ACTIVATION_MINUTES
  }
  });
  } catch (error) {
  console.error('Patient activation issuance error:', error);
  return res.status(500).json({
  ok: false,
  error: 'Unable to issue a patient activation token.'
  });
  }
  }
  );

/*

* Patient activates an account with the one-time token provided

* after clinic identity verification and chooses their own password.
  */
  app.post('/api/clinic/patient/activate', async (req, res) => {
  try {
  await ensureGgcPatientSchema();
  
  const applicationNumber = String(
  req.body?.applicationNumber || ''
  ).trim().toUpperCase();
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  
  if (
  !applicationNumber ||
  token.length < 30 ||
  password.length < 12 ||
  password.length > 200
  ) {
  return res.status(400).json({
  ok: false,
  error: 'Enter your application number, valid activation token, and a password of at least 12 characters.'
  });
  }
  
  const tokenResult = await query("SELECT activation_id, application_number FROM clinic_patient_activation_tokens WHERE application_number = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > NOW() LIMIT 1", [applicationNumber, sha256(token)]);
  
  if (!tokenResult.rows.length) {
  return res.status(400).json({
  ok: false,
  error: 'The activation token is invalid, expired, or already used.'
  });
  }
  
  const applicationResult = await query("SELECT application_number, resident_details FROM clinic_applications WHERE UPPER(application_number) = $1 LIMIT 1", [applicationNumber]);
  
  if (!applicationResult.rows.length) {
  return res.status(400).json({
  ok: false,
  error: 'The linked clinic application could not be found.'
  });
  }
  
  const alreadyActive = await query("SELECT patient_id FROM clinic_patient_accounts WHERE application_number = $1 LIMIT 1", [applicationNumber]);
  
  if (alreadyActive.rows.length) {
  return res.status(409).json({
  ok: false,
  error: 'A patient portal account already exists for this application.'
  });
  }
  
  const resident = applicationResult.rows[0].resident_details || {};
  const emailValue = String(
  resident.email || resident.emailAddress || resident.email_address || ''
  ).trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)
  ? emailValue
  : null;
  
  const patientId = `GGC-PAT-${randomBytes(12).toString('hex').toUpperCase()}`;
  const passwordHash = await createPasswordHash(password);
  
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO clinic_patient_accounts (patient_id, application_number, login_email, password_hash) VALUES ($1, $2, $3, $4)',
      [patientId, applicationNumber, email, passwordHash]
    );

    const consumed = await client.query(
      'UPDATE clinic_patient_activation_tokens SET used_at = NOW() WHERE activation_id = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING activation_id',
      [tokenResult.rows[0].activation_id]
    );

    if (!consumed.rows.length) {
      throw new Error('Activation token was already consumed or expired.');
    }
  });
  
  return res.status(201).json({
  ok: true,
  message: 'Patient portal account activated. You can now sign in.'
  });
  } catch (error) {
  if (error?.code === '23505') {
  return res.status(409).json({
  ok: false,
  error: 'An account already exists for this application, or the registered email is already associated with another account.'
  });
  }
  
  console.error('Patient activation error:', error);
  return res.status(500).json({
  ok: false,
  error: 'Unable to activate the patient portal account.'
  });
  }
  });

app.post('/api/clinic/patient/login', async (req, res) => {
try {
await ensureGgcPatientSchema();

const loginIdentifier = String(
  req.body?.loginIdentifier || req.body?.applicationNumber || ''
).trim().toLowerCase();
const password = String(req.body?.password || '');

if (!loginIdentifier || !password) {
  return res.status(400).json({
    ok: false,
    error: 'Patient number or registered email and password are required.'
  });
}

const result = await query(`
  SELECT patient_id, application_number, login_email,
         password_hash, status
  FROM clinic_patient_accounts
  WHERE LOWER(application_number) = $1
     OR LOWER(COALESCE(login_email, '')) = $1
  LIMIT 1
`, [loginIdentifier]);

if (
  !result.rows.length ||
  result.rows[0].status !== 'ACTIVE' ||
  !(await verifyPassword(password, result.rows[0].password_hash))
) {
  return res.status(401).json({
    ok: false,
    error: 'Invalid sign-in details, or the patient account is not active.'
  });
}

const account = result.rows[0];
const rawToken = randomBytes(32).toString('base64url');

await query(`
  INSERT INTO clinic_patient_sessions
    (session_id, patient_id, token_hash, expires_at, ip_address, user_agent)
  VALUES ($1, $2, $3, $4, $5, $6)
`, [
  `GGC-PAT-SES-${randomBytes(12).toString('hex')}`,
  account.patient_id,
  sha256(rawToken),
  new Date(Date.now() + GGC_PATIENT_SESSION_HOURS * 60 * 60 * 1000),
  req.ip || null,
  req.get('user-agent') || null
]);

await query(`
  UPDATE clinic_patient_accounts
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE patient_id = $1
`, [account.patient_id]);

setGgcPatientCookie(res, rawToken);

return res.json({
  ok: true,
  authenticated: true,
  patient: {
    patientId: account.patient_id,
    patientNumber: account.application_number
  }
});

} catch (error) {
console.error('Patient login error:', error);
return res.status(500).json({
ok: false,
error: 'Unable to complete patient sign-in.'
});
}
});

app.get('/api/clinic/patient/me', requireGgcPatient, async (req, res) => {
try {
const account = req.ggcPatient;

const result = await query(`
  SELECT application_number, branch_code, resident_details,
         application_status, submitted_at
  FROM clinic_applications
  WHERE UPPER(application_number) = $1
  LIMIT 1
`, [account.application_number.toUpperCase()]);

if (!result.rows.length) {
  return res.status(404).json({
    ok: false,
    error: 'The linked clinic application could not be found.'
  });
}

const application = result.rows[0];
const resident = application.resident_details || {};
const rawType = String(
  resident.applicationType || 'RESIDENTIAL_CARE'
).trim().toUpperCase();

return res.json({
  ok: true,
  authenticated: true,
  patient: {
    patientId: account.patient_id,
    patientNumber: application.application_number,
    fullName: String(resident.fullName || ''),
    careType: rawType,
    applicationType: rawType,
    admissionStatus: String(application.application_status || 'UNDER_REVIEW'),
    branchCode: application.branch_code,
    submittedAt: application.submitted_at,
    careTeamName: '',
    email: account.login_email || ''
  },
  careItems: []
});

} catch (error) {
console.error('Patient profile error:', error);
return res.status(500).json({
ok: false,
error: 'Unable to load the patient profile.'
});
}
});

app.post('/api/clinic/patient/logout', async (req, res) => {
try {
const token = getCookie(req, GGC_PATIENT_COOKIE);

if (token) {
  await ensureGgcPatientSchema();
  await query(
    'DELETE FROM clinic_patient_sessions WHERE token_hash = $1',
    [sha256(token)]
  );
}

} catch (error) {
console.error('Patient logout error:', error);
}

clearGgcPatientCookie(res);
return res.json({ ok: true });
});

/* End GGC patient portal authentication */

// ------------------------------------------------------------

// ------------------------------------------------------------

// ------------------------------------------------------------
// SPOTLIGHT WRITE ACCESS GUARD
// Public profile reads remain available.
// Member draft writes use the authenticated /my-profiles routes below.
// This public collection endpoint never accepts member writes.
// ------------------------------------------------------------
app.use('/api/spotlight/profiles', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  return res.status(503).json({
    ok: false,
    error: 'SPOTLIGHT AUTHENTICATION REQUIRED',
    message: 'Profile changes are temporarily disabled until secure Spotlight member authentication is enabled.'
  });
});


// ------------------------------------------------------------

// ------------------------------------------------------------
// SPOTLIGHT MEMBER REGISTRATION
// Public signup is limited to Spotlight accounts only.
// ------------------------------------------------------------
const spotlightScrypt = promisify(scryptCallback);

async function spotlightHashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await spotlightScrypt(password, salt, 64);
  return `spotlight-scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

async function spotlightVerifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'spotlight-scrypt') return false;
    const actual = Buffer.from(await spotlightScrypt(password, parts[1], 64));
    const expected = Buffer.from(parts[2], 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

app.post('/api/spotlight/auth/register', async (req, res) => {
  try {
    await ensureSpotlightAuthSchema();

    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (fullName.length < 2 || fullName.length > 120) {
      return res.status(400).json({ ok: false, error: 'Enter your full name.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({
        ok: false,
        error: 'Password must be at least 8 characters long.'
      });
    }

    const passwordHash = await spotlightHashPassword(password);
    const memberId = `SPOT-MEM-${randomBytes(12).toString('hex')}`;
    const systemId = `SPOT-${randomBytes(12).toString('hex')}`;

    const result = await query(`
      INSERT INTO spotlight_member_accounts
        (member_id, email, password_hash, system_id, full_name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING member_id, system_id, email, full_name
    `, [memberId, email, passwordHash, systemId, fullName]);

    if (!result.rows.length) {
      return res.status(409).json({
        ok: false,
        error: 'An account with this email already exists.'
      });
    }

    return res.status(201).json({
      ok: true,
      message: 'Spotlight account created. You can now sign in.',
      member: {
        systemId: result.rows[0].system_id,
        email: result.rows[0].email,
        fullName: result.rows[0].full_name
      }
    });
  } catch (error) {
    console.error('Spotlight registration error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Unable to create Spotlight account.'
    });
  }
});

// SPOTLIGHT MEMBER SESSION API
// Separate from beneficiary, admin, and registration systems.
// Accounts must be provisioned privately; no public signup.
// ------------------------------------------------------------
const SPOTLIGHT_SESSION_COOKIE = 'gft_spotlight_session';
const SPOTLIGHT_SESSION_HOURS = 12;

async function ensureSpotlightAuthSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS spotlight_member_accounts (
      member_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      system_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DISABLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS spotlight_member_sessions (
      session_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES spotlight_member_accounts(member_id)
        ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS spotlight_member_sessions_expiry_idx
    ON spotlight_member_sessions (expires_at)
  `);
}

function setSpotlightSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${SPOTLIGHT_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SPOTLIGHT_SESSION_HOURS * 60 * 60}${secure ? '; Secure' : ''}`
  );
}

function clearSpotlightSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${SPOTLIGHT_SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
  );
}

async function getAuthenticatedSpotlightMember(req) {
  const token = getCookie(req, SPOTLIGHT_SESSION_COOKIE);
  if (!token) return null;

  await ensureSpotlightAuthSchema();
  const result = await query(`
    SELECT a.member_id, a.system_id, a.email, a.full_name
    FROM spotlight_member_sessions s
    JOIN spotlight_member_accounts a ON a.member_id = s.member_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
      AND a.status = 'ACTIVE'
    LIMIT 1
  `, [sha256(token)]);

  return result.rows[0] || null;
}

app.post('/api/spotlight/auth/login', async (req, res) => {
  try {
    await ensureSpotlightAuthSchema();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password are required' });
    }

    const result = await query(`
      SELECT member_id, system_id, email, full_name, password_hash
      FROM spotlight_member_accounts
      WHERE LOWER(email) = $1 AND status = 'ACTIVE'
      LIMIT 1
    `, [email]);

    if (!result.rows.length ||
        !(await spotlightVerifyPassword(password, result.rows[0].password_hash))) {
      return res.status(401).json({ ok: false, error: 'Invalid Spotlight login details' });
    }

    const member = result.rows[0];
    const token = randomBytes(32).toString('base64url');
    await query(`
      INSERT INTO spotlight_member_sessions
        (session_id, member_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    `, [
      `SPOT-SES-${randomBytes(12).toString('hex')}`,
      member.member_id,
      sha256(token),
      new Date(Date.now() + SPOTLIGHT_SESSION_HOURS * 60 * 60 * 1000)
    ]);

    setSpotlightSessionCookie(res, token);
    return res.json({
      ok: true,
      authenticated: true,
      member: {
        systemId: member.system_id,
        email: member.email,
        fullName: member.full_name
      }
    });
  } catch (error) {
    console.error('Spotlight member login error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to sign in to Spotlight' });
  }
});

app.get('/api/spotlight/auth/me', async (req, res) => {
  try {
    const member = await getAuthenticatedSpotlightMember(req);
    if (!member) {
      return res.status(401).json({ ok: false, authenticated: false });
    }
    return res.json({
      ok: true,
      authenticated: true,
      member: {
        systemId: member.system_id,
        email: member.email,
        fullName: member.full_name
      }
    });
  } catch (error) {
    console.error('Spotlight session lookup error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to check Spotlight session' });
  }
});

app.post('/api/spotlight/auth/logout', async (req, res) => {
  try {
    const token = getCookie(req, SPOTLIGHT_SESSION_COOKIE);
    if (token) {
      await ensureSpotlightAuthSchema();
      await query(
        'DELETE FROM spotlight_member_sessions WHERE token_hash = $1',
        [sha256(token)]
      );
    }
  } catch (error) {
    console.error('Spotlight logout error:', error);
  }
  clearSpotlightSessionCookie(res);
  return res.json({ ok: true });
});

// Authenticated members can read only their own saved profiles.
app.get('/api/spotlight/my-profiles', async (req, res) => {
  try {
    const member = await getAuthenticatedSpotlightMember(req);
    if (!member) {
      return res.status(401).json({ ok: false, error: 'Spotlight sign-in required' });
    }
    await ensureSpotlightProfileTable();
    const result = await query(`
      SELECT profile_id, department, display_name, headline, biography,
             details, status, created_at, updated_at, published_at
      FROM spotlight_profiles
      WHERE owner_system_id = $1
      ORDER BY updated_at DESC
      LIMIT 100
    `, [member.system_id]);
    return res.json({ ok: true, profiles: result.rows });
  } catch (error) {
    console.error('Spotlight member profiles error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to load your profiles' });
  }
});

// Save a new Spotlight draft. This route never publishes a profile.
app.post('/api/spotlight/my-profiles', async (req, res) => {
  try {
    const member = await getAuthenticatedSpotlightMember(req);
    if (!member) return res.status(401).json({ ok: false, error: 'Spotlight sign-in required' });
    await ensureSpotlightProfileTable();

    const body = req.body || {};
    const departmentMap = {
      'author': 'author', 'artist': 'artist',
      'music producer': 'music', 'film professional': 'film'
    };
    const department = departmentMap[String(body.department || '').trim().toLowerCase()];
    const displayName = String(body.displayName || '').trim();
    const headline = String(body.headline || '').trim();
    const biography = String(body.biography || '').trim();
    const details = body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {};

    if (!department) return res.status(400).json({ ok: false, error: 'Choose a valid Spotlight department.' });
    if (!displayName || displayName.length > 160) return res.status(400).json({ ok: false, error: 'A display name is required (maximum 160 characters).' });
    if (headline.length > 240 || biography.length > 10000) return res.status(400).json({ ok: false, error: 'Headline or biography is too long.' });

    const profileId = `SPOT-PROF-${randomBytes(12).toString('hex')}`;
    const result = await query(`
      INSERT INTO spotlight_profiles
        (profile_id, owner_system_id, department, display_name, headline, biography, details, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft')
      RETURNING profile_id, department, display_name, headline, biography, details, status, created_at, updated_at
    `, [profileId, member.system_id, department, displayName, headline, biography, JSON.stringify(details)]);

    return res.status(201).json({ ok: true, profile: result.rows[0] });
  } catch (error) {
    console.error('Spotlight draft creation error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to save your draft' });
  }
});

// Update only a draft owned by the signed-in member. Status remains draft.
app.put('/api/spotlight/my-profiles/:profileId', async (req, res) => {
  try {
    const member = await getAuthenticatedSpotlightMember(req);
    if (!member) return res.status(401).json({ ok: false, error: 'Spotlight sign-in required' });
    await ensureSpotlightProfileTable();

    const body = req.body || {};
    const departmentMap = {
      'author': 'author', 'artist': 'artist',
      'music producer': 'music', 'film professional': 'film'
    };
    const department = departmentMap[String(body.department || '').trim().toLowerCase()];
    const displayName = String(body.displayName || '').trim();
    const headline = String(body.headline || '').trim();
    const biography = String(body.biography || '').trim();
    const details = body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {};

    if (!department) return res.status(400).json({ ok: false, error: 'Choose a valid Spotlight department.' });
    if (!displayName || displayName.length > 160) return res.status(400).json({ ok: false, error: 'A display name is required (maximum 160 characters).' });
    if (headline.length > 240 || biography.length > 10000) return res.status(400).json({ ok: false, error: 'Headline or biography is too long.' });

    const result = await query(`
      UPDATE spotlight_profiles
      SET department = $3, display_name = $4, headline = $5, biography = $6,
          details = $7::jsonb, updated_at = NOW()
      WHERE profile_id = $1 AND owner_system_id = $2 AND status = 'draft'
      RETURNING profile_id, department, display_name, headline, biography, details, status, created_at, updated_at
    `, [req.params.profileId, member.system_id, department, displayName, headline, biography, JSON.stringify(details)]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Draft not found, or it is not editable by this account.' });
    return res.json({ ok: true, profile: result.rows[0] });
  } catch (error) {
    console.error('Spotlight draft update error:', error);
    return res.status(500).json({ ok: false, error: 'Unable to update your draft' });
  }
});

// GFT SPOTLIGHT PROFILE API
// Registration and member-write authentication are intentionally
// deferred. Only published profiles are publicly readable.
// ------------------------------------------------------------

async function ensureSpotlightProfileTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS spotlight_profiles (
      profile_id TEXT PRIMARY KEY,
      owner_system_id TEXT NOT NULL,
      department TEXT NOT NULL CHECK (
        department IN ('author', 'artist', 'music', 'film')
      ),
      display_name TEXT NOT NULL,
      headline TEXT NOT NULL DEFAULT '',
      biography TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'published', 'archived')
      ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS spotlight_profiles_public_idx
    ON spotlight_profiles (department, published_at DESC)
    WHERE status = 'published'
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS spotlight_profiles_owner_idx
    ON spotlight_profiles (owner_system_id, updated_at DESC)
  `);
}

app.get('/api/spotlight/profiles', async (req, res) => {
  try {
    const department = String(req.query.department || '').trim().toLowerCase();
    const allowed = ['author', 'artist', 'music', 'film'];

    if (department && !allowed.includes(department)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid Spotlight department'
      });
    }

    await ensureSpotlightProfileTable();

    const params = department ? [department] : [];
    const result = await query(
      `SELECT profile_id, department, display_name, headline,
              biography, details, published_at
       FROM spotlight_profiles
       WHERE status = 'published'
       ${department ? 'AND department = $1' : ''}
       ORDER BY published_at DESC, display_name ASC
       LIMIT 100`,
      params
    );

    return res.json({
      ok: true,
      count: result.rows.length,
      profiles: result.rows
    });
  } catch (error) {
    console.error('Spotlight public profiles error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Unable to load Spotlight profiles'
    });
  }
});

app.get('/api/spotlight/health', async (_req, res) => {
  try {
    await ensureSpotlightProfileTable();
    return res.json({ ok: true, service: 'spotlight-profile-api' });
  } catch (error) {
    console.error('Spotlight API health error:', error);
    return res.status(503).json({
      ok: false,
      error: 'Spotlight storage is unavailable'
    });
  }
});


// ------------------------------------------------------------
// SAFE API 404
// ------------------------------------------------------------

app.use('/api', (_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'API route not found'
  });
});

// ------------------------------------------------------------
// ERROR HANDLING
installDepartmentAdmin(app, {
  query, withTransaction, getAuthenticatedAdmin, getCookie, sha256,
  createPasswordHash, verifyPassword
});

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

// START SERVER
// ------------------------------------------------------------

ensureFounderAccount()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `GFT server listening on http://localhost:${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      'Founder account initialization failed:',
      error
    );

    process.exit(1);
  });