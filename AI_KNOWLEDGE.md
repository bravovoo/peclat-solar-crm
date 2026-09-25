# Base de Conhecimento da IA — desenvolvimento local

A base utiliza o Assistente Comercial existente. A migration `032_ai_knowledge_base.sql` adiciona orientações por organização e perguntas/respostas com estados `draft`, `active`, `inactive`, `rejected` e `deleted`. Ela não modifica mensagens, clientes, automações ou provedores de IA existentes.

## Uso

Em **Configurações → Base de Conhecimento da IA**, o administrador cria uma pergunta, categoria, resposta e palavras-chave opcionais. O item começa como rascunho e só participa das sugestões depois de **Aprovar e ativar**. Editar uma resposta ativa devolve o item a rascunho. Desativar ou excluir retira o item da busca; a auditoria permanece. Vendedores e gerentes podem usar **Salvar na base de conhecimento** na Inbox para propor uma resposta corrigida. A proposta exige revisão administrativa e nunca é publicada automaticamente.

O administrador configura tom, formalidade, tamanho, emojis, apresentação e orientações comerciais. O campo **Testar pergunta** faz uma prévia privada usando o provedor já configurado, mostra as fontes aprovadas recuperadas e avisa quando não há fonte relevante. A prévia consome a mesma cota horária do assistente e nunca envia WhatsApp.

A busca é restrita à organização, considera somente itens ativos e usa índices de texto em português e palavras-chave, retornando até quatro respostas relevantes. O modelo não recebe a base inteira. Mensagens de clientes, rascunhos e orientações são dados, não instruções capazes de alterar as regras fixas de segurança. Valores e condições numéricos continuam sujeitos à validação de fatos do assistente.

## Preparação futura

Antes de disponibilizar em produção, aplicar a migration 032 pelo migrador versionado, validar RLS e privilégios, publicar a aplicação e testar os fluxos de administrador e vendedor. Esta implementação local não aplica a migration no Supabase remoto e não executa envio real de mensagens.
