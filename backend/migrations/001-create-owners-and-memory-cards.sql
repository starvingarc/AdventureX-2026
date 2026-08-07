CREATE TABLE omo_owners (
  owner_id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL DEFAULT 'device'
    CHECK (owner_kind IN ('device', 'account')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(owner_id) BETWEEN 1 AND 200)
);

CREATE TABLE omo_memory_cards (
  owner_id TEXT NOT NULL REFERENCES omo_owners(owner_id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  next_review_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, card_id),
  CHECK (char_length(card_id) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(card) = 'object')
);

CREATE INDEX omo_memory_cards_owner_created_idx
  ON omo_memory_cards (owner_id, created_at DESC, card_id);

CREATE INDEX omo_memory_cards_owner_review_idx
  ON omo_memory_cards (owner_id, next_review_at, card_id);
