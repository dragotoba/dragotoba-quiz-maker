import cors from "cors";
import express from "express";
import { createPool, runMigrations } from "./db.mjs";
import {
  proxyForgotPasswordToAccounts,
  proxyGoogleToAccounts,
  proxyLoginToAccounts,
  proxyResetPasswordToAccounts,
  proxySignupToAccounts,
} from "./accountsAuth.mjs";
import { ensureLocalQuizUserFromAccounts } from "./localUsers.mjs";
import {
  normalizeEmail,
  publicUser,
  readBearerToken,
  localUserIdFromToken,
  validateLogin,
  validateSignup,
  getJwtSecret,
  getAccountsJwtSecret,
} from "./auth.mjs";
import { registerQuizRoutes } from "./quizzes.mjs";

const PORT = Number(process.env.PORT) || 3001;

const DRAGOTOBA_ACCOUNT_EXISTS_MESSAGE =
  "You already have a Dragotoba account. Sign in with that email and password instead of signing up again.";

try {
  getJwtSecret();
  getAccountsJwtSecret();
} catch (error) {
  console.error("JWT secrets required in production:", error);
  process.exit(1);
}

let pool;
try {
  pool = createPool();
  await runMigrations(pool);
} catch (error) {
  console.error("Database startup failed:", error);
  process.exit(1);
}

const app = express();
const corsOrigin = process.env.CORS_ORIGIN?.trim();
app.use(cors({ origin: corsOrigin || true }));
app.use(express.json({ limit: "8mb" }));

function requestReturnOrigin(req) {
  const fromBody =
    typeof req.body?.returnOrigin === "string" ? req.body.returnOrigin.trim() : "";
  if (fromBody) return fromBody.replace(/\/+$/, "");
  const fromEnv = process.env.WEBSITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  return origin ? origin.replace(/\/+$/, "") : null;
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "dragotoba-quiz-maker-server" });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "dragotoba-quiz-maker-server",
      error: error instanceof Error ? error.message : "Database unavailable",
    });
  }
});

