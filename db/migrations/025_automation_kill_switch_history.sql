-- O bloqueio global de envios é uma decisão administrativa, não uma falha operacional.
-- Reclassifica apenas execuções que falharam exclusivamente por essa trava, sem
-- reprocessar jobs nem executar qualquer ação externa.
UPDATE automation_run_actions
SET status='skipped',
    safe_error='automation_outbound_kill_switch',
    completed_at=COALESCE(completed_at,now())
WHERE status='failed'
  AND safe_error='automation_outbound_kill_switch';

UPDATE automation_runs
SET status='skipped',
    skipped_reason='outbound_kill_switch',
    safe_error='',
    completed_at=COALESCE(completed_at,now())
WHERE status='failed'
  AND safe_error='automation_outbound_kill_switch';

UPDATE automation_jobs
SET status='completed',
    safe_error='',
    locked_at=NULL,
    completed_at=COALESCE(completed_at,failed_at,now()),
    failed_at=NULL,
    updated_at=now()
WHERE status='failed'
  AND safe_error='automation_outbound_kill_switch';
