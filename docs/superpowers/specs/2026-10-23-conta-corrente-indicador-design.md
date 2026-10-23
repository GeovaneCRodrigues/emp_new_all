# Conta corrente do indicador com a loja

Data: 23/10/2026 · Status: **aguardando revisão do Geovane** (nada foi implementado)

## 1. O que o Geovane quer (e o que eu assumi)

**Dito por ele**
- Às vezes o cliente paga na conta pessoal do indicador, e o indicador repassa para a loja depois.
- Às vezes a loja usa o dinheiro que está na conta do indicador para pagar um empréstimo novo.
- O indicador marca "caiu na minha conta" no Recebi; daí vira uma **conta corrente** dele com a loja.
- Quando ele transferir para a loja, ele informa que enviou (ex.: R$ 1.000) na própria conta corrente.
- Na hora de lançar um empréstimo novo, o administrador diz que **saiu da conta do indicador**.
- Aprovou os três lançamentos: *caiu na minha conta*, *enviei para a loja*, *saiu da conta do indicador*.

**Assumido (para ele corrigir)**
- O "enviei R$ X" do indicador é **confirmado pelo administrador**, como o Recebi. Só depois disso o saldo diminui e o dinheiro entra no Caixa.
- O administrador também pode lançar um envio direto, sem esperar o aviso (viu o Pix chegar).
- A **comissão** que a loja paga ao indicador (Repasse) **continua separada**. Abater uma conta na outra fica para uma segunda etapa.

**Sucesso =** o administrador vê, para cada indicador, quanto dinheiro de cliente está parado com ele; o Caixa só conta o dinheiro quando ele chega à loja; o empréstimo pago com o dinheiro do indicador não tira nada do Caixa; e nada disso exige baixa manual.

## 2. O que já existe (e que esta mudança reaproveita)

A migração do sistema antigo já deixou duas peças prontas, usadas hoje só pelos dados importados:

- `transacoes_recebimento.cobrado_por_indicador_id`: "o indicador cobrou direto do cliente". O Caixa **já ignora** essas transações até o repasse (`caixa/models/repository.ts`, ramo `R`).
- `movimentacoes_caixa` com `tipo = 'TRANSFERENCIA_INDICADOR'` (`indicador_id`, `lado`, `valor`, `data`): o dinheiro que o indicador **envia** à loja. O Caixa **já conta** como entrada ("Repasse do indicador").

Em produção hoje: 25 recebimentos cobrados pelo indicador e 3 transferências (R$ 8.435,00). Só o DEDA tem lançamentos: **cobrou R$ 12.020,00, transferiu R$ 8.435,00, ou seja, deve R$ 3.585,00** à loja. Esse será o saldo de abertura dele, sem nenhuma migração de dados. Confira se o número bate com o que você sabe.

O que **não** existe: nenhuma tela ou rota cria essas duas coisas (só a importação cria), não há como marcar "saiu da conta do indicador" no empréstimo, e não há tela da conta corrente.

## 3. Regra: o saldo não é guardado, é calculado

```
saldo do indicador  =  Σ recebimentos cobrados por ele (não desfeitos)
                     − Σ transferências dele para a loja
                     − Σ empréstimos pagos com a conta dele (não cancelados)
```

- **Positivo:** ele deve esse valor à loja. **Negativo:** a loja deve a ele (ele adiantou mais do que recebeu).
- Como é uma soma, **desfazer um recebimento ou cancelar um empréstimo corrige o saldo sozinho**. Não há saldo gravado para ficar errado.

## 4. Os três lançamentos

| # | Lançamento | Quem faz | Efeito no saldo | Efeito no Caixa |
|---|---|---|---|---|
| 1 | **Caiu na minha conta** | Indicador marca no Recebi (inclusive no "quitou tudo"). O administrador confirma e pode desmarcar ou marcar na confirmação. | + (ele passa a dever) | Nenhum: o dinheiro está com ele |
| 2 | **Enviei R$ X para a loja** | Indicador informa (valor, data, comprovante) e o administrador confirma; ou o administrador lança direto | − | Entra na data do envio (já é assim hoje) |
| 3 | **Saiu da conta do indicador** | Administrador, ao lançar o empréstimo novo: escolhe o indicador e o valor (pode ser só parte) | − | Sai do Caixa só a parte que **não** veio da conta dele |

