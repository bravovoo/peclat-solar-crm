# WhatsApp Flows

## Escopo

O CRM usa a integração oficial do WhatsApp Business Platform já existente. Não há um segundo token, WABA, número, webhook ou cliente Graph. O módulo de Flows é carregado apenas nas rotas de configuração, envio manual e processamento de respostas.

O Flow inicial é **Peclat Solar - Solicitar Orçamento**, categoria `LEAD_GENERATION`, com cinco telas: identificação, consumo, projeto, contato e confirmação. A definição local usa Flow JSON 7.3 e Data API 3.0. O upload de fatura não faz parte do Flow; quando necessário, o vendedor pode solicitar o arquivo na conversa.

## APIs oficiais utilizadas

- `GET /{WABA_ID}/flows`: sincroniza Flows existentes.
- `POST /{WABA_ID}/flows`: cria um rascunho oficial.
- `POST /{FLOW_ID}/assets`: envia e valida `flow.json`.
- `POST /{FLOW_ID}/publish`: publica após confirmação explícita. A publicação é irreversível.
- `POST /{FLOW_ID}/deprecate`: desativa um Flow publicado.
- `POST /{PHONE_NUMBER_ID}/messages`: envia manualmente uma mensagem interativa do tipo `flow` dentro da janela de atendimento.
- Webhook `messages[].interactive.nfm_reply.response_json`: recebe a conclusão do formulário.

A versão da Graph API, WABA e Phone Number ID continuam vindo da configuração da organização. `WHATSAPP_ACCESS_TOKEN` permanece somente no servidor.

## Segurança e dados

A migration `033_whatsapp_flows.sql` cria `whatsapp_flows`, `whatsapp_flow_field_mappings` e `whatsapp_flow_submissions`, além do vínculo opcional da mensagem com a submissão. As três tabelas usam RLS, não possuem políticas públicas e revogam os privilégios diretos de `PUBLIC`, `anon`, `authenticated` e `service_role`.

Somente administradores com `whatsapp.flows.manage` gerenciam, validam, publicam ou desativam Flows. Usuários com `whatsapp.use` podem listar e enviar manualmente apenas Flows publicados da própria organização. Toda consulta inclui `organization_id`, mesmo que o backend opere com papel privilegiado.

O webhook continua protegido pela assinatura HMAC oficial. A resposta é tratada como dado não confiável, aceita apenas chaves conhecidas e valores limitados e nunca altera permissões, organização ou instruções internas. O token do Flow é usado somente para correlacionar a resposta com um envio oficial anterior.

## Criação ou atualização do cadastro

A associação segue esta ordem:

1. cadastro já vinculado à conversa;
2. telefone ou WhatsApp normalizado dentro da mesma organização;
3. novo Lead, quando não existe correspondência.

Um Lead existente recebe apenas campos comerciais apropriados e campos preenchidos não são substituídos indiscriminadamente. Clientes e empresas permanecem com seu tipo original. Mais de um cadastro com o mesmo número gera `ambiguous_contact` e não cria outro Lead. Respostas incompletas geram `invalid_data` e ficam auditadas sem criar cadastro.

A unicidade de `(organization_id, provider_submission_id)` e `(organization_id, message_id)` torna o processamento idempotente. As tags WhatsApp Flow, Orçamento Solar, Financiamento e Visita Técnica são reutilizadas sem duplicação. O preenchimento não concede consentimento de marketing.

## Operação

1. Acesse **Configurações → WhatsApp Business → Flows**.
2. Revise o Flow e o mapeamento de campos.
3. Crie o rascunho na Meta.
4. Valide a definição.
5. Corrija qualquer erro retornado pela Meta.
6. Publique somente após confirmação explícita.
7. Na Inbox, durante uma janela aberta, use **Enviar formulário**, escolha o Flow e confirme.

Nenhuma sincronização ocorre em todas as requisições e não existe polling global. Sincronização, criação, validação e publicação só acontecem por ação administrativa. Nenhuma automação de Flow foi ativada; a Recuperação de Leads mantém o comportamento atual.

## Teste real futuro

Depois de aplicar a migration 033 e publicar a aplicação, configure e publique o Flow com uma autorização específica. Use uma conversa de teste com número próprio e janela aberta, envie o formulário manualmente, preencha-o e confira: submissão única, cartão na Inbox, cadastro criado ou atualizado, tags e atividade. Não use carteira real no primeiro teste.

Templates com botão de Flow são suportados pela plataforma oficial e ficaram previstos na arquitetura, mas nenhum template foi criado, submetido ou enviado nesta etapa.

