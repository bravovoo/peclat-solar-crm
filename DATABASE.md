# Banco de dados

PostgreSQL. Migrations SQL incrementais, transacionais, com lock de execução e checksum. Não executar sincronização destrutiva do schema.

FASE 1: organizations, users, roles, permissions, role_permissions, memberships, sessions, password_resets, rate_limits e audit_logs. Usuário pode pertencer a mais de uma organização; papel é por associação. Sessão referencia associação por chave composta. Auditoria é por organização. Índices cobrem sessões, expiração e auditoria cronológica.

Seed idempotente cria Peclat Solar, seis perfis e permissões. Conta administradora requer senha explícita em variável de ambiente, sem senha padrão. Reexecutar seed não altera senha existente.

## Estrutura implementada

| Tabela | Responsabilidade e integridade |
|---|---|
| schema_migrations | Arquivo aplicado, SHA-256 e data. Migração alterada após aplicação é rejeitada. |
| organizations | UUID, slug único e nome. |
| users | Identidade global, e-mail normalizado único, hash scrypt, nome e status. |
| memberships | PK organization_id + user_id, papel e ativação local. |
| roles / permissions / role_permissions | Catálogo global e concessões explícitas. Sem wildcard. |
| sessions | Hash do token como PK, validade, FK composta da associação. |
| password_resets | Hash do token, validade e FK composta; consumo transacional. |
| rate_limits | Hash de chave, contagem e validade. Upsert atômico. |
| audit_logs | Organização, ator opcional com FK composta, ação e data. |

Perfis iniciais:

| Perfil | Acesso nesta fase | Permissões reservadas para fases futuras |
|---|---|---|
| Administrador | CRM completo da organização, tags, duplicados, exclusão, equipe, configurações e auditoria | WhatsApp, instalação e pós-venda |
| Gerente Comercial | CRM da organização, duplicados, exclusão, dashboard e equipe | WhatsApp |
| Vendedor | CRM e indicadores dos registros próprios | WhatsApp |
| Atendimento | CRM e indicadores dos registros próprios | WhatsApp |
| Técnico | Dashboard base | Instalações |
| Pós-venda | Dashboard base | Pós-venda |

Exclusões de registros referenciados são restritas por padrão; não há cascata que apague histórico. E-mail é global porque a mesma identidade pode participar de várias organizações. Associações e sessões explicitam a organização selecionada no login.

As migrations foram aplicadas em PostgreSQL 18.4 local via binários auxiliares; Docker Compose aponta PostgreSQL 17 e não foi executado nesta máquina. O SQL usa recursos comuns às duas versões. A aplicação não usa a conta de desenvolvimento como recomendação de privilégio para produção.

Demais tabelas do domínio solar/WhatsApp serão adicionadas em suas fases, sempre com organization_id e FKs compostas para relacionamentos internos. Dados de outro tenant não podem ser acessados por IDs enviados pelo navegador.

## Migration 002_commercial_core.sql

Adição de oito tabelas, sem recriar ou remover tabelas/dados da FASE 1:

| Tabela | Responsabilidade |
|---|---|
| crm_records | Lead/cliente/empresa; responsável, dados de contato, endereço, perfil comercial e solar, version, status e deleted_at. |
| crm_tags | Tags da organização, nome único sem diferença entre maiúsculas/minúsculas e cor validada. |
| crm_record_tags | Associação de cadastro e tag com FKs compostas. |
| crm_contacts | Contatos independentes, cargo, canais e observações. |
| crm_record_contacts | Vínculos a cadastros, permitindo reutilização na conversão; índice garante no máximo um principal por cadastro. |
| crm_notes | Nota interna, cadastro, autor e data. |
| crm_tasks | Tarefa simples, cadastro, responsável, prazo e data de conclusão. |
| crm_activities | Timeline por cadastro, ação, autor, data e detalhe. |

Todas possuem organization_id. Responsáveis referenciam memberships; vínculos internos têm FKs compostas. A coluna original_lead_id é única por organização e referencia um registro kind=lead; somente um cliente pode apontar para cada lead. Valor e consumo usam numeric. Exclusão lógica não apaga atividades; a exclusão de tag remove somente seus vínculos.

Índices incluem organização/tipo/status/data, responsável, identidades normalizadas e trigramas para busca textual (extensão pg_trgm). O usuário de migrations precisa poder instalar essa extensão. A migration também concede crm.duplicate.override e crm.delete a administrador/gerente, e crm.tags.manage ao administrador. O seed de acesso mantém essas permissões em instalações novas.

Telefones nacionais de 10/11 dígitos recebem prefixo 55; CPF/CNPJ são armazenados sem máscara. CNPJ aceita letras maiúsculas nas 12 primeiras posições e dois dígitos verificadores, com cálculo módulo 11 usando ASCII menos 48, conforme [manual técnico da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). Nenhum documento real é usado no seed demo.

O banco local herdado é WIN1252. Foi mantido intacto; texto incompatível recebe HTTP 422 e rollback. Novos clusters de testes/desenvolvimento usam UTF-8. Conversão de codificação do banco antigo não faz parte desta migration e exige planejamento próprio.

## Migration 003_commercial_operations.sql

