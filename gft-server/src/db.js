import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function healthCheck() {
  const result = await pool.query("SELECT NOW() AS now");
  return result.rows[0];
}
