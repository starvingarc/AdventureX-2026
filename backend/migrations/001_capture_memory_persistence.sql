CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  image_sha256 TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('create_card', 'archive_only', 'needs_confirmation')),
  source_status TEXT NOT NULL CHECK (source_status IN ('verified', 'partial', 'unconfirmed')),
  status TEXT NOT NULL CHECK (status IN ('ready', 'fragment', 'pending')),
  source_app_hint TEXT NOT NULL DEFAULT '',
  shared_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX captures_device_image_active_uidx
  ON captures(device_id, image_sha256)
  WHERE deleted_at IS NULL;

CREATE INDEX captures_account_active_created_idx
  ON captures(account_id, created_at DESC)
  WHERE account_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE evidence_regions (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL,
  evidence_type TEXT NOT NULL DEFAULT 'paragraph',
  evidence_text TEXT NOT NULL,
  bounds_json JSONB,
  confidence DOUBLE PRECISION,
  start_seconds DOUBLE PRECISION,
  end_seconds DOUBLE PRECISION,
  model_version TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capture_id, evidence_key)
);

CREATE TABLE source_bindings (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('exact_context', 'verified_match', 'probable_match', 'unresolved', 'conflicting')),
  platform TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  source_account TEXT NOT NULL DEFAULT '',
  confidence DOUBLE PRECISION,
  evidence_keys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memory_cards (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
  source_binding_id TEXT REFERENCES source_bindings(id) ON DELETE SET NULL,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK (disposition IN ('create_card', 'archive_only', 'needs_confirmation')),
  state TEXT NOT NULL CHECK (state IN ('formal', 'fragment', 'pending')),
  card_json JSONB NOT NULL,
  source_evidence_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_json JSONB,
  mastery_stage TEXT NOT NULL DEFAULT 'sealed'
    CHECK (mastery_stage IN ('sealed', 'awakened', 'solidified', 'engraved')),
  successful_recall_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_recall_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  last_assessment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX memory_cards_device_active_created_idx
  ON memory_cards(device_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX memory_cards_account_active_created_idx
  ON memory_cards(account_id, created_at DESC)
  WHERE account_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE recall_attempts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES memory_cards(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  assessment TEXT NOT NULL CHECK (assessment IN ('remembered', 'fuzzy', 'forgot')),
  assessed_at TIMESTAMPTZ NOT NULL,
  mastery_before TEXT NOT NULL CHECK (mastery_before IN ('sealed', 'awakened', 'solidified', 'engraved')),
  mastery_after TEXT NOT NULL CHECK (mastery_after IN ('sealed', 'awakened', 'solidified', 'engraved')),
  successful_recall_count INTEGER NOT NULL CHECK (successful_recall_count >= 0),
  review_count INTEGER NOT NULL CHECK (review_count >= 0),
  schedule_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(card_id, attempt_id)
);

CREATE INDEX recall_attempts_card_assessed_idx
  ON recall_attempts(card_id, assessed_at DESC);
