# FASE 4 — dimensionamento solar

Esta etapa continuou a FASE 4 sobre as unidades e consumos existentes. Equipamentos e kits foram entregues posteriormente em `PHASE4-CATALOG.md`; propostas, contratos, pagamentos, instalação e WhatsApp permanecem fora do escopo.

## Entregue

- Parâmetros: irradiação solar média diária, desempenho global, potência nominal do módulo e margem de segurança.
- Consumo médio calculado no servidor com até 12 meses recentes da unidade.
- Geração mensal necessária com margem.
- Potência mínima calculada em kWp.
- Quantidade de módulos arredondada para cima e potência instalada resultante.
- Geração mensal estimada para a quantidade inteira de módulos.
- Memória imutável com parâmetros, resultados, meses usados, período, autor, observações, data e versão da fórmula.
- Histórico visível no cliente e atividade `solar.sizing.created` na timeline.
- Validação de faixas físicas básicas, unidade ativa, consumo existente, tenant, responsável e vínculos compostos.

## Fórmula v1

1. `consumo_médio = soma dos até 12 meses mais recentes / quantidade de meses`.
2. `geração_necessária = consumo_médio × (1 + margem / 100)`.
3. `potência_mínima_kWp = geração_necessária / (irradiação × 30 × desempenho / 100)`.
4. `módulos = teto(potência_mínima_kWp × 1000 / potência_do_módulo_W)`.
5. `potência_instalada_kWp = módulos × potência_do_módulo_W / 1000`.
6. `geração_estimada = potência_instalada_kWp × irradiação × 30 × desempenho / 100`.

É uma estimativa comercial. Projeto elétrico, perdas específicas, orientação, sombreamento, área e validação técnica permanecem futuros.

## Arquivos criados

- `db/migrations/005_solar_sizing.sql`
- `PHASE4-SIZING.md`

## Arquivos alterados

- `src/modules/energy/domain.ts`
- `src/modules/energy/repository.ts`
- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/components/energy/energy-workspace.tsx`
- `src/components/crm/record-detail.tsx`
- `src/app/globals.css`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `tests/e2e/energy.spec.ts`
- `README.md`
- `ROADMAP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `API.md`

## Validação

- Migration incremental aplicada no banco local e em PostgreSQL isolado.
- Testes de domínio cobrem fórmula, arredondamento de módulos, snapshot, múltiplos cenários, ausência de consumo, faixas inválidas, IDOR e isolamento entre organizações.
- Teste de navegador cobre consumo → fatura → dimensionamento → memória e responsividade móvel.
- Em 15/09/2026: `pnpm test` com **46/46**, `pnpm test:e2e` com **16/16**, lint sem avisos, TypeScript aprovado e build de produção aprovado.

O runner exibiu apenas o aviso conhecido sobre `NO_COLOR`/`FORCE_COLOR`. No teste focado, o encerramento do banco temporário registrou mensagens de conexão depois das asserções aprovadas; a regressão completa encerrou com 16/16 sem falhas.

O registro desta etapa permanece imutável; a etapa seguinte está documentada em `PHASE4-CATALOG.md`.
