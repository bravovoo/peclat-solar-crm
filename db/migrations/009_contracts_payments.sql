CREATE TABLE contract_statuses (
 code text PRIMARY KEY,
 name text NOT NULL,
 sort_order integer NOT NULL UNIQUE,
 terminal boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true
);
INSERT INTO contract_statuses(code,name,sort_order,terminal) VALUES
 ('draft','Rascunho',10,false),('sent','Enviado',20,false),('negotiation','Em negociação',30,false),
 ('signed','Assinado',40,false),('active','Ativo',50,false),('completed','Concluído',60,true),('cancelled','Cancelado',70,true);

CREATE TABLE payment_methods (
 code text PRIMARY KEY,
 name text NOT NULL,
 active boolean NOT NULL DEFAULT true
);
INSERT INTO payment_methods(code,name) VALUES
 ('pix','PIX'),('boleto','Boleto'),('card','Cartão'),('transfer','Transferência'),('cash','Dinheiro'),('financing','Financiamento'),('other','Outro');

CREATE TABLE contract_sequences (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 9999),
 last_value integer NOT NULL CHECK(last_value>0),
 PRIMARY KEY(organization_id,year)
);

CREATE TABLE contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 client_id uuid NOT NULL, client_kind text NOT NULL DEFAULT 'customer' CHECK(client_kind='customer'), opportunity_id uuid,
 responsible_user_id uuid NOT NULL, contract_number text NOT NULL CHECK(length(contract_number) BETWEEN 8 AND 40),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180), status text NOT NULL DEFAULT 'draft' REFERENCES contract_statuses(code),
 total_value numeric(14,2) NOT NULL CHECK(total_value>=0), discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(discount_value>=0),
 item_discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(item_discount_value>=0), commercial_discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(commercial_discount_value>=0),
 net_value numeric(14,2) NOT NULL CHECK(net_value>=0), down_payment_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(down_payment_value>=0),
 balance_value numeric(14,2) NOT NULL CHECK(balance_value>=0), payment_method text NOT NULL REFERENCES payment_methods(code),
 installments_count integer NOT NULL CHECK(installments_count BETWEEN 0 AND 120), first_due_date date,
 start_date date, end_date date, signed_at timestamptz, conditions text NOT NULL DEFAULT '' CHECK(length(conditions)<=10000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), is_demo boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,client_id), UNIQUE(organization_id,contract_number),
 FOREIGN KEY(organization_id,client_id,client_kind) REFERENCES crm_records(organization_id,id,kind),
 FOREIGN KEY(organization_id,opportunity_id,client_id) REFERENCES crm_opportunities(organization_id,id,customer_id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(discount_value=item_discount_value+commercial_discount_value),
 CHECK(net_value=total_value-discount_value), CHECK(balance_value=net_value-down_payment_value),
 CHECK(down_payment_value<=net_value), CHECK((balance_value=0 AND installments_count=0 AND first_due_date IS NULL) OR (balance_value>0 AND installments_count>0 AND first_due_date IS NOT NULL)),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date), CHECK(status NOT IN ('signed','active','completed') OR signed_at IS NOT NULL)
);
CREATE INDEX contracts_scope_idx ON contracts(organization_id,responsible_user_id,status,created_at DESC);
CREATE INDEX contracts_client_idx ON contracts(organization_id,client_id,created_at DESC);
CREATE INDEX contracts_opportunity_idx ON contracts(organization_id,opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX contracts_number_search_idx ON contracts USING gin(lower(contract_number||' '||title) gin_trgm_ops);

CREATE TABLE contract_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contract_id uuid NOT NULL,
 description text NOT NULL CHECK(length(description) BETWEEN 2 AND 500), category text NOT NULL CHECK(category IN ('manual','kit','equipment','service','installation','maintenance','other')),
 equipment_id uuid, kit_id uuid, quantity numeric(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000),
 unit_value numeric(14,2) NOT NULL CHECK(unit_value>=0), discount_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(discount_value>=0),
 gross_value numeric(14,2) NOT NULL CHECK(gross_value>=0), total_value numeric(14,2) NOT NULL CHECK(total_value>=0),
 display_order integer NOT NULL CHECK(display_order BETWEEN 1 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,contract_id,display_order),
 FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id),
 FOREIGN KEY(organization_id,equipment_id) REFERENCES solar_equipment(organization_id,id),
 FOREIGN KEY(organization_id,kit_id) REFERENCES solar_kits(organization_id,id),
 CHECK(num_nonnulls(equipment_id,kit_id)<=1), CHECK(category!='equipment' OR equipment_id IS NOT NULL), CHECK(category!='kit' OR kit_id IS NOT NULL),
 CHECK(discount_value<=gross_value), CHECK(total_value=gross_value-discount_value)
);
CREATE INDEX contract_items_contract_idx ON contract_items(organization_id,contract_id,display_order);

