-- Add repeatable public answers without rewriting the permanent historical ledger.
-- Attempts in both tables remain lifetime spend, including failed/cancelled calls.
CREATE TABLE IF NOT EXISTS video_chat_fal_answers (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3)
);
CREATE INDEX IF NOT EXISTS video_chat_fal_answers_actor ON video_chat_fal_answers(actor);
CREATE INDEX IF NOT EXISTS video_chat_fal_answers_created ON video_chat_fal_answers(created);

-- Protect the shared five-attempt budget even while an older deployed worker
-- completes a reservation from the historical ledger. IGNORE returns zero changes
-- to both versions, which deny submission before calling the paid provider.
CREATE TRIGGER IF NOT EXISTS video_chat_fal_answers_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_answers
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_answers WHERE actor = NEW.actor), 0)
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_previews WHERE actor = NEW.actor), 0) > 5
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS video_chat_fal_previews_lifetime
BEFORE UPDATE OF attempts ON video_chat_fal_previews
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_answers WHERE actor = NEW.actor), 0)
  + COALESCE((SELECT SUM(attempts) FROM video_chat_fal_previews WHERE actor = NEW.actor), 0) > 5
BEGIN SELECT RAISE(IGNORE); END;

-- Older workers count only the historical table when admitting answers. Preserve
-- the fixed site-wide hard ceilings if both versions overlap during rollout.
CREATE TRIGGER IF NOT EXISTS video_chat_fal_previews_global
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
