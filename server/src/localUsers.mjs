import { normalizeEmail, publicUser } from "./auth.mjs";

const USERNAME_SAFE_RE = /^[a-zA-Z0-9_]{3,32}$/;

/**
 * @param {string} raw
 * @param {{ lower?: boolean }} [options]
 * @returns {string | null}
 */
export function sanitizeUsername(raw, options = {}) {
  let cleaned = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 32);
  if (options.lower !== false) cleaned = cleaned.toLowerCase();
  if (!USERNAME_SAFE_RE.test(cleaned)) return null;
  return cleaned;
}

/**
 * @param {string} email
 */
export function usernameBaseFromEmail(email) {
  const localPart = String(email ?? "").split("@")[0] ?? "";
  return sanitizeUsername(localPart) || "user";
}

/**
 * @param {import("pg").Pool} pool
 * @param {string} base
 * @param {{ preserveCase?: boolean }} [options]
 */
export async function allocateUniqueUsername(pool, base, options = {}) {
  const root =
    sanitizeUsername(base, { lower: !options.preserveCase }) ||
    sanitizeUsername(base) ||
    "user";
  for (let i = 0; i < 64; i++) {
    let candidate;
    if (i === 0) {
      candidate = root;
    } else if (i < 20) {
      const suffix = `_${i + 1}`;
      candidate = `${root.slice(0, Math.max(3, 32 - suffix.length))}${suffix}`;
    } else {
      const hex = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, "0");
      const suffix = `_${hex}`;
      candidate = `${root.slice(0, Math.max(3, 32 - suffix.length))}${suffix}`;
    }
    const taken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [candidate],
    );
    if (!taken.rows[0]) return candidate;
  }
  throw new Error("Could not allocate a unique username.");
}

/**
 * Find, link, or create a Quiz Maker user for a Dragotoba accounts user.
 *
 * @param {import("pg").Pool} pool
 * @param {{ id: string, email?: string, name?: string }} accountsUser
 * @param {{ preferredUsername?: string | null, touchLastLogin?: boolean }} [options]
 * @returns {Promise<{ user: ReturnType<typeof publicUser>, created: boolean }>}
 */
export async function ensureLocalQuizUserFromAccounts(pool, accountsUser, options = {}) {
  const accountId = accountsUser?.id;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Missing Dragotoba account id.");
  }

  const email = normalizeEmail(accountsUser.email);
  if (!email) {
    throw new Error("Missing Dragotoba account email.");
  }

  const displayName =
    (typeof accountsUser.name === "string" && accountsUser.name.trim()) ||
    (typeof options.preferredUsername === "string" && options.preferredUsername.trim()) ||
    email.split("@")[0] ||
    "User";

  const byAccount = await pool.query(
    `SELECT id, username, email, display_name, dragotoba_account_id
     FROM users
     WHERE dragotoba_account_id = $1
     LIMIT 1`,
    [accountId],
  );
  if (byAccount.rows[0]) {
    if (options.touchLastLogin !== false) {
      await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [
        byAccount.rows[0].id,
      ]);
    }
    return { user: publicUser(byAccount.rows[0]), created: false };
  }

  const byEmail = await pool.query(
    `SELECT id, username, email, display_name, dragotoba_account_id
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email],
  );
  if (byEmail.rows[0]) {
    const row = byEmail.rows[0];
    if (row.dragotoba_account_id && row.dragotoba_account_id !== accountId) {
      const err = new Error("That email is already linked to another Dragotoba account.");
      err.code = "EMAIL_LINK_CONFLICT";
      throw err;
    }
    if (!row.dragotoba_account_id) {
      const linked = await pool.query(
        `UPDATE users
         SET dragotoba_account_id = $1,
             display_name = COALESCE(display_name, $2),
             last_login_at = CASE WHEN $3 THEN NOW() ELSE last_login_at END,
             updated_at = NOW()
         WHERE id = $4 AND dragotoba_account_id IS NULL
         RETURNING id, username, email, display_name`,
        [accountId, displayName, options.touchLastLogin !== false, row.id],
      );
      if (linked.rows[0]) {
        return { user: publicUser(linked.rows[0]), created: false };
      }
    }
    if (options.touchLastLogin !== false) {
      await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [row.id]);
    }
    return { user: publicUser(row), created: false };
  }

  const preferredRaw =
    typeof options.preferredUsername === "string" ? options.preferredUsername.trim() : "";
  const preferred = USERNAME_SAFE_RE.test(preferredRaw) ? preferredRaw : null;
  const username = preferred
    ? await allocateUniqueUsername(pool, preferred, { preserveCase: true })
    : await allocateUniqueUsername(pool, usernameBaseFromEmail(email));

  try {
    const inserted = await pool.query(
      `INSERT INTO users (
         username, email, display_name, dragotoba_account_id, email_verified_at, last_login_at
       )
       VALUES ($1, $2, $3, $4, NULL, CASE WHEN $5 THEN NOW() ELSE NULL END)
       RETURNING id, username, email, display_name`,
      [
        username,
        email,
        displayName,
        accountId,
        options.touchLastLogin !== false,
      ],
    );
    return { user: publicUser(inserted.rows[0]), created: true };
  } catch (error) {
    if (error?.code !== "23505") throw error;

    const racedAccount = await pool.query(
      `SELECT id, username, email, display_name
       FROM users
       WHERE dragotoba_account_id = $1
       LIMIT 1`,
      [accountId],
    );
    if (racedAccount.rows[0]) {
      return { user: publicUser(racedAccount.rows[0]), created: false };
    }

    const racedEmail = await pool.query(
      `SELECT id, username, email, display_name, dragotoba_account_id
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email],
    );
    if (racedEmail.rows[0] && !racedEmail.rows[0].dragotoba_account_id) {
      const linked = await pool.query(
        `UPDATE users
         SET dragotoba_account_id = $1,
             last_login_at = CASE WHEN $2 THEN NOW() ELSE last_login_at END
         WHERE id = $3 AND dragotoba_account_id IS NULL
         RETURNING id, username, email, display_name`,
        [accountId, options.touchLastLogin !== false, racedEmail.rows[0].id],
      );
      if (linked.rows[0]) {
        return { user: publicUser(linked.rows[0]), created: false };
      }
    }
    if (racedEmail.rows[0]) {
      return { user: publicUser(racedEmail.rows[0]), created: false };
    }
    throw error;
  }
}