CREATE TABLE contract_installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contract_id uuid NOT NULL,
 installment_number integer NOT NULL CHECK(installment_number BETWEEN 0 AND 120), description text NOT NULL CHECK(length(description) BETWEEN 2 AND 180),
 due_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0), amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK(amount_paid>=0),
 remaining_amount numeric(14,2) NOT NULL CHECK(remaining_amount>=0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partially_paid','paid','overdue','cancelled')),
 paid_at timestamptz, payment_method text REFERENCES payment_methods(code), transaction_reference text NOT NULL DEFAULT '' CHECK(length(transaction_reference)<=250),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000), created_by uuid NOT NULL, updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,contract_id), UNIQUE(organization_id,contract_id,installment_number),
 FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(remaining_amount=amount-amount_paid), CHECK(amount_paid<=amount), CHECK((status='paid')=(remaining_amount=0)), CHECK(status!='partially_paid' OR (amount_paid>0 AND remaining_amount>0))
);
CREATE INDEX contract_installments_due_idx ON contract_installments(organization_id,status,due_date);
CREATE INDEX contract_installments_contract_idx ON contract_installments(organization_id,contract_id,installment_number);

CREATE TABLE contract_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contract_id uuid NOT NULL, installment_id uuid NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0), paid_at timestamptz NOT NULL, payment_method text NOT NULL REFERENCES payment_methods(code),
 transaction_reference text NOT NULL DEFAULT '' CHECK(length(transaction_reference)<=250), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id),
 FOREIGN KEY(organization_id,installment_id,contract_id) REFERENCES contract_installments(organization_id,id,contract_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id), FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX contract_payments_installment_idx ON contract_payments(organization_id,installment_id,paid_at,id);
CREATE INDEX contract_payments_contract_idx ON contract_payments(organization_id,contract_id,paid_at DESC);

CREATE TABLE contract_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, contract_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 2 AND 80), detail text NOT NULL DEFAULT '' CHECK(length(detail)<=2000), snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX contract_history_idx ON contract_history(organization_id,contract_id,created_at DESC,id DESC);

ALTER TABLE crm_documents ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE crm_documents ADD COLUMN contract_id uuid;
ALTER TABLE crm_documents ADD COLUMN document_type text NOT NULL DEFAULT 'budget' CHECK(document_type IN ('budget','contract','amendment','receipt','invoice','client_document','other'));
ALTER TABLE crm_documents ADD COLUMN signature_status text NOT NULL DEFAULT 'unsigned' CHECK(signature_status IN ('unsigned','signed'));
ALTER TABLE crm_documents ADD COLUMN signed_at timestamptz;
ALTER TABLE crm_documents ADD COLUMN signed_by text NOT NULL DEFAULT '' CHECK(length(signed_by)<=180);
ALTER TABLE crm_documents ADD COLUMN signature_notes text NOT NULL DEFAULT '' CHECK(length(signature_notes)<=2000);
ALTER TABLE crm_documents ADD COLUMN signature_recorded_by uuid;
ALTER TABLE crm_documents ADD FOREIGN KEY(organization_id,contract_id,customer_id) REFERENCES contracts(organization_id,id,client_id);
ALTER TABLE crm_documents ADD FOREIGN KEY(organization_id,signature_recorded_by) REFERENCES memberships(organization_id,user_id);
ALTER TABLE crm_documents ADD CHECK(num_nonnulls(opportunity_id,contract_id)>=1);
ALTER TABLE crm_documents ADD CHECK((signature_status='unsigned' AND signed_at IS NULL AND signed_by='') OR (signature_status='signed' AND signed_at IS NOT NULL AND length(signed_by)>0));
CREATE INDEX crm_documents_contract_idx ON crm_documents(organization_id,contract_id,created_at DESC) WHERE contract_id IS NOT NULL;
ALTER TABLE crm_document_history DROP CONSTRAINT crm_document_history_action_check;
ALTER TABLE crm_document_history ADD CHECK(action IN ('created','updated','status_changed','signature_changed'));
ALTER TABLE crm_document_emails ALTER COLUMN opportunity_id DROP NOT NULL;

INSERT INTO permissions(code,description) VALUES
 ('contracts.all','Acessar todos os contratos da organização'),('contracts.own','Acessar contratos próprios'),
 ('contracts.create','Criar contratos'),('contracts.edit','Editar contratos'),('contracts.cancel','Cancelar contratos'),
 ('contracts.payments.read','Visualizar parcelas e pagamentos'),('contracts.payments.manage','Registrar e alterar pagamentos') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code IN ('admin','manager') AND p.code IN ('contracts.all','contracts.own','contracts.create','contracts.edit','contracts.cancel','contracts.payments.read','contracts.payments.manage')) OR
 (r.code='seller' AND p.code IN ('contracts.own','contracts.create','contracts.edit','contracts.payments.read')) OR
 (r.code='support' AND p.code IN ('contracts.own','contracts.payments.read'))
ON CONFLICT DO NOTHING;
