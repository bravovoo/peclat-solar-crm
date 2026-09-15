ALTER TABLE crm_records ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
UPDATE crm_records SET is_demo=true WHERE observations LIKE '[DEMO]%' AND name IN ('Residência Horizonte · DEMO','Projeto Boa Vista · DEMO','Cliente Jardim Solar · DEMO','Comércio Aurora · DEMO');
CREATE TABLE crm_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 is_demo boolean NOT NULL DEFAULT false,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180),
 lead_id uuid, customer_id uuid, company_id uuid, contact_id uuid,
 lead_kind text NOT NULL DEFAULT 'lead' CHECK(lead_kind='lead'),
 customer_kind text NOT NULL DEFAULT 'customer' CHECK(customer_kind='customer'),
 company_kind text NOT NULL DEFAULT 'company' CHECK(company_kind='company'),
 owner_id uuid NOT NULL, stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','qualification','opportunity','budget_requested','proposal_sent','negotiation','decision','won','lost')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','won','lost')),
 estimated_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(estimated_value>=0), probability integer NOT NULL DEFAULT 0 CHECK(probability BETWEEN 0 AND 100),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), source text NOT NULL DEFAULT 'Manual',
 opened_on date NOT NULL DEFAULT CURRENT_DATE, expected_close date, loss_reason text NOT NULL DEFAULT '', observations text NOT NULL DEFAULT '',
 closed_at timestamptz, closed_value numeric(14,2), closed_by uuid, closed_owner_id uuid,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now(), stage_changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,lead_id,lead_kind) REFERENCES crm_records(organization_id,id,kind),
 FOREIGN KEY(organization_id,customer_id,customer_kind) REFERENCES crm_records(organization_id,id,kind),
 FOREIGN KEY(organization_id,company_id,company_kind) REFERENCES crm_records(organization_id,id,kind),
 FOREIGN KEY(organization_id,contact_id) REFERENCES crm_contacts(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,closed_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,closed_owner_id) REFERENCES memberships(organization_id,user_id),
 CHECK(num_nonnulls(lead_id,customer_id,company_id)>=1),
 CHECK((stage='won' AND status='won') OR (stage='lost' AND status='lost') OR (stage NOT IN ('won','lost') AND status='open')),
 CHECK(status!='lost' OR length(loss_reason)>0),
 CHECK((status='open' AND closed_at IS NULL) OR (status!='open' AND closed_at IS NOT NULL AND closed_value IS NOT NULL AND closed_by IS NOT NULL AND closed_owner_id IS NOT NULL))
);
CREATE INDEX crm_opportunities_scope_idx ON crm_opportunities(organization_id,owner_id,status,created_at DESC);
CREATE INDEX crm_opportunities_stage_idx ON crm_opportunities(organization_id,stage,priority);
CREATE INDEX crm_opportunities_close_idx ON crm_opportunities(organization_id,expected_close);
CREATE INDEX crm_opportunities_created_idx ON crm_opportunities(organization_id,created_at DESC);
CREATE INDEX crm_opportunities_updated_idx ON crm_opportunities(organization_id,updated_at DESC);
CREATE INDEX crm_opportunities_activity_idx ON crm_opportunities(organization_id,last_activity_at) WHERE status='open';
CREATE INDEX crm_opportunities_title_idx ON crm_opportunities USING gin(lower(title) gin_trgm_ops);
CREATE TABLE crm_commercial_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), inactive_days integer NOT NULL DEFAULT 7 CHECK(inactive_days BETWEEN 1 AND 365), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_activities ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE crm_activities ADD COLUMN opportunity_id uuid;
ALTER TABLE crm_activities ADD FOREIGN KEY(organization_id,opportunity_id) REFERENCES crm_opportunities(organization_id,id);
ALTER TABLE crm_activities ADD CHECK(num_nonnulls(record_id,opportunity_id)=1);
CREATE INDEX crm_activities_opportunity_idx ON crm_activities(organization_id,opportunity_id,created_at DESC);
ALTER TABLE crm_notes ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE crm_notes ADD COLUMN opportunity_id uuid;
ALTER TABLE crm_notes ADD FOREIGN KEY(organization_id,opportunity_id) REFERENCES crm_opportunities(organization_id,id);
ALTER TABLE crm_notes ADD CHECK(num_nonnulls(record_id,opportunity_id)=1);
CREATE INDEX crm_notes_opportunity_idx ON crm_notes(organization_id,opportunity_id,created_at DESC);
ALTER TABLE crm_tasks ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE crm_tasks ADD COLUMN opportunity_id uuid;
ALTER TABLE crm_tasks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE crm_tasks ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'));
ALTER TABLE crm_tasks ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled'));
ALTER TABLE crm_tasks ADD COLUMN due_date date;
ALTER TABLE crm_tasks ADD COLUMN due_time time;
ALTER TABLE crm_tasks ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE crm_tasks ADD COLUMN version integer NOT NULL DEFAULT 1;
UPDATE crm_tasks SET due_date=(due_at AT TIME ZONE 'America/Sao_Paulo')::date,due_time=(due_at AT TIME ZONE 'America/Sao_Paulo')::time,status=CASE WHEN completed_at IS NULL THEN 'pending' ELSE 'completed' END,updated_at=COALESCE(completed_at,created_at);
ALTER TABLE crm_tasks ALTER COLUMN due_date SET NOT NULL;
ALTER TABLE crm_tasks ADD FOREIGN KEY(organization_id,opportunity_id) REFERENCES crm_opportunities(organization_id,id);
ALTER TABLE crm_tasks ADD CHECK(num_nonnulls(record_id,opportunity_id)=1);
ALTER TABLE crm_tasks ADD CHECK((status='completed')=(completed_at IS NOT NULL));
CREATE INDEX crm_tasks_owner_due_idx ON crm_tasks(organization_id,owner_id,status,due_date);
CREATE INDEX crm_tasks_opportunity_idx ON crm_tasks(organization_id,opportunity_id,due_date);
