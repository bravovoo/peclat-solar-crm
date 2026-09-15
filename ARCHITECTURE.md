# Arquitetura — Peclat Solar CRM

## Decisão da FASE 1

Aplicação Next.js/React/TypeScript, organizada como monólito modular. PostgreSQL com SQL versionado e driver `pg` (alternativa explícita ao ORM), consultas parametrizadas e repositórios tipados. Isso permite controlar constraints, transações e isolamento sem depender de extensões proprietárias. Interface em português, azul/verde, responsiva, renderizada no servidor por padrão.

Módulos: AUTH/RBAC e CRM CORE nesta fase. SOLAR, COMMERCIAL, INSTALLATION, POST-SALES, WHATSAPP, AUTOMATION e REPORTING serão introduzidos nas fases correspondentes, compartilhando apenas identificadores, autorização e contratos de integração.

## Fronteira de segurança

Sessão opaca revogável, token aleatório com somente hash no banco; cookie HttpOnly, SameSite=Lax e Secure em produção. Senhas com scrypt. Toda leitura privada valida sessão, usuário ativo e associação à organização. Permissões obtidas do banco, nunca do formulário. Identificador de organização é derivado da sessão. Transações e chaves compostas impedem referências entre organizações. Login e recuperação têm limitação persistida em PostgreSQL. Mutações validam Origin e dados com Zod. Recuperação usa token de uso único, validade curta e revogação das sessões.

## Integração futura com WhatsApp oficial

Na FASE 7, uma camada exclusiva no servidor falará com a Cloud API. Cada conta deverá pertencer a uma organização; resolver tenant pelo phone_number_id previamente cadastrado, nunca por dado de tenant recebido do cliente. Webhooks verificarão assinatura sobre corpo original, persistirão evento com chave única e retornarão antes do processamento pesado. Worker separado fará retries com backoff, limite de tentativas e fila de falhas. Outbox transacional evitará perda de eventos entre CRM e integrações. Credenciais nunca chegarão ao navegador; ambientes multiempresa usarão referências a segredos por conta. Não há webhook nem envio real nas FASES 1 e 2. Templates, consentimento e janela de atendimento deverão ser validados no servidor conforme regras vigentes da Meta na implementação.

Referências: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Cloud API oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Evolução do domínio solar

Contato/cliente será a raiz da visão 360º. Unidades consumidoras pertencerão ao cliente; contas e consumo à unidade. Oportunidades ligarão proposta versionada, contrato, pagamentos e instalação. Valores monetários usarão numeric, potência kWp e consumo kWh terão precisão explícita. Arquivos ficarão em armazenamento privado; PostgreSQL guardará metadados, tenant e permissões. Não antecipar tabelas sem casos de uso e migrations testadas.

### Consumo energético — FASE 4, etapa 1

O módulo `src/modules/energy` implementa a primeira parte dessa evolução. `energy_consumer_units` pertence exclusivamente a um registro `customer`; `energy_monthly_consumption` e `energy_bills` pertencem à unidade. O repositório valida o cliente pelo serviço central do CRM e herda `crm.all`/`crm.own`, organização e responsável.

Consumo e fatura ficam separados porque um mês pode ter consumo conhecido sem os dados financeiros da conta, ou uma fatura pode ser cadastrada antes da leitura. A referência mensal é única por unidade em cada tabela. Os 12 meses mais recentes geram somente quantidade, soma, média e completude. Não existe cálculo de potência, geração, economia, kit ou proposta nesta etapa.

Todas as edições usam `version` e bloqueio de linha. Arquivar uma unidade preserva seus lançamentos e bloqueia novos dados até reativação. Eventos relevantes entram em `crm_activities` do cliente. A classificação DEMO é copiada do cliente para a unidade.

### Dimensionamento solar — FASE 4, etapa 2

`solar_sizings` é uma memória imutável de cenários vinculada simultaneamente à unidade e ao cliente por FK composta. O serviço lê até 12 consumos mensais mais recentes dentro da mesma transação e grava um snapshot do período, quantidade de meses, média, parâmetros e resultados. Alterações posteriores no consumo não reescrevem cálculos anteriores.

Na versão `v1`, geração necessária = consumo médio × (1 + margem). Potência mínima = geração necessária ÷ (irradiação diária × 30 × desempenho global). A quantidade de módulos é arredondada para cima; potência instalada e geração estimada usam essa quantidade inteira. Irradiação, desempenho, potência do módulo e margem têm faixas validadas. O resultado é uma estimativa comercial e não substitui análise técnica, projeto elétrico ou vistoria.

### Equipamentos e kits — FASE 4, etapa 3

`src/modules/solar-catalog` separa o catálogo técnico da memória de dimensionamento. Equipamentos têm categoria, identidade, potência e características básicas; kits referenciam equipamentos com quantidade. Potência CC, quantidade de módulos e potência de inversores são derivadas da composição atual e não aceitas do navegador.

