# FASE 7.1 — Equipe comercial e vendedores

O vendedor continua sendo um usuário de `users` com um `membership` da organização e papel `seller`. Os papéis `admin` e `manager` existentes representam administrador e gerente comercial; nenhuma credencial ou cadastro paralelo foi criado. Os campos `owner_id` em leads, clientes, empresas, oportunidades e tarefas, e `responsible_user_id` em contratos, continuam como fonte dos responsáveis. As opções existentes de responsável já filtram organização, usuário e vínculo ativos e permissões comerciais.

`db/migrations/014_commercial_teams.sql` cria `commercial_teams`, `commercial_team_members` e `commercial_team_history`. Equipes têm nome, descrição, gerente, estado, versão e timestamps. O gerente precisa ser um membro ativo com papel `manager`; o vendedor precisa ser um membro ativo com papel `seller`. A chave primária `(organization_id,user_id)` em `commercial_team_members` limita cada vendedor a uma equipe por organização. Para transferi-lo, remova a associação anterior e adicione à nova equipe. Desativar equipe preserva a associação e o histórico; a equipe não aceita novos membros enquanto inativa.

A página `/equipe` exibe equipes, gerente, membros, estado e indicadores operacionais por responsável. Administrador e gerente podem criar e editar equipes, definir o gerente, adicionar/remover vendedores e desativar/reativar. O vendedor vê somente seu perfil e a equipe a que pertence. A página não cria usuários, altera papéis ou redistribui registros de um usuário desativado. Alterações relevantes entram em `commercial_team_history` e `audit_logs`; edições de equipe usam versão para detectar conflito.

As permissões novas são `commercial_team.read` para administrador, gerente e vendedor, e `commercial_team.manage` para administrador e gerente. As três tabelas têm RLS habilitada sem `FORCE` ou políticas públicas, com privilégios diretos revogados de `PUBLIC`, `anon`, `authenticated` e `service_role`. O backend segue usando PostgreSQL privilegiado via Hyperdrive.

Na entrega 7.1, o gerente ainda tinha acesso comercial à organização inteira. A etapa 7.2 abaixo restringe esse acesso de forma coordenada, mantendo as permissões existentes.

Antes de disponibilizar a interface em produção, aplique a migration 014. O comando de migração registra nome e checksum em `schema_migrations`; não altera migrations 001–013.

## FASE 7.2 — Carteira, distribuição e visibilidade

A carteira reutiliza `owner_id`, usuários, memberships e equipes da 7.1. Não existe tabela paralela de carteira nem nova permissão. `commercial/scope.ts` centraliza a restrição por organização e responsável: administrador vê a organização; gerente vê os próprios registros e os dos membros de suas equipes ativas; os demais perfis comerciais com escopo próprio veem seus registros. Sessões de usuários/memberships inativos continuam recusadas pela autenticação existente. A gestão conserva o histórico dos vendedores inativos enquanto associados à equipe.

O escopo é aplicado a leads, clientes, empresas, oportunidades, pipeline, tarefas, agenda, follow-up, busca, exportação e indicadores comerciais. Os filtros disponíveis são Meu, Minha equipe, Todos (administrador), Sem responsável (leads da gestão), responsável e equipe. Leads sem responsável ficam disponíveis à gestão da organização e não aos vendedores. Clientes e empresas continuam exigindo responsável.

Responsáveis de cadastros e oportunidades continuam independentes. Uma oportunidade autorizada pode preservar o nome/vínculo de um cliente de outra carteira; isso não concede acesso ao cadastro, suas notas ou sua busca. Não se propagam permissões ou mudanças de responsável automaticamente por esses vínculos. Contratos mantêm seu escopo anterior: editar um contrato autorizado preserva os vínculos originais mesmo fora da carteira comercial, com validação de organização, cliente ativo e correspondência da oportunidade; selecionar vínculos novos exige acesso comercial. Instalações e pós-venda não recebem um novo escopo nesta etapa.

`commercial_team.manage`, já atribuída a administrador e gerente, autoriza atribuição manual de um ou até 100 leads por lote, configuração do round-robin e transferência de carteira. Destinatários precisam ser vendedores ativos da organização; gerente só atribui a vendedores de suas equipes ativas. Seleções repetidas, versões desatualizadas e leads indisponíveis rejeitam o lote inteiro. O seletor de membros da equipe usa candidatos ativos sem equipe contendo apenas ID/nome, sem revelar indicadores de carteiras externas.

A distribuição automática é opcional por equipe. Após ativá-la em Equipe comercial, a gestão seleciona leads sem responsável e executa Distribuição automática. O cursor persistido alterna vendedores ordenados por ingresso/ID, excluindo usuários e memberships inativos. Remoção da equipe impede novas atribuições. Não há redistribuição retroativa nem automação na criação de cada lead. Transação, bloqueio por organização, equipe e leads, e versões impedem dupla distribuição concorrente.

Transferir carteira exige confirmação e move cadastros não excluídos, oportunidades e tarefas entre vendedores autorizados. A origem pode estar inativa; o destino precisa estar ativo. Snapshots de vendas fechadas e responsáveis de contratos, instalações e pós-venda permanecem preservados. A transferência bloqueia tarefas antes de oportunidades, compatível com a edição de tarefas, evitando deadlock. Atribuições, mudanças de responsável, configuração e transferências registram histórico e auditoria com autor e data; detalhes de transferência identificam origem e destino.

### Migration 015