## Validação local e limites

- Suíte unitária/integrada: **136/136**. Migrations 001–033 aplicadas em PostgreSQL temporário, com verificação de RLS/privilégios.
- Playwright completo: **39/39**, incluindo temas e responsividade. Após os últimos ajustes, os quatro cenários de WhatsApp/Inbox também passaram novamente no build atualizado.
- Regressões de Flow: criação, sincronização, validação, publicação e envio com Meta simulada; resposta assinada; criação/atualização de Lead; cliente existente; contato ambíguo; resposta incompleta; organização alheia; deduplicação; token de outra conversa rejeitado; valor decimal com ponto ou vírgula; criação externa incerta bloqueada até reconciliação.
- TypeScript, lint, Next.js, OpenNext e Wrangler dry-run aprovados; `git diff --check` sem erros.
- Os testes de layout usam a preferência de movimento reduzido para medir a geometria depois das transições. O cenário de edição de automação aguarda o salvamento terminar e o teste mobile tem uma conta própria, sem relaxar o rate limit da aplicação.
- Não houve acesso real à Meta, envio de WhatsApp, publicação, commit, push ou migration de produção durante a implementação.

O Flow solar usa navegação estática e recebe a conclusão pelo webhook existente. Não há endpoint de troca dinâmica de dados nem chaves de criptografia novas. O editor local cobre metadados e mapeamentos; não é um construtor visual de telas arbitrárias. Rascunhos novos reutilizam a estrutura solar inicial. Templates com botão de Flow e automações permanecem para uso futuro; o envio manual atual exige janela aberta.

A aceitação da definição, saúde da WABA, permissões reais do token e disponibilidade no aparelho precisam ser confirmadas no teste real autorizado. Os mocks não substituem a validação do Flow pela Meta. Nenhum resultado local afirma que o Flow já está publicado ou aprovado na Meta.

## Desempenho

Nenhuma dependência foi adicionada e não há consulta ou sincronização global nova. O gerenciamento fica na rota administrativa; o recebimento processa somente `nfm_reply`; o envio ocorre por ação manual. O dry-run mediu aproximadamente **2,38 MiB gzip** para o Worker completo. Esse tamanho não é uma medição de CPU: não houve benchmark de produção nem comparação controlada com o bundle anterior.

## Publicação futura

1. Com autorização, conferir o diff e obter backup recuperável do banco correto.
2. Aplicar a migration 033 pelo migrador existente e verificar checksum, três tabelas, índices, permissão administrativa, RLS e revogações.
3. Publicar a aplicação pelo fluxo habitual e verificar health, login, Inbox e a nova página de Flows.
4. Conferir o acesso da credencial existente à WABA, com `whatsapp_business_management` para gestão e `whatsapp_business_messaging` para envio; não adicionar secrets ao Git.
5. Criar/validar o rascunho pela ação administrativa e revisar a prévia e eventuais erros da Meta antes de publicar o Flow.
6. Somente com autorização específica, realizar o teste manual com número próprio descrito acima. Não ativar automações ou recuperação de leads como parte dessa publicação.

## Arquivos desta entrega

- `db/migrations/033_whatsapp_flows.sql`
- `src/modules/whatsapp/flow-domain.ts`
- `src/modules/whatsapp/solar-budget-flow.ts`
- `src/modules/whatsapp/flow-manager.ts`
- `src/modules/whatsapp/flow-outbound.ts`
- `src/modules/whatsapp/flow-submissions.ts`
- `src/modules/whatsapp/meta.ts`
- `src/modules/whatsapp/webhook.ts`
- `src/modules/crm/domain.ts`
- `src/app/api/whatsapp/flows/[[...segments]]/route.ts`
- `src/app/api/whatsapp/conversations/[[...segments]]/route.ts`
- `src/app/(workspace)/configuracoes/whatsapp/flows/page.tsx`
- `src/components/whatsapp/flow-manager.tsx`
- `src/components/whatsapp/whatsapp-settings.tsx`
- `src/components/whatsapp/whatsapp-inbox.tsx`
- `src/app/globals.css`
- `scripts/seed.ts`
- `scripts/e2e-server.ts`
- `playwright.config.ts`
- `tests/database.test.ts`
- `tests/whatsapp.test.ts`
- `tests/e2e/whatsapp-foundation.spec.ts`
- `tests/e2e/whatsapp-inbox.spec.ts`
- `tests/e2e/automations.spec.ts`
- `tests/e2e/workspace.spec.ts`
- `WHATSAPP_FLOWS.md`
