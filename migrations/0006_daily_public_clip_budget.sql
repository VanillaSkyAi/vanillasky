-- Old rows have only reservation timestamps. Preserve their recorded usage at
-- migration time; every subsequent increment is charged on its actual UTC day.
CREATE TABLE video_chat_fal_daily_attempts (
  day INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
);
INSERT INTO video_chat_fal_daily_attempts(day, attempts)
SELECT (created / 86400000) * 86400000, SUM(attempts)
FROM video_chat_fal_public_usage
GROUP BY (created / 86400000) * 86400000;

-- Answer counts no longer determine admission. Zero-attempt reservations remain
-- available even at daily exhaustion; only a charged clip consumes this pool.
DROP TRIGGER IF EXISTS video_chat_fal_previews_global;

-- Database time is authoritative for both old and new writers. Each guard and
-- charge executes atomically with its ledger change, including at UTC midnight.
-- Never decrement this pool: failed or cancelled submissions remain paid attempts.

CREATE TRIGGER video_chat_fal_previews_update_daily_limit
BEFORE UPDATE OF attempts ON video_chat_fal_previews
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_previews_update_daily_charge
AFTER UPDATE OF attempts ON video_chat_fal_previews
WHEN NEW.attempts > OLD.attempts
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts - OLD.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;

CREATE TRIGGER video_chat_fal_previews_insert_daily_limit
BEFORE INSERT ON video_chat_fal_previews
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_previews_insert_daily_charge
AFTER INSERT ON video_chat_fal_previews
WHEN NEW.attempts > 0
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;

CREATE TRIGGER video_chat_fal_answers_update_daily_limit
BEFORE UPDATE OF attempts ON video_chat_fal_answers
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_answers_update_daily_charge
AFTER UPDATE OF attempts ON video_chat_fal_answers
WHEN NEW.attempts > OLD.attempts
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts - OLD.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;

CREATE TRIGGER video_chat_fal_answers_insert_daily_limit
BEFORE INSERT ON video_chat_fal_answers
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_answers_insert_daily_charge
AFTER INSERT ON video_chat_fal_answers
WHEN NEW.attempts > 0
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;

CREATE TRIGGER video_chat_fal_reservations_update_daily_limit
BEFORE UPDATE OF attempts ON video_chat_fal_reservations
WHEN NEW.attempts > OLD.attempts AND
  NEW.attempts - OLD.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_reservations_update_daily_charge
AFTER UPDATE OF attempts ON video_chat_fal_reservations
WHEN NEW.attempts > OLD.attempts
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts - OLD.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;

CREATE TRIGGER video_chat_fal_reservations_insert_daily_limit
BEFORE INSERT ON video_chat_fal_reservations
WHEN NEW.attempts > 0 AND
  NEW.attempts
  + COALESCE((SELECT attempts FROM video_chat_fal_daily_attempts
      WHERE day = (unixepoch('now') / 86400) * 86400000), 0) > 200
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER video_chat_fal_reservations_insert_daily_charge
AFTER INSERT ON video_chat_fal_reservations
WHEN NEW.attempts > 0
BEGIN
  INSERT INTO video_chat_fal_daily_attempts(day, attempts)
  VALUES ((unixepoch('now') / 86400) * 86400000, NEW.attempts)
  ON CONFLICT(day) DO UPDATE SET attempts = attempts + excluded.attempts;
END;
