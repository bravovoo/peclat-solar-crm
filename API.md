# API — FASES 1 e 2

Respostas JSON. Endpoints privados usam cookie peclat_session. Nenhum endpoint confia em organization_id fornecido pelo navegador. O CRM reutiliza a mesma sessão e fronteira de autorização.

| Método | Caminho | Corpo / resultado |
|---|---|---|
| POST | /api/auth/login | organization (slug), email, password. Cria cookie e retorna ok. |
| POST | /api/auth/logout | Objeto vazio. Revoga sessão e remove cookie. |
| POST | /api/auth/recover | organization, email. Resposta genérica de solicitação recebida. Requer SMTP. |
| POST | /api/auth/reset | token, password. Consome token e revoga todas as sessões do usuário. |
| GET | /api/me | Identidade, organização, perfil e permissões efetivas. |
| GET | /api/team | Até 100 membros da organização, ordenados por nome. Exige team.read. |
| GET | /api/health | status ok ou unavailable, sem detalhes internos. |

POST exige Content-Type application/json, Origin exatamente igual a APP_URL e corpo até 16 KiB. Erros retornam error: 400 validação/token inválido; 401 autenticação; 403 origem/permissão; 413 corpo excedido; 415 formato; 429 limite; 503 indisponibilidade. Leituras privadas não são armazenadas em cache.

Login: até 10 tentativas por organização/e-mail em 15 minutos, mais teto global de 300/minuto. Recuperação: 3 por identidade em 15 minutos e 60/minuto global. Reset: 100/minuto global. Contadores são atômicos e compartilhados entre instâncias. Antes de produção adicionar proteção de borda/IP confiável contra exaustão do limite global; não confiar livremente em X-Forwarded-For.

Sessões duram 8 horas. Links de recuperação duram 30 minutos, uso único, substituídos por nova solicitação. Desativação de usuário/associação e mudança de perfil têm efeito nas próximas consultas da sessão.

## Recursos comerciais

Nos caminhos abaixo, {resource} é leads, customers ou companies. IDs são UUIDs; organização nunca vem do corpo. Todos exigem sessão e crm.all ou crm.own.

| Método | Caminho | Resultado/regra |
|---|---|---|
| GET | /api/{resource} | records, total, page, pageSize; filtros abaixo. |
| POST | /api/{resource} | Cria cadastro e atividade; 201 com registro. |
| GET | /api/{resource}/{id} | Registro acessível, tags, responsável e vínculo de conversão. |
| PUT | /api/{resource}/{id} | Substitui campos editáveis; version obrigatório para edição. |
| DELETE | /api/{resource}/{id} | Exclusão lógica; corpo {version}; exige crm.delete. Lead convertido não pode ser excluído. |
| POST | /api/{resource}/{id}/archive | Arquiva; corpo {version}. |
| POST | /api/{resource}/{id}/restore | Reativa; corpo {version}. |
| POST | /api/leads/{id}/convert | Cria cliente e preserva origem; corpo {version}. |
| GET | /api/{resource}/export | CSV UTF-8 com BOM, separador ponto e vírgula; mesmos filtros e escopo; até 10.000. |
| GET | /api/crm-options | Responsáveis comerciais ativos autorizados (até 200) e tags (até 500). |
| GET | /api/search?q=texto | Até 8 resultados em cada grupo lead/customer/company/contacts; mínimo 2 e máximo 120 caracteres. |
| GET | /api/dashboard | Totais leads/new_leads/in_service/customers e grouped.source/stage/owner. |
| GET | /api/tags | Tags da organização. |
| POST | /api/tags | {name,color}; exige crm.tags.manage. |
| PUT | /api/tags/{id} | Edita nome/cor; exige crm.tags.manage. |
| DELETE | /api/tags/{id} | Remove tag e vínculos; corpo {}; exige crm.tags.manage. |
| GET | /api/activities?record_id=UUID&page=1 | Timeline somente leitura, 20 itens por página. |
| GET | /api/notes?record_id=UUID&page=1 | Notas internas, 20 por página. |
| POST | /api/notes | {record_id,body}; grava nota e atividade, sem envio externo. |
| GET | /api/contacts?record_id=UUID&page=1 | Contatos vinculados, 20 por página. |
| POST | /api/contacts | {record_id,name,job_title,phone,whatsapp,email,is_primary,observations}. |
| GET | /api/tasks?record_id=UUID&page=1 | Tarefas do cadastro/origem, 20 por página. |
| POST | /api/tasks | {record_id,title,due_at}; prazo ISO com fuso; responsável herdado do cadastro. |
| POST | /api/tasks/{id}/complete | Corpo {}; conclusão idempotente com autorização no cadastro. |

