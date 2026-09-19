-- A carteira continua em crm_records.owner_id. Apenas leads podem aguardar atribuição.
ALTER TABLE crm_records ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE crm_records ADD CONSTRAINT crm_records_lead_unassigned_only
  CHECK (owner_id IS NOT NULL OR kind='lead');
CREATE INDEX crm_records_unassigned_leads_idx
  ON crm_records(organization_id,created_at DESC,id)
  WHERE kind='lead' AND owner_id IS NULL AND deleted_at IS NULL;

-- O bloqueio da linha da equipe serializa o cursor do round robin no PostgreSQL.
ALTER TABLE commercial_teams
  ADD COLUMN auto_distribute boolean NOT NULL DEFAULT false,
  ADD COLUMN distribution_cursor bigint NOT NULL DEFAULT 0 CHECK(distribution_cursor>=0);

-- RLS e revogações das tabelas alteradas já foram estabelecidas em 010 e 014.
