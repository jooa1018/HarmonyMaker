ALTER TABLE object_references
  ADD COLUMN IF NOT EXISTS publication_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publication_put_may_still_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_predecessor_token text,
  ADD COLUMN IF NOT EXISTS publication_predecessor_generation bigint,
  ADD COLUMN IF NOT EXISTS publication_delete_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS publication_cleanup_token text,
  ADD COLUMN IF NOT EXISTS publication_cleanup_lease_expires_at timestamptz;

UPDATE object_references
SET publication_generation = CASE WHEN publication_generation = 0 THEN 1 ELSE publication_generation END,
    publication_put_may_still_complete = true
WHERE lifecycle = 'upload-pending';

UPDATE object_references
SET lifecycle = 'tombstone-pending',
    publication_generation = CASE WHEN publication_generation = 0 THEN 1 ELSE publication_generation END,
    publication_put_may_still_complete = true
WHERE lifecycle = 'delete-pending' AND publication_token IS NOT NULL;

ALTER TABLE object_references DROP CONSTRAINT IF EXISTS object_references_lifecycle_check;
ALTER TABLE object_references ADD CONSTRAINT object_references_lifecycle_check CHECK (
  lifecycle IN ('upload-pending','tombstone-pending','active','delete-pending','deleted','expired')
);
ALTER TABLE object_references DROP CONSTRAINT IF EXISTS object_references_publication_check;
ALTER TABLE object_references ADD CONSTRAINT object_references_publication_check CHECK (
  (lifecycle <> 'upload-pending' OR (publication_token IS NOT NULL AND publication_generation > 0
    AND ((publication_put_may_still_complete AND publication_lease_expires_at IS NOT NULL)
      OR (NOT publication_put_may_still_complete AND publication_lease_expires_at IS NULL))))
  AND (lifecycle <> 'tombstone-pending' OR (publication_generation > 0 AND (publication_token IS NOT NULL OR publication_predecessor_token IS NOT NULL)))
  AND ((publication_predecessor_token IS NULL) = (publication_predecessor_generation IS NULL))
  AND ((publication_cleanup_token IS NULL) = (publication_cleanup_lease_expires_at IS NULL))
);

DROP INDEX IF EXISTS object_references_publication_cleanup_idx;
CREATE INDEX object_references_publication_cleanup_idx
  ON object_references (lifecycle, publication_lease_expires_at, id)
  WHERE lifecycle IN ('upload-pending','tombstone-pending');