app.get("/", (_req, res) => {
  res.json({
    service: "dragotoba-quiz-maker-server",
    status: "ready",
  });
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = validateSignup(req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    return;
  }

  try {
    const usernameTaken = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [parsed.username],
    );
    if (usernameTaken.rows[0]) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }

    const emailRow = await pool.query(
      `SELECT id, dragotoba_account_id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [parsed.email],
    );
    if (emailRow.rows[0]?.dragotoba_account_id) {
      res.status(409).json({
        error: DRAGOTOBA_ACCOUNT_EXISTS_MESSAGE,
        code: "DRAGOTOBA_ACCOUNT_EXISTS",
      });
      return;
    }

    const accounts = await proxySignupToAccounts({
      name: parsed.username,
      email: parsed.email,
      password: parsed.password,
      returnOrigin: requestReturnOrigin(req),
    });

    if (!accounts.ok) {
      if (accounts.status === 409) {
        res.status(409).json({
          error: DRAGOTOBA_ACCOUNT_EXISTS_MESSAGE,
          code: "DRAGOTOBA_ACCOUNT_EXISTS",
        });
        return;
      }
      res.status(accounts.status).json({ error: accounts.error });
      return;
    }

    const { user: localUser } = await ensureLocalQuizUserFromAccounts(
      pool,
      {
        id: accounts.user.id,
        email: accounts.user.email || parsed.email,
        name: accounts.user.name || parsed.username,
      },
      {
        preferredUsername: parsed.username,
        touchLastLogin: true,
      },
    );

    const session = await proxyLoginToAccounts(parsed.email, parsed.password);
    if (!session.ok) {
      res.status(201).json({
        user: localUser,
        needsLogin: true,
        message: "Account created — sign in.",
      });
      return;
    }

    res.status(201).json({
      token: session.token,
      user: localUser,
    });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Signup misconfigured:", error);
      res.status(503).json({ error: "Accounts signup is not configured." });
      return;
    }
    if (error?.code === "EMAIL_LINK_CONFLICT") {
      res.status(409).json({
        error: DRAGOTOBA_ACCOUNT_EXISTS_MESSAGE,
        code: "DRAGOTOBA_ACCOUNT_EXISTS",
      });
      return;
    }
    console.error("Signup failed:", error);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = validateLogin({
    identifier: req.body?.identifier ?? req.body?.email ?? req.body?.username,
    password: req.body?.password,
  });
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    return;
  }

  try {
    let email;
    if (parsed.identifier.includes("@")) {
      email = normalizeEmail(parsed.identifier);
    } else {
      const local = await pool.query(
        `SELECT email
         FROM users
         WHERE LOWER(username) = LOWER($1)
         LIMIT 1`,
        [parsed.identifier],
      );
      const row = local.rows[0];
      if (!row?.email) {
        res.status(401).json({ error: "Incorrect email/username or password." });
        return;
      }
      email = normalizeEmail(row.email);
    }

    const accounts = await proxyLoginToAccounts(email, parsed.password);
    if (!accounts.ok) {
      res.status(accounts.status).json({ error: accounts.error });
      return;
    }

    const { user: localUser, created } = await ensureLocalQuizUserFromAccounts(
      pool,
      accounts.user,
      { touchLastLogin: true },
    );

    res.json({
      token: accounts.token,
      user: localUser,
      needsDisplayName: created,
    });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Login misconfigured:", error);
      res.status(503).json({ error: "Accounts login is not configured." });
      return;
    }
    if (error?.code === "EMAIL_LINK_CONFLICT") {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error("Login failed:", error);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.post("/api/auth/google", async (req, res) => {
  const idToken =
    typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";
  if (!idToken) {
    res.status(400).json({ error: "Google sign-in did not return a credential." });
    return;
  }

  try {
    const accounts = await proxyGoogleToAccounts(idToken);
    if (!accounts.ok) {
      res.status(accounts.status).json({ error: accounts.error });
      return;
    }

    const { user: localUser, created } = await ensureLocalQuizUserFromAccounts(
      pool,
      accounts.user,
      { touchLastLogin: true },
    );

    // Same welcome popup as first-time password linkers: new local row or new Dragotoba user.
    const needsDisplayName = created || accounts.isNewUser;

    res.json({
      token: accounts.token,
      user: localUser,
      isNewUser: accounts.isNewUser,
      needsDisplayName,
    });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Google auth misconfigured:", error);
      res.status(503).json({ error: "Accounts Google sign-in is not configured." });
      return;
    }
    if (error?.code === "EMAIL_LINK_CONFLICT") {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error("Google auth failed:", error);
    res.status(500).json({ error: "Could not sign in with Google." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const token = readBearerToken(req);
  try {
    const userId = await localUserIdFromToken(pool, token);
    if (!userId) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, email, display_name
       FROM users
       WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    res.json({ user: publicUser(row) });
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Could not load account." });
  }
});

app.patch("/api/auth/me", async (req, res) => {
  const token = readBearerToken(req);
  try {
    const userId = await localUserIdFromToken(pool, token);
    if (!userId) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }

    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    if (!displayName) {
      res.status(400).json({ error: "Enter a display name." });
      return;
    }
    if (displayName.length > 120) {
      res.status(400).json({ error: "Display name must be at most 120 characters." });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET display_name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, username, email, display_name`,
      [displayName, userId],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    res.json({ user: publicUser(row) });
  } catch (error) {
    console.error("Update profile failed:", error);
    res.status(500).json({ error: "Could not update display name." });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  try {
    const returnOrigin =
      typeof req.body?.returnOrigin === "string"
        ? req.body.returnOrigin
        : process.env.WEBSITE_URL?.trim() || null;
    const result = await proxyForgotPasswordToAccounts(email, returnOrigin);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const message =
      typeof result.data?.message === "string"
        ? result.data.message
        : "If an account exists for that email, we sent a password reset link.";
    res.json({ ok: true, message });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Forgot password misconfigured:", error);
      res.status(503).json({ error: "Accounts password reset is not configured." });
      return;
    }
    console.error("Forgot password failed:", error);
    res.status(500).json({ error: "Could not send reset email." });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!token) {
    res.status(400).json({ error: "This link is invalid or expired." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  if (password.length > 128) {
    res.status(400).json({ error: "Password is too long." });
    return;
  }

  try {
    const result = await proxyResetPasswordToAccounts(token, password);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const message =
      typeof result.data?.message === "string"
        ? result.data.message
        : "Password updated.";
    res.json({ ok: true, message });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Reset password misconfigured:", error);
      res.status(503).json({ error: "Accounts password reset is not configured." });
      return;
    }
    console.error("Reset password failed:", error);
    res.status(500).json({ error: "Could not reset password." });
  }
});

async function requireUser(req, res, next) {
  const token = readBearerToken(req);
  try {
    const userId = await localUserIdFromToken(pool, token);
    if (!userId) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    req.userId = userId;
    next();
  } catch (error) {
    console.error("Auth middleware failed:", error);
    res.status(500).json({ error: "Could not verify session." });
  }
}

registerQuizRoutes(app, pool, requireUser);

app.listen(PORT, "::", () => {
  console.log(`API server listening on [::]:${PORT}`);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
