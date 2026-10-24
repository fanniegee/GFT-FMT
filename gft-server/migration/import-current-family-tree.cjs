require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const treeFile = path.resolve(__dirname, '../../guvazaTree.js');
  const source = fs.readFileSync(treeFile, 'utf8');
  const sandbox = { module: { exports: {} }, exports: {} };

  vm.runInNewContext(
    source + '\nmodule.exports = LEGACY_GUVAZA_TREE;',
    sandbox
  );

  const people = sandbox.module.exports;

  if (!Array.isArray(people) || !people.length) {
    throw new Error('Family tree could not be loaded; no database changes made.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const person of people) {
      if (!person.systemId || !person.fullName) {
        throw new Error('A family-tree entry is missing its systemId or fullName.');
      }

      const profile = {
        rootSurname: person.rootSurname || '',
        currentSurname: person.currentSurname || '',
        secondNameOrIdentityQualifier: person.secondSurname || null,
        wifeNo: person.wifeNo || null,
        isPlaceholder: Boolean(person.isPlaceholder),
        isEditable: person.isEditable !== false,
        isFemaleChild: Boolean(person.isFemaleChild),
        canonicalSource: 'guvazaTree.js'
      };

      await client.query(
        `INSERT INTO family_people
          (system_id, parent_system_id, full_name, gender, generation,
           branch_code, date_of_birth, profile)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb)
         ON CONFLICT (system_id) DO NOTHING`,
        [
          person.systemId,
          person.parentId || null,
          person.fullName,
          person.isFemaleChild ? 'FEMALE' : null,
          person.generation,
          person.branch || null,
          JSON.stringify(profile)
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`Family-tree import completed for ${people.length} entries.`);
    console.log('Existing system IDs were not duplicated.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Import failed:', error.message);
  process.exitCode = 1;
});