Filtros: q, owner (UUID), source, stage, temperature, priority, city, state, person_type, tag (UUID), from/to (YYYY-MM-DD), status (active padrão, archived, converted, all). Paginação page=1, pageSize=20 (máximo 100); sort=newest/oldest/name/value. Datas usam America/Sao_Paulo, incluindo integralmente o dia final. CSV neutraliza fórmulas iniciadas por =, +, -, @, inclusive após espaços.

Campos do cadastro: name obrigatório; person_type PF/PJ; document, phone, whatsapp, email, postal_code, address, number, complement, neighborhood, city, state, owner_id, source, campaign, priority, temperature, stage, potential_value, expected_close, observations, average_consumption, utility, property_type, roof_type, consumer_units, battery_interest, financing_interest, trade_name, state_registration, website, tag_ids. companies exige PJ. Esquemas completos/defaults/limites em src/modules/crm/domain.ts. PUT não é PATCH: campos omitidos voltam aos defaults, exceto owner_id que mantém o responsável.

POST/PUT/DELETE exigem Origin=APP_URL, JSON e corpo até 16 KiB. Respostas sem cache. Erros: 400 validação/vínculo inválido; 401 sessão; 403 permissão; 404 registro inexistente ou fora do escopo; 409 versão/duplicidade/conversão inválida; 422 limite de exportação/tags ou caractere incompatível com banco legado; 413/415 formato do corpo; 503 indisponibilidade.

Duplicidade retorna {error,matches,canOverride} com 409. matches só revela cadastros autorizados. Reenviar allow_duplicate=true só funciona com crm.duplicate.override; nunca remove o existente. Gravações são serializadas por organização para evitar corrida entre criação e detecção.

Dashboard exclui arquivados e excluídos. Total de leads inclui convertidos; novos/em atendimento consideram somente ativos. Em atendimento exclui estágios new/won/lost. Agrupamentos mostram até 100 categorias. Histórico do cliente inclui notas, atividades e tarefas do lead original; contatos são vinculados na conversão. Não há endpoint de importação, upload, oportunidade ou envio de WhatsApp.

## FASE 3 — operação comercial

Mantém autenticação, Origin, JSON, limite de corpo, erros e isolamento anteriores. crm.all permite a organização; crm.own limita oportunidades/tarefas ao próprio responsável. IDs de outra organização não são revelados.

| Método | Endpoint | Uso |
|---|---|---|
| GET / POST | /api/opportunities | Listar/criar oportunidade; criação com lead_id é o fluxo lead → oportunidade, sem criar cliente. |
| GET / PUT | /api/opportunities/{id} | Detalhar/substituir campos comerciais; PUT exige version. |
| POST | /api/opportunities/{id}/stage | {stage,version,loss_reason?}. |
| POST | /api/opportunities/{id}/win | {version}; registra snapshot e probabilidade 100%. |
| POST | /api/opportunities/{id}/lose | {version,loss_reason}; exige motivo válido e probabilidade 0%. |
| GET | /api/opportunities/{id}/activities | Histórico próprio e dos cadastros acessíveis; page, 20 por página. |
| GET / POST | /api/opportunities/{id}/notes | Listar notas / criar {body}. Não envia mensagens. |
| GET | /api/pipeline | Colunas com até 20 cartões, contagens e somas completas. |
| GET | /api/commercial-indicators | Métricas por período e classificação real/DEMO. |
| GET | /api/follow-up | Hoje, atrasadas, inativas, paradas e fechamento próximo. |
| GET / PUT | /api/commercial-settings | Configuração {inactive_days}; PUT somente crm.all. |
| GET / POST | /api/tasks | API existente ampliada: listar por filtros / criar tarefa. |
| GET / PUT | /api/tasks/{id} | Detalhar/editar, PUT exige version. |
| POST | /api/tasks/{id}/status | {status,version?}; interface envia version. |
| POST | /api/tasks/{id}/complete | Compatibilidade com a FASE 2; usa o mesmo serviço de status. |

