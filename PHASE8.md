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
