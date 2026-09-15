# Entrega da FASE 3 — Peclat Solar CRM

A FASE 3 amplia a base validada das FASES 1 e 2. A stack, a autenticação, o RBAC, os cadastros e o banco existente foram preservados. A migration `003_commercial_operations.sql` foi aplicada de forma incremental. A FASE 4 não foi iniciada.

## Funcionalidades entregues

- Oportunidades vinculadas a lead, cliente, empresa, contato e responsável, com etapa, status, valor, probabilidade, prioridade, origem, datas, observações e controle de versão.
- Conversão de lead em oportunidade sem criar cliente automaticamente, trocar o lead original ou perder o histórico acessível.
- Pipeline Kanban com nove etapas, cartões arrastáveis e seletor acessível para movimentação. Cada mudança atualiza o banco e registra histórico.
- Fechamento ganho/perdido. Perda exige motivo; ganho registra data, valor final, usuário e responsável do fechamento. Probabilidade passa a 100% ou 0%.
- Detalhes da oportunidade com resumo, vínculos, atividades, histórico, notas internas e tarefas.
- Tarefas ampliadas com descrição, responsável, prioridade, quatro estados, data, horário opcional, edição, conclusão e vínculo exclusivo a cadastro ou oportunidade.
- Agenda comercial por dia e semana, em horário de Brasília, integrada às tarefas e sem calendário externo.
- Follow-up com tarefas do dia, atrasadas, oportunidades sem atividade, paradas na mesma etapa e próximas do fechamento. A gestão configura o limite de 1 a 365 dias; padrão 7.
- Dashboard preservado e ampliado com oportunidades abertas, valor do pipeline, ganhos, perdas, conversão, valor ganho, pendências e inatividade.
- Busca global ampliada para oportunidades por título e pelos dados dos cadastros vinculados.
- Separação explícita entre operação real e DEMO em pipeline, tarefas, agenda, follow-up e indicadores. Exemplos não entram nas métricas reais padrão.
- Estados de carregamento, vazio, erro e sucesso; identidade visual Peclat Solar preservada em desktop e mobile.

## Migration criada

`db/migrations/003_commercial_operations.sql`:

- cria `crm_opportunities` e `crm_commercial_settings`;
- adiciona `is_demo` a `crm_records` e identifica somente os quatro exemplos conhecidos do seed anterior;
- amplia `crm_tasks` sem remover registros existentes;
- permite que `crm_notes` e `crm_activities` pertençam a uma oportunidade;
- adiciona constraints de tipo, vínculo exclusivo, etapa/status, motivo de perda e snapshot de fechamento;
- adiciona índices por organização, responsável, etapa, status, previsão, criação, atualização e atividade.

As migrations `001_identity.sql` e `002_commercial_core.sql` não foram modificadas.

## APIs criadas ou ampliadas

- `GET/POST /api/opportunities`
- `GET/PUT /api/opportunities/{id}`
- `POST /api/opportunities/{id}/stage`
- `POST /api/opportunities/{id}/win`
- `POST /api/opportunities/{id}/lose`
- `GET /api/opportunities/{id}/activities`
- `GET/POST /api/opportunities/{id}/notes`
- `GET /api/pipeline`
- `GET /api/commercial-indicators`
- `GET /api/follow-up`
- `GET/PUT /api/commercial-settings`
- `GET/POST /api/tasks`
- `GET/PUT /api/tasks/{id}`
- `POST /api/tasks/{id}/status`
- `POST /api/tasks/{id}/complete` preservado para compatibilidade
- `GET /api/search` ampliado com o grupo `opportunities`

Filtros, corpos, limites e códigos de erro estão detalhados em `API.md`.

## Segurança e decisões de arquitetura

- Toda consulta parte do `Actor` autenticado; `organization_id` vem da sessão.
- Administrador e gerente usam `crm.all`; vendedor e atendimento ficam limitados ao próprio responsável por `crm.own`.
- Vínculos usam FKs compostas e validam o tipo do cadastro e o contato relacionado.
- Edição e movimento de etapa usam `version` e bloqueio de linha para evitar sobrescrita concorrente.
- Notas, tarefas e atividades existentes foram ampliadas, sem tabelas paralelas.
- O futuro orçamento/proposta deverá referenciar `(organization_id, opportunity_id)`, preservando a oportunidade como raiz comercial.
- Etapas usam códigos estáveis; um configurador futuro poderá migrá-los para catálogo por organização sem recriar oportunidades.
- Dados DEMO são classificados por coluna e derivados dos cadastros vinculados. Não podem ser misturados com dados reais na mesma oportunidade.

