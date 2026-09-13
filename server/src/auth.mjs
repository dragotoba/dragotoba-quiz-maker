import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = "30d";

/** Legacy Quiz Maker JWT (signup still uses this until signup cutover). */
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
  } catch (error) {
    // #region agent log
    const decoded = (() => {
      try {
        return jwt.decode(token);
      } catch {
        return null;
      }
    })();
    const secretLen = (process.env.ACCOUNTS_JWT_SECRET || "").trim().length;
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "B",
        location: "auth.mjs:dragotobaAccountIdFromToken",
        message: "jwt.verify failed",
        data: {
          errName: error?.name,
          errMessage: error?.message,
          tokenLen: typeof token === "string" ? token.length : 0,
          secretConfigured: secretLen > 0,
          secretLen,
          decodedSubType: typeof decoded?.sub,
          decodedHasSid: Boolean(decoded && typeof decoded === "object" && "sid" in decoded),
          decodedHasSvc: Boolean(decoded && typeof decoded === "object" && "svc" in decoded),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.error("[dbg-a58a7b] jwt.verify failed", {
      errName: error?.name,
      errMessage: error?.message,
      tokenLen: typeof token === "string" ? token.length : 0,
      secretLen,
    });
    // #endregion
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
  if (!token) {
    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "A",
        location: "auth.mjs:localUserIdFromToken",
        message: "no token",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.error("[dbg-a58a7b] localUserIdFromToken: no token");
    // #endregion
    return null;
  }
  const dragotobaAccountId = dragotobaAccountIdFromToken(token);
  if (!dragotobaAccountId) {
    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "B",
        location: "auth.mjs:localUserIdFromToken",
        message: "verify returned null sub",
        data: { tokenLen: token.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return null;
  }

  const result = await pool.query(
    `SELECT id FROM users WHERE dragotoba_account_id = $1 LIMIT 1`,
    [dragotobaAccountId],
  );
  const localId = result.rows[0]?.id ?? null;
  // #region agent log
  fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "a58a7b",
    },
    body: JSON.stringify({
      sessionId: "a58a7b",
      hypothesisId: localId ? "OK" : "C",
      location: "auth.mjs:localUserIdFromToken",
      message: localId ? "resolved local user" : "no local user for dragotoba_account_id",
      data: {
        hasLocalId: Boolean(localId),
        accountIdLen: dragotobaAccountId.length,
        accountIdPrefix: dragotobaAccountId.slice(0, 8),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  if (!localId) {
    console.error("[dbg-a58a7b] no local user for dragotoba_account_id", {
      accountIdPrefix: dragotobaAccountId.slice(0, 8),
    });
  }
  // #endregion
  return localId;
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

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function passwordMatches(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function uniqueFieldFromError(error) {
  const detail = String(error?.detail ?? error?.message ?? "");
  if (detail.includes("email")) return "email";
  if (detail.includes("username")) return "username";
  return null;
}
