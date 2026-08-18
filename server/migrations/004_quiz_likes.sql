CREATE TABLE IF NOT EXISTS published_quiz_likes (
  quiz_id UUID NOT NULL REFERENCES published_quizzes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (quiz_id, user_id)
);

CREATE INDEX IF NOT EXISTS published_quiz_likes_user_idx
  ON published_quiz_likes (user_id);
