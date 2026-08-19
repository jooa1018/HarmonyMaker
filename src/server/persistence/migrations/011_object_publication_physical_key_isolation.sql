ALTER TABLE object_references
  ADD COLUMN IF NOT EXISTS logical_publication_key text;

UPDATE object_references
SET logical_publication_key = object_key
WHERE logical_publication_key IS NULL;

ALTER TABLE object_references ALTER COLUMN logical_publication_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS object_references_logical_publication_key_idx
  ON object_references (logical_publication_key);

UPDATE object_references
SET publication_generation = 1
WHERE publication_generation <= 0;

CREATE TABLE IF NOT EXISTS object_publication_generations (
  object_reference_id bigint NOT NULL REFERENCES object_references(id) ON DELETE RESTRICT,
  publication_generation bigint NOT NULL CHECK (publication_generation > 0),
  physical_object_key text NOT NULL UNIQUE,
  publication_token text NOT NULL,
  publication_put_may_still_complete boolean NOT NULL,
  publication_lease_expires_at timestamptz,
  delete_outcome text NOT NULL CHECK (delete_outcome IN ('not-started','acknowledged','outcome-uncertain','definitive-not-dispatched')),
  delete_confirmed_at timestamptz,
  cleanup_token text,
  cleanup_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (object_reference_id, publication_generation),
  UNIQUE (object_reference_id, publication_token),
  CHECK ((publication_put_may_still_complete AND publication_lease_expires_at IS NOT NULL)
    OR (NOT publication_put_may_still_complete AND publication_lease_expires_at IS NULL)),
  CHECK ((cleanup_token IS NULL) = (cleanup_lease_expires_at IS NULL)),
  CHECK (deleted_at IS NULL OR (NOT publication_put_may_still_complete AND delete_outcome = 'acknowledged'))
);

INSERT INTO object_publication_generations (
  object_reference_id,publication_generation,physical_object_key,publication_token,
  publication_put_may_still_complete,publication_lease_expires_at,delete_outcome,
  delete_confirmed_at,cleanup_token,cleanup_lease_expires_at,created_at,updated_at,deleted_at
)
SELECT id,publication_generation,object_key,
  COALESCE(publication_token,'legacy-object-publication-' || id::text || '-' || publication_generation::text),
  publication_put_may_still_complete,
  CASE WHEN publication_put_may_still_complete
    THEN COALESCE(publication_lease_expires_at,created_at + interval '100 years') ELSE NULL END,
  CASE WHEN lifecycle = 'deleted' THEN 'acknowledged' ELSE 'not-started' END,
  publication_delete_confirmed_at,publication_cleanup_token,publication_cleanup_lease_expires_at,
  created_at,COALESCE(deleted_at,created_at),
  CASE WHEN lifecycle = 'deleted' AND NOT publication_put_may_still_complete
    THEN COALESCE(deleted_at,created_at) ELSE NULL END
FROM object_references
ON CONFLICT (object_reference_id,publication_generation) DO NOTHING;

CREATE INDEX IF NOT EXISTS object_publication_generations_cleanup_idx
  ON object_publication_generations (deleted_at,delete_outcome,publication_lease_expires_at,object_reference_id,publication_generation)
  WHERE deleted_at IS NULL;
