# FASE 6.1 — base de gestão de instalações

## Entrega

Uma instalação pertence obrigatoriamente a um contrato da mesma organização. O banco permite somente uma instalação por contrato, com número `INST-` seguido do número contratual. O cadastro só aceita contratos assinados, ativos ou concluídos. Cliente e oportunidade são identificados pelo contrato; os itens vendidos são lidos de `contract_items` na página da instalação, sem cópia do catálogo.

Campos: responsável, equipe, endereço, datas prevista/agendada/de início/de conclusão, observações, autor, timestamps e versão. Os status são aguardando agendamento, agendada, aguardando equipamento, em execução, pendência, concluída e cancelada. Conclusão e cancelamento exigem `installations.manage`; alterações operacionais exigem `installations.edit`. Registros concluídos ou cancelados não podem ser editados. Cada criação, alteração relevante e mudança de status gera snapshot em `installation_history` e atividade no histórico do cliente. A oportunidade vinculada tem sua data de última atividade atualizada.

## Acesso e interface

- Administrador e gerente: visualizam todas as instalações e podem criar, editar e gerenciar.
- Vendedor: visualiza e edita instalações próprias ou de seus contratos, e cria instalações para contratos próprios. Não conclui nem cancela.
- Atendimento: visualiza instalações de contratos próprios ou atribuídas a si.
- Técnico: visualiza instalações atribuídas, edita, gerencia andamento e pode reatribuir a outro membro ativo com permissão de leitura.
- Pós-venda: sem acesso inicial.

`/instalacoes` contém pesquisa, filtro e paginação; `/instalacoes/nova`, `/instalacoes/{id}` e `/instalacoes/{id}/editar` cobrem o fluxo. O contrato exibe acesso à instalação vinculada e a página do cliente lista suas instalações. A navegação principal mostra o módulo apenas para quem possui `installations.read`.

## Banco e operação

`db/migrations/011_installations.sql` cria `installations` e `installation_history`, quatro permissões e seus vínculos aos perfis. As duas tabelas usam RLS habilitada, sem política aberta, e retiram acesso direto dos papéis da Data API, conforme a migration 010. O backend mantém conexão PostgreSQL via Hyperdrive na Cloudflare e `DATABASE_URL` local. A migration 010 não foi modificada.

A migration 011 já foi aplicada no Supabase de produção. A Fase 6.1 está em uso.

## Fases 6.2 e 6.3 — execução, pendências e entrega

`db/migrations/012_installation_execution.sql` cria `installation_checklist_items`, `installation_files`, `installation_issues`, `installation_completions` e `installation_deliveries`. O checklist possui 16 itens iniciais por instalação, inclusive as existentes, com progresso, observação, autor, horário e versão por item. O encerramento registra um snapshot do checklist e das pendências, observações finais e usuário. Checklist incompleto é mostrado ao responsável; pendências abertas exigem confirmação explícita. Pendências existentes continuam resolvíveis depois da conclusão. A entrega/aceite simples só pode ser registrada após conclusão, sem assinatura eletrônica.

Fotos e documentos da instalação usam o mesmo provedor e bucket privado dos PDFs comerciais, mas têm metadados próprios em `installation_files`, pois `crm_documents` exige orçamento, validade e oportunidade. São permitidos PNG, JPEG, WEBP para fotos e PDF, PNG, JPEG, WEBP, XLSX, XLS, CSV, DOCX, DOC e TXT para documentos, até 10 MB. O servidor confere extensão, MIME e assinatura/conteúdo; downloads autenticados verificam SHA-256. A exclusão é lógica no banco, remove o objeto e gera histórico. Em produção, o bucket existente está privado e sem filtro de MIME ou limite próprios; o backend aplica essas restrições. `pnpm storage:setup` pode sincronizar lista e limite no bucket com credencial exclusiva do servidor.

