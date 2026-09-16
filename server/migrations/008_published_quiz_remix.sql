-- Attribution for remixed community quizzes (source may later be deleted).
ALTER TABLE published_quizzes
  ADD COLUMN IF NOT EXISTS remixed_from_id UUID NULL,
  ADD COLUMN IF NOT EXISTS remixed_from_author TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN published_quizzes.remixed_from_id IS
  'Published quiz id this listing was remixed from, if any.';

COMMENT ON COLUMN published_quizzes.remixed_from_author IS
  'Username of the remixed source author at remix/publish time.';
