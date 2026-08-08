ALTER TABLE omo_memory_cards
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1
    CHECK (version > 0);

CREATE TABLE omo_assessment_attempts (
  owner_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  assessment TEXT NOT NULL
    CHECK (assessment IN ('remembered', 'fuzzy', 'forgot')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, card_id, attempt_id),
  FOREIGN KEY (owner_id, card_id)
    REFERENCES omo_memory_cards(owner_id, card_id)
    ON DELETE CASCADE,
  CHECK (char_length(attempt_id) BETWEEN 1 AND 200)
);
