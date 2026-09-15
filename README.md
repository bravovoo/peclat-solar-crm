# Peclat Solar CRM

Projeto novo em `C:\Peclat Solar CRM`. FASES 1, 2 e 3 implementadas e preservadas. A FASE 4 inclui consumo/faturas, dimensionamento solar, catálogo técnico, kits comerciais, documentos/orçamentos manuais em PDF e envio desses arquivos por e-mail. Gerador automático de proposta e demais fases não foram iniciados.

## Executar no Windows

Pré-requisitos: Node.js 22.12+ (validado com 24.19) e pnpm 11.19. Execute na pasta do projeto:

```powershell
pnpm install --frozen-lockfile
pnpm local:prepare
pnpm db:local
```

Mantenha o banco aberto. Em outro terminal:

```powershell
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Abra http://localhost:3000. Organização: `peclat-solar`. O comando de preparação cria credenciais aleatórias em `.local/ACESSO_LOCAL.md`; não sobrescreve configuração existente. Não publica nem envia esses arquivos. Banco local escuta somente em 127.0.0.1:55432. Ctrl+C encerra sem apagar dados.

Para executar o build: `pnpm build`, depois `pnpm start`. Em produção os cookies usam Secure; o teste local no Chrome usa a exceção segura de localhost. Acesso por IP de rede requer HTTPS e APP_URL correspondente.

Alternativa Docker: copie `.env.example` para `.env`, defina SEED_ADMIN_PASSWORD, execute `docker compose up -d`, migrations e seed. Essa opção usa PostgreSQL na porta 5432 e Mailpit nas portas 1025/8025. Não misture a URL do Docker com o banco local na porta 55432.

## O que está disponível

- Login/logout, validação, limite persistente de tentativas e recuperação de senha com tokens de uso único.
- Organização e permissões verificadas no servidor a cada acesso. Seis perfis iniciais.
- Dashboard base, histórico real de login/logout/redefinição para administrador, consulta da equipe e configurações conforme perfil.
- Estados de carregamento, erro, acesso restrito e páginas ausentes. Menu mobile e formulários acessíveis.
- Migrations com transação, lock e checksum; seed idempotente sem alteração de senha existente.

O dashboard consulta os cadastros comerciais visíveis ao usuário, com totais e distribuição por origem, estágio e vendedor. Leads/clientes/empresas possuem cadastro, edição, detalhes, filtros, paginação e CSV. Conversão preserva o lead original, contatos e histórico. Notas são exclusivamente internas. Tarefas podem ser criadas, editadas, atribuídas e concluídas no cadastro ou na operação comercial. Pipeline, oportunidades, agenda de dia/semana e follow-up estão disponíveis. Clientes possuem a aba Consumo e faturas para cadastrar várias unidades, medições mensais e faturas, com média e total dos 12 meses mais recentes. O CRM aplica organização e responsável em todas as consultas, inclusive na API de energia.

## Recuperação de senha

`local:prepare` deixa SMTP desabilitado. Para testar e-mails localmente, inicie Mailpit com `docker compose up -d mail`, defina `SMTP_HOST=localhost`, `SMTP_PORT=1025` e reinicie a aplicação. Abra http://localhost:8025 para ler a caixa local. Não há envio real de e-mails sem um servidor SMTP configurado. Em produção configure SMTP seguro, remetente autorizado e APP_URL HTTPS. Tokens ficam no fragmento do link e não em parâmetros de logs de acesso.

## Verificações executadas — 14/09/2026

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod
pnpm peers check
```

Lint sem avisos; TypeScript e build aprovados; 28 testes unitários/integração e 12 testes E2E passaram. Integração usa PostgreSQL real, com base exclusiva criada pelo teste; não lê nem altera o banco local de uso. E2E usa Chrome instalado, build de produção e porta 3100; valida login/logout, cookies, API, CSRF, RBAC, mobile de 320px a tablet, cadastros, notas, contatos, tarefa, conversão, tags, busca, CSV e exclusão confirmada. Capturas desktop/mobile foram revisadas. Na FASE 1, a auditoria de dependências de produção não indicou avisos conhecidos nem conflitos de peer dependencies; essas duas verificações não foram repetidas na FASE 2, que não adicionou dependências.