Oportunidade: title; lead_id/customer_id/company_id (ao menos um); contact_id opcional e pertencente a vínculo; owner_id; stage; estimated_value; probability (0–100); priority; source; opened_on; expected_close; loss_reason; observations. Status e snapshot são derivados no servidor, não aceitos como campos arbitrários. Etapas: new, qualification, opportunity, budget_requested, proposal_sent, negotiation, decision, won, lost. Motivos: price, competitor, no_interest, no_response, timing, financing, postponed, other.

Filtros de oportunidade: q, owner, record_id, stage, priority, source, status=all/open/won/lost, from/to (abertura), demo=real/demo/all, page e pageSize (máximo 100). Padrão demo=real; filtro record_id já identifica o contexto e aceita seus exemplos. Busca global existente inclui grupo opportunities, até 8 por título ou nome/canais dos cadastros vinculados; pode localizar DEMO explicitamente.

Tarefa: title, description, owner_id, priority, status=pending/in_progress/completed/cancelled, record_id OU opportunity_id, due_date e due_time opcional. due_at ISO continua aceito na criação antiga e é convertido para Brasília. Filtros: owner, record_id, opportunity_id, status=all/active ou estado específico, from/to (vencimento), bucket=all/overdue/today/upcoming, demo=real/demo/all, page/pageSize (20 padrão, 100 máximo). Alteração gera histórico.

Indicadores: from/to filtram fechamento de ganhas/perdidas/valor/conversão; padrão mês atual. Abertas, valor do pipeline, tarefas pendentes e inativas refletem o estado atual. demo=real/demo, padrão real. Conversão = ganhas/(ganhas+perdidas), zero quando não há fechadas. Follow-up aceita demo=real/demo e limita cada grupo de oportunidades a 20; tarefas retornam primeira página com total.

A FASE 3 não fornece importação, proposta, contrato, pagamento, instalação ou envio de WhatsApp. Todas as operações são internas ao CRM.

## FASE 4 — consumo energético, etapa 1

Os endpoints mantêm sessão, Origin, JSON, limite de corpo e os mesmos erros. O cliente é autorizado pelo escopo `crm.all` ou `crm.own`; `organization_id` e classificação DEMO são derivados no servidor.

| Método | Endpoint | Uso |
|---|---|---|
| GET / POST | /api/energy-units | GET exige `customer_id`; POST cria unidade vinculada ao cliente. |
| GET / PUT | /api/energy-units/{id} | GET retorna unidade, até 120 consumos, até 120 faturas e resumo dos 12 meses; PUT exige `version`. |
| POST | /api/energy-units/{id}/archive | Arquiva com `{version}` e preserva histórico. |
| POST | /api/energy-units/{id}/restore | Reativa com `{version}`. |
| POST | /api/energy-consumptions | Cria um mês de consumo. |
| PUT | /api/energy-consumptions/{id} | Edita o mês; exige `version`. |
| POST | /api/energy-bills | Cria os dados básicos de uma fatura. |
| PUT | /api/energy-bills/{id} | Edita a fatura; exige `version`. |

Unidade: `customer_id`, `label`, `consumer_unit_number`, `installation_number`, `utility`, `holder_name`, `tariff_group`, `supply_type`, `voltage` e `service_address`. Consumo: `consumer_unit_id`, `reference_month` em AAAA-MM, `consumption_kwh`, `injected_energy_kwh`, `peak_demand_kw`, `days_billed`, `source=manual|bill` e `notes`. Fatura: `consumer_unit_id`, `reference_month`, `invoice_number`, `issue_date`, `due_date`, `total_amount`, `tariff_flag`, `previous_reading`, `current_reading` e `notes`.

Retorna 404 para cliente/unidade fora do escopo, 409 para mês/UC duplicado, versão divergente ou lançamento em unidade arquivada, e 400 para valores, datas ou leituras inválidas. Não há upload de conta, OCR ou integração externa.

### Dimensionamento solar

| Método | Endpoint | Uso |
|---|---|---|
| GET | /api/solar-sizings?consumer_unit_id=UUID | Lista até 100 cálculos da unidade, do mais recente ao mais antigo. |
| POST | /api/solar-sizings | Calcula e salva um novo cenário imutável. |

Corpo do POST: `consumer_unit_id`, `solar_irradiation_daily` entre 1 e 8, `performance_ratio_percent` entre 50 e 100, `module_power_w` inteiro entre 100 e 1.000, `safety_margin_percent` entre 0 e 50 e `notes`. O servidor sempre usa até 12 consumos mais recentes da unidade; médias ou resultados enviados pelo navegador são rejeitados pelo esquema estrito.

