-- Retain rows: lifetime totals are intentional. Do not purge without preserving totals.
CREATE TABLE IF NOT EXISTS video_chat_requests (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  units INTEGER NOT NULL,
  released INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS video_chat_actor_time ON video_chat_requests(actor, created);
CREATE INDEX IF NOT EXISTS video_chat_time ON video_chat_requests(created);