Os testes preservam seus clusters em `.local/tests` e os encerram ao terminar. Não executar os testes como root em Linux. Docker Compose e entrega SMTP externa não foram executados neste ambiente. O pacote auxiliar embedded-postgres tem versão beta e é exclusivo de desenvolvimento/testes; deploy deve usar PostgreSQL gerenciado ou instalação suportada.

ESLint 9 foi fixado para compatibilidade com os plugins atuais do Next.js; o registro o marca como fora de suporte. A migração da ferramenta para ESLint 10 fica pendente da compatibilidade dos plugins. Não é dependência de execução do CRM.

## Limites antes de produção

Esta aprovação cobre a aplicação local, não uma implantação pública. Antes de produção: SMTP real, HTTPS, política CSP com nonce, usuário PostgreSQL com privilégios mínimos, backups restaurados em teste, retenção de auditoria e limites na borda. RLS não está habilitada; o isolamento atual ocorre nos repositórios e nas chaves compostas, com testes de fronteira. Não expor o driver diretamente a novos endpoints.

Documentação: ARCHITECTURE.md, DATABASE.md, ROADMAP.md, ENVIRONMENT.md e API.md.

## Desenvolvimento gratuito

Next.js, PostgreSQL e ferramentas locais open source. Sem serviço pago obrigatório.

## Serviços externos

SMTP para recuperação de senha e envio de orçamentos PDF; Mailpit local para desenvolvimento. WhatsApp oficial somente na FASE 7, com credenciais reais.

## Possíveis custos de produção

Servidor, domínio, armazenamento, backup, e-mail e consumo da API oficial do WhatsApp. Deploy não faz parte desta fase.

## Dados de demonstração da FASE 2

Após aplicar as migrations e o seed de acesso, execute opcionalmente:

```powershell
$env:SEED_DEMO = "true"
pnpm db:seed:demo
Remove-Item Env:SEED_DEMO
```

O comando é exclusivo de desenvolvimento, bloqueia NODE_ENV=production e não roda automaticamente. Cria quatro cadastros fictícios com o sufixo DEMO, tags, contatos e notas explicitamente identificados. Não usa telefones, documentos ou e-mails de pessoas reais. A reexecução ignora os cadastros já existentes. Dados visíveis nos indicadores vêm sempre do banco, inclusive os exemplos quando o seed é executado.

A importação CSV/Excel possui apenas contrato de evolução; não há importador ativo nesta fase. Exportação CSV está disponível até 10.000 registros por seleção. PDFs manuais podem ser anexados a cliente e oportunidade; geração automática de orçamento e envio de WhatsApp não estão ativos. Oportunidades estão disponíveis na FASE 3.

O banco local existente usa WIN1252 e foi preservado. Caracteres fora dessa codificação (como emojis) retornam erro de validação, sem gravação parcial. Novos clusters auxiliares são criados em UTF-8. Antes de produção, usar PostgreSQL UTF-8 e planejar qualquer conversão do banco antigo com backup e validação; esta fase não recria o banco.

O inventário completo desta entrega está em PHASE2.md.

## Resultado da revalidação final

Em 14/09/2026: pnpm lint aprovado sem avisos; pnpm typecheck aprovado; pnpm test com 28/28 aprovados; pnpm build aprovado; pnpm test:e2e com 12/12 aprovados (55,8 segundos). Prévia reiniciada e dashboard confirmado em localhost:3000. Nenhuma falha nas asserções finais.

O encerramento do ambiente E2E no Windows ainda emite database_idle_connection_failed, após os testes, além do aviso de NO_COLOR/FORCE_COLOR do runner. A espera pelo fechamento do processo da aplicação foi adicionada ao encerramento normal; o aviso auxiliar persiste no encerramento pelo Playwright. Isso está registrado como pendência de limpeza do ambiente de testes, não como falha de um fluxo validado. O banco local de uso é separado dos bancos de teste e permaneceu disponível.