O resultado contém período e quantidade de meses, consumo médio, geração necessária, potência mínima, quantidade estimada de módulos, potência instalada e geração mensal estimada. Retorna 422 quando não existe consumo ou a média é zero, 409 para unidade arquivada e 404 fora do escopo. Não gera kit, lista de materiais, preço ou proposta.

### Equipamentos, kits e vínculo

| Método | Endpoint | Uso |
|---|---|---|
| GET / POST | /api/solar-equipment | Lista catálogo / cria equipamento. POST exige `solar.catalog.manage`. |
| GET / PUT | /api/solar-equipment/{id} | Detalhe com histórico / edição com `version`. |
| POST | /api/solar-equipment/{id}/archive | Arquiva se não estiver em kit ativo; exige `{version}`. |
| POST | /api/solar-equipment/{id}/restore | Reativa com `{version}`. |
| GET / POST | /api/solar-kits | Lista kits com composição e potências / cria kit. POST exige gestão. |
| GET / PUT | /api/solar-kits/{id} | Detalhe com histórico / edição integral com `version`. |
| POST | /api/solar-kits/{id}/archive | Arquiva com `{version}`. |
| POST | /api/solar-kits/{id}/restore | Reativa com `{version}`. |
| GET | /api/solar-kit-selections?sizing_id=UUID | Histórico de kits vinculados ao dimensionamento acessível. |
| POST | /api/solar-kit-selections | Vincula `{sizing_id,kit_id}` e cria snapshot imutável. |

Equipamento: `category=module|inverter|structure|component`, `name`, `manufacturer`, `model`, `sku`, `nominal_power_w`, `efficiency_percent`, `phases`, `mppt_count`, `unit=unit|meter|set`, `technical_notes`. Módulos e inversores exigem potência nominal.

Kit: `name`, `code`, `description`, `items:[{equipment_id,quantity}]`. O servidor deriva `module_count`, `dc_power_kwp` e `inverter_power_kw`; exige ao menos um módulo e itens ativos da organização. A seleção calcula `kit_quantity = teto(potência dimensionada / potência CC do kit)` e multiplica módulos e potências. Nenhum preço, proposta ou reserva de estoque é criado.

### Documentos e orçamentos manuais em PDF

| Método | Endpoint | Uso |
|---|---|---|
| GET | /api/documents?customer_id=UUID | Lista os documentos do cliente acessível. |
| GET | /api/documents?opportunity_id=UUID | Lista os documentos da oportunidade acessível. |
| POST | /api/documents | `multipart/form-data` com cliente, oportunidade, metadados e PDF; cria como rascunho. |
| GET | /api/documents/{id} | Retorna documento e histórico completo de snapshots. |
| PUT | /api/documents/{id} | Atualiza nome, valor, validade e observação; exige `version`. |
| POST | /api/documents/{id}/status | Atualiza `{status,version}`. |
| GET | /api/documents/{id}/file | Download autenticado do PDF com verificação SHA-256. |

O upload recebe `customer_id`, `opportunity_id`, `name`, `budget_value`, `valid_until`, `notes` e `file`. Cliente e oportunidade são obrigatórios e precisam ter vínculo entre si. O PDF deve usar MIME `application/pdf`, extensão `.pdf`, cabeçalho `%PDF-` e no máximo 10 MB; o formulário completo aceita até 10 MB mais o envelope multipart. Status: `draft`, `sent`, `accepted`, `refused`. Todas as leituras e downloads aplicam organização e responsável. O caminho físico não é retornado pela API.

### Envio do PDF por e-mail

| Método | Endpoint | Uso |
|---|---|---|
| POST | /api/documents/{id}/email | Envia o PDF armazenado com `{recipient,subject,message}` e registra a entrega. |

`recipient` deve ser um e-mail válido com até 254 caracteres; `subject` tem de 1 a 180 caracteres e rejeita quebras de linha; `message` tem de 1 a 10.000 caracteres. O servidor reaplica o acesso ao documento, confirma a integridade do PDF e usa `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `MAIL_FROM` somente no servidor.

Após aceite do SMTP, a resposta contém documento e registro da entrega. Rascunhos passam para `sent`; outros status são preservados. SMTP ausente retorna 503 com mensagem de configuração. Falha de conexão/entrega retorna 502 e não grava envio. Não há envio automático, HTML, rastreamento de abertura ou geração de proposta.