Detalhes:

1. A baixa continua sendo uma baixa normal: parcela paga, recibo emitido, cliente quite. A marca só decide **de quem é o dinheiro** (`cobrado_por_indicador_id` na transação).
2. Envio maior que o saldo é aceito, com aviso na confirmação ("passa do que ele devia"): vira crédito dele.
3. Empréstimo pago em parte pela conta dele: o Caixa registra a saída só do restante. A linha do empréstimo no extrato do Caixa mostra "R$ X da conta do indicador".

## 5. Mudanças nos dados

- `emprestimos.saiu_da_conta_indicador_id` (FK nullable) e `emprestimos.saiu_da_conta_valor` (numeric, default 0). A linha de empréstimo do Caixa passa a subtrair esse valor.
- Tabela nova `envios_indicador` (`indicador_id`, `valor`, `data`, `comprovante`, `status PENDENTE|CONFIRMADO|RECUSADO`, `solicitado_por`, `respondido_por/em`, `resposta`, `movimentacao_id`). Ao confirmar, cria o `TRANSFERENCIA_INDICADOR` em `movimentacoes_caixa` na mesma transação.
- `aprovacoes` (tipo `BAIXA`): `dados.naContaDoIndicador` (boolean). Na confirmação, grava `cobrado_por_indicador_id` da transação.
- Uma migração só, sem tocar nos dados atuais.

## 6. Telas

- **Indicador**
  - Recebi / "quitou tudo": opção **"Caiu na minha conta"**.
  - Nova área **"Minha conta com a loja"** (no Início e no menu Repasse): saldo, extrato (cobrado, enviado, usado em empréstimo) e botão **"Informar envio"**.
- **Administrador**
  - Equipe → *Esperando você*: o aviso de baixa mostra "caiu na conta de [indicador]" (editável) e o **envio** do indicador aparece como cartão novo, com Confirmar e Recusar.
  - Indicadores → ficha: aba **Conta corrente** (saldo, extrato, botão *Lançar envio*).
  - Novo empréstimo: campo **"De onde sai o dinheiro?"**: *Caixa da loja* (padrão) ou *Conta do indicador* + indicador + valor.
  - O cartão do Início "Quanto está com os indicadores" fica para a etapa 2.
- Dinheiro sempre com máscara BRL; celular e computador.

## 7. Casos de borda

- **Desfazer recebimento** que estava na conta do indicador: o saldo cai sozinho.
- **Empréstimo cancelado** que usou a conta dele: o valor volta ao saldo dele.
- **Acordo com "dinheiro novo"** saindo da conta do indicador: fica **fora desta etapa**; hoje continua saindo do Caixa.
- **Venda de iPhone**: o Recebi do indicador também pode marcar "caiu na minha conta" (mesma regra).
- **Indicador sem usuário/inativo**: o administrador ainda lança envio e vê a conta.
- **Concorrência**: confirmar o mesmo aviso ou envio duas vezes devolve 409, igual ao Recebi de hoje.

## 8. Testes

- Back, com Postgres: saldo derivado em cada lançamento; Caixa não conta o cobrado até o envio; empréstimo parcialmente pago pela conta tira só o restante do Caixa; desfazer e cancelar corrigem o saldo; confirmar duas vezes; permissões (indicador só vê a conta dele; só o administrador confirma).
- Front: fakes iguais ao back; unitários do cálculo.
- Ponta a ponta no desktop e no celular: o fluxo completo (cobrei na minha conta → informei o envio → administrador confirma → saldo zera) e o empréstimo "saiu da conta do indicador".

## 9. Entrega em etapas (uma PR por etapa, merge só com OK)

1. **Back + administrador:** marca "caiu na conta" na confirmação da baixa, envio lançado pelo administrador, "saiu da conta do indicador" no empréstimo, conta corrente do indicador na ficha dele.
2. **Indicador:** marca no Recebi, "Minha conta com a loja", informar envio e confirmação pelo administrador.
3. *(depois, se quiser)* abater a comissão da conta, acordo com dinheiro novo da conta do indicador, aviso por WhatsApp.

## 10. Perguntas abertas

1. O "enviei" do indicador é confirmado pelo administrador? (assumido: sim)
2. O saldo de abertura do DEDA (deve R$ 3.585,00) confere?
3. Posso começar pela etapa 1?
