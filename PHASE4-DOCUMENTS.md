# FASE 4 — documentos e orçamentos manuais em PDF

Esta etapa adiciona PDFs preparados manualmente às oportunidades e aos clientes. O envio desses PDFs por e-mail foi acrescentado na etapa seguinte e está inventariado em `PHASE4-EMAIL.md`. Não existe gerador automático, assinatura, contrato, pagamento, instalação ou WhatsApp.

## Entregue

- Upload privado de PDF com limite de 10 MB e validação de MIME, extensão e cabeçalho.
- Nome, valor do orçamento, validade, observação, data, autor e tamanho do arquivo.
- Status rascunho, enviado, aceito e recusado.
- Vínculo obrigatório com um cliente e uma oportunidade desse mesmo cliente.
- Listagem nas abas Documentos do cliente e da oportunidade.
- Download autenticado com nome original e verificação SHA-256.
- Edição de metadados com controle de versão concorrente.
- Histórico de criação, edição e status com snapshots, autor e data.
- Armazenamento configurável por `DOCUMENT_STORAGE_DIR`, fora da pasta pública.
- Interface responsiva validada em 390 × 844 px.

## Arquivos criados

- `db/migrations/007_manual_documents.sql`
- `src/modules/documents/domain.ts`
- `src/modules/documents/storage.ts`
- `src/modules/documents/repository.ts`
- `src/components/documents/document-workspace.tsx`
- `tests/e2e/documents.spec.ts`
- `PHASE4-DOCUMENTS.md`

## Arquivos alterados

- `.env.example`
- `.gitignore`
- `src/server/http.ts`
- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/components/crm/record-detail.tsx`
- `src/components/commercial/opportunity-detail.tsx`
- `src/modules/commercial/domain.ts`
- `src/app/globals.css`
- `scripts/e2e-server.ts`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `README.md`
- `ROADMAP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `API.md`

## Validação

- Migration 007 aplicada no banco local e em bancos isolados criados do zero.
- `pnpm test`: 51 testes aprovados.
- `pnpm lint`: aprovado sem avisos.
- `pnpm typecheck`: aprovado sem erros.
- `pnpm build`: produção gerada sem alertas.
- `pnpm test:e2e`: 17 cenários aprovados.

## Operação

O diretório configurado em `DOCUMENT_STORAGE_DIR` precisa ser persistente e incluído no backup junto com o PostgreSQL. Restaurar somente um dos dois deixa metadados ou arquivos incompletos. O padrão local é `.local/documents`.

O PDF original não é substituído. Uma nova versão do arquivo deve ser anexada como outro documento; alterações de nome, valor, validade, observação e status ficam no histórico do documento existente.

Não iniciar contratos, pagamentos, instalação ou WhatsApp sem nova solicitação.
