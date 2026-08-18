import cors from "cors";
import express from "express";
import { createPool, runMigrations } from "./db.mjs";
import {
  hashPassword,
  passwordMatches,
  publicUser,
  readBearerToken,
  signToken,
  uniqueFieldFromError,
  userIdFromToken,
  validateLogin,
  validateSignup,
  getJwtSecret,
} from "./auth.mjs";

console.log("[auth] starting process", {
  nodeEnv: process.env.NODE_ENV ?? null,
  portEnv: process.env.PORT ?? null,
});

const PORT = Number(process.env.PORT) || 3001;

try {
  getJwtSecret();
  console.log("[auth] jwt secret ok");
} catch (error) {
  console.error("[auth] fatal: JWT_SECRET is required in production", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

let pool;
try {
  pool = createPool();
  console.log("[auth] running migrations");
  await runMigrations(pool);
  console.log("[auth] migrations finished");
} catch (error) {
  console.error("[auth] fatal: database startup failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const app = express();
const corsOrigin = process.env.CORS_ORIGIN?.trim();
app.use(cors({ origin: corsOrigin || true }));
app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  authLog("incoming", { method: req.method, path: req.path });
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
      location: "server/src/index.mjs:incoming",
      message: "incoming request",
      data: { method: req.method, path: req.path },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  next();
});

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

function authLog(message, data = {}) {
  console.log(`[auth] ${message}`, data);
}

app.post("/api/auth/signup", async (req, res) => {
  const started = Date.now();
  const parsed = validateSignup(req.body ?? {});
  authLog("signup request", {
    ok: parsed.ok,
    usernameLen: parsed.username.length,
    emailLen: parsed.email.length,
    errors: parsed.ok ? [] : parsed.errors,
  });
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
      location: "server/src/index.mjs:signup",
      message: "signup received",
      data: { ok: parsed.ok, errors: parsed.ok ? [] : parsed.errors },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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
    const token = signToken(user.id);
    authLog("signup success", { userId: user.id, ms: Date.now() - started });
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
        location: "server/src/index.mjs:signup",
        message: "signup success",
        data: { userId: user.id, ms: Date.now() - started },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    res.status(201).json({
      token,
      user,
    });
  } catch (error) {
    if (error?.code === "23505") {
      const field = uniqueFieldFromError(error);
      authLog("signup conflict", { field, ms: Date.now() - started });
      res.status(409).json({
        error:
          field === "email"
            ? "An account with that email already exists."
            : "That username is already taken.",
      });
      return;
    }
    authLog("signup failed", {
      code: error?.code ?? null,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    });
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
    const result = await pool.query(
      `SELECT id, username, email, display_name, password_hash
       FROM users
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
       LIMIT 1`,
      [parsed.identifier],
    );
    const row = result.rows[0];
    if (!row || !(await passwordMatches(parsed.password, row.password_hash))) {
      res.status(401).json({ error: "Incorrect email/username or password." });
      return;
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      row.id,
    ]);

    res.json({
      token: signToken(row.id),
      user: publicUser(row),
    });
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const token = readBearerToken(req);
  const userId = token ? userIdFromToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  try {
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

const server = app.listen(PORT, () => {
  const addr = server.address();
  authLog("listening", {
    port: PORT,
    envPort: process.env.PORT ?? null,
    address: addr,
  });
  console.log(
    `API server listening on port ${PORT} (PORT env=${process.env.PORT ?? "unset"}). Railway public domain target port must match this.`,
  );
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
