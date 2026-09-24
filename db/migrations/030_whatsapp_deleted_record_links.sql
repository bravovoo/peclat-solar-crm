-- Cadastros excluídos logicamente permanecem em crm_records para preservar o histórico.
-- Remova somente o vínculo operacional obsoleto; conversas e mensagens permanecem intactas.
UPDATE whatsapp_conversations AS conversation
SET record_id = NULL,
    link_status = 'unidentified',
    link_source = 'none',
    version = conversation.version + 1,
    updated_at = now()
WHERE conversation.record_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM crm_records AS record
    WHERE record.organization_id = conversation.organization_id
      AND record.id = conversation.record_id
      AND record.deleted_at IS NULL
  );
