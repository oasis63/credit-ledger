-- Core schema for the credit ledger.
-- Money is stored as integer paise (BIGINT). Never floats.
-- Tenant isolation is enforced by Postgres row-level security (RLS):
-- every tenant-scoped query runs as role app_user with app.tenant_id set.
-- The connecting (owner) role bypasses RLS and is used only for the few
-- cross-tenant operations: register, login, webhook routing, agent keys.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

CREATE TABLE tenants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  upi_vpa             TEXT,
  upi_payee_name      TEXT,
  wa_phone_number_id  TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'accountant', 'salesman')),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  phone               TEXT NOT NULL,
  gstin               TEXT,
  credit_limit_paise  BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  credit_days         INTEGER NOT NULL DEFAULT 30 CHECK (credit_days BETWEEN 0 AND 365),
  language            TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  tally_ledger_name   TEXT,
  tally_balance_paise BIGINT,
  tally_synced_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);
CREATE UNIQUE INDEX customers_tally_ledger_idx ON customers(tenant_id, tally_ledger_name) WHERE tally_ledger_name IS NOT NULL;

-- Immutable ledger. Corrections are made with new entries (credit notes,
-- adjustments, reversals), never by editing history.
CREATE TABLE ledger_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  kind               TEXT NOT NULL CHECK (kind IN (
                       'opening_balance', 'invoice', 'payment', 'credit_note',
                       'adjustment_debit', 'adjustment_credit', 'cheque_bounce')),
  amount_paise       BIGINT NOT NULL CHECK (amount_paise > 0),
  entry_date         DATE NOT NULL,
  due_date           DATE,
  reference          TEXT,
  note               TEXT,
  payment_mode       TEXT CHECK (payment_mode IN ('cash', 'cheque', 'upi', 'bank')),
  payment_ref        TEXT,
  collected_by       UUID REFERENCES users(id),
  handed_over_at     TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'payment') = (payment_mode IS NOT NULL))
);
CREATE INDEX ledger_customer_idx ON ledger_entries(tenant_id, customer_id, entry_date);
CREATE INDEX ledger_collected_idx ON ledger_entries(tenant_id, collected_by) WHERE collected_by IS NOT NULL;

CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger entries are immutable; post a correcting entry instead';
  END IF;
  -- Only the cash hand-over marker may change after posting.
  IF (NEW.id, NEW.tenant_id, NEW.customer_id, NEW.kind, NEW.amount_paise, NEW.entry_date,
      NEW.due_date, NEW.reference, NEW.note, NEW.payment_mode, NEW.payment_ref,
      NEW.collected_by, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.customer_id, OLD.kind, OLD.amount_paise, OLD.entry_date,
      OLD.due_date, OLD.reference, OLD.note, OLD.payment_mode, OLD.payment_ref,
      OLD.collected_by, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ledger entries are immutable; post a correcting entry instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable_trg
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

CREATE TABLE day_closes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salesman_id     UUID NOT NULL REFERENCES users(id),
  expected_paise  BIGINT NOT NULL,
  declared_paise  BIGINT NOT NULL CHECK (declared_paise >= 0),
  variance_paise  BIGINT NOT NULL,
  entry_count     INTEGER NOT NULL,
  note            TEXT,
  closed_by       UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id),
  entry_id         UUID REFERENCES ledger_entries(id),
  reason           TEXT NOT NULL CHECK (reason IN (
                     'amount_wrong', 'return_not_applied', 'scheme_discount',
                     'already_paid', 'not_received', 'other')),
  message          TEXT CHECK (length(message) <= 1000),
  raised_by        TEXT NOT NULL CHECK (raised_by IN ('retailer', 'staff')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolution_note  TEXT,
  resolved_by      UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX disputes_status_idx ON disputes(tenant_id, status);

CREATE TABLE promises (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id),
  promised_date  DATE NOT NULL,
  amount_paise   BIGINT,
  source_text    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept', 'broken')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reminders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES customers(id),
  channel              TEXT NOT NULL CHECK (channel IN ('whatsapp', 'console')),
  amount_paise         BIGINT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id  TEXT,
  error                TEXT,
  sent_by              UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reminders_customer_idx ON reminders(tenant_id, customer_id, created_at DESC);

CREATE TABLE agent_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  subject_id  UUID,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_log(tenant_id, created_at DESC);

-- Row-level security on every tenant-scoped table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','customers','ledger_entries','day_closes','disputes',
                           'promises','reminders','agent_keys','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, UPDATE ON tenants TO app_user;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
