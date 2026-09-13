-- Passwords live on Dragotoba accounts; Quiz Maker no longer stores hashes.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
