-- Additive cycle identity and immutable scheduling history. No sends or activation.
ALTER TABLE lead_recovery_enrollments
 ADD COLUMN anchor_message_id uuid,
 ADD COLUMN sequence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD FOREIGN KEY (organization_id,anchor_message_id) REFERENCES whatsapp_messages(organization_id,id);
CREATE UNIQUE INDEX lead_recovery_cycle_message_uidx
 ON lead_recovery_enrollments(organization_id,conversation_id,anchor_message_id)
 WHERE anchor_message_id IS NOT NULL;
ALTER TABLE lead_recovery_attempts
 ADD COLUMN eligible_at timestamptz,
 ADD COLUMN day_offset integer CHECK(day_offset BETWEEN 1 AND 365),
 ADD COLUMN timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
