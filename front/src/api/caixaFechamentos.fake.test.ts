import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import type { CaixaApi } from './caixa'
import { criarCaixaFake } from './caixa.fake'
import type { CaixaFechamentosApi } from './caixaFechamentos'
import { criarCaixaFechamentosFake } from './caixaFechamentos.fake'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarRepassesFake } from './repasses.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/caixa-fechamentos.test.ts. O "hoje" da demonstração é 08/10/2026.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const OUTROS: Sessao[] = [{ perfil: 'VENDEDOR', usuarioId: 2 }, { perfil: 'COBRADOR', usuarioId: 3 }, { perfil: 'INDICADOR', indicadorId: 1 }]
const HOJE = '2026-10-08'
const ONTEM = '2026-10-07'

let caixa: CaixaApi, api: CaixaFechamentosApi
beforeEach(() => {
  const estoque = criarEstoqueFake()
  const indicadores = criarIndicadoresFake()
  const clientes = criarClientesFake()
  const vendas = criarVendasFake({ estoque, indicadores, clientes })
  const emprestimos = criarEmprestimosFake({ clientes, indicadores })
  const repasses = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: HOJE })
  caixa = criarCaixaFake({ vendas, emprestimos, estoque, repasses })
  api = criarCaixaFechamentosFake({ caixa, hoje: HOJE })
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

describe('quem pode', () => {
  it('só o administrador', async () => {
    for (const s of OUTROS) {
      expect((await falha(api.listar(s)))?.status).toBe(403)
      expect((await falha(api.previa(s, ONTEM)))?.status).toBe(403)
      expect((await falha(api.fechar(s, { dia: ONTEM })))?.status).toBe(403)
      expect((await falha(api.desfazer(s, 1)))?.status).toBe(403)
    }
  })
})

describe('o último dia fechado', () => {
  it('a demonstração já começa com um fechamento antigo (para mostrar o alerta de dias sem fechar)', async () => {
    const l = await api.listar(ADMIN)
    expect(l.hoje).toBe(HOJE)
    expect(l.ultimo?.dia).toBe('2026-10-05')
    expect(l.diasSemFechar).toBe(2) // 06 e 07
  })

  it('fecha ontem: vira o último, com a observação, e não há dias sem fechar', async () => {
    const f = await api.fechar(ADMIN, { dia: ONTEM, obs: '  conferi o pix  ' })
    expect(f).toMatchObject({ dia: ONTEM, obs: 'conferi o pix' })
    const l = await api.listar(ADMIN)
    expect(l.ultimo?.id).toBe(f.id)
    expect(l.diasSemFechar).toBe(0)
    expect(l.itens[0].id).toBe(f.id)
  })

  it('pode fechar o mesmo dia de novo, mas não um dia anterior ao último; hoje pode, amanhã não', async () => {
    await api.fechar(ADMIN, { dia: '2026-10-06' })
    expect((await api.fechar(ADMIN, { dia: '2026-10-06' })).dia).toBe('2026-10-06')
    const antes = await falha(api.fechar(ADMIN, { dia: '2026-10-05' }))
    expect(antes?.status).toBe(409)
    expect(antes?.codigo).toBe('DIA_ANTERIOR_AO_FECHADO')
    expect((await api.fechar(ADMIN, { dia: HOJE })).dia).toBe(HOJE)
    expect((await falha(api.fechar(ADMIN, { dia: '2026-10-09' })))?.status).toBe(400)
  })

  it('recusa dia inválido e observação grande demais', async () => {
    for (const dia of ['', '08/10/2026', '2026-02-30']) expect((await falha(api.fechar(ADMIN, { dia })))?.status).toBe(400)
    expect((await falha(api.fechar(ADMIN, { dia: ONTEM, obs: 'x'.repeat(201) })))?.status).toBe(400)
  })
})

describe('desfazer', () => {
  it('desfaz só o último; o anterior volta a ser o último', async () => {
    const a = (await api.listar(ADMIN)).ultimo!
    const b = await api.fechar(ADMIN, { dia: ONTEM })
    expect((await falha(api.desfazer(ADMIN, a.id)))?.status).toBe(409)
    await api.desfazer(ADMIN, b.id)
    expect((await api.listar(ADMIN)).ultimo?.id).toBe(a.id)
    expect((await falha(api.desfazer(ADMIN, 9999)))?.status).toBe(404)
  })
})

describe('o resumo para conciliar antes de fechar', () => {
  it('do dia seguinte ao último fechado até o dia escolhido, somando o que entrou e saiu', async () => {
    const p = await api.previa(ADMIN, ONTEM)
    expect(p).toMatchObject({ de: '2026-10-06', ate: ONTEM })
    expect(p.itens.every((i) => i.data >= p.de && i.data <= p.ate)).toBe(true)
    const entrou = p.itens.filter((i) => i.entrada).reduce((t, i) => t + i.valor, 0)
    const saiu = p.itens.filter((i) => !i.entrada).reduce((t, i) => t + i.valor, 0)
    expect(p.entrou).toBeCloseTo(entrou, 2)
    expect(p.saiu).toBeCloseTo(saiu, 2)
    expect(p.saldo).toBeCloseTo(entrou - saiu, 2)
    expect(p.porLado.EMPRESTIMO.entrou + p.porLado.IPHONE.entrou + p.porLado.SEM_LADO.entrou).toBeCloseTo(p.entrou, 2)
    expect(p.cortado).toBe(false)
  })

  it('fechar o mesmo dia de novo mostra só aquele dia', async () => {
    await api.fechar(ADMIN, { dia: '2026-10-06' })
    expect(await api.previa(ADMIN, '2026-10-06')).toMatchObject({ de: '2026-10-06', ate: '2026-10-06' })
  })

  it('um lançamento do dia aparece e soma no resumo', async () => {
    await caixa.lancar(ADMIN, { tipo: 'DESPESA', lado: 'IPHONE', valor: 77, data: ONTEM, obs: 'frete' })
    const p = await api.previa(ADMIN, ONTEM)
    expect(p.itens.some((i) => i.titulo === 'frete' && !i.entrada && i.valor === 77)).toBe(true)
    expect(p.porLado.IPHONE.saiu).toBeGreaterThanOrEqual(77)
  })

  it('recusa dia futuro, inválido ou antes do último fechado', async () => {
    expect((await falha(api.previa(ADMIN, '2026-10-09')))?.status).toBe(400)
    expect((await falha(api.previa(ADMIN, 'banana')))?.status).toBe(400)
    expect((await falha(api.previa(ADMIN, '2026-10-04')))?.status).toBe(409)
  })
})
