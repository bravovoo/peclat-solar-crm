INSERT INTO permissions(code,description) VALUES ('solar.catalog.manage','Gerenciar equipamentos e kits solares') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code) SELECT code,'solar.catalog.manage' FROM roles WHERE code IN ('admin','manager') ON CONFLICT DO NOTHING;

CREATE TABLE solar_equipment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 category text NOT NULL CHECK(category IN ('module','inverter','structure','component')),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180), manufacturer text NOT NULL DEFAULT '' CHECK(length(manufacturer)<=120),
 model text NOT NULL DEFAULT '' CHECK(length(model)<=120), sku text NOT NULL DEFAULT '' CHECK(length(sku)<=80),
 nominal_power_w numeric(12,2) CHECK(nominal_power_w>0), efficiency_percent numeric(5,2) CHECK(efficiency_percent>0 AND efficiency_percent<=100),
 phases integer CHECK(phases BETWEEN 1 AND 3), mppt_count integer CHECK(mppt_count BETWEEN 1 AND 100),
 unit text NOT NULL DEFAULT 'unit' CHECK(unit IN ('unit','meter','set')), technical_notes text NOT NULL DEFAULT '' CHECK(length(technical_notes)<=4000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 CHECK(category NOT IN ('module','inverter') OR nominal_power_w IS NOT NULL)
);
CREATE UNIQUE INDEX solar_equipment_sku_idx ON solar_equipment(organization_id,lower(sku)) WHERE sku!='';
CREATE INDEX solar_equipment_catalog_idx ON solar_equipment(organization_id,status,category,name);

CREATE TABLE solar_kits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180), code text NOT NULL DEFAULT '' CHECK(length(code)<=80),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX solar_kits_code_idx ON solar_kits(organization_id,lower(code)) WHERE code!='';
CREATE INDEX solar_kits_catalog_idx ON solar_kits(organization_id,status,name);

CREATE TABLE solar_kit_items (
 organization_id uuid NOT NULL, kit_id uuid NOT NULL, equipment_id uuid NOT NULL, quantity numeric(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000),
 PRIMARY KEY(organization_id,kit_id,equipment_id),
 FOREIGN KEY(organization_id,kit_id) REFERENCES solar_kits(organization_id,id),
 FOREIGN KEY(organization_id,equipment_id) REFERENCES solar_equipment(organization_id,id)
);
CREATE INDEX solar_kit_items_equipment_idx ON solar_kit_items(organization_id,equipment_id);

CREATE TABLE solar_equipment_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, equipment_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated','archived','restored')), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,equipment_id) REFERENCES solar_equipment(organization_id,id), FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX solar_equipment_history_idx ON solar_equipment_history(organization_id,equipment_id,created_at DESC);

CREATE TABLE solar_kit_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, kit_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated','archived','restored')), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,kit_id) REFERENCES solar_kits(organization_id,id), FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX solar_kit_history_idx ON solar_kit_history(organization_id,kit_id,created_at DESC);

CREATE TABLE solar_sizing_kit_selections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, sizing_id uuid NOT NULL, kit_id uuid NOT NULL, customer_id uuid NOT NULL, consumer_unit_id uuid NOT NULL, actor_id uuid NOT NULL,
 kit_quantity integer NOT NULL CHECK(kit_quantity BETWEEN 1 AND 100000), module_count integer NOT NULL CHECK(module_count>=1),
 dc_power_kwp numeric(14,4) NOT NULL CHECK(dc_power_kwp>0), inverter_power_kw numeric(14,4) NOT NULL CHECK(inverter_power_kw>=0),
 kit_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,sizing_id) REFERENCES solar_sizings(organization_id,id), FOREIGN KEY(organization_id,kit_id) REFERENCES solar_kits(organization_id,id),
 FOREIGN KEY(organization_id,consumer_unit_id,customer_id) REFERENCES energy_consumer_units(organization_id,id,customer_id), FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX solar_sizing_kit_history_idx ON solar_sizing_kit_selections(organization_id,sizing_id,created_at DESC);
CREATE INDEX solar_customer_kit_history_idx ON solar_sizing_kit_selections(organization_id,customer_id,created_at DESC);
