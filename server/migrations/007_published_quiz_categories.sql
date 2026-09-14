-- Optional tags for community listing. Empty for legacy publishes.
ALTER TABLE published_quizzes
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN published_quizzes.categories IS
  'Publish categories (e.g. Politics, Fandom). Empty array for quizzes published before categories existed.';

CREATE INDEX IF NOT EXISTS published_quizzes_categories_gin_idx
  ON published_quizzes USING GIN (categories)
  WHERE NOT unlisted;
