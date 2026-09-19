-- Freeform publish tags (stored without leading #). Empty for legacy publishes.
ALTER TABLE published_quizzes
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN published_quizzes.tags IS
  'Freeform listing tags without leading #. Empty array for quizzes published before tags existed.';

CREATE INDEX IF NOT EXISTS published_quizzes_tags_gin_idx
  ON published_quizzes USING GIN (tags)
  WHERE NOT unlisted;
