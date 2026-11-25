-- Append-only guard (System Design NFR-09). Rows protected by this trigger can be inserted, never changed or deleted.
CREATE OR REPLACE FUNCTION sentire_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_entries_append_only BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION sentire_append_only();
