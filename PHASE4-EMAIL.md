# FASE 4 — envio de orçamentos por e-mail

Esta etapa envia por SMTP os PDFs manuais já armazenados na área Documentos. Não cria orçamento, proposta automática, contrato, pagamento, instalação ou WhatsApp.

## Entregue

- Botão **Enviar por e-mail** em cada documento.
- E-mail do cliente preenchido automaticamente e editável antes do envio.
- Validação do destinatário, assunto e mensagem no navegador e no servidor.
- Assunto e mensagem editáveis com texto inicial da Peclat Solar.
- PDF original enviado como anexo `application/pdf`.
- Registro de destinatário, assunto, mensagem, documento, arquivo, autor e data.
- Histórico do envio no documento, no cliente e na oportunidade.
- Mudança automática de rascunho para enviado somente após aceite do SMTP.
- Erro explícito para SMTP ausente e erro de entrega sem falso registro de sucesso.
- Interface responsiva e SMTP local isolado para testes de navegador.

## Migration

`db/migrations/008_document_email.sql` cria `crm_document_emails` e seus índices. As migrations 001–007 permanecem inalteradas.

## Arquivos criados

- `db/migrations/008_document_email.sql`
- `PHASE4-EMAIL.md`

## Arquivos alterados

- `.env.example`
- `src/integrations/mail.ts`
- `src/server/http.ts`
- `src/app/api/[resource]/[[...segments]]/route.ts`
- `src/modules/documents/domain.ts`
- `src/modules/documents/repository.ts`
- `src/components/documents/document-workspace.tsx`
- `src/components/crm/record-detail.tsx`
- `src/modules/commercial/domain.ts`
- `src/app/globals.css`
- `scripts/e2e-server.ts`
- `tests/crm.test.ts`
- `tests/database.test.ts`
- `tests/security.test.ts`
- `tests/e2e/documents.spec.ts`
- `README.md`
- `ROADMAP.md`
- `PHASE4-DOCUMENTS.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `API.md`

## Configuração

Defina `SMTP_HOST` para habilitar o envio. `SMTP_PORT` usa 1025 por padrão; `SMTP_SECURE=true` habilita TLS direto. Preencha `SMTP_USER` e `SMTP_PASSWORD` quando o servidor exigir autenticação e use um remetente autorizado em `MAIL_FROM`.

## Validação

- Migration 008 aplicada no banco local e em bancos isolados.
- `pnpm test`: 53 testes aprovados.
- `pnpm lint`: aprovado sem avisos.
- `pnpm typecheck`: aprovado sem erros.
- `pnpm build`: produção gerada com sucesso.
- `pnpm test:e2e`: 17 cenários aprovados, incluindo SMTP local e PDF anexado.
- Fluxo focado repetido após a captura mobile final: aprovado.

Não iniciar gerador automático, contratos, pagamentos, instalação ou WhatsApp sem nova solicitação.
