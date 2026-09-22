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
