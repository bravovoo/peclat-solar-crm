# Fase 9 — Estabilidade operacional

## 9.1 Monitoramento e alertas internos

O CRM executa uma verificação operacional a cada cinco minutos no Cron Trigger já existente. A rotina roda depois do processamento das filas de webhook, exclusão de Storage e automações, sem criar um serviço externo ou expor credenciais.

A migration `026_operational_monitoring.sql` cria o estado da última verificação e incidentes deduplicados por organização. São observados: webhooks do WhatsApp parados ou com falha, exclusões pendentes do Storage, jobs de automação recentes, tentativas de e-mail, envios de WhatsApp com resultado incerto ou falhas recorrentes e indisponibilidade recorrente do provedor de IA. Falhas históricas antigas não abrem incidentes novos.

Administradores recebem `operations.read` e `operations.manage`. Em **Configurações → Monitoramento operacional**, podem consultar integrações e filas, reconhecer um incidente e acompanhar sua resolução automática. Reconhecer não encerra o alerta: a rotina só o marca como resolvido quando a condição deixa de existir. Títulos e detalhes guardam apenas códigos e contagens seguras, sem telefone, mensagem, documento, prompt, token ou secret.

As tabelas `operational_monitor_status` e `operational_alerts` têm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios para `PUBLIC`, `anon`, `authenticated` ou `service_role`. O backend continua acessando PostgreSQL exclusivamente pela conexão privilegiada via Hyperdrive em produção.

Esta etapa não envia alertas por WhatsApp ou e-mail. O painel interno e os eventos estruturados da Cloudflare são os canais iniciais; canais externos devem ser adicionados apenas depois de definir destinatários, escalonamento e política de ruído.

## 9.2 Alertas externos e escalonamento

Administradores podem configurar no mesmo painel alertas operacionais por e-mail para até cinco destinatários. A configuração é isolada por organização, exige SMTP no ambiente e permite escolher severidade mínima, aviso de recuperação e o intervalo de escalada de incidentes críticos não reconhecidos.

A migration `027_operational_notifications.sql` cria a configuração e a fila persistente de entregas. Abertura, escalada e recuperação são deduplicadas por incidente e destinatário. Uma escalada é criada apenas uma vez, e reconhecer o incidente impede a escalada. Envios ficam registrados como pendentes, processando, enviados, falhos ou de confirmação incerta; um envio que ficou processando não é repetido automaticamente, evitando duplicidade após resultado externo ambíguo.

O conteúdo enviado inclui somente título, severidade e contagens seguras já presentes no incidente. Endereços não são registrados nos logs da Cloudflare, e credenciais SMTP continuam exclusivas do runtime. WhatsApp não é usado como canal de alerta, evitando depender da própria integração que pode estar indisponível.

As novas tabelas mantêm RLS ativa, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios diretos para a Data API. Os testes usam um provedor SMTP simulado e não enviam e-mails reais.

## 9.3 Recuperação Automática de Leads

A recuperação de leads reutiliza integralmente a integração oficial existente com o WhatsApp, o catálogo de modelos aprovados, o webhook, o histórico de conversas e o Cron Trigger do Worker. A funcionalidade permanece desativada por padrão e só pode ser ativada por administrador quando a integração estiver conectada e o envio externo global estiver habilitado.

A migration `028_lead_recovery.sql` cria configuração e sequência por organização, registro de consentimento explícito por lead, acompanhamentos, tentativas persistentes e notificações internas. Na lógica atual de ciclos da migration 035, o marco é a última saída da empresa, manual ou de automação normal; mensagens da própria recuperação não reiniciam o prazo. Leads nunca contatados ou aguardando resposta da empresa não entram. Negociação concluída, proposta aceita, tarefa futura, opt-out, contato bloqueado, responsável inativo e etapa fora da configuração impedem o agendamento.

Cada tentativa usa exclusivamente um modelo aprovado e suportado da própria organização. Parâmetros podem usar o primeiro nome sanitizado do lead, com fallback seguro quando o cadastro não possui nome utilizável. A fila usa bloqueio concorrente, identificador idempotente e revalida autorização, elegibilidade, horário, conversa e configuração imediatamente antes do envio. Uma recusa explícita da Meta pode ser repetida de forma controlada no mesmo registro, por até três tentativas; resultado incerto ou aceitação sem confirmação local nunca é repetido automaticamente. Uma resposta inbound encerra a sequência na mesma transação do webhook, cancela tentativas futuras e notifica o vendedor; entrega, leitura e mensagens outbound do CRM ou do Business App não contam como resposta.

