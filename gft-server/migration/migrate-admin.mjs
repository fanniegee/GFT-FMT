import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..', '..');

const API_URL =
  'https://gft-fmt.onrender.com/api/admin/migrate-legacy';

function findSnapshot(dir) {
  const entries = fs.readdirSync(dir, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git'
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (
      entry.isFile() &&
      entry.name === 'GFT-localstorage-snapshot.json'
    ) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const found = findSnapshot(fullPath);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function main() {
  console.log('');
  console.log('GFT-FMT Admin Migration');
  console.log('-----------------------');

  const snapshotPath = findSnapshot(projectRoot);

  if (!snapshotPath) {
    console.error(
      'ERROR: GFT-localstorage-snapshot.json was not found.'
    );
    process.exit(1);
  }

  console.log(
    'Snapshot found.'
  );

  const raw = fs.readFileSync(
    snapshotPath,
    'utf8'
  );

  const snapshot = JSON.parse(raw);

  const adminsRaw =
    snapshot.storage?.guvaza_admins;

  if (!adminsRaw) {
    console.error(
      'ERROR: guvaza_admins was not found in the snapshot.'
    );
    process.exit(1);
  }

  const admins =
    Array.isArray(adminsRaw)
      ? adminsRaw
      : parseJSON(adminsRaw, []);

  if (!admins.length) {
    console.error(
      'ERROR: No Admin accounts were found.'
    );
    process.exit(1);
  }

  const activeAdmins =
    admins.filter(
      admin =>
        admin &&
        admin.active === true &&
        admin.email &&
        admin.passwordHash
    );

  if (!activeAdmins.length) {
    console.error(
      'ERROR: No active Admin with a password verifier was found.'
    );
    process.exit(1);
  }

  if (activeAdmins.length > 1) {
    console.log(
      `Found ${activeAdmins.length} active Admin accounts.`
    );
  }

  /*
   * The existing snapshot contains the Admin account
   * we are migrating. We select the first active account
   * with the existing password verifier.
   */
  const admin = activeAdmins[0];

  if (
    typeof admin.passwordPlain === 'string'
  ) {
    console.log(
      'Existing password is present locally.'
    );
    console.log(
      'It will NOT be sent to the server.'
    );
  }

  if (
    typeof admin.passwordHash !== 'string' ||
    !admin.passwordHash
  ) {
    console.error(
      'ERROR: Existing password verifier is missing.'
    );
    process.exit(1);
  }

  const secret = await ask(
    'Enter GFT_ADMIN_MIGRATION_SECRET: '
  );

  if (!secret) {
    console.error(
      'ERROR: Migration secret was not entered.'
    );
    process.exit(1);
  }

  const payload = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    phone: admin.phone || '',
    role: admin.role,

    permissions:
      Array.isArray(admin.permissions)
        ? admin.permissions
        : [],

    tasks:
      Array.isArray(admin.tasks)
        ? admin.tasks
        : [],

    deployment:
      admin.deployment &&
      typeof admin.deployment === 'object'
        ? admin.deployment
        : {},

    passwordHash:
      admin.passwordHash,

    status:
      admin.status || 'ACTIVE',

    active:
      admin.active === true,

    dateInvited:
      admin.dateInvited || null
  };

  console.log('');
  console.log(
    'Sending existing Admin account to the protected server...'
  );

  const response = await fetch(
    API_URL,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-gft-migration-secret': secret
      },

      body: JSON.stringify(payload)
    }
  );

  const result =
    await response.json();

  if (!response.ok || !result.ok) {
    console.error('');
    console.error(
      'ADMIN MIGRATION FAILED'
    );
    console.error(
      result.error || `HTTP ${response.status}`
    );
    process.exit(1);
  }

  console.log('');
  console.log(
    'ADMIN MIGRATION SUCCESSFUL'
  );
  console.log(
    'The existing Admin account is now in PostgreSQL.'
  );
  console.log(
    'The existing LocalStorage account has NOT been changed.'
  );
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error(
    'Migration error:',
    error.message
  );
  process.exit(1);
});