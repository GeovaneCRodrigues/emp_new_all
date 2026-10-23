import { describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarContaIndicadorFake } from './contaIndicador.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarIndicadoresFake } from './indicadores.fake'

const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

function mundo() {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  const conta = criarContaIndicadorFake({ indicadores, hoje: () => '2026-10-08' })
  return { conta, emp: criarEmprestimosFake({ clientes, indicadores, conta }) }
}
const base = { clienteId: 3, modalidade: 'PARCELADO' as const, capital: 1000, taxa: 30, parcelas: 2 }

describe('empréstimo "saiu da conta do indicador" (demonstração)', () => {
  it('registra na conta do indicador (de qualquer indicador) e baixa o saldo', async () => {
    const { conta, emp } = mundo()
    await emp.criar(ADMIN, { ...base, indicadorId: 1, saiuDaConta: { indicadorId: 2, valor: 600 } })
    expect(await conta.ver(ADMIN, 2)).toMatchObject({ saldo: -600, emprestou: 600 })
  })
  it('valor igual ao capital vale; sem saiuDaConta nada muda', async () => {
    const { conta, emp } = mundo()
    await emp.criar(ADMIN, { ...base, saiuDaConta: { indicadorId: 2, valor: 1000 } })
    await emp.criar(ADMIN, { ...base })
    expect((await conta.ver(ADMIN, 2)).emprestou).toBe(1000)
  })
  it.each([['maior que o capital', { indicadorId: 2, valor: 1000.01 }], ['zero', { indicadorId: 2, valor: 0 }], ['negativo', { indicadorId: 2, valor: -5 }], ['texto', { indicadorId: 2, valor: '300' }], ['sem indicador', { valor: 300 }], ['indicador inexistente', { indicadorId: 999, valor: 300 }]])('valor %s: 400 e nada é criado', async (_n, saiuDaConta) => {
    const { conta, emp } = mundo()
    const antes = (await emp.listar(ADMIN, { limite: 200 })).total
    expect((await falha(emp.criar(ADMIN, { ...base, saiuDaConta } as never)))?.status).toBe(400)
    expect((await emp.listar(ADMIN, { limite: 200 })).total).toBe(antes)
    expect((await conta.ver(ADMIN, 2)).emprestou).toBe(0)
  })
})
