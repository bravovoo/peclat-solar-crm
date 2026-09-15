# FASE 4 — etapa 1: consumo energético e faturas

Esta entrega iniciou a FASE 4 somente no cadastro energético do cliente. Dimensionamento, equipamentos e kits foram entregues posteriormente em documentos próprios; propostas, contratos, pagamentos, instalação e WhatsApp permanecem fora do escopo.

## Entregue

- Várias unidades consumidoras por cliente, com identificação, distribuidora, titular, grupo tarifário, tipo de ligação, tensão e endereço.
- Histórico mensal por unidade: consumo, energia injetada, demanda máxima, dias faturados, origem e observações.
- Dados básicos de uma fatura por mês: valor, número, emissão, vencimento, bandeira tarifária, leituras e observações.
- Média, soma dos últimos 12 meses, quantidade total de meses e indicador de completude de 12 meses para uso futuro pelo dimensionamento.
- Criação e edição com validação no navegador e no servidor; arquivamento/reativação da unidade com preservação integral do histórico.
- Aba **Consumo e faturas** exclusiva do cliente, gráfico de 12 meses, tabela mensal e layout responsivo com rolagem contida na tabela.
- Atividades do cliente para criação/edição/arquivamento de unidade, consumo e fatura.
- Isolamento por organização e responsável, proteção contra IDOR, FK composta, versão otimista e unicidade por unidade/mês.

## Migration e API

`db/migrations/004_energy_consumption.sql` cria `energy_consumer_units`, `energy_monthly_consumption` e `energy_bills`. As migrations anteriores não foram modificadas. Os endpoints estão descritos em `API.md`.

## Verificação executada em 14/09/2026

- `pnpm test`: 44/44 testes unitários e de integração aprovados em PostgreSQL isolado.
- `pnpm lint`: aprovado sem avisos.
- `pnpm typecheck`: aprovado sem erros.
- `pnpm build`: aprovado.
- `pnpm test:e2e`: 16 testes de navegador, incluindo cadastro completo de unidade, consumo e fatura, RBAC e regressão das FASES 1–3.
- Revisão visual móvel em 390 × 844; a página não apresenta rolagem lateral e a tabela mantém sua própria rolagem.

O aviso conhecido `NO_COLOR`/`FORCE_COLOR` pode aparecer no runner. O encerramento do banco E2E pode registrar `database_idle_connection_failed` depois do teste focado, quando o servidor é finalizado; nenhuma asserção ou transação falhou.

## Arquivos criados

- `db/migrations/004_energy_consumption.sql`
- `src/modules/energy/domain.ts`
- `src/modules/energy/repository.ts`
- `src/components/energy/energy-workspace.tsx`
- `tests/e2e/energy.spec.ts`
- `PHASE4-STAGE1.md`

## Arquivos alterados

- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/app/globals.css`
- `src/components/crm/record-detail.tsx`
- `src/modules/crm/domain.ts`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `README.md`
- `ROADMAP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `API.md`

## Pendências intencionais

- Nenhum arquivo de fatura é armazenado; esta etapa cadastra somente dados estruturados.
- O indicador de 12 meses não é um dimensionamento e não sugere potência, geração, economia ou kit.
- Exclusão de consumo/fatura não foi aberta na interface; correções são feitas por edição e o histórico da unidade é preservado ao arquivar.
- O banco local legado continua WIN1252 conforme documentado; os testes isolados usam UTF-8.

O registro desta etapa permanece imutável; as etapas seguintes estão documentadas em `PHASE4-SIZING.md` e `PHASE4-CATALOG.md`.
