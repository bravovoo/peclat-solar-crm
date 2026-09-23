# Fase 8 — WhatsApp Business

## 8.1 Fundação

A integração foi preparada sem ativar envio ou recebimento de mensagens. A configuração administrativa armazena apenas metadados não secretos por organização: nome da conta, Phone Number ID, Business Account ID, número exibido, versão da Graph API, estado, versão e timestamps.

Os segredos `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` são exclusivamente server-side. Eles não são persistidos no PostgreSQL, retornados pelas APIs ou enviados ao navegador. A interface informa somente se cada segredo está presente.

A migration `018_whatsapp_foundation.sql` cria `whatsapp_integrations` e `whatsapp_webhook_events`. A segunda tabela reserva a chave idempotente do provedor e somente hashes de payload; nenhum corpo de mensagem é armazenado nesta etapa. As duas tabelas têm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e com privilégios revogados de `PUBLIC`, `anon`, `authenticated` e `service_role`.

O endpoint `/api/whatsapp/webhook` suporta a verificação do webhook apenas quando o token de verificação está configurado. `POST` permanece bloqueado com HTTP 503 durante a Fase 8.1, portanto eventos e mensagens reais não são aceitos nem processados.

O helper de telefone retorna o valor original, dígitos normalizados, formato E.164 e validade. Ele não migra nem regrava cadastros existentes. A ação futura de WhatsApp em leads, clientes, empresas e oportunidades exige número válido, permissão `whatsapp.use` e integração marcada como conectada com secrets mínimos presentes.

Para a etapa seguinte será necessário configurar no ambiente protegido da Cloudflare os três secrets acima e, no painel da Meta, a conta WhatsApp Business, o número, o aplicativo, a URL de webhook e as assinaturas de eventos. Nenhuma dessas configurações externas pertence à Fase 8.1.

## 8.2 Recebimento seguro e caixa de entrada

O `POST /api/whatsapp/webhook` recebe eventos oficiais da Meta e valida `X-Hub-Signature-256` sobre os bytes exatos do corpo com `WHATSAPP_APP_SECRET`. Requisições sem assinatura, alteradas, grandes demais ou malformadas são recusadas antes da persistência. Eventos autenticados sem mensagens relevantes retornam sucesso para não provocar novas tentativas desnecessárias da Meta.

A migration `019_whatsapp_inbox.sql` cria `whatsapp_conversations` e `whatsapp_messages` e amplia a integração com o estado do webhook e o último evento. O identificador da mensagem da Meta e `whatsapp_webhook_events` fornecem idempotência. Texto e metadados seguros de tipos como imagem, documento, áudio, vídeo e localização são registrados; arquivos de mídia não são baixados nesta etapa. As novas tabelas seguem o padrão de segurança: RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies e sem privilégios de `PUBLIC`, `anon`, `authenticated` ou `service_role`.

Cada evento é associado a uma organização pelos identificadores da conta configurada. O telefone é normalizado para E.164 e a conversa só recebe vínculo automático quando existe exatamente um cadastro compatível na mesma organização. Nenhuma correspondência mantém a conversa não identificada; mais de uma gera estado ambíguo. Usuários autorizados podem vincular, alterar ou remover o vínculo manualmente, sempre respeitando a carteira comercial e com auditoria.

A caixa de entrada em `/whatsapp` oferece busca, filtros de leitura e vínculo, contador de não lidas, histórico cronológico e acesso ao cadastro associado. Marcar como lida altera somente o CRM. Leads, clientes e empresas exibem suas conversas vinculadas no resumo. A tela não possui campo, botão ou API de envio; respostas, templates, automações, chatbot e download de mídia ficam fora da Fase 8.2.

O estado administrativo passa de **Aguardando evento** para **Recebendo eventos** somente após uma mensagem válida ser processada. Tokens continuam exclusivamente no runtime e não aparecem no banco, nas respostas ou no navegador.

## 8.3 Envio, janela de atendimento e modelos aprovados

A caixa de entrada permite resposta manual de texto enquanto a janela de atendimento está aberta. O backend calcula a janela com base na última mensagem inbound válida e exige que ela tenha ocorrido há menos de 24 horas; exatamente 24 horas já representa janela encerrada. A interface mostra o horário de encerramento, mas a decisão é repetida no servidor no momento da tentativa.