## Testes e revisão visual

- Testes unitários/integração: criação e edição de oportunidade, mudança de etapa, versão concorrente, ganho, perda obrigatória, snapshot de fechamento, tarefas, filtros, pesquisa por telefone, histórico, notas, conversão de lead, cliente/contato, RBAC, IDOR, isolamento entre organizações, follow-up, indicadores e separação DEMO.
- Testes de navegador: fluxo lead → oportunidade → nota → tarefa → Kanban → ganha; arrastar e soltar; seletor de etapa; edição e conclusão na agenda; follow-up; API protegida; perda com motivo; busca e indicadores.
- Regressão das FASES 1 e 2 mantida na mesma suíte.
- Revisão visual feita no pipeline preenchido em desktop e no viewport móvel de 390 × 844. O documento não ganha largura extra; a rolagem horizontal fica contida no Kanban.

### Resultado final — 14/09/2026

- `pnpm test`: **41/41 aprovados**.
- `pnpm test:e2e`: **15/15 aprovados** em Chrome com build de produção.
- `pnpm lint`: aprovado, sem avisos do ESLint.
- `pnpm typecheck`: aprovado, sem erros TypeScript.
- `pnpm build`: aprovado; todas as páginas e rotas da FASE 3 foram geradas.

A primeira tentativa da rodada final de navegador coincidiu com a regeneração de `.next` e não encontrou o build temporário. O build foi concluído e a suíte foi executada novamente, de forma sequencial, com 15/15 testes aprovados. O runner continua exibindo apenas o aviso conhecido sobre `NO_COLOR`/`FORCE_COLOR`; ele não representa falha da aplicação.

## Arquivos criados (19)

- `db/migrations/003_commercial_operations.sql`
- `src/modules/commercial/domain.ts`
- `src/modules/commercial/repository.ts`
- `src/components/commercial/entity-picker.tsx`
- `src/components/commercial/opportunity-form.tsx`
- `src/components/commercial/opportunity-board.tsx`
- `src/components/commercial/opportunity-detail.tsx`
- `src/components/commercial/task-workspace.tsx`
- `src/components/commercial/follow-up.tsx`
- `src/components/commercial/metrics.tsx`
- `src/app/(workspace)/pipeline/page.tsx`
- `src/app/(workspace)/oportunidades/page.tsx`
- `src/app/(workspace)/oportunidades/nova/page.tsx`
- `src/app/(workspace)/oportunidades/[id]/page.tsx`
- `src/app/(workspace)/tarefas/page.tsx`
- `src/app/(workspace)/agenda/page.tsx`
- `src/app/(workspace)/follow-up/page.tsx`
- `tests/e2e/operations.spec.ts`
- `PHASE3.md`

## Arquivos alterados (16)

- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/app/(workspace)/page.tsx`
- `src/app/globals.css`
- `src/components/shell.tsx`
- `src/components/crm/dashboard-summary.tsx`
- `src/components/crm/global-search.tsx`
- `src/components/crm/record-detail.tsx`
- `src/modules/crm/repository.ts`
- `scripts/seed-demo.ts`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `README.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `ROADMAP.md`
- `API.md`

`next-env.d.ts`, `tsconfig.tsbuildinfo`, `.next`, `test-results` e clusters em `.local/tests` são artefatos gerados. Não fazem parte da implementação manual. O diretório não possui repositório Git; o inventário foi calculado comparando hashes com o estado salvo antes da FASE 3.

## Limites mantidos

- Não há WhatsApp, contrato, pagamento, instalação, proposta, orçamento executável ou integração de calendário.
- O Kanban entrega até 20 cartões por etapa e encaminha excedentes para a lista paginada.
- O seletor de contatos usa a primeira página do cadastro; pesquisa dedicada pode ser adicionada quando houver bases maiores.
- O banco local herdado continua WIN1252, conforme documentado na FASE 2.

Não iniciar a FASE 4 antes da validação desta entrega.
