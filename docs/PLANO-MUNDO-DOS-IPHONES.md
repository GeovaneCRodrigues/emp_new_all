# Mundo dos iPhones — o que implementar

Este documento é para quem for implementar no sistema de verdade, seja um agente ou uma pessoa. Ele junta tudo o que foi desenhado e decidido com o Geovane no dia 08/10/2026.

O protótipo clicável está em `docs/prototipo/proto-iphone.html`. Abra no navegador: ele funciona sozinho, sem servidor, e usa dados de exemplo. É a referência visual e de comportamento de todas as telas descritas aqui.

> **Antes de qualquer coisa**
> - **Merge ou push na `main` vai direto pra produção** (o deploy roda via GitHub Actions). Trabalhe sempre em branch e abra PR em rascunho. Só faça merge com o OK explícito do Geovane.
> - Nunca commite `backend/.env` nem nenhum segredo.
> - O código mais novo pode estar na branch `agent-contexto`, que é a que tem as Diárias. Se ela existir no GitHub, parta dela. Senão, parta de `feat/vendas-modulos`. **Nunca parta da `main`**, que está desatualizada.
> - O Geovane escreve em português e de forma informal. Responda em português.

---

## 0. Se este for um repositório novo, só do front

O Geovane quer começar um front novo do zero, em outro repositório, a partir deste protótipo.

- **Stack sugerida:** Vue 3 + Vite + TypeScript, com componentes próprios. Ele pediu para não usar Nuxt UI.
- **Primeiro, rodar com dados de exemplo:** use os mesmos do protótipo, numa camada de "API falsa" com as mesmas formas das respostas do backend atual. Depois troca pela API real (`sistema_emprestimos/backend`) sem mexer nas telas.
- **Escopo do front:** tudo o que está nas seções 2 e 3 deste documento.
  - Faça os cálculos das seções 2 e 7 em funções puras com testes: lucro, juros da parcela, repasse, pagamento parcial e a mais.
  - A seção 5 é o que o backend vai precisar depois. Não é trabalho deste repositório, mas desenhe os tipos do front já pensando nesses campos.
- **Perfis:** o front precisa ter os 4 modos (admin, vendedor, cobrador, indicador) com menus diferentes. O escopo de dados de verdade é responsabilidade do backend.
- **Prioridade:** a mesma da seção 6, sem as partes de backend.

## 1. Contexto

- **Repositório:** `GeovaneCRodrigues/sistema_emprestimos`.
- **Backend:** Express + Knex + MySQL.
- **Front atual:** Vue 3 em `front_nuxtui/`.
- **Marca:** o CredFácil vira **Mundo dos iPhones**.
  - Tema claro, verde esmeralda `#0f8f5f` com detalhe lima `#b8e35a`.
  - Fonte Plus Jakarta Sans. O Geovane não gosta da fonte atual.
  - Valores e cores exatos estão no `:root` do protótipo.
- **Foco do negócio:** venda de iPhone parcelada. Os empréstimos continuam existindo, mas em segundo plano.
- **Objetivo:** deixar o sistema pronto para uma equipe trabalhar nele: cobrador, vendedor e indicadores.

## 2. Regras de negócio (decididas pelo Geovane)

### 2.1 Lucro
- Em cada operação (venda ou empréstimo), o dinheiro que entra **primeiro devolve o capital investido**. Só o que passa disso é lucro.
- Se tem indicador ou sócio, o lucro do Geovane é só a parte dele: `lucro × (1 − % do indicador)`.
- Sem indicador, o lucro é tudo o que passou do capital.

### 2.2 Juros da venda parcelada (Simulador)
- Do preço de venda, **tira primeiro a entrada** (e o valor do aparelho dado na troca, se houver). O que sobra é o "valor parcelado".
- Sobre o valor parcelado entra **10% por parcela, juros simples, em até 10x**.
- Fórmula: `total = parcelado × (1 + 0,10 × n)` e `parcela = total ÷ n`, arredondando para cima no centavo.
- Exemplo do Geovane: preço 7.500 e entrada 1.500 deixam 6.000 pra parcelar.
  - 10x: total 12.000, ou seja, 10x de **1.200,00** (o dobro).
  - 6x: 6x de 1.600,00.
  - 5x: 5x de 1.800,00.
