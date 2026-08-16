DELETE FROM idempotency_records
WHERE operation = 'share-create-v1';

ALTER TABLE idempotency_records
  DROP CONSTRAINT IF EXISTS idempotency_share_replay_envelope;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_share_replay_envelope CHECK (
    operation <> 'share-create-v1'
    OR state <> 'complete'
    OR (
      response_json->>'version' = '1'
      AND response_json->>'algorithm' = 'aes-256-gcm'
      AND response_json->>'associatedDataVersion' = 'share-create-replay-v1'
      AND response_json ? 'nonce'
      AND response_json ? 'ciphertext'
      AND response_json ? 'authenticationTag'
    )
  );