Administrador e gerente possuem `solar.catalog.manage`; usuários comerciais autorizados podem consultar o catálogo e vincular um kit aos próprios dimensionamentos. Equipamentos usados por kit ativo não podem ser arquivados. Kits sem módulo ou com item inativo são rejeitados. Edições usam `version` e geram snapshots em tabelas de histórico.

O vínculo não altera `solar_sizings`. `solar_sizing_kit_selections` acrescenta uma seleção imutável, calcula quantos kits são necessários para atingir a potência dimensionada e salva o kit completo como JSONB. Assim, mudanças futuras de potência, nome ou composição não reescrevem o histórico do cliente.

### Documentos e orçamentos manuais — FASE 4, etapa 4

`src/modules/documents` mantém metadados, vínculos, versões e snapshots no PostgreSQL. O PDF fica em armazenamento privado fora de `public`; o caminho físico usa UUIDs de organização e documento, enquanto o nome original existe apenas como metadado. `DOCUMENT_STORAGE_DIR` aponta para um volume persistente e usa `.local/documents` no desenvolvimento.

Cada documento exige simultaneamente um cliente e uma oportunidade vinculada àquele mesmo cliente. O repositório reaplica `crm.all`/`crm.own` nos dois pais, inclusive no download. Uploads aceitam somente `application/pdf`, extensão `.pdf`, cabeçalho `%PDF-` e até 10 MB. O download recalcula SHA-256 antes de responder e nunca expõe o caminho do arquivo.

Edição de nome, valor, validade e observação usa versão concorrente. Mudanças de status e dados geram snapshots com autor e data. O arquivo original não é substituído: um novo PDF exige um novo documento, preservando a rastreabilidade. Não há geração automática, assinatura, contrato ou pagamento.

### Envio de orçamentos por e-mail — FASE 4, etapa 5

O mesmo adaptador SMTP da recuperação de senha implementa um contrato separado para documentos. O serviço recebe destinatário, assunto e texto já validados, carrega o PDF pelo armazenamento privado, confirma SHA-256 e entrega o conteúdo ao Nodemailer como `application/pdf`. O navegador nunca recebe credenciais SMTP ou caminho físico.

`crm_document_emails` é gravada somente após o SMTP aceitar a mensagem. Ela preserva destinatário, assunto, mensagem, nome do documento e arquivo, identificador do provedor, autor e data. A atividade pertence ao cliente e aparece também no histórico agregado da oportunidade. Um documento em rascunho passa a enviado depois da entrega; aceitos ou recusados não são rebaixados ao reenviar.

SMTP ausente retorna erro 503 explícito. Falha de conexão ou entrega retorna 502 e não cria registro de envio. O fluxo não contém fila, reenvio automático, rastreamento de abertura, HTML, WhatsApp ou geração de proposta.

## Validação

Lint, verificação TypeScript, testes unitários, integração com PostgreSQL e build são obrigatórios antes de aprovar a fase. O estado executado será registrado no README.

## Organização implementada

- `src/app`: páginas, layouts, tratamento de erro e adaptação HTTP.
- `src/components`: apresentação compartilhada, shell e formulários.
- `src/modules/auth`: validação, senhas, sessões, recuperação e política de acesso.
- `src/modules/core`: consultas administrativas da organização.
- `src/server`: pool PostgreSQL, transação, leitura de sessão e proteção HTTP.
- `src/integrations`: contrato MailProvider e adaptador SMTP; não acoplar domínio ao provedor.
- `db/migrations` e `scripts`: versionamento do banco, bootstrap e ambiente local.
- `tests`: unidade, integração com PostgreSQL e E2E com build de produção.

Query client não é necessário na FASE 1: páginas privadas são renderizadas no servidor e formulários têm apenas mutações pequenas. React Hook Form/Zod validam a interface; servidor valida novamente. Nenhum segredo é passado ao shell. Sessões e permissões são consultadas em cada requisição; não há cache compartilhado de dados entre organizações.

As consultas privadas retornam dados limitados (100 membros/8 eventos). Novo módulo deve receber Actor validado, exigir permissão, aplicar tenant e escopo de dono e manter FK composta. O helper recordScope é o contrato inicial; não substitui testes do repositório futuro.

RBAC atual usa catálogo fixo, sem editor de papéis na interface. Ajustes administrativos futuros precisarão transação, auditoria e prevenção de remoção do último administrador. Não há upload, notificações comerciais ou fila em execução. A busca global do CRM está implementada no servidor.

## CRM central — FASE 2

O módulo src/modules/crm concentra validação de domínio e repositório SQL. Leads, clientes e empresas compartilham crm_records, discriminados por kind, evitando repetir regras de titularidade, endereço, tags, duplicidade e histórico. As páginas dinâmicas aceitam exclusivamente leads, clientes e empresas; rotas de autenticação e administração existentes continuam específicas. O adaptador HTTP despacha recursos explícitos e não interpola nomes de tabelas fornecidos pelo cliente.

Cada consulta recebe Actor validado e exige crm.all ou crm.own. Organização vem da sessão; crm.own acrescenta o responsável. Chaves compostas validam vínculos na mesma organização. Busca e exportação reutilizam o mesmo filtro. Contatos só aparecem quando há um vínculo acessível ao usuário. A interface não recebe a base completa: listagens têm paginação, pesquisa tem debounce e cancelamento de respostas antigas. Opções são limitadas a 200 responsáveis e 500 tags.

