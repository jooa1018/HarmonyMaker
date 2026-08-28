CREATE INDEX IF NOT EXISTS idempotency_share_create_recovery_idx
  ON idempotency_records (operation, key_hash, expires_at, id)
  WHERE operation = 'share-create-v1';
