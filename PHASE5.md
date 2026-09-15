# FASE 5 — contratos, vendas e financeiro

## Entrega

A FASE 5 formaliza a venda a partir de um cliente e, opcionalmente, de uma oportunidade. O contrato recebe número anual sequencial no formato `PECLAT-AAAA-000001`, gerado dentro da transação do banco para impedir duplicidade concorrente. O cadastro inclui responsável, título, datas, condições, observações e itens manuais ou vinculados a equipamentos e kits.

O servidor calcula valor bruto, desconto por item, desconto comercial, valor líquido, entrada e saldo. Valores monetários são normalizados em centavos; as parcelas do saldo são mensais e a última absorve qualquer diferença de arredondamento. A entrada é representada pela parcela zero. Contratos com pagamentos registrados não permitem a reconstrução do plano financeiro.

Status disponíveis: rascunho, enviado, em negociação, assinado, ativo, concluído e cancelado. A conclusão exige ausência de saldo pendente. O cancelamento exige permissão específica e encerra parcelas abertas. Todas as criações, edições, mudanças de status, pagamentos e eventos documentais geram histórico com autor e data; atualizações usam `version` para detectar concorrência.

Cada parcela aceita vários pagamentos. O total recebido nunca pode superar o valor da parcela. O sistema deriva os estados pendente, parcial, pago e vencido, oferece resumo de contratado/recebido/a receber/em atraso e lista parcelas vencidas.

PDFs continuam no armazenamento privado configurado na FASE 4. A migration 009 acrescenta vínculo opcional ao contrato, classificação comercial e registro de assinatura externa. Upload, hash SHA-256, limite de 10 MB, download autenticado e envio SMTP permanecem no backend. O registro de assinatura não executa assinatura eletrônica.

## Acesso

- Administrador e gerente: todos os contratos, criação, edição, cancelamento e gestão de pagamentos.
- Vendedor: contratos próprios, criação, edição e leitura financeira.
- Atendimento: contratos próprios e leitura financeira.
- Técnico e pós-venda: sem acesso por padrão.

O servidor deriva sempre a organização da sessão. Perfis com acesso próprio recebem somente contratos cujo responsável seja o usuário atual. Vínculos a cliente, oportunidade, equipamento, kit, documento, parcela e pagamento usam chaves compostas por organização.

## Interface

- `/contratos`: indicadores, alertas, pesquisa, filtro por status e lista.
- `/contratos/novo`: cliente, oportunidade, itens, descontos e plano de pagamento.
- `/contratos/{id}`: composição, parcelas, pagamentos, PDFs e histórico.
- `/contratos/{id}/editar`: edição protegida por versão.
- Abas Contratos no cliente e na oportunidade permitem iniciar o cadastro já vinculado.

## Limites intencionais

Não foram implementados gerador automático de proposta, assinatura eletrônica real, gateway de pagamento, cobrança automática, nota fiscal, contabilidade, WhatsApp, instalação ou pós-venda.

## Verificação

A migration 009 é aplicada sobre as migrations 001–008 e foi validada em PostgreSQL isolado. A suíte integrada cobre cálculos, parcelas, pagamento parcial e total, excesso de pagamento, RBAC/IDOR, histórico, PDF de contrato e assinatura registrada. O navegador cobre venda, contrato, recebimento, PDF, assinatura e responsividade móvel.
