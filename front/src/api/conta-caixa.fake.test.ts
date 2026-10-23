import { describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { criarCaixaFake } from './caixa.fake'
import { criarClientesFake } from './clientes.fake'
import { criarContaIndicadorFake } from './contaIndicador.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarAprovacoesFake } from './equipe.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarRepassesFake } from './repasses.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/conta-indicador.test.ts (Caixa, desfazer, envio): a demonstração tem de se comportar como o back.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const HOJE = '2026-10-08'

function mundo() {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake(); const estoque = criarEstoqueFake()
  const vendas = criarVendasFake({ estoque, indicadores, clientes })
  const emprestimos = criarEmprestimosFake({ clientes, indicadores })
  const conta = criarContaIndicadorFake({ indicadores, hoje: () => HOJE, transacoes: () => vendas._interno.transacoes, emprestimos: () => emprestimos._interno.registros })
  const recebimentos = criarRecebimentosFake(vendas, emprestimos)
  const apr = criarAprovacoesFake(vendas, emprestimos, undefined, recebimentos)
  const repasses = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: HOJE })
  const caixa = criarCaixaFake({ vendas, emprestimos, estoque, repasses, conta })
  const itens = async () => { const r = []; for (let p = 1; ; p++) { const x = await caixa.ver(ADMIN, { pagina: p, limite: 100 }); r.push(...x.itens); if (r.length >= x.total) return r } }
  const emp = async (extra: object = {}) => (await emprestimos.criar(ADMIN, { clienteId: 3, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId: 1, ...extra })).id
  /** o indicador avisa a parcela 1 do empréstimo e a loja confirma; `naConta` decide se o dinheiro ficou com ele */
  async function baixa(op: number, naConta: boolean) {
    const p = await apr.pedirBaixa(IND1, { alvo: 'EMPRESTIMO', operacaoId: op, parcela: 1, valor: 650, forma: 'PIX' })
    const r = await apr.aprovar(ADMIN, p.id, { naContaDoIndicador: naConta })
    return r.recibo!.id
  }
  const registro = (id: number) => emprestimos._interno.registros.find((r) => r.id === id)!
  return { conta, caixa, recebimentos, itens, emp, baixa, registro }
}

describe('o Caixa e a conta do indicador (demonstração)', () => {
  it('baixa marcada "na conta do indicador" NÃO entra no Caixa; sem marcar, entra', async () => {
    const m = mundo()
    const a = await m.baixa(await m.emp(), true)
    const b = await m.baixa(await m.emp(), false)
    const chaves = (await m.itens()).map((i) => i.chave)
    expect(chaves).not.toContain(`R${a}`)
    expect(chaves).toContain(`R${b}`)
  })
  it('desfazer o recebimento que estava na conta do indicador tira do saldo', async () => {
    const m = mundo()
    const antes = (await m.conta.ver(ADMIN, 1)).saldo
    const id = await m.baixa(await m.emp(), true)
    expect((await m.conta.ver(ADMIN, 1)).saldo).toBe(antes + 650)
    await m.recebimentos.desfazer(ADMIN, id)
    expect((await m.conta.ver(ADMIN, 1)).saldo).toBe(antes)
  })
  it('empréstimo pago em parte pela conta do indicador: o Caixa só perde o resto, e o extrato diz de quem foi', async () => {
    const m = mundo()
    const e = await m.emp({ saiuDaConta: { indicadorId: 1, valor: 600 } })
    const linha = (await m.itens()).find((i) => i.chave === `E${e}`)!
    expect(linha).toMatchObject({ valor: 400, entrada: false })
    expect(linha.sub).toContain('R$ 600,00 da conta do indicador')
  })
  it('empréstimo pago todo pela conta do indicador: não aparece no Caixa', async () => {
    const m = mundo()
    const e = await m.emp({ saiuDaConta: { indicadorId: 1, valor: 1000 } })
    expect((await m.itens()).some((i) => i.chave === `E${e}`)).toBe(false)
  })
  it('empréstimo cancelado devolve o valor ao saldo do indicador', async () => {
    const m = mundo()
    const antes = (await m.conta.ver(ADMIN, 1)).saldo
    const e = await m.emp({ saiuDaConta: { indicadorId: 1, valor: 600 } })
    expect((await m.conta.ver(ADMIN, 1)).saldo).toBe(antes - 600)
    m.registro(e).status = 'CANCELADA'
    expect((await m.conta.ver(ADMIN, 1)).saldo).toBe(antes)
  })
  it('o envio lançado entra no Caixa como "Repasse do indicador"', async () => {
    const m = mundo()
    await m.conta.lancarEnvio(ADMIN, 1, { valor: 250, lado: 'EMPRESTIMO' })
    const t = (await m.itens()).filter((i) => i.categoria === 'TRANSFERENCIA' && i.valor === 250)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ entrada: true, lado: 'EMPRESTIMO' })
  })
})
