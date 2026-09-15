ALTER TABLE energy_consumer_units ADD CONSTRAINT energy_units_customer_unique UNIQUE(organization_id,id,customer_id);

CREATE TABLE solar_sizings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 consumer_unit_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 calculation_version text NOT NULL DEFAULT 'v1' CHECK(calculation_version='v1'),
 consumption_months integer NOT NULL CHECK(consumption_months BETWEEN 1 AND 12),
 consumption_period_start date NOT NULL,
 consumption_period_end date NOT NULL,
 average_consumption_kwh numeric(14,3) NOT NULL CHECK(average_consumption_kwh>0),
 safety_margin_percent numeric(5,2) NOT NULL CHECK(safety_margin_percent BETWEEN 0 AND 50),
 required_generation_kwh numeric(14,3) NOT NULL CHECK(required_generation_kwh>0),
 solar_irradiation_daily numeric(5,2) NOT NULL CHECK(solar_irradiation_daily BETWEEN 1 AND 8),
 performance_ratio_percent numeric(5,2) NOT NULL CHECK(performance_ratio_percent BETWEEN 50 AND 100),
 module_power_w integer NOT NULL CHECK(module_power_w BETWEEN 100 AND 1000),
 required_power_kwp numeric(12,4) NOT NULL CHECK(required_power_kwp>0),
 module_count integer NOT NULL CHECK(module_count BETWEEN 1 AND 100000),
 system_power_kwp numeric(12,4) NOT NULL CHECK(system_power_kwp>0),
 estimated_monthly_generation_kwh numeric(14,3) NOT NULL CHECK(estimated_monthly_generation_kwh>0),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,consumer_unit_id,customer_id) REFERENCES energy_consumer_units(organization_id,id,customer_id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id),
 CHECK(consumption_period_end>=consumption_period_start)
);
CREATE INDEX solar_sizings_unit_history_idx ON solar_sizings(organization_id,consumer_unit_id,created_at DESC);
CREATE INDEX solar_sizings_customer_history_idx ON solar_sizings(organization_id,customer_id,created_at DESC);
