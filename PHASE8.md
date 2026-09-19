# Fase 8 — WhatsApp Business

## 8.1 Fundação

A integração foi preparada sem ativar envio ou recebimento de mensagens. A configuração administrativa armazena apenas metadados não secretos por organização: nome da conta, Phone Number ID, Business Account ID, número exibido, versão da Graph API, estado, versão e timestamps.

Os segredos `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` são exclusivamente server-side. Eles não são persistidos no PostgreSQL, retornados pelas APIs ou enviados ao navegador. A interface informa somente se cada segredo está presente.

A migration `018_whatsapp_foundation.sql` cria `whatsapp_integrations` e `whatsapp_webhook_events`. A segunda tabela reserva a chave idempotente do provedor e somente hashes de payload; nenhum corpo de mensagem é armazenado nesta etapa. As duas tabelas têm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e com privilégios revogados de `PUBLIC`, `anon`, `authenticated` e `service_role`.

O endpoint `/api/whatsapp/webhook` suporta a verificação do webhook apenas quando o token de verificação está configurado. `POST` permanece bloqueado com HTTP 503 durante a Fase 8.1, portanto eventos e mensagens reais não são aceitos nem processados.

O helper de telefone retorna o valor original, dígitos normalizados, formato E.164 e validade. Ele não migra nem regrava cadastros existentes. A ação futura de WhatsApp em leads, clientes, empresas e oportunidades exige número válido, permissão `whatsapp.use` e integração marcada como conectada com secrets mínimos presentes.

Para a etapa seguinte será necessário configurar no ambiente protegido da Cloudflare os três secrets acima e, no painel da Meta, a conta WhatsApp Business, o número, o aplicativo, a URL de webhook e as assinaturas de eventos. Nenhuma dessas configurações externas pertence à Fase 8.1.