- crm_opportunities: vínculos tipados com cadastros/contato, proprietário, etapa/status, valor, probabilidade, prioridade, origem, datas, motivo de perda, observações, versão e snapshot do fechamento. organization_id em todas as relações; índices por responsável/status, etapa, previsão, criação, atualização e inatividade; trigramas no título.
- crm_commercial_settings: uma configuração por organização, inactive_days entre 1 e 365 (padrão de leitura 7). Alteração pela gestão é auditada.
- crm_tasks: preservada e ampliada com opportunity_id, description, priority, status, due_date, due_time, updated_at e version. Tarefas antigas recebem datas/horários e status derivados de due_at/completed_at. Nenhuma tarefa é removida.
- crm_notes e crm_activities: recebem opportunity_id; record_id fica opcional, mas CHECK exige exatamente um vínculo. Índices por oportunidade e data.
- crm_records: recebe is_demo, inicialmente false; a migration marca somente os quatro exemplos conhecidos do seed anterior. crm_opportunities também tem is_demo, derivado e validado no serviço. Conversão lead/cliente preserva a classificação.

A migration 003 foi aplicada incrementalmente no banco local e testada em clusters isolados. As migrations 001 e 002 permanecem intactas. O banco local continua WIN1252, conforme a limitação registrada na FASE 2.

Sem tabelas de contratos, pagamentos, instalação, WhatsApp ou cálculo solar. O vínculo futuro de proposta deve apontar para a oportunidade por chave composta, não duplicar seus dados de identidade.

## Migration 004_energy_consumption.sql

- `energy_consumer_units`: unidades vinculadas por FK composta a um `crm_records.kind=customer`, com distribuidora, números de UC/instalação, titular, grupo tarifário, ligação, tensão, endereço, status, classificação DEMO e versão.
- `energy_monthly_consumption`: uma linha por unidade/mês, com consumo kWh, energia injetada, demanda máxima, dias faturados, origem e observações.
- `energy_bills`: uma fatura por unidade/mês, com valor `numeric(14,2)`, número, emissão, vencimento, bandeira, leituras e observações.
- Constraints impedem valores negativos, datas/leitura invertidas, mês fora do primeiro dia, vínculos cruzados e duplicidade mensal. Índices cobrem cliente/status e históricos em ordem decrescente.

A migration 004 é incremental e não altera as tabelas das FASES 1–3. Ela não criou dimensionamento, equipamento, kit, proposta, contrato, pagamento ou instalação.

## Migration 005_solar_sizing.sql

- `solar_sizings`: memória imutável do cálculo com unidade, cliente, autor, versão da fórmula, snapshot dos até 12 meses usados, consumo médio, margem, irradiação, desempenho, potência do módulo e todos os resultados.
- FK composta garante que unidade e cliente correspondem; o autor deve pertencer à mesma organização.
- Constraints validam parâmetros e resultados positivos. Índices atendem ao histórico por unidade e por cliente.

A migration 005 não altera dados de consumo nem cria equipamentos, kits, propostas ou instalações. O histórico é acrescentado a cada execução e não possui atualização ou exclusão pela API.

## Migration 006_solar_catalog.sql

- `solar_equipment`: módulos, inversores, estruturas e componentes com fabricante, modelo, código, potência nominal e características técnicas.
- `solar_kits` e `solar_kit_items`: kit comercial e composição por equipamento/quantidade. Potências são calculadas nas consultas.
- `solar_equipment_history` e `solar_kit_history`: snapshots JSONB de criação, edição, arquivamento e reativação, com autor e data.
- `solar_sizing_kit_selections`: vínculo imutável entre dimensionamento e kit, com quantidade calculada, módulos, potência CC, potência de inversores e snapshot da composição.
- Permissão `solar.catalog.manage` para administrador e gerente. Usuários comerciais mantêm leitura e podem selecionar kit em dimensionamentos acessíveis.

FKs compostas preservam organização, cliente e unidade. Códigos não vazios são únicos por organização. A migration é incremental e não cria propostas, contratos, pagamentos ou instalação.

## Migration 007_manual_documents.sql

- `crm_documents`: metadados do PDF, valor, validade, observação, status, hash SHA-256, tamanho, versão, autor, cliente e oportunidade.
- `crm_document_history`: snapshots JSONB de criação, edição e mudança de status, com autor e data.
- A FK composta `(organization_id, opportunity_id, customer_id)` garante que a oportunidade pertença ao cliente informado.
- O arquivo binário fica no armazenamento privado; o banco guarda somente uma chave física aleatória e metadados de integridade.
- Status permitidos: `draft`, `sent`, `accepted` e `refused`. PDFs têm limite de 10 MB.

A migration é incremental, não altera migrations anteriores e não cria gerador de proposta, contrato, pagamento, instalação ou integração externa.

## Migration 008_document_email.sql

- `crm_document_emails`: entregas aceitas pelo SMTP, com documento, cliente, oportunidade, autor, destinatário, assunto, mensagem, nomes preservados e data.
- FKs compostas garantem a mesma organização e o vínculo correto entre cliente e oportunidade.
- Índices cobrem os históricos por documento, cliente e oportunidade.

Somente envios aceitos pelo SMTP são persistidos. Falhas de configuração ou transporte não são registradas como sucesso e não alteram o documento.