Fora da janela, o texto livre é bloqueado e a equipe pode usar somente um modelo aprovado sincronizado da WABA configurada. O CRM lê os modelos existentes na Meta, sem criar, editar ou excluir modelos. Esta etapa suporta cabeçalho e corpo de texto com parâmetros simples. Mídia, catálogo, autenticação, produto, localização, carrossel, botões e demais componentes complexos ficam marcados como não suportados.

A migration `020_whatsapp_outbound.sql` amplia `whatsapp_messages` com direção outbound, usuário remetente, UUID idempotente, modelo, estados e timestamps de entrega e erro seguro. Ela também registra `last_inbound_at` nas conversas e cria o cache `whatsapp_templates`. A nova tabela tem RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios diretos da Data API.

Cada envio reserva uma linha `pending` antes de chamar `POST /{PHONE_NUMBER_ID}/messages`. Repetir o mesmo `client_request_id` devolve a tentativa existente e não chama a Meta novamente. O CRM não faz retry automático do POST. Se a Meta puder ter aceitado a mensagem, mas a resposta for perdida, a tentativa permanece pendente com resultado não confirmado. Essa estratégia evita duplicidade, embora uma API externa sem chave idempotente própria não permita prometer exatamente uma entrega em toda falha de rede possível.

O webhook autenticado também processa `statuses[]` para `sent`, `delivered`, `read` e `failed`. Eventos duplicados são idempotentes e atualizações fora de ordem nunca regridem o estado visual. A inbox consulta atualizações leves periodicamente e diferencia mensagens do cliente e da equipe, com remetente, horário e situação segura.

O destinatário, a organização, o Phone Number ID, a WABA e a credencial são resolvidos no servidor pela sessão e pela conversa. `WHATSAPP_ACCESS_TOKEN` permanece somente no runtime. Os testes usam um servidor Meta falso e nunca fazem envio real.

### Validação e encerramento da Fase 8.3

A Fase 8.3 foi validada com 85/85 testes unitários e integrados, incluindo 21 cenários de banco temporário, e 28/28 cenários Playwright. As telas foram conferidas em 390×844 e 1440×900. TypeScript, lint, build Next.js, bundle OpenNext, Wrangler dry-run e `git diff --check` passaram.

A migration `020_whatsapp_outbound.sql` foi aplicada em produção com checksum `2d13aad09f45a1f256270eae394ba06429fd34c4c91de339bedfb2212c316083`. As tabelas envolvidas mantêm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies e sem privilégios diretos para `PUBLIC`, `anon`, `authenticated` ou `service_role`. O endpoint `/api/health` permaneceu saudável.

Após o deploy automático, um envio real controlado do CRM para o WhatsApp foi recebido pelo destinatário. Os estados **Entregue** e **Lida** foram refletidos no CRM. Uma mensagem inbound posterior voltou para a mesma conversa, renovou a janela de 24 horas e o comando de marcar como lida zerou o contador. Nenhuma falha funcional foi encontrada nessa validação manual. A Fase 8.3 está encerrada.

## 8.3.1 Criação rápida de Lead pela inbox

Conversas não identificadas oferecem a ação manual **Criar Lead** aos usuários que possuem `whatsapp.use` e acesso comercial (`crm.own` ou `crm.all`). A ação nunca é disparada pelo webhook. O modal sugere o `profile name` recebido da Meta, permite revisar o nome e preencher e-mail, observação e Tags internas do CRM. O telefone é somente leitura na interface e o backend sempre o obtém da conversa, normaliza em E.164 e deriva a organização e o responsável da sessão e das regras de carteira já existentes. A origem do cadastro é registrada como **WhatsApp**.

A Tag interna **WhatsApp** é garantida de forma idempotente por organização e aplicada automaticamente; outras Tags existentes podem ser selecionadas opcionalmente. Essas Tags pertencem exclusivamente ao CRM e não sincronizam etiquetas do aplicativo WhatsApp Business. A criação do Lead, as Tags, o vínculo da conversa, a atividade e a auditoria ocorrem na mesma transação. Qualquer falha desfaz toda a operação, sem Lead órfão ou vínculo parcial.

Antes da criação, o backend procura o telefone em Leads, Clientes, Empresas e contatos relacionados da mesma organização. Uma correspondência oferece o vínculo ao cadastro existente; múltiplas correspondências exigem escolha humana e nenhuma delas é selecionada automaticamente. O bloqueio transacional por organização e o bloqueio da conversa impedem duplicação por clique repetido, retry ou operadores concorrentes. IDs de organização, telefone, destinatário, responsável, WABA, Phone Number ID e credenciais não são aceitos do navegador.

