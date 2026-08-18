import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function createPool() {
  const connectionString = getDatabaseUrl();
  const sslDisabled = process.env.PGSSLMODE === "disable";
  console.log("[auth] creating db pool", {
    sslDisabled,
    hasDatabaseUrl: true,
    connectionTimeoutMs: 10000,
  });
  const pool = new pg.Pool({
    connectionString,
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (error) => {
    console.error("[auth] db pool error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return pool;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

export async function runMigrations(pool = createPool()) {
  console.log("[auth] connecting to database for migrations");
  const client = await pool.connect();
  console.log("[auth] database connection acquired");
  try {
    await ensureMigrationsTable(client);
    const files = await listMigrationFiles();
    for (const file of files) {
      const id = file;
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE id = $1",
        [id],
      );
      if (applied.rowCount > 0) continue;

      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
        await client.query("COMMIT");
        console.log(`Applied migration ${id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