## FASE 3 — operação comercial

Aplique a migration 003 com pnpm db:migrate. Nenhuma migration anterior foi reescrita. Navegação: Pipeline, Oportunidades, Tarefas, Agenda e Follow-up. O botão Criar oportunidade no cadastro aproveita o lead/cliente/empresa existente e não cria cliente automaticamente. O pipeline aceita arrastar cartões e também o seletor acessível Mover para; perdas exigem motivo e ganhos registram valor, data e responsável.

Notas, histórico e tarefas usam as tabelas existentes. Agenda funciona por dia/semana, em horário de Brasília, sem integração externa. O follow-up mostra tarefas do dia, atrasadas, oportunidades sem atividade e paradas na etapa, além dos fechamentos previstos para os próximos sete dias. Administrador/gerente configuram de 1 a 365 dias; padrão 7.

O seed opt-in mantém os quatro cadastros anteriores e acrescenta duas oportunidades e duas tarefas DEMO. No pipeline, tarefas, agenda, follow-up e métricas comerciais, escolha Demonstração DEMO no filtro Base de dados para inspecionar os exemplos. O padrão é Operação real. Os indicadores de cadastros existentes também excluem DEMO, mantendo as mesmas métricas. A busca global pode encontrar exemplos identificados pelo nome. Não é possível misturar cadastros DEMO e reais numa oportunidade; a conversão para cliente conserva essa classificação.

Detalhes técnicos da operação comercial: PHASE3.md. A FASE 4 está implementada até equipamentos, kits e vínculo ao dimensionamento; integrações externas e FASE 5 não foram iniciadas.

## FASE 4 — consumo energético, etapa 1

Aplique a migration 004 com `pnpm db:migrate`. Abra um cliente e use a aba **Consumo e faturas**. Cada unidade mantém distribuidora, identificadores, titular, grupo tarifário, tipo de ligação, tensão e endereço. O histórico registra consumo, energia injetada, demanda máxima, dias faturados e origem do dado; a fatura registra valor, datas, número, bandeira e leituras. A indicação “base para dimensionamento” apenas informa se existem 12 meses recentes e não executa cálculo solar.

O dimensionamento usa a média de até 12 consumos recentes, irradiação diária, desempenho global, potência do módulo e margem de segurança. Cada execução salva parâmetros e resultados. O menu **Equipamentos e kits** mantém módulos, inversores, estruturas, componentes e kits compostos. Ao vincular um kit, a quantidade é arredondada para cobrir a potência dimensionada e a composição é preservada como snapshot. A aba **Documentos** de clientes e oportunidades guarda PDFs manuais em armazenamento privado configurado por `DOCUMENT_STORAGE_DIR` e permite enviá-los pelo SMTP configurado. Inventários: `PHASE4-STAGE1.md`, `PHASE4-SIZING.md`, `PHASE4-CATALOG.md`, `PHASE4-DOCUMENTS.md` e `PHASE4-EMAIL.md`.

### Validação final da FASE 3 — 14/09/2026

Lint e TypeScript aprovados; build de produção aprovado; 41/41 testes unitários e de integração e 15/15 testes de navegador aprovados. A suíte do navegador valida as FASES 1–3, incluindo criação e conversão comercial, Kanban por arrastar e por seletor, ganho/perda, agenda, follow-up, RBAC/API e responsividade. A verificação móvel espera o conteúdo carregar antes de confirmar que a largura do documento não excede o viewport; o deslocamento horizontal permanece contido no Kanban.

A única saída auxiliar é o aviso do runner sobre `NO_COLOR` junto de `FORCE_COLOR`, sem impacto nos testes. As limitações já documentadas continuam: banco local legado WIN1252, SMTP externo não configurado e ausência intencional dos módulos das fases seguintes.
