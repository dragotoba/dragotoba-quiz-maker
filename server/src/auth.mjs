import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = "30d";

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set");
  }
  return "dev-only-jwt-secret";
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

export function userIdFromToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
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
