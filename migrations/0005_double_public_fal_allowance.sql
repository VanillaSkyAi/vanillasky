-- Double the shared public lifetime allowance from five to ten clip attempts.
-- Replace the original guards so existing and new ledgers enforce the same cap.
DROP TRIGGER IF EXISTS video_chat_fal_answers_lifetime;
DROP TRIGGER IF EXISTS video_chat_fal_previews_lifetime;
DROP TRIGGER IF EXISTS video_chat_fal_previews_global;

CREATE TABLE video_chat_fal_answers_v2 (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10)
);
INSERT INTO video_chat_fal_answers_v2(id, actor, created, attempts)
SELECT id, actor, created, attempts FROM video_chat_fal_answers;
DROP TABLE video_chat_fal_answers;
ALTER TABLE video_chat_fal_answers_v2 RENAME TO video_chat_fal_answers;
CREATE INDEX video_chat_fal_answers_actor ON video_chat_fal_answers(actor);
CREATE INDEX video_chat_fal_answers_created ON video_chat_fal_answers(created);

CREATE TRIGGER video_chat_fal_answers_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_answers
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_answers WHERE actor = NEW.actor), 0)
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_previews WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;

-- Retain protection against an older worker inserting through the historical
-- table while this migration rolls out.
CREATE TRIGGER video_chat_fal_previews_global
BEFORE INSERT ON video_chat_fal_previews
WHEN (SELECT COUNT(*) FROM video_chat_fal_previews)
   + (SELECT COUNT(*) FROM video_chat_fal_answers) >= 100
 OR (SELECT COUNT(*) FROM video_chat_fal_previews
     WHERE created >= (NEW.created / 86400000) * 86400000
       AND created < (NEW.created / 86400000 + 1) * 86400000)
   + (SELECT COUNT(*) FROM video_chat_fal_answers
     WHERE created >= (NEW.created / 86400000) * 86400000
       AND created < (NEW.created / 86400000 + 1) * 86400000) >= 10
BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER video_chat_fal_previews_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_previews
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_answers WHERE actor = NEW.actor), 0)
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_previews WHERE actor = NEW.actor), 0) > 10
BEGIN SELECT RAISE(IGNORE); END;