- O % (10) e o máximo de parcelas (10) precisam ser **configuráveis** em Configurações.
- **Pendente de confirmar com o Geovane:** se 1x também paga os 10%. No protótipo, paga.

### 2.3 Indicadores e repasse
- O indicador normalmente fica com **50% do lucro**, e só **depois que o capital voltou**.
- O **% fica congelado em cada operação** na hora da venda ou do empréstimo. Mudar o % do indicador depois não altera operações antigas.
  - O backend já tem `vendas.percentual_parceiro`.
  - Atenção: em `vendas` ele é `decimal(5,2)`, e em `operacoes` é `decimal(5,4)`, uma fração como 0,5. Confira a escala antes de calcular.
- **Repasse:** o Geovane paga o indicador quando quiser, total ou parcial, e registra data e forma (Pix, dinheiro ou transferência).
  - O pagamento vai **por indicador**, não por operação.
  - Para mostrar quanto falta em cada operação, os pagamentos abatem as operações da **mais antiga para a mais nova**.
- A tela precisa responder: "quanto já paguei pro Roberto, quanto falta e quanto vai liberar nos próximos meses".
- **Níveis do indicador** (números ainda **não confirmados** pelo Geovane):

  | Nível | Operações indicadas | % do lucro |
  |---|---|---|
  | Bronze | 0 | 30% |
  | Prata | 3 | 40% |
  | Ouro | 5 | 50% |
  | Diamante | 10 | 55% |

  - Tem uma opção de subir o % sozinho nas próximas operações, mas só se o % não tiver sido definido à mão.

### 2.4 Recebimento
- **Pagou o valor certo:** quita a parcela.
- **Pagou menos:** o admin escolhe entre duas opções.
  - "Fica devendo nesta parcela": a parcela continua aberta com o resto. **Nesse caso pede a nova data do restante** (+3, +7, +15 dias ou uma data escolhida; "manter" se ainda não venceu).
    - A parcela passa a vencer na nova data, sai dos atrasados e o lembrete do WhatsApp vai nessa data.
    - Guarde o vencimento antigo. `venda_parcelas.vencimento_original` já existe.
    - Nas Cobranças, mostre "remarcada (era dd/mm)".
    - As próximas parcelas continuam nas datas delas. Ainda falta o Geovane confirmar isso.
  - "Dar desconto": quita a parcela e o desconto sai do lucro. `venda_recebimentos.desconto` já existe.
- **Pagou mais:** o excedente abate as próximas parcelas, em ordem.
- Cada recebimento registra **data, valor, forma (Pix, dinheiro ou cartão) e quem recebeu**. Um recebimento que cobre várias parcelas é **uma transação só**: um recibo e um desfazer.
- **Recibo:** abre logo depois de confirmar e pode ser reaberto no histórico da operação. Ele tem:
  - nº do recibo, empresa e CNPJ;
  - cliente, valor e a que se refere ("parcela 2/12" ou "parcelas 2 a 4 de 12");
  - data, forma e quem recebeu;
  - quanto ainda falta e a próxima parcela.
  - O texto vai pro WhatsApp do cliente. No sistema real, de preferência com o PDF.
- **Desfazer** um recebimento volta tudo como estava.

### 2.5 Quem vê o quê (perfis)

| Perfil | Vê | Pode | Não pode |
|---|---|---|---|
| **Admin** | Tudo | Tudo, inclusive aprovar pedidos e conferir o fechamento do dia | — |
| **Vendedor** | Estoque com **preço de venda**, os clientes dele, as vendas dele, Simulador | Vender, mandar contrato, cadastrar cliente | Ver **custo e lucro** em qualquer tela; mexer em caixa ou repasse |
| **Cobrador** | Só a **carteira dele** (clientes com `responsável = ele`) | Dar baixa no que recebeu, mandar recibo, chamar no WhatsApp, fechar o dia | Dar desconto, acordo ou retomada sem aprovação; ver lucro, caixa da loja ou estoque |
| **Indicador** | Só os **clientes que ele indicou**, as parcelas deles e os repasses dele | Ver, chamar o cliente no WhatsApp, mandar indicação nova | **Dar baixa** ("só nós aqui damos baixa"); ver cliente de outro indicador |