A página de instalação usa abas Resumo, Checklist, Fotos, Documentos, Pendências, Entrega e Histórico. Cliente e contrato exibem o progresso/status da instalação vinculada. As permissões existentes `installations.read`, `installations.edit` e `installations.manage` cobrem leitura, edição operacional e exclusão/conclusão/entrega; nenhuma permissão nova foi criada. As cinco tabelas novas têm RLS habilitada sem FORCE nem políticas públicas e têm privilégios da Data API revogados para PUBLIC, anon, authenticated e service_role. A conexão PostgreSQL privilegiada do backend continua pelo Hyperdrive.

## Fase 6.4 — garantias, chamados, manutenção e pós-venda

`db/migrations/013_post_sales.sql` acrescenta nove tabelas sem modificar as migrations 001–012: `post_sales_ticket_sequences`, `post_sales_warranties`, `post_sales_tickets`, `post_sales_ticket_history`, `post_sales_warranty_claims`, `post_sales_maintenances`, `post_sales_maintenance_items`, `post_sales_files` e `post_sales_task_links`.

Garantias pertencem a uma instalação e podem apontar para o item vendido no contrato. A situação efetiva é calculada pela data de validade em fuso de São Paulo: ativa, próxima do vencimento, vencida, acionada, encerrada ou cancelada. O acionamento exige garantia e chamado da mesma instalação, guarda fornecedor, protocolo, resultado e histórico; uma garantia acionada não retorna ao estado vigente.

Cada chamado recebe um identificador anual atômico no formato `POS-AAAA-000001`, tem prioridade, categoria, responsável, prazo, status, resolução, timeline de alterações e comentários internos. Chamados fechados ou cancelados exigem gestão; para resolver ou fechar é necessário registrar a resolução. Eles podem ser reabertos e vinculados a tarefas existentes do mesmo cliente, sem criar uma agenda paralela.

Manutenções pertencem a uma instalação e podem ser vinculadas ao chamado e à garantia correspondentes. O registro contém motivo, descrição, responsável, datas, status, custo interno, valor cobrado, gratuidade/cobertura de garantia, resultado e itens/serviços executados. Conclusão ou cancelamento exige gestão; conclusão exige data executada e serviço realizado.

Anexos de garantia, chamado e manutenção usam o bucket privado já existente `peclat-crm-documents`, com a mesma credencial exclusiva de servidor, limite de 10 MB, conferência de formato/MIME/assinatura e SHA-256 dos arquivos de instalação. Os metadados ficam em `post_sales_files`; download passa pelo backend com sessão e autorização, e exclusão é lógica no banco antes da remoção do objeto. Não há URL pública, segredo exposto ao navegador ou alteração no provedor de documentos.

As permissões novas são `post_sales.read`, `post_sales.create`, `post_sales.edit` e `post_sales.manage`. Administrador, gerente e pós-venda têm gestão; atendimento e técnico têm leitura/criação/edição dentro do escopo; vendedor tem leitura/criação. O escopo de leitura e escrita limita registros ao responsável, cliente, contrato ou instalação atribuídos ao usuário, salvo `post_sales.manage`. As nove tabelas têm RLS habilitada, sem `FORCE ROW LEVEL SECURITY`, sem políticas abertas e com privilégios diretos revogados de `PUBLIC`, `anon`, `authenticated` e `service_role`. O backend mantém a conexão privilegiada existente via Hyperdrive na Cloudflare.

`/pos-venda` reúne indicadores, busca e filtros; detalhes integram cliente, contrato, instalação, garantias, chamados, timeline, acionamentos, manutenções, itens, anexos e tarefas. Cliente, contrato e instalação exibem o pós-venda agregado somente a quem já tem a permissão correspondente. A interface foi ajustada para desktop e 390 px sem rolagem horizontal indevida.

## Fora deste bloco

Manutenção, garantias, chamados de pós-venda, WhatsApp, automações, notificações, assinatura eletrônica externa, portal do cliente, monitoramento de geração e Fase 7.
