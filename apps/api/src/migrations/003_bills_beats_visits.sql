-- Customer details, GST bills, salesman beats (routes), visits and daily targets.

-- ---------- customers ----------
ALTER TABLE customers
  ADD COLUMN contact_name TEXT CHECK (length(contact_name) <= 100),
  ADD COLUMN address      TEXT CHECK (length(address) <= 500),
  ADD COLUMN area         TEXT CHECK (length(area) <= 100),
  ADD COLUMN tags         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN lat          DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng          DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN archived_at  TIMESTAMPTZ;
CREATE INDEX customers_area_idx ON customers(tenant_id, area);

-- ---------- business details printed on bills ----------
ALTER TABLE tenants
  ADD COLUMN gstin        TEXT,
  ADD COLUMN address      TEXT,
  ADD COLUMN phone        TEXT,
  ADD COLUMN state_code   TEXT CHECK (state_code ~ '^\d{2}$'),
  ADD COLUMN bill_prefix  TEXT NOT NULL DEFAULT 'INV-',
  ADD COLUMN next_bill_no INTEGER NOT NULL DEFAULT 1 CHECK (next_bill_no > 0);

-- ---------- daily collection target per salesman ----------
ALTER TABLE users ADD COLUMN daily_target_paise BIGINT NOT NULL DEFAULT 0 CHECK (daily_target_paise >= 0);

-- ---------- beats (fixed routes a salesman covers on given weekdays) ----------
CREATE TABLE beats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  salesman_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 0 = Sunday ... 6 = Saturday
  weekdays     SMALLINT[] NOT NULL DEFAULT '{}' CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE customers ADD COLUMN beat_id UUID REFERENCES beats(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN beat_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX customers_beat_idx ON customers(tenant_id, beat_id, beat_order);

-- ---------- visits (check-ins by salesmen) ----------
CREATE TABLE visits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  salesman_id  UUID NOT NULL REFERENCES users(id),
  visited_on   DATE NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('collected', 'promised', 'no_payment', 'shop_closed', 'owner_absent', 'order_taken')),
  note         TEXT CHECK (length(note) <= 500),
  lat          DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng          DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  accuracy_m   REAL,
  client_ref   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX visits_client_ref_idx ON visits(tenant_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX visits_day_idx ON visits(tenant_id, visited_on, salesman_id);
CREATE INDEX visits_customer_idx ON visits(tenant_id, customer_id, visited_on DESC);

-- ---------- GST bills ----------
CREATE TABLE bills (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  bill_no          TEXT NOT NULL,
  bill_date        DATE NOT NULL,
  due_date         DATE NOT NULL,
  interstate       BOOLEAN NOT NULL DEFAULT false,
  subtotal_paise   BIGINT NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise   BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_paise    BIGINT NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise       BIGINT NOT NULL DEFAULT 0,
  sgst_paise       BIGINT NOT NULL DEFAULT 0,
  igst_paise       BIGINT NOT NULL DEFAULT 0,
  round_off_paise  BIGINT NOT NULL DEFAULT 0,
  total_paise      BIGINT NOT NULL CHECK (total_paise > 0),
  notes            TEXT CHECK (length(notes) <= 1000),
  entry_id         UUID REFERENCES ledger_entries(id),
  cancelled_at     TIMESTAMPTZ,
  cancel_entry_id  UUID REFERENCES ledger_entries(id),
  cancel_reason    TEXT,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bill_no)
);
CREATE INDEX bills_date_idx ON bills(tenant_id, bill_date DESC);
CREATE INDEX bills_customer_idx ON bills(tenant_id, customer_id, bill_date DESC);

CREATE TABLE bill_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id        UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  description    TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  hsn            TEXT CHECK (hsn ~ '^\d{4,8}$'),
  qty            NUMERIC(12, 3) NOT NULL CHECK (qty > 0),
  unit           TEXT NOT NULL DEFAULT 'pcs',
  rate_paise     BIGINT NOT NULL CHECK (rate_paise >= 0),
  discount_pct   NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  gst_rate       NUMERIC(5, 2) NOT NULL CHECK (gst_rate IN (0, 0.25, 3, 5, 12, 18, 28)),
  taxable_paise  BIGINT NOT NULL,
  tax_paise      BIGINT NOT NULL,
  amount_paise   BIGINT NOT NULL
);
CREATE INDEX bill_items_bill_idx ON bill_items(bill_id, position);

-- Bills are financial records: only the cancellation fields may change, and never twice.
CREATE OR REPLACE FUNCTION bills_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bills cannot be deleted; cancel them instead';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'bill is already cancelled';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.customer_id, NEW.bill_no, NEW.bill_date, NEW.due_date, NEW.interstate,
      NEW.subtotal_paise, NEW.discount_paise, NEW.taxable_paise, NEW.cgst_paise, NEW.sgst_paise, NEW.igst_paise,
      NEW.round_off_paise, NEW.total_paise, NEW.notes, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.customer_id, OLD.bill_no, OLD.bill_date, OLD.due_date, OLD.interstate,
      OLD.subtotal_paise, OLD.discount_paise, OLD.taxable_paise, OLD.cgst_paise, OLD.sgst_paise, OLD.igst_paise,
      OLD.round_off_paise, OLD.total_paise, OLD.notes, OLD.created_by, OLD.created_at)
     OR (OLD.entry_id IS NOT NULL AND NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN
    RAISE EXCEPTION 'bills are immutable; cancel and re-issue instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER bills_immutable_trg BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION bills_immutable();

CREATE OR REPLACE FUNCTION bill_items_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bill items cannot be changed';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER bill_items_immutable_trg BEFORE UPDATE OR DELETE ON bill_items FOR EACH ROW EXECUTE FUNCTION bill_items_immutable();

-- ---------- row-level security for the new tables ----------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['beats', 'visits', 'bills', 'bill_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
