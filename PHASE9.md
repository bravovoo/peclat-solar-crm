# Fase 9 — Estabilidade operacional

## 9.1 Monitoramento e alertas internos

O CRM executa uma verificação operacional a cada cinco minutos no Cron Trigger já existente. A rotina roda depois do processamento das filas de webhook, exclusão de Storage e automações, sem criar um serviço externo ou expor credenciais.

A migration `026_operational_monitoring.sql` cria o estado da última verificação e incidentes deduplicados por organização. São observados: webhooks do WhatsApp parados ou com falha, exclusões pendentes do Storage, jobs de automação recentes, tentativas de e-mail, envios de WhatsApp com resultado incerto ou falhas recorrentes e indisponibilidade recorrente do provedor de IA. Falhas históricas antigas não abrem incidentes novos.

Administradores recebem `operations.read` e `operations.manage`. Em **Configurações → Monitoramento operacional**, podem consultar integrações e filas, reconhecer um incidente e acompanhar sua resolução automática. Reconhecer não encerra o alerta: a rotina só o marca como resolvido quando a condição deixa de existir. Títulos e detalhes guardam apenas códigos e contagens seguras, sem telefone, mensagem, documento, prompt, token ou secret.

As tabelas `operational_monitor_status` e `operational_alerts` têm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios para `PUBLIC`, `anon`, `authenticated` ou `service_role`. O backend continua acessando PostgreSQL exclusivamente pela conexão privilegiada via Hyperdrive em produção.

Esta etapa não envia alertas por WhatsApp ou e-mail. O painel interno e os eventos estruturados da Cloudflare são os canais iniciais; canais externos devem ser adicionados apenas depois de definir destinatários, escalonamento e política de ruído.

## 9.2 Alertas externos e escalonamento

Administradores podem configurar no mesmo painel alertas operacionais por e-mail para até cinco destinatários. A configuração é isolada por organização, exige SMTP no ambiente e permite escolher severidade mínima, aviso de recuperação e o intervalo de escalada de incidentes críticos não reconhecidos.

A migration `027_operational_notifications.sql` cria a configuração e a fila persistente de entregas. Abertura, escalada e recuperação são deduplicadas por incidente e destinatário. Uma escalada é criada apenas uma vez, e reconhecer o incidente impede a escalada. Envios ficam registrados como pendentes, processando, enviados, falhos ou de confirmação incerta; um envio que ficou processando não é repetido automaticamente, evitando duplicidade após resultado externo ambíguo.

O conteúdo enviado inclui somente título, severidade e contagens seguras já presentes no incidente. Endereços não são registrados nos logs da Cloudflare, e credenciais SMTP continuam exclusivas do runtime. WhatsApp não é usado como canal de alerta, evitando depender da própria integração que pode estar indisponível.

As novas tabelas mantêm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios diretos para a Data API. Os testes usam um provedor SMTP simulado e não enviam e-mails reais.