- O cobrador **pede** desconto, acordo ou retomada, e o pedido vai para a fila "Esperando sua aprovação" do admin (tela Equipe). A parcela só muda quando o admin aprova.
- **Fechamento do dia do cobrador:** ele vê quanto recebeu em dinheiro e em Pix e toca em "Fechar o dia". Isso vai pro admin marcar como conferido.
- Hoje o perfil `INDICADORES` consegue puxar dados de todo mundo, o que é um **bug de escopo** conhecido. Todo endpoint precisa filtrar pelo perfil **no backend**, não só esconder na tela.

## 3. Telas (ver o protótipo)

No protótipo, a barra de cima tem **"Ver como: Admin | Indicador | Cobrador | Vendedor"** e **"Comparar menus"**, que mostra os quatro menus lado a lado.

Layout geral:
- Em tela larga (880px ou mais) fica um menu lateral.
- No celular fica uma barra embaixo com um botão central em destaque.
- Botões, não links, na navegação do celular.
- Campos de dinheiro usam máscara BRL que digita pelos centavos: digitar `400000` vira `4.000,00`.
- **Campos de data** (pedido do Geovane): aparecem como `dd/mm/aaaa`, dá pra digitar só os números (`08112026` vira `08/11/2026`) ou tocar no ícone e escolher num **calendário** que abre embaixo do campo, com atalhos "Hoje" e "Daqui a 30 dias". Dias fora do permitido (antes da data do empréstimo, no futuro para "quando recebeu") ficam apagados.
- Tudo o que é clicável (linhas de lista, cards, itens do menu) tem **hover** visível e cursor de mãozinha no computador, e foco visível no teclado. Pedido do Geovane.
- Toda modal tem um botão **"x"** redondo no canto de cima, à direita, **saindo um pouco pra fora** da modal (no celular, sai por cima da borda). Ele fica fora da área que rola, então está sempre visível. Esc e clicar fora também fecham. Pedido do Geovane.

### Admin
- **Barra de baixo:** Início, Cobranças, **Novo** (central), Estoque, Mais.
- **Botão Novo** (central no celular, e o botão de destaque da lateral no computador): abre a escolha entre **Venda de iPhone**, **Empréstimo** e **Só simular**. Pedido do Geovane.
- **Lateral (computador), em grupos** (pedido do Geovane):
  - **Dia a dia:** Início, Cobranças, Cronograma, Caixa, Simulador.
  - **Cadastros:** Clientes, Estoque, Operações, Contratos.
  - **Gestão:** Indicadores e repasses, Equipe, Relatórios.
  - **Configurações** fica sozinho no rodapé da lateral, logo acima do usuário.
- **Mais (celular):** os mesmos grupos, sem o que já está na barra de baixo, e Configurações por último.
- Nas cobranças, parcela atrasada mostra a **data de vencimento** ("venceu 01/09") além dos dias de atraso.
- **Início:** o que cobrar hoje, atrasados, vendas do mês, lucro no bolso.
- **Cobranças:**
  - abas Tudo / iPhones / Empréstimos;
  - filtro Atrasadas / Esta semana / Próximas / Recebidas;
  - cada linha tem WhatsApp e **Recebi**.
- **Operações:**
  - abas iPhones / Empréstimos, com **os mesmos 3 números no topo nas duas**: A receber, Capital na rua, Lucro por vir;
  - botão no topo "+ Venda" ou "+ Empréstimo", conforme a aba;
  - ficha da operação: recebido/falta, barra "seu capital de volta", linha do tempo das parcelas, últimos pagamentos com Recibo, renegociar/mudar vencimento, retomar aparelho.
