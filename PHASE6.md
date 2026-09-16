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

Antes de usar a Fase 6.1 em produção, aplique a migration 011 no Supabase com o processo de migração existente. Esta entrega não aplica a migration no banco remoto. Após a aplicação, confirme criação a partir de contrato assinado, edição, status, histórico e visibilidade por perfil.

## Fora desta etapa

Fotos, checklist técnico, assinatura do cliente, garantia, manutenção, pós-venda, WhatsApp e automações.
