import { readFileSync } from 'node:fs';

export async function ensurePersonNameCleanup(withTransaction) {
  const sql = readFileSync(new URL('../migration/clean-person-name-suffixes.sql', import.meta.url), 'utf8');
  await withTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gft-person-name-cleanup'))");
    await client.query("CREATE TABLE IF NOT EXISTS gft_data_migrations (migration_id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const existing = await client.query("SELECT 1 FROM gft_data_migrations WHERE migration_id = $1", ['clean-guvaza-name-suffixes-v1']);
    if (existing.rowCount) return;
    await client.query(sql);
    await client.query("INSERT INTO gft_data_migrations(migration_id) VALUES ($1)", ['clean-guvaza-name-suffixes-v1']);
  });
}
