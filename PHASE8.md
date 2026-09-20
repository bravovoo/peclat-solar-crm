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

## Próximas etapas possíveis

A Fase 8.4 poderá abranger mídia outbound, download de mídia inbound, anexos e administração de modelos. Uma Fase 8.5 futura poderá avaliar automações, distribuição, chatbot, IA e campanhas somente após aprovação explícita. Nenhum desses itens faz parte da Fase 8.3.
