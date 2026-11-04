import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATRASO_MS, MINIMO_MS, useCarregando } from '@/composables/useCarregando'
import { useToast } from '@/composables/useToast'
import { comFeedback, ehAcao } from './comFeedback'

const resposta = (status: number, corpo: unknown = {}) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }))

beforeEach(() => { vi.useFakeTimers(); useToast().fechar() })
afterEach(() => { vi.runAllTimers(); vi.useRealTimers() })

describe('ehAcao: o que é ação do usuário', () => {
  it.each([['POST', '/api/vendas'], ['PATCH', '/api/clientes/1'], ['PUT', '/api/contratos/modelo'], ['DELETE', '/api/caixa/fechamentos/3']])('%s %s sim', (m, u) => { expect(ehAcao(m, u)).toBe(true) })
  it.each([['GET', '/api/vendas'], ['get', '/api/vendas'], ['HEAD', '/api/vendas'],
    ['POST', '/api/auth/login'], ['POST', '/api/auth/renovar'], ['POST', '/api/notificacoes/3/lida'], ['POST', '/api/notificacoes/lidas'],
    ['POST', 'http://x.com/api/contratos/modelo/previa']])('%s %s não', (m, u) => { expect(ehAcao(m, u)).toBe(false) })
})

describe('comFeedback', () => {
  it('consulta (GET) passa direto, sem loading nem toast', async () => {
    const r = await comFeedback('GET', '/api/vendas', async () => resposta(200))
    expect(r.status).toBe(200)
    expect(useToast().aviso.value).toBeNull()
  })
  it('deu certo: toast verde "Feito."', async () => {
    await comFeedback('POST', '/api/vendas', async () => resposta(201))
    expect(useToast().aviso.value).toMatchObject({ mensagem: 'Feito.', tipo: 'ok' })
  })
  it('apagar: "Removido."', async () => {
    await comFeedback('DELETE', '/api/caixa/fechamentos/1', async () => resposta(204))
    expect(useToast().aviso.value).toMatchObject({ mensagem: 'Removido.', tipo: 'ok' })
  })
  it('o servidor recusou: toast vermelho com a mensagem dele, e a resposta segue para a tela', async () => {
    const r = await comFeedback('POST', '/api/vendas', async () => resposta(409, { erro: 'Aparelho já vendido' }))
    expect(useToast().aviso.value).toMatchObject({ mensagem: 'Aparelho já vendido', tipo: 'erro' })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ erro: 'Aparelho já vendido' }) // o corpo continua legível para quem chamou
  })
  it('erro sem mensagem legível: texto padrão', async () => {
    await comFeedback('POST', '/api/vendas', async () => new Response('<html>', { status: 502 }))
    expect(useToast().aviso.value).toMatchObject({ mensagem: 'Algo deu errado. Tente de novo.', tipo: 'erro' })
  })
  it('401 não vira toast (a sessão acabou e o app leva para o login)', async () => {
    await comFeedback('POST', '/api/vendas', async () => resposta(401, { erro: 'Não autenticado' }))
    expect(useToast().aviso.value).toBeNull()
  })
  it('sem conexão: toast vermelho e o erro continua subindo', async () => {
    await expect(comFeedback('POST', '/api/vendas', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow('Failed to fetch')
    expect(useToast().aviso.value).toMatchObject({ mensagem: 'Sem conexão com o servidor. Tente de novo.', tipo: 'erro' })
  })
  it('chamada silenciosa (previa, sino, login) não mostra loading nem toast', async () => {
    const c = useCarregando()
    const p = comFeedback('POST', '/api/contratos/modelo/previa', async () => { await new Promise((r) => setTimeout(r, 1000)); return resposta(200) })
    vi.advanceTimersByTime(ATRASO_MS + 1)
    expect(c.visivel.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(useToast().aviso.value).toBeNull()
  })
  it('ação lenta mostra o "enviando…" e tira quando termina', async () => {
    const c = useCarregando()
    const p = comFeedback('POST', '/api/vendas', async () => { await new Promise((r) => setTimeout(r, 1000)); return resposta(201) })
    await vi.advanceTimersByTimeAsync(ATRASO_MS + 1)
    expect(c.visivel.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    await p
    await vi.advanceTimersByTimeAsync(MINIMO_MS)
    expect(c.visivel.value).toBe(false)
  })
  it('um toast específico da tela, mostrado depois, substitui o padrão', async () => {
    const toast = useToast()
    await comFeedback('POST', '/api/vendas', async () => resposta(201))
    toast.mostrar('Venda lançada', { texto: 'Desfazer', executar: () => {} })
    expect(toast.aviso.value).toMatchObject({ mensagem: 'Venda lançada' })
    expect(toast.aviso.value?.acao?.texto).toBe('Desfazer')
  })
})