O fluxo mantém mensagens, leitura, janela de 24 horas e estados de entrega. Após a criação, a inbox permanece aberta, exibe **Ver Lead** sem redirecionar automaticamente e preserva o atendimento. Nenhuma migration foi necessária porque Leads, origem, Tags, relacionamento de Tags e vínculo da conversa já existiam.

### Validação da Fase 8.3.1

A etapa foi validada com 86/86 testes unitários e integrados, incluindo banco temporário, isolamento, concorrência e rollback, e 28/28 cenários Playwright. O cenário de inbox cobre criação com nome editado e Tag, telefone somente leitura, origem WhatsApp, vínculo persistente após recarga, abertura do Lead, bloqueio de duplicidade e vínculo ao cadastro existente. A responsividade foi conferida em 390×844 e 1440×900, sem rolagem horizontal indevida. TypeScript, lint, build Next.js, bundle OpenNext, Wrangler dry-run e `git diff --check` passaram.

## 8.4 Automações comerciais

A migration `021_commercial_automations.sql` adiciona configurações por organização, regras, execuções, ações executadas e jobs persistidos. Também registra origem de tarefas e mensagens, responsável automático e os controles de pausa e bloqueio das conversas. As tabelas novas têm RLS ativa, sem `FORCE ROW LEVEL SECURITY` e sem acesso direto de `PUBLIC`, `anon`, `authenticated` ou `service_role`. As permissões `automations.read` e `automations.manage` são concedidas a administradores e gerentes. Nenhuma regra nasce ativa, e o envio automático por WhatsApp começa globalmente desligado por organização.

Eventos de mensagens inbound, conversas, Leads e mudanças de etapa alimentam a fila persistida. Um Cron Trigger do Worker agenda casos de tarefa vencida, follow-up pendente, proposta parada e conversa sem resposta, e processa lotes limitados. O claim usa `FOR UPDATE SKIP LOCKED`, chaves únicas de evento/job e registros de execução para evitar trabalho duplicado entre invocações concorrentes. O motor registra ações e motivos seguros de falha ou ignorado, aplica condições, horário comercial no fuso da organização, cooldown e limites de envio. Mensagens outbound de automação não geram novo evento inbound. Falha ambígua da Meta nunca provoca reenvio automático.

As ações reutilizam as tarefas, Tags, escopo comercial, atribuição de responsável e envio WhatsApp já existentes. É possível criar tarefa ou follow-up, adicionar/remover Tag, atribuir responsável fixo ou por round-robin, enviar texto dentro da janela de 24 horas e usar modelo aprovado fora dela. O backend valida organização, equipe, responsável, Tag e modelo no momento da configuração e da execução. O envio passa pelas verificações de janela, modelo, pausa da conversa, opt-out, kill switch e limites imediatamente antes da reserva da mensagem. Pausar e reativar automações ou bloquear o envio para um contato ficam disponíveis na inbox, com auditoria.

Em **Configurações → Automações**, administradores e gerentes autorizados criam e editam regras, veem uma prévia, ativam ou desativam, simulam sem ação externa e consultam execuções. Gerentes veem e administram somente as próprias regras; a execução exige acesso atual à carteira/equipe relacionada. Regras para distribuição de conversas ainda sem vínculo ou responsável precisam ser configuradas por administrador. Somente administradores alteram o horário comercial, limites e o controle global de envio. A simulação nunca chama a Meta. Os testes automáticos usam apenas uma Meta falsa: nenhuma mensagem real foi enviada na validação.

`create_internal_notification` ficou fora da Fase 8.4 porque o CRM ainda não possui um subsistema adequado de notificações internas. Campanhas, chatbot e IA também não foram incluídos. A Fase 8.5 fica reservada a mídia e anexos, mediante nova solicitação.

### Estado da validação da Fase 8.4

Localmente, a migration 021 foi aplicada em bancos temporários; 99/99 testes unitários e integrados (12 específicos de automações) e 30/30 cenários Playwright passaram. A inbox foi ajustada para rolar somente depois da renderização do histórico, mantendo a posição quando o operador lê mensagens antigas. Responsividade em 390×844 e 1440×900, TypeScript, lint, build Next.js, OpenNext, Wrangler dry-run e `git diff --check` passaram. Após habilitar a criação de links simbólicos no Windows, o OpenNext gerou `.open-next/worker.js` sem ajustes específicos no projeto. A migration 021 foi aplicada em produção e registrada em `schema_migrations` com checksum `6eb50d11d3b1d2d57a6b3ccc07ae0831934b7cc5e85a0fdf49d5ecaedf79746b`. As cinco tabelas novas têm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies e sem privilégios diretos da Data API. `/api/health` respondeu HTTP 200 após a aplicação. Nenhuma mensagem real de WhatsApp foi enviada na validação.

