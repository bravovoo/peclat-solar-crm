# Roadmap

- FASE 1 — Implementada e validada localmente em 14/09/2026: infraestrutura, arquitetura, PostgreSQL, migrations, autenticação, RBAC, layout, dashboard inicial e seed. Lint, TypeScript, 13 testes unitários/integração, 7 E2E e build aprovados. Entrega SMTP externa e Docker não verificados; consultar README antes de produção.
- FASE 2 — Implementada: leads, clientes, empresas, contatos, duplicados, busca global, tags, notas, atividades, conversão com histórico, tarefas simples por cadastro, CSV e indicadores reais. Migration incremental 002; seed demo explícito. Verificações detalhadas no README e PHASE2.md. Importador CSV/Excel reservado por contrato, sem implementação opcional nesta entrega.
- FASE 3 — Implementada: oportunidades ligadas a cadastros, Kanban com movimentação e histórico, fechamento ganho/perdido, tarefas ampliadas, agenda de dia/semana, follow-up, indicadores e busca. Migration 003 incremental; DEMO separado da operação real. Ver PHASE3.md para validação e limites.
- FASE 4 — Implementada: consumo/faturas, dimensionamento solar, catálogo de equipamentos, kits comerciais, documentos/orçamentos manuais em PDF e envio por e-mail.
- FASE 5 — Implementada: contratos vinculados a clientes/oportunidades, itens, cálculos comerciais, numeração anual atômica, parcelas, pagamentos parciais, alertas de atraso, documentos comerciais e registro de assinatura externa. Não inclui gerador automático de proposta.
- FASE 6 — Instalação, checklists, fotos, homologação e pós-venda. As etapas 6.1–6.4 estão concluídas: instalações, execução/entrega e garantias, chamados e manutenção. WhatsApp, automações, portal do cliente, estoque, telemetria e Fase 7 permanecem fora deste escopo.
- FASE 7 — WhatsApp Cloud API oficial, inbox, webhooks, templates e distribuição.
- FASE 8 — Automações, notificações, relatórios e ampliação da auditoria.
- FASE 9 — Performance, segurança, testes, UX e mobile.
- FASE 10 — Deploy, backup, monitoramento e documentação operacional.

FASE 5 concluída. A FASE 6.1 implementa a base de instalações; fotos, checklist, homologação e pós-venda permanecem para etapas posteriores. Cada etapa exige revisão de arquitetura, banco e dependências; testes, lint e build.
