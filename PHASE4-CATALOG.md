# FASE 4 — equipamentos e kits solares

Esta etapa conclui a FASE 4 sobre consumo, faturas e dimensionamento já existentes. As FASES 1–3 não foram alteradas funcionalmente. Propostas, contratos, pagamentos, instalação e WhatsApp permanecem fora do escopo.

## Entregue

- Catálogo de módulos/painéis, inversores, estruturas e componentes.
- Fabricante, modelo, código interno, potência nominal, eficiência, fases, MPPT, unidade e características técnicas.
- Kits comerciais com composição e quantidade de até 500 itens distintos.
- Cálculo automático de quantidade de módulos, potência CC e potência nominal de inversores.
- Gestão por administrador/gerente; leitura por perfis comerciais.
- Criação, edição, arquivamento e reativação com versão concorrente.
- Histórico com snapshot, autor e data para equipamentos e kits.
- Bloqueio do arquivamento de equipamento utilizado por kit ativo.
- Vínculo de kit ativo ao dimensionamento acessível.
- Cálculo da quantidade de kits necessária para atingir a potência dimensionada.
- Snapshot imutável da composição, quantidades e potências no histórico do cliente.
- Página **Equipamentos e kits**, navegação no CRM e interface responsiva.

## Migration

`db/migrations/006_solar_catalog.sql` cria `solar_equipment`, `solar_kits`, `solar_kit_items`, os dois históricos e `solar_sizing_kit_selections`. Também adiciona `solar.catalog.manage`. As migrations 001–005 não foram modificadas.

## Arquivos criados

- `db/migrations/006_solar_catalog.sql`
- `src/modules/solar-catalog/domain.ts`
- `src/modules/solar-catalog/repository.ts`
- `src/components/solar-catalog/catalog-workspace.tsx`
- `src/app/(workspace)/catalogo-solar/page.tsx`
- `PHASE4-CATALOG.md`

## Arquivos alterados

- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/components/energy/energy-workspace.tsx`
- `src/components/crm/record-detail.tsx`
- `src/components/shell.tsx`
- `src/app/globals.css`
- `scripts/seed.ts`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `tests/e2e/energy.spec.ts`
- `README.md`
- `ROADMAP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `API.md`
- `PHASE4-STAGE1.md`
- `PHASE4-SIZING.md`

## Limites

- O catálogo não contém preço, estoque, fornecedor ou disponibilidade.
- O vínculo é uma seleção comercial; não gera proposta, lista executiva de materiais ou reserva de itens.
- Dados de placa detalhados, compatibilidade elétrica, strings, área, orientação e sombreamento exigem validação técnica futura.

## Validação final

- `pnpm test`: 49 testes aprovados.
- `pnpm lint`: aprovado sem avisos.
- `pnpm typecheck`: aprovado sem erros.
- `pnpm build`: versão de produção gerada com sucesso.
- `pnpm test:e2e`: 16 cenários de navegador aprovados.
- Catálogo e área de energia verificados em 390 × 844 px, sem rolagem horizontal da página.
- Navegação completa verificada em notebook com 1440 × 900 px.

Não iniciar a FASE 5 sem nova solicitação.
