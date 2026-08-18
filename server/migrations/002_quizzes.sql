-- One row per quiz. The editor document is stored as JSONB so every field
-- round-trips losslessly. Postgres TOASTs and compresses the document, so
-- list queries that only touch project_name / updated_at never load it.
CREATE TABLE IF NOT EXISTS quizzes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  project_name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  document JSONB NOT NULL,
  PRIMARY KEY (user_id, id),
  CONSTRAINT quizzes_document_object CHECK (jsonb_typeof(document) = 'object'),
  CONSTRAINT quizzes_document_version CHECK ((document->>'version') = '1')
);

CREATE INDEX IF NOT EXISTS quizzes_user_updated_idx
  ON quizzes (user_id, updated_at DESC);