`015_commercial_distribution.sql` permite `owner_id` nulo apenas para leads, cria `crm_records_unassigned_leads_idx` e acrescenta `auto_distribute` e `distribution_cursor` a `commercial_teams`. Não cria tabelas, não redistribui dados existentes e não modifica migrations 001–014. RLS, ausência de FORCE/políticas e revogações de PUBLIC/anon/authenticated/service_role permanecem nas tabelas protegidas por 010/014. O SQL é de execução única pelo runner transacional, que registra e verifica checksum SHA-256 em `schema_migrations` e ignora migrations já aplicadas.

### Validação e limites

Testes de integração cobrem contagens exatas por perfil/organização, filtros, clientes/empresas, busca, pipeline, tarefas/follow-up, lote atômico, inatividade, concorrência no mesmo lead, transferência, snapshots e auditoria. Há regressões específicas para concorrência entre transferência/edição de tarefa e edição de contrato com vínculos preservados. Os cenários Playwright da 7.2 cobrem as telas, atribuição individual/em lote, round-robin, transferência e resoluções 390x844 e 1440x900.

Na validação final, passaram 72 testes unitários/de integração e 24 cenários Playwright. TypeScript, lint, build Next.js, bundle OpenNext/Cloudflare, dry-run do Wrangler e `git diff --check` também passaram. A migration 015 foi validada em bancos temporários com as migrations 001–014 e deve ser aplicada pelo runner somente depois da publicação do código.

## FASE 7.3 — Metas e desempenho comercial

As metas reutilizam os vendedores, equipes e escopos das Fases 7.1 e 7.2. `commercial_goals` armazena somente organização, destinatário (vendedor ou equipe), indicador, periodicidade, datas e valor alvo. Resultados não são persistidos: valor vendido e contratos usam contratos assinados/ativos/concluídos e `signed_at`; oportunidades ganhas usam `closed_at` e o responsável preservado no fechamento; novos clientes usam os cadastros existentes no período. `commercial_goal_history` preserva criação e edição com valor anterior, novo valor, autor, data e snapshot.

Os períodos aceitos são mensal, trimestral e anual, sempre com limites completos e validados. Os indicadores são valor vendido, contratos fechados, oportunidades ganhas e novos clientes. A página `/desempenho` também agrega leads recebidos e trabalhados, clientes, oportunidades abertas/ganhas/perdidas, contratos, valor contratado, ticket médio, tarefas abertas/concluídas e conversão. As consultas usam agregações por responsável no PostgreSQL, sem uma consulta por vendedor e sem duplicar dados financeiros.

Administrador vê a organização; gerente vê metas e vendedores das equipes ativas que gerencia; vendedor vê somente suas metas e desempenho. Metas de equipe são apresentadas ao gerente responsável e ao administrador. Filtros por período, equipe e vendedor respeitam o mesmo limite. Não há acesso entre organizações ou equipes.

`016_commercial_goals.sql` cria `commercial_goals` e `commercial_goal_history`, índices por período/destinatário e as permissões `commercial_goals.read` e `commercial_goals.manage`. As tabelas usam RLS sem FORCE ou políticas públicas e revogam privilégios de PUBLIC, anon, authenticated e service_role. A gestão recebe leitura e edição; vendedores recebem somente leitura.

Na validação local, passaram 73 testes unitários/de integração e 25 cenários Playwright, incluindo 390x844 e 1440x900. TypeScript, lint, build Next.js, bundle OpenNext/Cloudflare, dry-run do Wrangler e `git diff --check` também fazem parte da validação final. A migration 016 foi validada em bancos temporários com as migrations anteriores antes da aplicação remota.

Comissões, bônus, ranking, gamificação, cadastro público, WhatsApp, automações e Fase 7.4 não fazem parte desta entrega.

## FASE 7.1.1 — Gestão interna de usuários

A gestão interna reutiliza `users`, `memberships`, `roles`, `role_permissions`, sessões, recuperação de senha e equipes comerciais. Não existe cadastro público ou uma segunda fonte de identidade. Somente o administrador com `users.read` e `users.manage` acessa `/configuracoes/usuarios`, cria membros da própria organização, define função, ativa ou suspende o vínculo e redefine o acesso. As funções disponíveis são administrador, gerente comercial, vendedor, técnico, atendimento e pós-venda.

Ao criar ou redefinir um acesso, o servidor gera uma senha temporária criptograficamente aleatória, persiste apenas o hash scrypt com salt e devolve a senha uma única vez na resposta autenticada. A interface mostra essa credencial somente até o administrador fechar o aviso ou sair da página. Redefinir acesso invalida sessões e recuperações anteriores. O fluxo existente de recuperação de senha continua disponível quando o transporte de e-mail estiver configurado. Esta etapa não adiciona uma troca obrigatória no primeiro login; essa limitação fica explícita para evitar um estado de autenticação paralelo.

Desativar um membro usa o vínculo da organização, encerra suas sessões e o retira das opções de novas atribuições e do round-robin, preservando registros, equipes e histórico. Gerentes e vendedores ativos aparecem automaticamente na Equipe Comercial. A troca de função é bloqueada enquanto um gerente ainda administra uma equipe ou um vendedor ainda pertence a uma equipe. O administrador não pode alterar a própria função/status nem redefinir o próprio acesso pela tela. E-mail continua único globalmente e alterações de nome ou credencial global exigem que a conta pertença somente à organização atual.

`017_internal_users.sql` acrescenta versão concorrente a `memberships`, identifica o usuário afetado e o detalhe em `audit_logs` e cria as permissões `users.read` e `users.manage` exclusivamente para o papel administrador. Não cria tabelas públicas. `audit_logs` e `memberships` permanecem sob o RLS e as revogações estabelecidas pela migration 010, sem `FORCE RLS`, políticas públicas ou acesso direto de PUBLIC, anon, authenticated e service_role. Criação, nome, função, ativação, desativação e redefinição entram na auditoria com autor, usuário afetado e data.
