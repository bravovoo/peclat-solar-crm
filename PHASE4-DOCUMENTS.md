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
- Armazenamento local configurável para desenvolvimento e bucket privado no Supabase Storage para hospedagem.
- Interface responsiva validada em 390 × 844 px.

## Arquivos criados

- `db/migrations/007_manual_documents.sql`
- `src/modules/documents/domain.ts`
- `src/modules/documents/storage.ts`
- `src/modules/documents/supabase-storage.ts`
- `src/modules/documents/repository.ts`
- `src/components/documents/document-workspace.tsx`
- `tests/e2e/documents.spec.ts`
- `tests/storage.test.ts`
- `scripts/setup-document-storage.ts`
- `scripts/migrate-document-storage.ts`
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

No desenvolvimento, `DOCUMENT_STORAGE_PROVIDER=local` mantém os PDFs em `DOCUMENT_STORAGE_DIR`, cujo padrão é `.local/documents`. Na hospedagem, use `DOCUMENT_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET` e `SUPABASE_SECRET_KEY` (preferida) ou `SUPABASE_SERVICE_ROLE_KEY` (legada). Configure somente uma chave; ela existe apenas no backend e não pode receber prefixo `NEXT_PUBLIC_`.

`pnpm storage:setup` cria ou reforça o bucket como privado, limitado a 10 MB e `application/pdf`. `pnpm storage:migrate` copia os arquivos mencionados por `crm_documents` do diretório local para o bucket, valida SHA-256 nos dois lados, ignora cópias já válidas e não apaga os originais. Configure o provedor como `supabase` somente depois que a migração terminar sem arquivos ausentes.

O navegador continua usando `/api/documents/:id/file`. Essa rota exige a sessão própria do CRM, valida organização, responsável, cliente e oportunidade antes de o backend acessar o Storage. Não são geradas URLs públicas ou assinadas. Como o backend usa uma chave secreta, não são necessárias políticas de acesso direto para `anon` ou `authenticated` no bucket.

O PDF original não é substituído. Uma nova versão do arquivo deve ser anexada como outro documento; alterações de nome, valor, validade, observação e status ficam no histórico do documento existente.

Não iniciar contratos, pagamentos, instalação ou WhatsApp sem nova solicitação.
