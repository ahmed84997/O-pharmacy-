-- S6: multi-tenant isolation in one database. Every business table carries tenant_id; the app logs in as a role that is
-- NOT owner, NOT superuser, NOT BYPASSRLS; policies are FORCEd; unique keys and foreign keys always include tenant_id.
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_user LOGIN PASSWORD 'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA ophar AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA ophar TO app_user;
SET ROLE app_owner;

CREATE FUNCTION ophar.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE ophar.tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE ophar.items (
  tenant_id uuid NOT NULL REFERENCES ophar.tenants(id), id uuid NOT NULL, name text NOT NULL, barcode text,
  PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, barcode));
CREATE TABLE ophar.movements (
  tenant_id uuid NOT NULL, id uuid NOT NULL, item_id uuid NOT NULL, qty int NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES ophar.items (tenant_id, id));       -- composite: cannot point at another tenant's item
CREATE TABLE ophar.customers (tenant_id uuid NOT NULL, id uuid NOT NULL, name_enc bytea NOT NULL, PRIMARY KEY (tenant_id, id));

-- negative controls: the mistakes we must never make (used by tests to prove each trap is real)
CREATE TABLE ophar.bad_movements (tenant_id uuid NOT NULL, id uuid PRIMARY KEY, item_id uuid NOT NULL);   -- no tenant in the key
CREATE TABLE ophar.loose_items (tenant_id uuid NOT NULL, id uuid PRIMARY KEY, name text);                 -- RLS but NOT forced
CREATE VIEW ophar.loose_items_view AS SELECT * FROM ophar.loose_items;                                     -- owner-run view

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['items','movements','customers','bad_movements','loose_items'] LOOP
    EXECUTE format('ALTER TABLE ophar.%I ENABLE ROW LEVEL SECURITY', t);
    IF t <> 'loose_items' THEN EXECUTE format('ALTER TABLE ophar.%I FORCE ROW LEVEL SECURITY', t); END IF;
    EXECUTE format('CREATE POLICY tenant_isolation ON ophar.%I USING (tenant_id = ophar.current_tenant()) WITH CHECK (tenant_id = ophar.current_tenant())', t);
  END LOOP;
END $$;
ALTER TABLE ophar.tenants ENABLE ROW LEVEL SECURITY; ALTER TABLE ophar.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON ophar.tenants USING (id = ophar.current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ophar TO app_user;
GRANT SELECT ON ophar.loose_items_view TO app_user;
RESET ROLE;
