import cors from "cors";
import express from "express";
import { createPool, runMigrations } from "./db.mjs";
import { proxyLoginToAccounts } from "./accountsAuth.mjs";
import {
  hashPassword,
  normalizeEmail,
  publicUser,
  readBearerToken,
  signToken,
  uniqueFieldFromError,
  localUserIdFromToken,
  validateLogin,
  validateSignup,
  getJwtSecret,
  getAccountsJwtSecret,
} from "./auth.mjs";
import { registerQuizRoutes } from "./quizzes.mjs";

const PORT = Number(process.env.PORT) || 3001;

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
    const passwordHash = await hashPassword(parsed.password);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $1)
       RETURNING id, username, email, display_name`,
      [parsed.username, parsed.email, passwordHash],
    );
    const user = publicUser(result.rows[0]);
    res.status(201).json({
      token: signToken(user.id),
      user,
    });
  } catch (error) {
    if (error?.code === "23505") {
      const field = uniqueFieldFromError(error);
      res.status(409).json({
        error:
          field === "email"
            ? "An account with that email already exists."
            : "That username is already taken.",
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
        `SELECT email, dragotoba_account_id
         FROM users
         WHERE LOWER(username) = LOWER($1)
         LIMIT 1`,
        [parsed.identifier],
      );
      const row = local.rows[0];
      if (!row?.email || !row.dragotoba_account_id) {
        // #region agent log
        fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "a58a7b",
          },
          body: JSON.stringify({
            sessionId: "a58a7b",
            hypothesisId: "C",
            location: "index.mjs:login",
            message: "username lookup failed or missing dragotoba_account_id",
            data: {
              foundUser: Boolean(row),
              hasEmail: Boolean(row?.email),
              hasDragotobaId: Boolean(row?.dragotoba_account_id),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        console.error("[dbg-a58a7b] username login: missing link", {
          foundUser: Boolean(row),
          hasDragotobaId: Boolean(row?.dragotoba_account_id),
        });
        // #endregion
        res.status(401).json({ error: "Incorrect email/username or password." });
        return;
      }
      email = normalizeEmail(row.email);
    }

    const accounts = await proxyLoginToAccounts(email, parsed.password);
    if (!accounts.ok) {
      // #region agent log
      fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "a58a7b",
        },
        body: JSON.stringify({
          sessionId: "a58a7b",
          hypothesisId: "D",
          location: "index.mjs:login",
          message: "accounts proxy rejected login",
          data: {
            status: accounts.status,
            error: accounts.error,
            identifierKind: parsed.identifier.includes("@") ? "email" : "username",
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      console.error("[dbg-a58a7b] accounts login rejected", {
        status: accounts.status,
        error: accounts.error,
      });
      // #endregion
      res.status(accounts.status).json({ error: accounts.error });
      return;
    }

    const linked = await pool.query(
      `SELECT id, username, email, display_name
       FROM users
       WHERE dragotoba_account_id = $1
       LIMIT 1`,
      [accounts.user.id],
    );
    const localUser = linked.rows[0];
    if (!localUser) {
      // #region agent log
      fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "a58a7b",
        },
        body: JSON.stringify({
          sessionId: "a58a7b",
          hypothesisId: "C",
          location: "index.mjs:login",
          message: "accounts ok but no linked local user",
          data: {
            accountsIdPrefix: String(accounts.user.id).slice(0, 8),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      console.error("[dbg-a58a7b] login: account not linked");
      // #endregion
      res.status(403).json({
        error: "Account not linked to Quiz Maker.",
      });
      return;
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      localUser.id,
    ]);

    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "D",
        location: "index.mjs:login",
        message: "login success returning accounts token",
        data: {
          tokenLen: typeof accounts.token === "string" ? accounts.token.length : 0,
          localUserIdPrefix: String(localUser.id).slice(0, 8),
          accountsIdPrefix: String(accounts.user.id).slice(0, 8),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.error("[dbg-a58a7b] login success", {
      tokenLen: typeof accounts.token === "string" ? accounts.token.length : 0,
    });
    // #endregion

    res.json({
      token: accounts.token,
      user: publicUser(localUser),
    });
  } catch (error) {
    if (error?.message === "ACCOUNTS_API_BASE_URL is not set") {
      console.error("Login misconfigured:", error);
      res.status(503).json({ error: "Accounts login is not configured." });
      return;
    }
    console.error("Login failed:", error);
    res.status(500).json({ error: "Could not sign in." });
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

async function requireUser(req, res, next) {
  const token = readBearerToken(req);
  try {
    const userId = await localUserIdFromToken(pool, token);
    if (!userId) {
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
          location: "index.mjs:requireUser",
          message: "requireUser 401",
          data: {
            path: req.path,
            hasAuthHeader: Boolean(req.headers.authorization),
            hasToken: Boolean(token),
            tokenLen: token ? token.length : 0,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      console.error("[dbg-a58a7b] requireUser 401", {
        path: req.path,
        hasAuthHeader: Boolean(req.headers.authorization),
        hasToken: Boolean(token),
        tokenLen: token ? token.length : 0,
      });
      // #endregion
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
