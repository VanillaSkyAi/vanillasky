-- Retain both historical tables and every paid attempt. New answers use a new
-- ledger because the published answer table has a three-attempt CHECK.
CREATE TABLE video_chat_fal_reservations (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10)
);
CREATE INDEX video_chat_fal_reservations_actor ON video_chat_fal_reservations(actor);
CREATE INDEX video_chat_fal_reservations_created ON video_chat_fal_reservations(created);
CREATE VIEW video_chat_fal_public_usage AS
  SELECT actor, created, attempts FROM video_chat_fal_previews
  UNION ALL SELECT actor, created, attempts FROM video_chat_fal_answers
  UNION ALL SELECT actor, created, attempts FROM video_chat_fal_reservations;

-- Every deployed worker sees the same lifetime ceiling, even while an older
-- worker writes either historical ledger during rollout or application rollback.
DROP TRIGGER IF EXISTS video_chat_fal_answers_lifetime;
DROP TRIGGER IF EXISTS video_chat_fal_previews_lifetime;

CREATE TRIGGER video_chat_fal_previews_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_previews
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_previews_insert_lifetime
BEFORE INSERT ON video_chat_fal_previews
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER video_chat_fal_answers_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_answers
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_answers_insert_lifetime
BEFORE INSERT ON video_chat_fal_answers
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER video_chat_fal_reservations_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_reservations
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_reservations_insert_lifetime
BEFORE INSERT ON video_chat_fal_reservations
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_public_usage WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;
