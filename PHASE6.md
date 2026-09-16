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

## Fora deste bloco

Manutenção, garantias, chamados de pós-venda, WhatsApp, automações, notificações, assinatura eletrônica externa, portal do cliente, monitoramento de geração e Fase 7.
