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
import { registerQuizRoutes } from "./quizzes.mjs";

const PORT = Number(process.env.PORT) || 3001;

try {
  getJwtSecret();
} catch (error) {
  console.error("JWT_SECRET is required in production:", error);
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

function requireUser(req, res, next) {
  const token = readBearerToken(req);
  const userId = token ? userIdFromToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  req.userId = userId;
  next();
}

registerQuizRoutes(app, pool, requireUser);

app.listen(PORT, "::", () => {
  console.log(`API server listening on [::]:${PORT}`);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