Mutações usam transação e validação Zod. Edição exige version para evitar sobrescrita concorrente. Um lock transacional por organização serializa gravações de identidade e verificação de duplicados. Telefones/WhatsApp compartilham normalização; e-mail é normalizado e CPF/CNPJ validado. Duplicidade não apaga registros: retorna conflito, mostra apenas registros acessíveis e permite confirmação apenas com crm.duplicate.override, registrando atividade.

Conversão cria um cliente e marca o lead como convertido na mesma transação. Copia os vínculos dos contatos/tags, mantém original_lead_id único e agrega notas, tarefas e atividades do lead na visão do cliente. Não há duplicação física de histórico. O futuro módulo de oportunidades deverá referenciar esses IDs com organization_id e FK composta, sem reproduzir cadastros ou antecipar tabelas nesta fase.

Exclusão lógica exige crm.delete e preserva histórico. Leads convertidos não podem ser excluídos. Arquivamento permite reativação. Notas e atividades não possuem endpoints de edição/exclusão. Tarefas nesta fase só têm título, prazo, responsável herdado do cadastro e conclusão; não constituem o pipeline/agenda da FASE 3.

O contrato import-contract.ts reserva relatório por linha para importação futura (importados, ignorados, duplicados e erros). Um importador deverá passar pelo mesmo serviço de validação/permissões e publicar o resultado de cada linha; nenhum parser ou importação parcial silenciosa foi implementado.

## Operação comercial — FASE 3

Decisão: adicionar crm_opportunities como entidade comercial e ampliar crm_tasks, crm_notes e crm_activities com opportunity_id. Cada tarefa/nota/atividade aponta para exatamente um cadastro OU oportunidade, por CHECK e FKs compostas. Não foram criados cadastros, contatos ou históricos paralelos. crm_records continua sendo a raiz de relacionamento.

Uma oportunidade tem lead_id/customer_id/company_id opcionais, com pelo menos um vínculo; FK composta inclui o tipo correto de cadastro. contact_id deve estar vinculado a um desses cadastros. Uma oportunidade pode nascer do lead e ganhar vínculos adicionais posteriormente, mas seu lead original é preservado. O mesmo lead pode originar oportunidades distintas: não há conversão automática para cliente nem exclusão de histórico. Orçamentos/propostas futuros deverão referenciar (organization_id, opportunity_id).

RBAC reutiliza crm.all/crm.own. Administrador e gerente operam toda a organização; vendedor/atendimento somente suas oportunidades e tarefas atribuídas. Uma atribuição de oportunidade/tarefa compartilha seu contexto de relacionamento (nomes), sem conceder acesso ao cadastro completo. O histórico herdado de cadastros na oportunidade inclui apenas os cadastros acessíveis ao ator; o histórico próprio acompanha a permissão da oportunidade. Toda atribuição valida membro ativo com perfil comercial.

Atualizações usam version com bloqueio de linha e transação. Movimentação reutiliza a mesma validação da edição. Fechamento guarda closed_at, closed_value, closed_by e closed_owner_id. Valor de oportunidade fechada só pode mudar depois da reabertura; editar o responsável não altera o responsável registrado no fechamento. Etapa, status, motivo obrigatório e snapshot de fechamento têm constraints no banco. Probabilidade é 100% na ganha e 0% na perdida. Reabertura é registrada; fechamento anterior continua no histórico.

Etapas e motivos usam códigos estáveis no catálogo do domínio e validação SQL. Um futuro configurador poderá introduzir catálogo por organização e FK através de nova migration, migrando os códigos existentes sem recriar oportunidades. Não foi antecipado um construtor de pipelines.

Agenda utiliza due_date e due_time opcional em America/Sao_Paulo; due_at continua disponível para compatibilidade com a FASE 2. Sem horário, o vencimento é o fim do dia. Status concluída sincroniza completed_at; cancelamento não equivale a conclusão. Alterações geram atividades no relacionamento correspondente. last_activity_at acompanha atividades próprias da oportunidade; stage_changed_at mede tempo na etapa. Atividades no cadastro original ficam no histórico herdado, mas não são tratadas como contato específico de todas as oportunidades desse cadastro.

DEMO: classificação explícita em crm_records e crm_opportunities, herdada dos cadastros vinculados. Tarefas herdam a classificação por seu vínculo. Consultas operacionais e métricas separam real/DEMO por padrão, sem usar títulos como regra permanente de autorização. O seed identifica apenas seus exemplos conhecidos.

Pipeline retorna no máximo 20 cartões por etapa e totais SQL completos; links levam à lista paginada. Agenda pagina até 100 tarefas; busca retorna até 8 oportunidades. Contatos no seletor exibem a primeira página de até 20 por cadastro vinculado; para bases maiores o seletor poderá ganhar pesquisa dedicada. Não foi adicionado pacote de drag-and-drop, serviço de calendário ou dependência externa.
