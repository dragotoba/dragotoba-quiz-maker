import express from "express";
import { createPool, runMigrations } from "./db.mjs";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 3001;

const pool = createPool();

await runMigrations(pool);

const app = express();
app.use(express.json());

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

app.listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
