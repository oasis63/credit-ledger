-- Offline-safe collections from the mobile app.
-- client_ref is a UUID generated on the phone when the salesman records a
-- collection. Retries after a lost connection send the same client_ref, and
-- the unique index guarantees the payment is recorded only once.
ALTER TABLE ledger_entries ADD COLUMN client_ref UUID;
CREATE UNIQUE INDEX ledger_client_ref_idx ON ledger_entries(tenant_id, client_ref) WHERE client_ref IS NOT NULL;

-- Keep the new column covered by the immutability trigger.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger entries are immutable; post a correcting entry instead';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.customer_id, NEW.kind, NEW.amount_paise, NEW.entry_date,
      NEW.due_date, NEW.reference, NEW.note, NEW.payment_mode, NEW.payment_ref,
      NEW.collected_by, NEW.created_by, NEW.created_at, NEW.client_ref)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.customer_id, OLD.kind, OLD.amount_paise, OLD.entry_date,
      OLD.due_date, OLD.reference, OLD.note, OLD.payment_mode, OLD.payment_ref,
      OLD.collected_by, OLD.created_by, OLD.created_at, OLD.client_ref) THEN
    RAISE EXCEPTION 'ledger entries are immutable; post a correcting entry instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
