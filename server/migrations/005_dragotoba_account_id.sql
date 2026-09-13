-- Link Quiz Maker users to central Dragotoba accounts.id (JWT sub).
-- Nullable until sync/provision; unique when set so one Dragotoba account
-- maps to at most one Quiz Maker user.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dragotoba_account_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS users_dragotoba_account_id_unique
  ON users (dragotoba_account_id)
  WHERE dragotoba_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_dragotoba_account_id_idx
  ON users (dragotoba_account_id);

COMMENT ON COLUMN users.dragotoba_account_id IS
  'Dragotoba accounts.id (JWT sub). Filled by sync-dragotoba-ids / future provision.';