## 8.5 Mídia e anexos

Mensagens inbound de áudio, imagem, documento e vídeo usam o `media_id`, MIME, nome e legenda que o webhook já grava. O webhook continua sem buscar os bytes. Ao abrir um anexo, o backend valida sessão, permissão `whatsapp.use`, organização, acesso comercial à conversa e pertencimento da mensagem à conversa. Só então consulta a Meta com o token do runtime, confere a origem da URL temporária e transmite os bytes ao navegador com resposta privada sem cache. O navegador recebe apenas a URL interna do CRM; nem o token nem a URL temporária da Meta são expostos. O proxy repassa solicitações `Range` para reprodução de áudio/vídeo quando a origem as suporta. Arquivos indisponíveis apresentam uma mensagem segura.

Dentro da janela de 24 horas, a equipe pode anexar JPEG, PNG ou PDF. O servidor verifica MIME, assinatura, tamanho máximo de 5 MB para imagens e 10 MB para PDF, calcula SHA-256, reserva uma tentativa idempotente, faz upload à Meta e envia a mensagem pelo fluxo outbound já existente. A organização, o telefone, o destinatário e as credenciais nunca são aceitos do formulário. Não há armazenamento permanente dos bytes no CRM; o banco guarda somente os metadados, hash e IDs necessários. A tentativa ambígua de envio mantém o comportamento conservador de não repetir automaticamente a chamada à Meta. Fora da janela, continua obrigatório usar modelo aprovado.

Os campos já existentes em `whatsapp_messages` são suficientes; não há migration 022 nem alterações nas permissões, no Supabase Storage ou nas regras das fases anteriores. Os testes automáticos usam somente Meta simulada. A checagem de envio e recebimento de mídia real deve ser feita manualmente após a publicação, sem automação de disparo real.

### Validação da Fase 8.5

Passaram 104 testes unitários e integrados, incluindo autorização, escopo, isolamento entre organizações, formato/assinatura, erros da Meta, streaming parcial, PDF, hash e dupla tentativa concorrente. Os 30 cenários Playwright passaram com Meta simulada; a inbox foi verificada em 390×844 e 1440×900, incluindo áudio, imagem, PDF, mídia expirada, envio de anexo e ausência de rolagem horizontal indevida. TypeScript, lint, build Next.js, bundle OpenNext e Wrangler dry-run passaram. Nenhuma mensagem ou mídia real foi enviada nos testes automatizados. Após o deploy, áudio, imagem, PDF e envio manual para número próprio ainda exigem verificação humana.

## 8.6 Assistente Comercial com IA

O assistente funciona exclusivamente sob demanda na inbox. O vendedor escolhe **Resumir**, **Sugerir resposta**, **Próxima ação**, **Dados faltantes**, **Follow-up** ou **Apoio ao fechamento**. Uma sugestão só chega ao composer depois de um clique explícito, permanece editável e nunca é enviada automaticamente. A IA não cria registros, tarefas, oportunidades, Tags, contratos, cobranças ou automações.

O navegador envia apenas o identificador da conversa, a ação e um UUID da solicitação. O backend autentica a sessão, valida `ai_assistant.use`, resolve a organização e aplica o mesmo escopo comercial da inbox antes de montar o contexto. O contexto usa no máximo 10 a 50 mensagens recentes, conforme configuração, além do cadastro vinculado, Tags, responsável, oportunidade acessível, tarefas abertas, proposta manual e dados solares existentes quando pertinentes. Telefones, documentos pessoais, credenciais, sessões, webhooks brutos e arquivos não são enviados. Áudio, imagem, vídeo e documento entram somente como marcadores textuais; não há transcrição nem análise de arquivo.

O domínio depende da interface `CommercialAiProvider`. O adapter inicial usa a Responses API com Structured Outputs, `store: false`, timeout de 15 segundos e chave exclusivamente no runtime. Mensagens do cliente são delimitadas como conteúdo não confiável e não podem modificar instruções, permissões ou escopo. O resultado passa por schema estrito e por uma verificação adicional que rejeita valores, potência, geração, quantidade de módulos, garantia, prazo ou economia não sustentados pelos dados do CRM. Falhas, 429, JSON vazio ou inválido e schema incorreto retornam erro seguro sem interromper a inbox.

