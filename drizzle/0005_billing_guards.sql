-- NFR-09: billing ledgers are append-only.
CREATE TRIGGER statement_lines_append_only BEFORE UPDATE OR DELETE ON statement_lines FOR EACH ROW EXECUTE FUNCTION sentire_append_only();
--> statement-breakpoint
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION sentire_append_only();
--> statement-breakpoint
CREATE TRIGGER credit_notes_append_only BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION sentire_append_only();
--> statement-breakpoint
-- Statements: never deleted; number, seller, buyer and amounts never change after issue. Status and settlement totals do.
CREATE OR REPLACE FUNCTION sentire_statement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing statements cannot be deleted; void them' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.seller_profile_id IS DISTINCT FROM OLD.seller_profile_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.subtotal_centavos IS DISTINCT FROM OLD.subtotal_centavos
     OR NEW.tax_centavos IS DISTINCT FROM OLD.tax_centavos OR NEW.total_centavos IS DISTINCT FROM OLD.total_centavos
     OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date THEN
    RAISE EXCEPTION 'issued statement fields cannot change; use a credit note or void' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_statements_guard BEFORE UPDATE OR DELETE ON billing_statements FOR EACH ROW EXECUTE FUNCTION sentire_statement_guard();