- **Novo empréstimo em 3 passos** (pedido do Geovane):
  1. **Cliente e valor:** cliente, quanto vai emprestar, data do empréstimo (padrão: hoje) e indicação.
  2. **Como paga:**
     - Parcelado (capital + juros divididos) ou Só juros (o juro a cada parcela, e o capital junto da última);
     - de quanto em quanto tempo: Mensal, Quinzenal (15 dias), Semanal (7 dias) ou Diária (todo dia menos domingo, sempre parcelado);
     - quantidade de parcelas, com atalhos e campo pra digitar;
     - **juros:** no parcelado e na diária é **% no total**, padrão **30%**, atalhos 20/30/50/80/100% e campo livre (pode passar de 100%). No só juros é % por parcela;
     - campos **"Total que ele paga"** e **"Valor da parcela"** (no só juros, "Juro de cada parcela"). Mexeu em um, os outros e o % se ajustam.
  3. **Datas e confirmar:** 1º vencimento (sugere um período depois; no mensal, o mesmo dia do mês seguinte), lista de todas as parcelas com data, dia da semana e valor, e o resumo de total e lucro.
- **Cronograma:** tem **busca por nome do cliente** (ignora acento). Com busca, o calendário mostra só os dias dele e embaixo vêm todas as parcelas dele no mês.
- **Nova venda em 3 passos:** Aparelho, Cliente, Pagamento.
  - Pagamento tem preço, entrada, troca, parcelas de 1 a 10x, dia do vencimento e indicação.
  - Ao lado fica o resumo com juros, total, custo, parte do indicador, seu lucro e em qual parcela o capital volta.
- **Simulador:**
  - escolhe um aparelho do estoque ou digita o preço, e digita a entrada (atalhos 10/20/30/50%);
  - tabela de 1x a 10x com parcela, total e juros, mais a coluna "seu lucro" (que o vendedor não vê);
  - "Mandar pro cliente" monta o texto pro WhatsApp;
  - "Vender assim" abre a venda já preenchida.
- **Estoque:** disponível / encomendado / vendidos, custo e lucro de cada aparelho, e Simular ou Vender pela ficha do aparelho.
- **Indicadores e repasses:**
  - abas Repasses / Indicadores / Níveis / Já pagos;
  - por indicador mostra a pagar, já pago e vai liberar, e cada operação dele com o capital voltando;
  - "Pagar" (total ou parcial) e "Ver a área dele".
- **Equipe:**
  - pedidos esperando aprovação, com Aprovar/Recusar e "Conferido" no fechamento;
  - pessoas com carteira, recebido no mês e atrasos;
  - convidar alguém (vendedor ou cobrador).
- **Configurações:** juros da venda parcelada, WhatsApp da loja (QR), lembretes, mensagens, diárias, resumo do dia, números do bot.
- **Contratos, Relatórios, Cronograma e Caixa:** ver o protótipo. Quase tudo já existe no backend.

### Cobrador
- **Barra de baixo:** Hoje, Carteira, **Recebi** (central), Caixa, Pedidos.
- **Hoje:** quanto cobrar hoje, depois atrasadas, vencem hoje e próximos 7 dias. Cada linha tem WhatsApp e Recebi.
- **Carteira:** os clientes dele, filtrados por todos / atrasados / em dia. A ficha do cliente tem Recebi, Pedir desconto, Pedir acordo e Pedir retomada.
- **Meu caixa:** dinheiro na mão, Pix e total do dia, a lista do que recebeu com Recibo e o botão **Fechar o dia**.
- **Pedidos:** os que esperam o Geovane e os já respondidos.

### Vendedor
- **Barra de baixo:** Início, Estoque, **Vender** (central), Clientes, Vendas. O Simulador fica na lateral e no Início.
- O fluxo de venda é o mesmo do admin, **sem custo nem lucro** em nenhum lugar.
- **Início:** vendas do mês, contratos esperando assinatura (com Reenviar), aparelhos disponíveis e clientes dele com atraso.

### Indicador
- **Barra de baixo:** Início, Clientes, **Indicar** (central), Cobrança, Repasse. A lateral também tem Níveis.
- **Início:** quanto tem pra receber, quanto já recebeu e quanto ainda vai ganhar, além do nível e quanto falta pro próximo.
- **Clientes:** cada cliente com o que já pagou, o que falta e a sua parte, e o status de cada parcela.
- **Cobrança:** só para olhar, com o aviso "Quem dá baixa é a loja". Tem duas vistas:
  - **Lista:** Atrasadas, Esta semana, Próximas e Pagas.
  - **Calendário:** o cronograma do mês só com os clientes dele (previsto, recebido e em atraso, e as parcelas do dia escolhido), igual ao Cronograma do admin, mas sem botão de dar baixa. Pedido do Geovane.