O painel **Recuperação de Leads** oferece indicadores, filtros, simulação sem ação externa, horários, vendedores, etapas e sequência configuráveis. No cadastro do lead, a autorização é registrada sem ação do vendedor quando existe evidência explícita verificável: resposta afirmativa contextual ao pedido automático ou a outra solicitação explícita, resposta textual inequívoca “Sim, autorizo” quando o último outbound foi o pedido automático, ou seleção verdadeira de um componente `OptIn` em um Flow enviado pelo CRM. Um “sim” ambíguo sem contexto ou um campo que não seja `OptIn` não libera marketing. O vendedor pode descadastrar, pausar, cancelar, reagendar ou retomar, mas não pode conceder manualmente opt-in. A autorização histórica não é alterada; opt-out posterior continua bloqueando até um novo aceite explícito com data mais recente. Todas as tabelas novas usam RLS, sem `FORCE ROW LEVEL SECURITY`, sem policies públicas e sem privilégios diretos para `PUBLIC`, `anon`, `authenticated` ou `service_role`.

### Identidade de contatos originados no WhatsApp

- Toda mensagem inbound válida resolve uma identidade por `organization_id + wa_id` dentro da mesma transação do webhook.
- Um número novo cria um Lead sem responsável, com origem `WhatsApp`, e vincula imediatamente conversa, histórico e identidade canônica.
- Números já existentes são comparados de forma normalizada, inclusive em contatos relacionados; uma correspondência única é reutilizada e ambiguidades não são mescladas automaticamente.
- Mensagens outbound e `smb_message_echoes` nunca criam Leads. Reprocessamentos permanecem idempotentes pelo ID da Meta e pela identidade WhatsApp.
- O contato iniciado pelo cliente é registrado como atendimento pelo WhatsApp, separado do consentimento para marketing. A recuperação só prossegue após `opted_in` com origem registrada por evidência explícita; a definição atual do Flow de orçamento não contém um componente `OptIn` para marketing.
- A migration `034_whatsapp_contact_identity.sql` corrige conversas inbound antigas: reutiliza somente correspondências fortes, marca ambiguidades e cria Lead apenas quando não existe candidato.
- Formatações com espaços, parênteses, hífens, `+55` ou número nacional usam a mesma forma canônica. Alterações inferidas de nono dígito não são feitas automaticamente.

### Ciclos de inatividade e janela de envio

A migration `035_lead_recovery_cycles.sql` vincula cada ciclo à mensagem outbound que iniciou a espera e registra snapshot imutável da sequência e dos horários. A varredura automática considera o histórico real da conversa: inbound mais recente significa atendimento aguardando a empresa; outbound humana ou de automação normal inicia a contagem. Mensagens da própria recuperação não reiniciam o relógio.

A sequência é absoluta desde a mensagem-base: D+2 usa `peclat_recuperacao_lead_1`, D+5 usa `peclat_recuperacao_lead_2`, D+7 usa `peclat_recuperacao_lead_3` e D+10 usa novamente `peclat_recuperacao_lead_3`. A posição da etapa participa da idempotência e o ciclo termina após a quarta tentativa. Os envios só ocorrem entre 10h e 14h em `America/Sao_Paulo`, nos dias habilitados; vencimentos fora da janela ficam pendentes para o próximo horário permitido sem consumir tentativa.

Antes de cada envio, o Worker revalida consentimento, contato, telefone, conversa, mensagem-base, modelo aprovado, configuração, controles globais e ausência de resposta. O webhook e a fila seguem a mesma ordem de bloqueios para uma resposta concorrente cancelar etapas futuras. Uma nova mensagem normal da empresa pode iniciar outro ciclo; resposta do cliente encerra o ciclo atual e mantém o histórico. Tentativas registram marco, elegibilidade, etapa, fuso, modelo, resultado, ID da Meta e motivo seguro.

### Revisão funcional e de segurança da recuperação

- O consentimento explícito verificável permanece obrigatório. Se a Recuperação e o outbound global estiverem ativos, um cron de cinco em cinco minutos seleciona conversas abertas com Lead ativo, preferência desconhecida, inbound nas últimas 24 horas e resposta normal da empresa após esse inbound. Envia uma única pergunta interativa pela Cloud API: “Podemos continuar enviando pelo WhatsApp atualizações e lembretes sobre seu atendimento e orçamento da Peclat Solar?”, com botões “Sim, autorizo” e “Não quero”. A reserva persistida por conversa impede repetição entre crons e workers; resposta afirmativa com contexto registra opt-in, resposta negativa registra opt-out e resposta ambígua não concede autorização. Com consentimento ou opt-out, não há novas perguntas automáticas. O pedido não conta como mensagem-base da recuperação e não reabre a janela de atendimento.
- Descadastramento por resposta interativa (inclusive o botão “Não quero”) segue a mesma proteção de uma resposta textual: cancela o ciclo, bloqueia novos envios e preserva o histórico de autorização.
- Reagendar atualiza também a tentativa pendente, impedindo que a fila use a data antiga. Reagendamento/retomada durante uma tentativa em processamento retorna conflito, sem alterar o envio em curso.
- O indicador de envios respeita a carteira autorizada do usuário, usando o mesmo escopo comercial dos Leads.
- Os testes usam banco temporário e Meta simulada para sequência completa, idempotência, workers concorrentes, inbound, janela, opt-out, ausência de autorização, reagendamento, permissões e isolamento. Nenhuma migration nova é necessária para estas correções.
