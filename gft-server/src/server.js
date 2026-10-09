import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { Resend } from 'resend';

import {
  randomBytes,
  createHash,
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

app.post('/api/registration/verify-lineage', async (req, res) => {
  try {
    const parentName = String(req.body?.parentName || '').trim();
    const grandparentName = String(req.body?.grandparentName || '').trim();

    if (!parentName || !grandparentName) {
      return res.status(400).json({
        ok: false,
        status: 'LINEAGE_REVIEW_REQUIRED',
        error: 'Parent name and grandparent name are required'
      });
    }

    const normalize = value =>
      String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();

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
       WHERE UPPER(TRIM(full_name)) = $1
       LIMIT 2`,
      [normalize(parentName)]
    );

    if (parentResult.rows.length !== 1) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: parentResult.rows.length === 0
          ? 'PARENT_NOT_FOUND'
          : 'PARENT_NOT_UNIQUE'
      });
    }

    const parent = parentResult.rows[0];

    if (!parent.parent_system_id) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_NOT_LINKED',
        parent: {
          systemId: parent.system_id,
          fullName: parent.full_name,
          generation: parent.generation,
          branch: parent.branch_code
        }
      });
    }

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
       LIMIT 1`,
      [parent.parent_system_id]
    );

    if (!grandparentResult.rows.length) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_NOT_FOUND'
      });
    }

    const grandparent = grandparentResult.rows[0];

    if (normalize(grandparent.full_name) !== normalize(grandparentName)) {
      return res.json({
        ok: true,
        status: 'LINEAGE_REVIEW_REQUIRED',
        reason: 'GRANDPARENT_MISMATCH',
        parent: {
          systemId: parent.system_id,
          fullName: parent.full_name,
          generation: parent.generation,
          branch: parent.branch_code
        }
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
      error: 'Unable to verify lineage'
    });
  }
});

// ------------------------------------------------------------
// SERVER-SIDE FAMILY STRUCTURE / WIFE VERIFICATION
// ------------------------------------------------------------

