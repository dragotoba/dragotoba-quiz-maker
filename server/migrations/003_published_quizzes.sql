-- Frozen public snapshot, separate from the owner's editable draft in quizzes.
-- Community lists only these listing columns so the full JSONB document stays TOASTed.
CREATE TABLE IF NOT EXISTS published_quizzes (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  unlisted BOOLEAN NOT NULL DEFAULT FALSE,
  like_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  document JSONB NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT published_quizzes_owner_quiz_fk
    FOREIGN KEY (user_id, id) REFERENCES quizzes(user_id, id) ON DELETE CASCADE,
  CONSTRAINT published_quizzes_document_object CHECK (jsonb_typeof(document) = 'object')
);

CREATE INDEX IF NOT EXISTS published_quizzes_recent_idx
  ON published_quizzes (published_at DESC)
  WHERE NOT unlisted;

CREATE INDEX IF NOT EXISTS published_quizzes_liked_idx
  ON published_quizzes (like_count DESC, published_at DESC)
  WHERE NOT unlisted;
