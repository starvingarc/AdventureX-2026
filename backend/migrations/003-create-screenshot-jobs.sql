CREATE TABLE omo_screenshot_jobs (
  owner_id TEXT NOT NULL REFERENCES omo_owners(owner_id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('accepted', 'processing', 'succeeded', 'failed')),
  image_base64 TEXT,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  attempt_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  card_id TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, job_id),
  UNIQUE (owner_id, fingerprint),
  CHECK (char_length(job_id) BETWEEN 1 AND 200),
  CHECK (char_length(fingerprint) = 64),
  CHECK (char_length(mime_type) BETWEEN 1 AND 100),
  CHECK (attempt_token IS NULL OR char_length(attempt_token) BETWEEN 1 AND 200),
  CHECK (card_id IS NULL OR char_length(card_id) BETWEEN 1 AND 200),
  CHECK (
    (state IN ('accepted', 'processing') AND image_base64 IS NOT NULL)
    OR (state IN ('succeeded', 'failed') AND image_base64 IS NULL)
  ),
  CHECK (
    (state = 'processing' AND attempt_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'processing' AND attempt_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX omo_screenshot_jobs_owner_state_idx
  ON omo_screenshot_jobs (owner_id, state, created_at, job_id);