app.post('/api/registration/verify-structure', async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const parentSystemId = String(req.body?.parentSystemId || '').trim();
    const selectedWifeNo = Number(req.body?.wifeNo);

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

    const childResult = await query(
      `SELECT
         system_id,
         full_name,
         parent_system_id,
         generation,
         branch_code,
         profile->>'wifeNo' AS wife_no
       FROM family_people
       WHERE parent_system_id = $1
         AND UPPER(TRIM(full_name)) = $2
       LIMIT 10`,
      [parentSystemId, normalize(fullName)]
    );

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

    if (selectedWifeNo !== expectedWifeNo) {
      return res.json({
        ok: true,
        status: 'FAMILY_STRUCTURE_NOT_CONFIRMED',
        reason: 'WIFE_NUMBER_MISMATCH'
      });
    }

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
      wifeNo: expectedWifeNo
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

app.post('/api/registration/send-otp', async (req, res) => {
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
        <p>This code expires in 10 minutes.</p>
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
      expiresInSeconds: 600
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

async function generateGftSystemId(generation) {
  const gen = Number(generation);

  if (!Number.isInteger(gen) || gen < 1) {
    throw new Error('Invalid generation for GFT System ID');
  }

  const prefix = `GFT-GEN${gen}-`;

  const result = await query(
    `
    SELECT COALESCE(MAX(number_part), 0) AS max_number
    FROM (
      SELECT
        CASE
          WHEN system_id LIKE $1 || '%'
          THEN NULLIF(SUBSTRING(system_id FROM LENGTH($1) + 1), '')::INTEGER
          ELSE NULL
        END AS number_part
      FROM family_people
      WHERE system_id LIKE $1 || '%'

      UNION ALL

      SELECT
        CASE
          WHEN applicant_system_id LIKE $1 || '%'
          THEN NULLIF(SUBSTRING(applicant_system_id FROM LENGTH($1) + 1), '')::INTEGER
          ELSE NULL
        END AS number_part
      FROM registrations
      WHERE applicant_system_id LIKE $1 || '%'
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
      String(record.idNumber || record.id_number || '').trim() || null;

    if (!fullName) {
      return res.status(400).json({
        ok: false,
        error: 'Full name is required'
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

const structureResult = await query(
  `
  SELECT
    child.system_id,
    child.parent_system_id,
    child.generation,
    child.branch_code,
    child.profile->>'wifeNo' AS wife_no,
    parent.parent_system_id AS grandparent_system_id
  FROM family_people child
  LEFT JOIN family_people parent
    ON parent.system_id = child.parent_system_id
  WHERE LOWER(TRIM(child.full_name)) = LOWER(TRIM($1))
    AND child.parent_system_id = $2
  LIMIT 1
  `,
  [
    fullName,
    String(record.parentId || '').trim()
  ]
);

if (structureResult.rows.length === 0) {
  return res.status(400).json({
    ok: false,
    error: 'Server-side family structure verification failed'
  });
}

const verifiedStructure = structureResult.rows[0];

const verifiedWifeNo = Number(
  String(verifiedStructure.wife_no || '').replace(/\D/g, '')
);

if (
  !Number.isInteger(verifiedWifeNo) ||
  verifiedWifeNo !== Number(record.wifeNo)
) {
  return res.status(400).json({
    ok: false,
    error: 'Server-side wife number verification failed'
  });
}

const verifiedGeneration = Number(verifiedStructure.generation);

const verifiedBranch = verifiedStructure.branch_code || null;
const verifiedParentId = verifiedStructure.parent_system_id || null;
const verifiedGrandparentId =
  verifiedStructure.grandparent_system_id || null;

const serverSystemId =
  await generateGftSystemId(verifiedGeneration);

    const result = await query(
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
  status
)
       )
      VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, $11, $12, $13, $14, $15, $16, 'PENDING'
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
  verifiedGrandparentId
]
    );

    const saved = result.rows[0];
  const serverVerification = {
  emailStatus: 'VERIFIED',
  lineageStatus: 'LINEAGE_CONFIRMED',
  familyStructureStatus: 'VERIFIED',
  identityStatus: 'PENDING_DOCUMENT_VERIFICATION',
  beneficiaryStatus: 'PENDING_VERIFICATION',
  founderVerificationStatus: 'PENDING',
  walletEligible: false,
  payoutEligible: false
};

const uploadedDocuments = [
  {
    field: 'applicantDocument',
    type: 'APPLICANT_DOCUMENT'
  },
  {
    field: 'parentDocument',
    type: 'PARENT_DOCUMENT'
  },
  {
    field: 'additionalDocument',
    type: 'ADDITIONAL_DOCUMENT'
  }
];

for (const document of uploadedDocuments) {
  const file = req.files?.[document.field]?.[0];

  if (!file) continue;

  await query(
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

    return res.status(201).json({
      ok: true,
      registrationId: saved.registration_id,
      systemId: saved.applicant_system_id,
      registrationStatus: saved.status,
      submittedAt: saved.submitted_at,
      verification: serverVerification,
      serverAuthoritative: true,
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
// REGISTRATION LIST
// Server-backed registration records for Admin/Founder views.
// Reads directly from PostgreSQL.
// ------------------------------------------------------------

app.get('/api/registrations', requireAdmin, async (req, res) => {
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
  requireAdmin,
  async (req, res) => {
    try {
      const registrationId =
        String(req.params.registrationId || '').trim();

      if (!registrationId) {
        return res.status(400).json({
          ok: false,
          error: 'Registration ID is required'
        });
      }

      // --------------------------------------------------------
      // 1. Load the registration
      // --------------------------------------------------------

      const registrationResult = await query(
        `SELECT
           registration_id,
           applicant_system_id,
           full_name,
           username,
           phone,
           id_number,
           email,
           date_of_birth,
           gender,
           current_surname,
           generation,
           branch_code,
           wife_no,
           parent_system_id,
           grandparent_system_id,
           parent_full_name,
           grandparent_full_name,
           status
         FROM registrations
         WHERE registration_id = $1
         LIMIT 1`,
        [registrationId]
      );

      if (registrationResult.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Registration not found'
        });
      }

      const registration =
        registrationResult.rows[0];

      // --------------------------------------------------------
      // 2. Only PENDING registrations may be approved
      // --------------------------------------------------------

      if (
        String(registration.status || '')
          .toUpperCase() !== 'PENDING'
      ) {
        return res.status(409).json({
          ok: false,
          error:
            `Registration cannot be approved because its current status is ${registration.status}`
        });
      }

      // --------------------------------------------------------
      // 3. Make sure the applicant has a valid GFT System ID
      // --------------------------------------------------------

      const systemId =
        String(
          registration.applicant_system_id || ''
        ).trim();

      if (!systemId) {
        return res.status(400).json({
          ok: false,
          error:
            'Registration does not have a valid GFT System ID'
        });
      }

      // --------------------------------------------------------
      // 4. Check whether this registration was already converted
      // into a beneficiary.
      //
      // This protects against duplicate beneficiary creation.
      // --------------------------------------------------------

      const existingBeneficiaryResult =
        await query(
          `SELECT
             beneficiary_id,
             system_id,
             membership,
             full_name,
             status
           FROM beneficiaries
           WHERE system_id = $1
           LIMIT 1`,
          [systemId]
        );

      if (
        existingBeneficiaryResult.rows.length > 0
      ) {
        const existing =
          existingBeneficiaryResult.rows[0];

        return res.status(409).json({
          ok: false,
          error:
            'This registration already has a beneficiary record',
          beneficiary: {
            beneficiaryId:
              existing.beneficiary_id,
            systemId:
              existing.system_id,
            membership:
              existing.membership,
            fullName:
              existing.full_name,
            status:
              existing.status
          }
        });
      }

      // --------------------------------------------------------
      // 5. Create the official beneficiary
      //
      // Membership is server-generated from the official
      // GFT System ID.
      // --------------------------------------------------------

      const membership =
        `GFT-MEM-${systemId}`;

      const profile = {
        parentId:
          registration.parent_system_id || null,

        grandparentId:
          registration.grandparent_system_id || null,

        parentName:
          registration.parent_full_name || null,

        grandparentName:
          registration.grandparent_full_name || null,

        generation:
          registration.generation || null,

        branch:
          registration.branch_code || null,

        wifeNo:
          registration.wife_no || null,

        gender:
          registration.gender || null,

        dateOfBirth:
          registration.date_of_birth || null,

        currentSurname:
          registration.current_surname || null,

        email:
          registration.email || null,

        registrationId:
          registration.registration_id,

        approvedAt:
          new Date().toISOString(),

        approvedByAdminId:
          req.admin?.admin_id || null,

        approvedByAdminEmail:
          req.admin?.email || null
      };

      const beneficiaryResult =
        await query(
          `INSERT INTO beneficiaries
             (
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
             )
           VALUES
             (
               $1,
               $2,
               $3,
               $4,
               $5,
               $6,
               'VERIFIED',
               'VERIFIED',
               'ACTIVE',
               $7::jsonb
             )
           RETURNING
             beneficiary_id,
             system_id,
             membership,
             full_name,
             username,
             phone,
             identity_status,
             lineage_status,
             status,
             profile,
             created_at`,
          [
            systemId,
            membership,
            registration.full_name,
            registration.username,
            registration.phone,
            registration.id_number,
            JSON.stringify(profile)
          ]
        );

      const beneficiary =
        beneficiaryResult.rows[0];

      // --------------------------------------------------------
      // 6. Mark the registration as APPROVED
      // --------------------------------------------------------

      const updatedRegistrationResult =
        await query(
          `UPDATE registrations
           SET
             status = 'APPROVED',
             reviewed_at = NOW(),
             review_notes = $2
           WHERE registration_id = $1
           RETURNING
             registration_id,
             applicant_system_id,
             status,
             reviewed_at`,
          [
            registrationId,
            'Registration approved and beneficiary activated'
          ]
        );

      const updatedRegistration =
        updatedRegistrationResult.rows[0];

      // --------------------------------------------------------
      // 7. Return the newly created beneficiary
      //
      // GFT VISA card is intentionally NOT created here yet.
      // --------------------------------------------------------

       const gftVisaCard =
        await issueGftVisaCard({
          beneficiaryId:
            beneficiary.beneficiary_id,

          systemId:
            beneficiary.system_id
        });    

       return res.json({
        ok: true,

        registration: {
          registrationId:
            updatedRegistration.registration_id,

          systemId:
            updatedRegistration.applicant_system_id,

          status:
            updatedRegistration.status,

          reviewedAt:
            updatedRegistration.reviewed_at
        },

        beneficiary: {
          beneficiaryId:
            beneficiary.beneficiary_id,

          systemId:
            beneficiary.system_id,

          membership:
            beneficiary.membership,

          fullName:
            beneficiary.full_name,

          username:
            beneficiary.username,

          identityStatus:
            beneficiary.identity_status,

          lineageStatus:
            beneficiary.lineage_status,

          status:
            beneficiary.status,

          profile:
            beneficiary.profile
        },

     gftVisaCard: {
          created: true,
          cardId:
            gftVisaCard.card_id,

          cardNumber:
            gftVisaCard.card_number,

          cardLast4:
            gftVisaCard.card_last4,

          cardStatus:
            gftVisaCard.card_status,

          issuedAt:
            gftVisaCard.issued_at,

          expiresAt:
            gftVisaCard.expires_at
        },

        serverAuthoritative: true
      });

    } catch (error) {
      console.error(
        'Registration approval error:',
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          'Unable to approve registration'
      });
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
           LOWER(COALESCE(username, '')) =
             LOWER($1)
           OR
           phone = $1
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
       GROUP BY w.wallet_id, w.currency
       LIMIT 1`,
      [beneficiary.system_id]
    );

    const wallet = result.rows[0];

    return res.json({
      ok: true,
      wallet: wallet
        ? {
            walletId: wallet.wallet_id,
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