- **Repasse:** valor por cliente e repasses recebidos.
- **Indicar:** manda o nome e o telefone, e o pedido aparece pro admin como "Indicações esperando". O admin aceita e a pessoa vira cliente.
- Ele vê **vendas e empréstimos** que indicou.

## 4. O que já existe no backend (branch `feat/credfacil-ui`)

Lido nas migrations em `backend/src/database/migrations`:
- **Clientes:** CPF único, endereço, RG e origem.
- **Usuários:** `users.perfil` = `ADMIN | OPERADOR | INDICADORES`.
- **Indicadores:** tabela `indicadores`, com WhatsApp.
- **Empréstimos:** `operacoes` (com `percentual_parceiro`, periodicidade incluindo diária), `cronograma_pagamentos`, recebimentos/baixas, `acordos` e repasses de empréstimo.
- **Vendas:**
  - `bens` (estoque, com estados `ENCOMENDADO | DISPONIVEL | VENDIDO`);
  - `vendas`, `venda_parcelas` (com `vencimento_original`) e `venda_recebimentos` (`ENTRADA | TROCA | PARCELA`, com `desconto`);
  - `venda_repasses` (tem `usuario_id`), `venda_ajustes` (reparcelamento, antes e depois) e retomada.
- **Caixa:** `movimentacoes_caixa` (`APORTE | RETIRADA`, sem `DESPESA`).
- **Contratos:** `empresa_config`, `contrato_modelos`, `contratos` + ZapSign.
- **WhatsApp:** lembretes, bot, números do bot e logs.

## 5. O que falta no banco e na API (proposta)

1. **Perfis:** adicionar `VENDEDOR` e `COBRADOR` ao enum de `users.perfil`, e decidir o que fazer com `OPERADOR`.
2. **Responsável pelo cliente:** `clientes.responsavel_id` → `users.id`. É a carteira do cobrador e do vendedor.
3. **Vendedor da venda:** `vendas.vendedor_id` → `users.id`.
4. **Recebimento:** em `venda_recebimentos` e nos recebimentos de empréstimo:
   - `forma_pagamento` (`PIX | DINHEIRO | CARTAO`);
   - `recebido_por` (`users.id`);
   - `transacao_id` (agrupa as parcelas pagas de uma vez; serve pro recibo e pro desfazer);
   - `numero_recibo`.
5. **Remarcação do restante:** quando o pagamento é parcial, atualiza `vencimento` e preenche `vencimento_original` (para empréstimos, criar o mesmo campo).
6. **Pedidos de aprovação:** tabela `aprovacoes`.
   - Campos: `tipo` (`DESCONTO | ACORDO | RETOMADA | FECHAMENTO`), `solicitado_por`, `operacao` (venda ou empréstimo), `parcela`, `valor`, `motivo`, `status` (`PENDENTE | APROVADO | RECUSADO`), `respondido_por`, datas.
   - A ação só é aplicada quando aprovada.
7. **Fechamento do dia:** tabela `fechamentos_caixa`, com usuário, data, total em dinheiro, total em Pix, status e quem conferiu.
8. **Repasse por indicador:** hoje `venda_repasses` é por venda. A proposta é um pagamento por indicador (`indicador_id`, valor, data, forma), com a distribuição por operação **calculada**, da mais antiga para a mais nova. Pode ser a tabela nova `repasses_indicador`, ou distribuir nas tabelas atuais ao gravar.
9. **Níveis:** `niveis_indicador` (nome, mínimo de operações, %) e uma flag de subir sozinho em `sistema_config`. Também `indicadores.pct_manual`.
10. **Juros da venda:** `juros_parcela_pct` (10) e `max_parcelas` (10) em `sistema_config` ou `empresa_config`.
11. **Indicações (leads):** tabela `indicacoes` com indicador, nome, telefone, o que quer, status e cliente criado.
12. **Despesa no caixa:** adicionar `DESPESA` ao enum de `movimentacoes_caixa.tipo`.
13. **Registro de auditoria:** quem fez cada baixa, desconto, desfazer, mudança de vencimento e aprovação. Pode reaproveitar o padrão de `venda_ajustes` (antes/depois + `usuario_id`).
14. **Escopo por perfil em todos os endpoints:** cobrador e vendedor só veem a carteira deles, e indicador só o que ele indicou. Isso também corrige o bug atual dos `INDICADORES`.

