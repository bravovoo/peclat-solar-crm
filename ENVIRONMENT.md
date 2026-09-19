# Ambiente e operação

## Configuração

`DATABASE_URL`: conexão PostgreSQL obrigatória em runtime e migrations. `APP_URL`: origem exata permitida em mutações, sem caminho adicional. `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`: somente bootstrap. Senha de 12–128 caracteres, nunca padrão. Seeds subsequentes não alteram senha nem elevam privilégios de conta preexistente.

`DOCUMENT_STORAGE_PROVIDER`: `local` no desenvolvimento ou `supabase` na hospedagem. O modo local usa `DOCUMENT_STORAGE_DIR` (padrão `.local/documents`). O modo Supabase exige `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET` e, preferencialmente, `SUPABASE_SECRET_KEY`; `SUPABASE_SERVICE_ROLE_KEY` é aceita como alternativa legada. Configure apenas uma chave. Ela é exclusiva do servidor, nunca usa prefixo `NEXT_PUBLIC_` e não deve ser incluída no Git. O bucket deve permanecer privado. O backend limita cada arquivo a 10 MB e aceita PDF comercial ou, para instalação, PNG, JPEG, WEBP, XLSX, XLS, CSV, DOCX, DOC e TXT. `pnpm storage:setup` também configura limite e MIME no bucket existente quando executado em ambiente seguro com a credencial de servidor. O download passa pelo backend autenticado e verifica SHA-256.

SMTP_HOST/PORT/SECURE/USER/PASSWORD e MAIL_FROM configuram o transporte de recuperação. SMTP_HOST vazio desabilita a recuperação com resposta de indisponibilidade. Falha de entrega não revela existência de usuário; invalida token criado e registra somente código de erro, sem destinatário ou token. Consulte logs operacionais para falhas. Localmente use Mailpit, sem envio para terceiros.

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` são secrets server-only reservados para a integração oficial da Meta. Na Fase 8.1 eles não ativam envio ou recebimento de mensagens. Os identificadores não secretos da conta são administrados no CRM e isolados por organização. Não usar prefixo `NEXT_PUBLIC_`, não persistir os valores dos secrets no banco e não incluí-los no Git ou em logs.

`.env`, `.local`, dados do banco, credenciais e logs são ignorados pelo Git. Não incluir em pacotes de entrega. A instalação de dependências mantém TLS validado; neste computador foi necessário NODE_USE_SYSTEM_CA=1 para confiar nos certificados do Windows. Não desabilitar verificação TLS.

## Persistência e backup

Banco do comando db:local: `.local/postgres`. Testes: `.local/tests`, bases separadas. Docker: volume postgres_data. Nunca substituir nem apagar diretórios de dados para corrigir migrations. Não usar `docker compose down -v` em uma base que precisa preservar.

O auxiliar local usa pg_ctl com shutdown fast e espera limitada, em vez de encerrar forçadamente a árvore de processos do PostgreSQL no Windows. Isso evita workers órfãos e permite fechamento coordenado dos arquivos. Bases de teste são preservadas, sem remoção recursiva automática.

Em produção, usar utilitários PostgreSQL da mesma versão major do servidor. Exemplo operacional (substituir nome do arquivo e conexão em ambiente seguro):

```powershell
pg_dump --dbname=$env:DATABASE_URL --format=custom --file=peclat-backup.dump
pg_restore --dbname=$env:RESTORE_DATABASE_URL --no-owner --no-acl peclat-backup.dump
```

Restaurar primeiro em banco novo e isolado, validar contagem de organizações/usuários e login, e somente então planejar recuperação do serviço. Proteger arquivo de backup com criptografia e acesso restrito. Retenção proposta para implantação: cópias diárias por 30 dias e mensais por 12 meses, a ajustar à operação. Documentos ainda não existem na FASE 1; sua política de backup será adicionada quando armazenamento privado for implementado.

## Manutenção

Remover sessões, password_resets e rate_limits com expires_at menor que now() em rotina periódica de produção. As consultas ignoram registros expirados mesmo antes da limpeza. Auditoria não tem exclusão automática nesta fase; definir retenção antes do uso público.

O endpoint /api/health verifica conexão; não divulga configuração. Não substitui monitoramento de entregabilidade, espaço em disco, migrations ou backups. Nenhum deploy, monitor externo ou automação recorrente foi criado.
