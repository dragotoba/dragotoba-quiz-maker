/**
 * Sync users.dragotoba_account_id from the main Dragotoba accounts DB.
 *
 * For each Quiz Maker user, finds the matching accounts row (email +
 * service_links.service_name = quiz_maker) and writes accounts.id onto
 * users.dragotoba_account_id.
 *
 * Env:
 *   DATABASE_URL              — Quiz Maker Postgres
 *   ACCOUNTS_DATABASE_URL     — Dragotoba accounts Postgres (required)
 *   SYNC_DRY_RUN=1            — log only, no Quiz Maker writes
 *   ACCOUNTS_DATABASE_SSL=false / PGSSLMODE=disable — local SSL off
 *   QUIZ_DATABASE_SSL=false   — optional; defaults to same SSL rules as db.mjs
 *
 * Does not delete users or change accounts.
 */
import pg from "pg";
import { createPool, runMigrations } from "./db.mjs";

const { Pool } = pg;

function sslOption(envFlag) {
  if (envFlag === "false" || process.env.PGSSLMODE === "disable") {
    return false;
  }
  return { rejectUnauthorized: false };
}

function createAccountsPool() {
  const url = process.env.ACCOUNTS_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "ACCOUNTS_DATABASE_URL is not set (Dragotoba accounts Postgres)",
    );
  }
  return new Pool({
    connectionString: url,
    ssl: sslOption(process.env.ACCOUNTS_DATABASE_SSL),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

async function main() {
  const dryRun = process.env.SYNC_DRY_RUN === "1";
  const quizPool = createPool();
  const accountsPool = createAccountsPool();

  let updated = 0;
  let alreadySet = 0;
  let missing = 0;
  let conflicts = 0;
  let unchanged = 0;

  try {
    await runMigrations(quizPool);

    const quizUsers = await quizPool.query(`
      SELECT id, username, lower(trim(email)) AS email, dragotoba_account_id
      FROM users
      ORDER BY created_at ASC
    `);

    const accounts = await accountsPool.query(`
      SELECT
        a.id AS accounts_id,
        lower(trim(a.email)) AS email,
        sl.status AS link_status
      FROM accounts a
      INNER JOIN service_links sl
        ON sl.account_id = a.id
       AND sl.service_name = 'quiz_maker'
      WHERE a.status <> 'deleted'
      ORDER BY
        CASE WHEN sl.status = 'active' THEN 0 ELSE 1 END,
        a.created_at ASC
    `);

    /** @type {Map<string, { accounts_id: string, link_status: string }>} */
    const byEmail = new Map();
    for (const row of accounts.rows) {
      if (!byEmail.has(row.email)) {
        byEmail.set(row.email, {
          accounts_id: row.accounts_id,
          link_status: row.link_status,
        });
      }
    }

    // Fallback: email on accounts without requiring a quiz_maker link
    // (covers edge cases before service_links were upserted).
    const accountsByEmailOnly = await accountsPool.query(`
      SELECT id AS accounts_id, lower(trim(email)) AS email
      FROM accounts
      WHERE status <> 'deleted'
    `);
    /** @type {Map<string, string>} */
    const fallbackByEmail = new Map();
    for (const row of accountsByEmailOnly.rows) {
      if (!fallbackByEmail.has(row.email)) {
        fallbackByEmail.set(row.email, row.accounts_id);
      }
    }

    console.log(
      `Quiz Maker users=${quizUsers.rows.length}; ` +
        `accounts with quiz_maker link=${byEmail.size}` +
        (dryRun ? " (DRY RUN)" : ""),
    );

    /** Track accounts_id → quiz user to detect unique conflicts before write */
    const claimed = new Map();

    for (const user of quizUsers.rows) {
      const linked = byEmail.get(user.email);
      const accountsId =
        linked?.accounts_id ?? fallbackByEmail.get(user.email) ?? null;

      if (!accountsId) {
        missing += 1;
        console.warn(
          `[missing] quiz_user=${user.id} email=${user.email} username=${user.username}`,
        );
        continue;
      }

      if (!linked) {
        console.warn(
          `[fallback] ${user.email} matched accounts.id=${accountsId} without quiz_maker service_link`,
        );
      }

      const prior = claimed.get(accountsId);
      if (prior && prior !== user.id) {
        conflicts += 1;
        console.error(
          `[conflict] accounts.id=${accountsId} already claimed by quiz_user=${prior}; ` +
            `skipping quiz_user=${user.id} email=${user.email}`,
        );
        continue;
      }
      claimed.set(accountsId, user.id);

      if (user.dragotoba_account_id === accountsId) {
        alreadySet += 1;
        unchanged += 1;
        continue;
      }

      if (user.dragotoba_account_id && user.dragotoba_account_id !== accountsId) {
        console.warn(
          `[replace] quiz_user=${user.id} email=${user.email} ` +
            `${user.dragotoba_account_id} → ${accountsId}`,
        );
      }

      if (dryRun) {
        console.log(
          `[dry-run] set quiz_user=${user.id} email=${user.email} → ${accountsId}`,
        );
        updated += 1;
        continue;
      }

      try {
        await quizPool.query(
          `UPDATE users
           SET dragotoba_account_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [accountsId, user.id],
        );
        updated += 1;
      } catch (error) {
        conflicts += 1;
        console.error(
          `[write-failed] quiz_user=${user.id} email=${user.email} accounts_id=${accountsId}`,
          error,
        );
      }
    }

    console.log(
      `Done. updated=${updated} already_set=${alreadySet} missing=${missing} ` +
        `conflicts=${conflicts} unchanged=${unchanged}` +
        (dryRun ? " (dry-run)" : ""),
    );
  } finally {
    await accountsPool.end();
    await quizPool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
