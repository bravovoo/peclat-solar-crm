CREATE TABLE energy_consumer_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 customer_id uuid NOT NULL,
 customer_kind text NOT NULL DEFAULT 'customer' CHECK(customer_kind='customer'),
 label text NOT NULL CHECK(length(label) BETWEEN 2 AND 120),
 consumer_unit_number text NOT NULL DEFAULT '' CHECK(length(consumer_unit_number)<=80),
 installation_number text NOT NULL DEFAULT '' CHECK(length(installation_number)<=80),
 utility text NOT NULL DEFAULT '' CHECK(length(utility)<=120),
 holder_name text NOT NULL DEFAULT '' CHECK(length(holder_name)<=180),
 tariff_group text NOT NULL DEFAULT '' CHECK(length(tariff_group)<=40),
 supply_type text NOT NULL DEFAULT 'unknown' CHECK(supply_type IN ('single_phase','two_phase','three_phase','unknown')),
 voltage integer CHECK(voltage BETWEEN 1 AND 1000000),
 service_address text NOT NULL DEFAULT '' CHECK(length(service_address)<=500),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 is_demo boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,customer_id,customer_kind) REFERENCES crm_records(organization_id,id,kind)
);
CREATE INDEX energy_units_customer_idx ON energy_consumer_units(organization_id,customer_id,status,created_at);
CREATE UNIQUE INDEX energy_units_number_idx ON energy_consumer_units(organization_id,utility,consumer_unit_number) WHERE consumer_unit_number!='';

CREATE TABLE energy_monthly_consumption (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 consumer_unit_id uuid NOT NULL,
 reference_month date NOT NULL CHECK(reference_month=date_trunc('month',reference_month)::date),
 consumption_kwh numeric(14,3) NOT NULL CHECK(consumption_kwh>=0),
 injected_energy_kwh numeric(14,3) CHECK(injected_energy_kwh>=0),
 peak_demand_kw numeric(14,3) CHECK(peak_demand_kw>=0),
 days_billed integer CHECK(days_billed BETWEEN 1 AND 62),
 source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','bill')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,consumer_unit_id,reference_month),
 FOREIGN KEY(organization_id,consumer_unit_id) REFERENCES energy_consumer_units(organization_id,id)
);
CREATE INDEX energy_consumption_history_idx ON energy_monthly_consumption(organization_id,consumer_unit_id,reference_month DESC);

CREATE TABLE energy_bills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 consumer_unit_id uuid NOT NULL,
 reference_month date NOT NULL CHECK(reference_month=date_trunc('month',reference_month)::date),
 invoice_number text NOT NULL DEFAULT '' CHECK(length(invoice_number)<=100),
 issue_date date,
 due_date date,
 total_amount numeric(14,2) NOT NULL CHECK(total_amount>=0),
 tariff_flag text NOT NULL DEFAULT 'not_informed' CHECK(tariff_flag IN ('green','yellow','red_level_1','red_level_2','not_informed')),
 previous_reading numeric(14,3) CHECK(previous_reading>=0),
 current_reading numeric(14,3) CHECK(current_reading>=0),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,consumer_unit_id,reference_month),
 FOREIGN KEY(organization_id,consumer_unit_id) REFERENCES energy_consumer_units(organization_id,id),
 CHECK(issue_date IS NULL OR due_date IS NULL OR due_date>=issue_date),
 CHECK(previous_reading IS NULL OR current_reading IS NULL OR current_reading>=previous_reading)
);
CREATE INDEX energy_bills_history_idx ON energy_bills(organization_id,consumer_unit_id,reference_month DESC);
