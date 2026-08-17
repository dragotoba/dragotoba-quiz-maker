import { createPool, runMigrations } from "./db.mjs";

const pool = createPool();

try {
  await runMigrations(pool);
  console.log("Database migrations complete");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
