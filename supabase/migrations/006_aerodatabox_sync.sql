-- Quota-safe synchronization state for server-side external data providers.
CREATE TABLE IF NOT EXISTS external_sync_state (
  sync_key TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE external_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE external_sync_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE external_sync_state TO service_role;

CREATE OR REPLACE FUNCTION claim_external_sync(
  requested_key TEXT,
  requested_now TIMESTAMPTZ,
  requested_lease_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF requested_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'requested_lease_seconds must be positive';
  END IF;

  INSERT INTO external_sync_state(sync_key, lease_until, updated_at)
  VALUES (
    requested_key,
    requested_now + make_interval(secs => requested_lease_seconds),
    requested_now
  )
  ON CONFLICT (sync_key) DO UPDATE
    SET lease_until = EXCLUDED.lease_until,
        updated_at = EXCLUDED.updated_at
    WHERE external_sync_state.lease_until IS NULL
       OR external_sync_state.lease_until <= requested_now;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION claim_external_sync(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_external_sync(TEXT, TIMESTAMPTZ, INTEGER) TO service_role;
