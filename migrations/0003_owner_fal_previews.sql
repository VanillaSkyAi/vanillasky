-- Separate owner ledger. Only a server-verified Access identity may reserve here.
-- Answers have no cumulative owner limit, but each keeps a permanent five-attempt
-- ceiling. Never place these reservations in the public preview ledger.
CREATE TABLE IF NOT EXISTS video_chat_owner_fal_previews (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5)
);
