import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { NotificacoesApi } from './notificacoes'
import { criarNotificacoesFake } from './notificacoes.fake'

const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const COBRADOR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const VENDEDOR: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }

let api: NotificacoesApi
beforeEach(() => { api = criarNotificacoesFake(() => new Date('2026-10-08T12:00:00.000Z')) })

describe('avisos do sino (demonstração)', () => {
  it('o administrador começa com avisos, o mais novo primeiro, e o contador só conta os não lidos', async () => {
    const l = await api.listar(ADMIN)
    expect(l.itens.length).toBeGreaterThan(1)
    expect(l.itens[0].texto).toMatch(/atrasadas|assinado|Recebido|desconto/)
    expect(l.itens.map((n) => n.id)).toEqual([...l.itens.map((n) => n.id)].sort((a, b) => b - a))
    expect(l.naoLidas).toBe(l.itens.filter((n) => !n.lida).length)
    expect(l.itens.some((n) => n.lida)).toBe(true)
  })
  it('cada perfil só enxerga os próprios avisos; quem não recebe vê a lista vazia', async () => {
    const adm = await api.listar(ADMIN)
    const cob = await api.listar(COBRADOR)
    expect(cob.itens.map((n) => n.id).filter((i) => adm.itens.some((a) => a.id === i))).toEqual([])
    expect(await api.listar(VENDEDOR)).toEqual({ itens: [], naoLidas: 0 })
  })
  it('marcar um como lido baixa o contador em um', async () => {
    const antes = await api.listar(ADMIN)
    const alvo = antes.itens.find((n) => !n.lida)!
    await api.marcarLida(ADMIN, alvo.id)
    const depois = await api.listar(ADMIN)
    expect(depois.naoLidas).toBe(antes.naoLidas - 1)
    expect(depois.itens.find((n) => n.id === alvo.id)?.lida).toBe(true)
  })
  it('marcar o aviso de outro perfil ou um que não existe: 404', async () => {
    const dele = (await api.listar(COBRADOR)).itens[0]
    const e = await api.marcarLida(ADMIN, dele.id).catch((x) => x)
    expect(e).toBeInstanceOf(ErroApi)
    expect((e as ErroApi).status).toBe(404)
    expect(((await api.marcarLida(ADMIN, 99999).catch((x) => x)) as ErroApi).status).toBe(404)
  })
  it('marcar todas zera só as do próprio perfil', async () => {
    const cobAntes = (await api.listar(COBRADOR)).naoLidas
    await api.marcarTodas(ADMIN)
    expect((await api.listar(ADMIN)).naoLidas).toBe(0)
    expect((await api.listar(COBRADOR)).naoLidas).toBe(cobAntes)
  })
})
