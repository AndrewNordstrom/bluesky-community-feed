-- 008_audit_log_append_only.sql
-- Enforce append-only semantics for governance_audit_log.

CREATE OR REPLACE FUNCTION prevent_governance_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'governance_audit_log is append-only and does not permit % operations', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'governance_audit_log_append_only'
  ) THEN
    CREATE TRIGGER governance_audit_log_append_only
    BEFORE UPDATE OR DELETE ON governance_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_governance_audit_log_mutation();
  END IF;
END;
$$;