## 6. Ordem sugerida (um PR em rascunho por parte)

1. **Visual e navegação:** marca nova, tema, fonte, menu lateral e barra de baixo do admin; Início, Cobranças, Operações (abas) e Estoque, usando só o backend que já existe.
2. **Venda e Simulador:** regra dos 10% por parcela (configurável), Simulador, Nova venda em 3 passos com o resumo de lucro.
3. **Recebimento novo:** parcial com nova data, a mais abatendo as próximas, forma de pagamento, quem recebeu, transação, recibo (WhatsApp) e desfazer.
4. **Indicadores:** repasse por indicador com distribuição, níveis, área do indicador (só leitura) e indicações.
5. **Equipe:** perfis vendedor e cobrador, carteira, áreas de cada um, pedidos de aprovação, fechamento do dia, auditoria e escopo no backend.

Em cada PR: rode o lint, o build e os testes que o repositório tiver. Mostre a tela ao Geovane com um link de prévia; ele prefere link a print. Não faça merge sem o OK dele.

## 7. Como conferir (exemplos que precisam bater)

- **Simulador:** 7.500 − 1.500 de entrada dá 10x de 1.200,00 (total 12.000 + 1.500 de entrada), 6x de 1.600,00 e 5x de 1.800,00.
- **Lucro com indicador:** aparelho com custo 2.500, vendido com total 4.000, indicador com 50%. O lucro total é 1.500. Os primeiros 2.500 recebidos são capital; depois disso, cada real recebido é lucro, dividido meio a meio.
- **Pagamento parcial:**
  - Parcela de 800 vencida em 01/09, cliente paga 100 em 08/10 e escolhe "+7 dias".
  - Resultado: a parcela fica com 700 e vence 15/10, `vencimento_original` = 01/09, e ela sai dos atrasados.
  - O recibo diz "ainda ficam 700,00, para 15/10".
- **Pagamento a mais:** parcelas de 300 e cliente paga 750. Quita a atual e a próxima, e abate 150 da seguinte. É uma transação e um recibo só.
- **Empréstimo:** 3.000 a 30% no total em 6x dá 3.900 (6x de 650,00). Digitando 6.000 de total, o % vira 100% (6x de 1.000,00). Digitando parcela de 700 em 6x, total 4.200 e 40%. Só juros, 1.000 a 10% em 6x: 5x de 100,00 e a última de 1.100,00. Parcela arredonda pra cima no centavo. Semanal com 1º vencimento em 15/10: 15/10, 22/10, 29/10…
- **Vendedor:** em nenhuma tela ou resposta da API aparece custo (`valor_compra`, `valor_investido`) ou lucro.
- **Indicador:** a API não devolve cliente de outro indicador, nem com o id na URL.

## 8. Ainda em aberto com o Geovane

- 1x paga os 10% ou fica sem juros?
- Na remarcação do restante, as próximas parcelas ficam nas datas delas? (Assumido que sim.)
- Os números dos níveis.
- A equipe vai ser de cobrador na rua, de gente na loja, ou os dois? (Assumido: cobrador na rua e vendedor na loja.)
- O que fazer com o perfil `OPERADOR` atual.

## 9. Arquivos deste pacote

- `PLANO-MUNDO-DOS-IPHONES.md`: este documento.
- `docs/prototipo/proto-iphone.html`: o protótipo completo, num arquivo só. Abra no navegador.
- `prototipo/modulos/*.js`: os mesmos trechos do protótipo, separados por assunto, só para leitura:
  - contratos, relatórios/configurações, repasses, área do indicador, equipe e recibo, simulador e comparação de menus.
  - O que vale é o HTML.
- O código do protótipo é JavaScript puro com dados de exemplo. **Não copie a estrutura dele.** Use-o como especificação de telas, textos e cálculos (`contas`, `contasEmp`, `repassesDoIndicador`, `previsaoRepasse`, `planoParc`, `registrar`).