A migration `022_commercial_ai_assistant.sql` cria a configuração por organização e a telemetria mínima. Ela adiciona `ai_assistant.use` para administradores, gerentes e vendedores, e `ai_assistant.manage` somente para administradores. As tabelas guardam ação, usuário, conversa, provider/model, duração, resultado e tokens quando disponíveis; prompts e respostas completas não são persistidos. O limite por usuário e organização usa reserva transacional, e o `request_id` único impede chamadas concorrentes repetidas. A configuração nasce desativada e a ausência da credencial mostra **Assistente de IA ainda não configurado** sem afetar o restante do CRM.

Os testes usam provider fake local, sem chamada de IA real e sem envio de WhatsApp. A cobertura inclui output estruturado, conversa vazia/incompleta, prompt injection, tentativa de alucinação factual, permissão, isolamento entre organizações, idempotência, limite, falhas do provider, inserção e edição humana, desktop 1440×900 e mobile 390×844.

### Validação local da Fase 8.6

Passaram 107/107 testes unitários e integrados. Os 30 cenários Playwright foram validados, incluindo a inbox com provider fake, inserção e edição sem envio, falha segura e responsividade em 390×844 e 1440×900. TypeScript, lint, build Next.js, bundle OpenNext, geração de `.open-next/worker.js`, Wrangler dry-run e `git diff --check` passaram. Nenhum teste chamou IA real ou enviou mensagem de WhatsApp. A migration 022 passou em bancos temporários e foi aplicada no Supabase com checksum `b6a3ce57baadfae39fd02d26449a3efb5fbb50dc48af1c719a51ba05fbaf216f`; as duas tabelas mantêm RLS ativa, sem `FORCE`, sem policies e sem privilégios diretos da Data API.

## 8.6.1 Google Gemini Free Tier

O Assistente Comercial oferece **Google Gemini** e **OpenAI** como providers selecionáveis por organização, mantendo a interface `CommercialAiProvider`. O adapter `GeminiCommercialAiProvider` usa a API oficial `generateContent` pelo backend, envia a chave somente no header `x-goog-api-key` e solicita o mesmo JSON Schema estrito da Fase 8.6. O modelo padrão atual do Gemini é `gemini-3.5-flash-lite`; `gemini-3.8-flash` também pode ser selecionado, e o administrador pode alterar o modelo sem expor a credencial no navegador. Não existe fallback automático entre providers nem tentativa de ativar billing.

A seleção persistida determina exclusivamente qual provider é chamado. A ausência de `GEMINI_API_KEY` mantém o Gemini indisponível sem afetar o restante do CRM. HTTP 400 é registrado como `provider_bad_request`, HTTP 404 como `provider_model_not_found` e HTTP 429 é apresentado como limite gratuito atingido, sem provocar chamada à OpenAI. Erros 401, 403, 5xx, timeout, JSON inválido, schema inválido e resposta vazia continuam seguros. A telemetria conserva provider, modelo, ação, duração, tokens, resultado, usuário, organização e conversa, sem armazenar prompt ou resposta integral.

Antes da chamada, o contexto remove telefone, CPF/CNPJ, e-mail, URLs e nomes de arquivos. Mídias e documentos continuam apenas como marcadores textuais, sem bytes ou conteúdo do arquivo. Isolamento por organização, permissões, defesa contra prompt injection, rate limit, idempotência, timeout, validação factual e revisão humana permanecem ativos.

A migration `023_gemini_ai_provider.sql` foi necessária porque a constraint da migration 022 aceitava somente `openai`. Ela amplia a constraint para `gemini` e `openai` e define `gemini`/`gemini-2.5-flash` como defaults para novas configurações, sem alterar configurações existentes, criar tabelas ou modificar RLS e privilégios.

### Validação local da Fase 8.6.1

Passaram 110/110 testes unitários e integrados com providers simulados e 31 cenários Playwright, incluindo seleção e persistência do Gemini, troca para OpenAI, ausência de campo de credencial e responsividade em 390×844 e 1440×900. Nenhum teste chamou Google, OpenAI ou WhatsApp reais. TypeScript, lint, build Next.js, bundle OpenNext, Wrangler dry-run e `git diff --check` passaram.
