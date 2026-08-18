const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PROJECT_NAME = "Untitled Quiz";
const MAX_QUIZ_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_COUNT = 100;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function asDocument(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw;
  if (data.version !== 1) return null;

  const id = typeof data.id === "string" && isUuid(data.id) ? data.id : null;
  if (!id) return null;

  const projectName =
    typeof data.projectName === "string" && data.projectName.trim()
      ? data.projectName.trim()
      : DEFAULT_PROJECT_NAME;

  const updatedAt =
    typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
      ? data.updatedAt
      : Date.now();

  let sections = data.sections;
  let activeSectionId =
    typeof data.activeSectionId === "string" ? data.activeSectionId : "";

  if (!Array.isArray(sections) || sections.length === 0) {
    const fallbackId = isUuid(data.activeSectionId)
      ? data.activeSectionId
      : crypto.randomUUID();
    const section = {
      id: fallbackId,
      name:
        (typeof data.sectionName === "string" && data.sectionName.trim()) ||
        (typeof data.sceneName === "string" && data.sceneName.trim()) ||
        "Section1",
      localVariables: data.localVariables ?? [],
      localDefaultAnswers: data.localDefaultAnswers ?? [],
      boxes: data.boxes ?? [],
      transitions: data.transitions ?? [],
      camera: data.camera ?? { x: 0, y: 0, scale: 1 },
    };
    sections = [section];
    activeSectionId = section.id;
  }

  const sectionList = sections;
  if (!sectionList.some((section) => section && section.id === activeSectionId)) {
    activeSectionId =
      typeof sectionList[0]?.id === "string" ? sectionList[0].id : "";
  }

  return {
    version: 1,
    id,
    projectName,
    updatedAt,
    variables: Array.isArray(data.variables) ? data.variables : [],
    defaultAnswers: Array.isArray(data.defaultAnswers) ? data.defaultAnswers : [],
    sections,
    activeSectionId,
    results: data.results ?? { textBoxes: [] },
    listing:
      data.listing && typeof data.listing === "object" && !Array.isArray(data.listing)
        ? {
            description:
              typeof data.listing.description === "string" ? data.listing.description : "",
            coverImage:
              typeof data.listing.coverImage === "string" ? data.listing.coverImage : "",
            unlisted: data.listing.unlisted === true,
          }
        : { description: "", coverImage: "", unlisted: false },
  };
}

function parseDocument(raw) {
  const doc = asDocument(raw);
  if (!doc) return { ok: false, error: "Quiz data is invalid." };
  if (jsonSize(doc) > MAX_QUIZ_BYTES) {
    return { ok: false, error: "Quiz is too large to save." };
  }
  return { ok: true, doc };
}

function rowToSummary(row) {
  return {
    id: row.id,
    projectName: row.project_name,
    updatedAt: Number(row.updated_at_ms),
  };
}

export function registerQuizRoutes(app, pool, requireUser) {
  app.get("/api/quizzes", requireUser, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, project_name,
                (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_at_ms
         FROM quizzes
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [req.userId],
      );
      res.json({ quizzes: result.rows.map(rowToSummary) });
    } catch (error) {
      console.error("List quizzes failed:", error);
      res.status(500).json({ error: "Could not load quizzes." });
    }
  });

  app.get("/api/quizzes/:id", requireUser, async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: "Invalid quiz id." });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT document FROM quizzes WHERE user_id = $1 AND id = $2`,
        [req.userId, req.params.id],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: "Quiz not found." });
        return;
      }
      res.json({ quiz: row.document });
    } catch (error) {
      console.error("Load quiz failed:", error);
      res.status(500).json({ error: "Could not load quiz." });
    }
  });

  app.put("/api/quizzes/:id", requireUser, async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: "Invalid quiz id." });
      return;
    }
    const parsed = parseDocument({ ...(req.body?.quiz ?? req.body ?? {}), id: req.params.id });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const doc = parsed.doc;
    try {
      await pool.query(
        `INSERT INTO quizzes (user_id, id, project_name, updated_at, document)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, id) DO UPDATE SET
           project_name = EXCLUDED.project_name,
           updated_at = EXCLUDED.updated_at,
           document = EXCLUDED.document
         WHERE quizzes.document IS DISTINCT FROM EXCLUDED.document
            OR quizzes.updated_at < EXCLUDED.updated_at`,
        [req.userId, doc.id, doc.projectName, new Date(doc.updatedAt), JSON.stringify(doc)],
      );
      res.json({ quiz: doc });
    } catch (error) {
      console.error("Save quiz failed:", error);
      res.status(500).json({ error: "Could not save quiz." });
    }
  });

  app.delete("/api/quizzes/:id", requireUser, async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(400).json({ error: "Invalid quiz id." });
      return;
    }
    try {
      const result = await pool.query(
        `DELETE FROM quizzes WHERE user_id = $1 AND id = $2`,
        [req.userId, req.params.id],
      );
      if (result.rowCount === 0) {
        res.status(404).json({ error: "Quiz not found." });
        return;
      }
      res.status(204).end();
    } catch (error) {
      console.error("Delete quiz failed:", error);
      res.status(500).json({ error: "Could not delete quiz." });
    }
  });

  app.post("/api/quizzes/import", requireUser, async (req, res) => {
    const incoming = req.body?.quizzes;
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: "Expected a list of quizzes." });
      return;
    }
    if (incoming.length > MAX_IMPORT_COUNT) {
      res.status(400).json({ error: "Too many quizzes to import at once." });
      return;
    }

    const docs = [];
    for (const raw of incoming) {
      const parsed = parseDocument(raw);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      docs.push(parsed.doc);
    }

    const unique = new Map();
    for (const doc of docs) {
      const previous = unique.get(doc.id);
      if (!previous || previous.updatedAt <= doc.updatedAt) unique.set(doc.id, doc);
    }

    if (unique.size === 0) {
      res.json({ imported: 0, quizzes: [] });
      return;
    }

    const payload = [...unique.values()].map((doc) => ({
      id: doc.id,
      project_name: doc.projectName,
      updated_at: new Date(doc.updatedAt).toISOString(),
      document: doc,
    }));

    try {
      const result = await pool.query(
        `INSERT INTO quizzes (user_id, id, project_name, updated_at, document)
         SELECT $1, x.id, x.project_name, x.updated_at, x.document
         FROM jsonb_to_recordset($2::jsonb) AS x(
           id uuid,
           project_name text,
           updated_at timestamptz,
           document jsonb
         )
         ON CONFLICT (user_id, id) DO UPDATE SET
           project_name = EXCLUDED.project_name,
           updated_at = EXCLUDED.updated_at,
           document = EXCLUDED.document
         WHERE quizzes.updated_at < EXCLUDED.updated_at
         RETURNING id, project_name,
                   (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_at_ms`,
        [req.userId, JSON.stringify(payload)],
      );
      res.json({
        imported: result.rowCount,
        quizzes: result.rows.map(rowToSummary),
      });
    } catch (error) {
      console.error("Import quizzes failed:", error);
      res.status(500).json({ error: "Could not save quizzes to your account." });
    }
  });
}
