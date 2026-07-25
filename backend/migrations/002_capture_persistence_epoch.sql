ALTER TABLE devices
  ADD COLUMN capture_persistence_epoch BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN devices.capture_persistence_epoch IS
  'Monotonic cancellation fence for in-flight capture persistence.';
