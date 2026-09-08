-- Permanent pilot spending ledger. Do not expire or prune these rows: actor
-- lifetime and total pilot limits depend on them. No prompt or raw IP stored.
CREATE TABLE IF NOT EXISTS video_chat_fal_previews (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5)
);
CREATE INDEX IF NOT EXISTS video_chat_fal_previews_created ON video_chat_fal_previews(created);
