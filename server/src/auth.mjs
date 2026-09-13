import jwt from "jsonwebtoken";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = "30d";

/** Legacy Quiz Maker JWT helper (unused for password login after accounts cutover). */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set");
  }
  return "dev-only-jwt-secret";
}

/**
 * Secret shared with Dragotoba accounts (accounts JWT_SECRET).
 * Used to verify tokens returned by accounts login.
 */
export function getAccountsJwtSecret() {
  const secret = process.env.ACCOUNTS_JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ACCOUNTS_JWT_SECRET is not set");
  }
  return "dev-only-accounts-jwt-secret";
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name ?? null,
  };
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

export function readBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Verify Dragotoba accounts JWT; returns accounts.id (sub) or null. */
export function dragotobaAccountIdFromToken(token) {
  try {
    const payload = jwt.verify(token, getAccountsJwtSecret());
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Resolve Bearer token → local Quiz Maker users.id via dragotoba_account_id.
 * @param {import("pg").Pool} pool
 * @param {string | null | undefined} token
 * @returns {Promise<string | null>}
 */
export async function localUserIdFromToken(pool, token) {
  if (!token) return null;
  const dragotobaAccountId = dragotobaAccountIdFromToken(token);
  if (!dragotobaAccountId) return null;

  const result = await pool.query(
    `SELECT id FROM users WHERE dragotoba_account_id = $1 LIMIT 1`,
    [dragotobaAccountId],
  );
  return result.rows[0]?.id ?? null;
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeUsername(value) {
  return String(value ?? "").trim();
}

export function validateSignup({ username, email, password }) {
  const errors = [];
  const nextUsername = normalizeUsername(username);
  const nextEmail = normalizeEmail(email);
  const nextPassword = String(password ?? "");

  if (!USERNAME_RE.test(nextUsername)) {
    errors.push("Username must be 3–32 letters, numbers, or underscores.");
  }
  if (!EMAIL_RE.test(nextEmail)) {
    errors.push("Enter a valid email address.");
  }
  if (nextPassword.length < 8) {
    errors.push("Password must be at least 8 characters.");
  }
  if (nextPassword.length > 128) {
    errors.push("Password is too long.");
  }

  return {
    ok: errors.length === 0,
    errors,
    username: nextUsername,
    email: nextEmail,
    password: nextPassword,
  };
}

export function validateLogin({ identifier, password }) {
  const nextIdentifier = String(identifier ?? "").trim();
  const nextPassword = String(password ?? "");
  const errors = [];
  if (!nextIdentifier) errors.push("Enter your email or username.");
  if (!nextPassword) errors.push("Enter your password.");
  return {
    ok: errors.length === 0,
    errors,
    identifier: nextIdentifier,
    password: nextPassword,
  };
}

export function uniqueFieldFromError(error) {
  const detail = String(error?.detail ?? error?.message ?? "");
  if (detail.includes("email")) return "email";
  if (detail.includes("username")) return "username";
  return null;
}
