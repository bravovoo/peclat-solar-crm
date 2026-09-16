-- O CRM acessa estas tabelas exclusivamente pelo backend, via DATABASE_URL.
-- Sem políticas, RLS aplica negação por padrão à Data API; o proprietário
-- usado pelas migrations e o papel postgres do backend preservam o acesso.
DO $$
DECLARE
  protected_table text;
  api_role text;
  protected_tables text[] := ARRAY[
    'audit_logs',
    'contract_history',
    'contract_installments',
    'contract_items',
    'contract_payments',
    'contract_sequences',
    'contract_statuses',
    'contracts',
    'crm_activities',
    'crm_commercial_settings',
    'crm_contacts',
    'crm_document_emails',
    'crm_document_history',
    'crm_documents',
    'crm_notes',
    'crm_opportunities',
    'crm_record_contacts',
    'crm_record_tags',
    'crm_records',
    'crm_tags',
    'crm_tasks',
    'energy_bills',
    'energy_consumer_units',
    'energy_monthly_consumption',
    'memberships',
    'organizations',
    'password_resets',
    'payment_methods',
    'permissions',
    'rate_limits',
    'role_permissions',
    'roles',
    'schema_migrations',
    'sessions',
    'solar_equipment',
    'solar_equipment_history',
    'solar_kit_history',
    'solar_kit_items',
    'solar_kits',
    'solar_sizing_kit_selections',
    'solar_sizings',
    'users'
  ];
BEGIN
  FOREACH protected_table IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', protected_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', protected_table);

    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          protected_table,
          api_role
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Evita que novas tabelas criadas pelo mesmo papel de migrations sejam
  -- publicadas automaticamente para os papéis da Data API.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
    current_user
  );
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        current_user,
        api_role
      );
    END IF;
  END LOOP;
END $$;
