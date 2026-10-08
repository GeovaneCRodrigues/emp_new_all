import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { IndicadoresApi } from './indicadores'
import { criarIndicadoresFake } from './indicadores.fake'

// Mesmos cenários de back/tests/indicadores.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
let api: IndicadoresApi
beforeEach(() => { api = criarIndicadoresFake() })
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

const tabela = (auto = true, mudancas: Record<string, object> = {}) => ({
  auto,
  niveis: [
    { id: 'BRONZE', nome: 'Bronze', minOperacoes: 0, pct: 0.3, ...mudancas.BRONZE },
    { id: 'PRATA', nome: 'Prata', minOperacoes: 3, pct: 0.4, ...mudancas.PRATA },
    { id: 'OURO', nome: 'Ouro', minOperacoes: 5, pct: 0.5, ...mudancas.OURO },
    { id: 'DIAMANTE', nome: 'Diamante', minOperacoes: 10, pct: 0.55, ...mudancas.DIAMANTE },
  ],
})

describe('permissões', () => {
  it('só o admin gerencia (403 para os outros perfis)', async () => {
    for (const perfil of ['VENDEDOR', 'COBRADOR', 'INDICADOR'] as const) {
      const s: Sessao = { perfil, usuarioId: 2 }
      expect((await falha(api.listar(s)))?.status).toBe(403)
      expect((await falha(api.criar(s, { nome: 'X Y', pct: 0.5 })))?.status).toBe(403)
      expect((await falha(api.niveis(s)))?.status).toBe(403)
    }
  })
})

describe('cadastro e %', () => {
  it('% definido à mão fica manual; WhatsApp é normalizado; nível Bronze', async () => {
    const i = await api.criar(ADMIN, { nome: '  Roberto   Silva ', whatsapp: '(11) 98812-4410', pct: 0.5 })
    expect(i).toMatchObject({ nome: 'Roberto Silva', whatsapp: '11988124410', pct: 0.5, pctManual: true, ativo: true, operacoes: 0 })
    expect(i.nivel.nome).toBe('Bronze')
    expect(i.faltamParaProximo).toBe(3)
  })
  it('"automático" usa o % do nível e não fica manual', async () => {
    expect(await api.criar(ADMIN, { nome: 'Loja Auto', automatico: true })).toMatchObject({ pct: 0.3, pctManual: false })
  })
  it.each([
    ['sem nome', {}], ['nome curto', { nome: 'A', pct: 0.5 }], ['sem % nem automático', { nome: 'Fulano' }], ['% zero', { nome: 'Fulano', pct: 0 }],
    ['% acima de 100', { nome: 'Fulano', pct: 1.5 }], ['% e automático juntos', { nome: 'Fulano', pct: 0.5, automatico: true }],
    ['WhatsApp inválido', { nome: 'Fulano', pct: 0.5, whatsapp: '123' }],
  ])('recusa %s (400)', async (_n, corpo) => expect((await falha(api.criar(ADMIN, corpo as never)))?.status).toBe(400))

  it('editar só o nome não mexe no %; definir o % torna manual; voltar ao automático usa o nível', async () => {
    const roberto = (await api.listar(ADMIN)).find((i) => i.nome.startsWith('Roberto'))! // 5 operações no exemplo: Ouro
    expect((await api.atualizar(ADMIN, roberto.id, { nome: 'Roberto Novo' }))).toMatchObject({ pct: roberto.pct, pctManual: true })
    expect((await api.atualizar(ADMIN, roberto.id, { pct: 0.35 }))).toMatchObject({ pct: 0.35, pctManual: true })
    expect((await api.atualizar(ADMIN, roberto.id, { automatico: true }))).toMatchObject({ pct: 0.5, pctManual: false }) // Ouro
  })
  it('lista em ordem alfabética e 404 para id inexistente', async () => {
    const nomes = (await api.listar(ADMIN)).map((i) => i.nome)
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    expect((await falha(api.obter(ADMIN, 99999)))?.status).toBe(404)
  })
})

describe('níveis', () => {
  it('mudar o % de um nível atualiza só os automáticos', async () => {
    const auto = await api.criar(ADMIN, { nome: 'Automático', automatico: true }) // 0 operações: Bronze
    const manual = await api.criar(ADMIN, { nome: 'Manual', pct: 0.35 })
    await api.salvarNiveis(ADMIN, tabela(true, { BRONZE: { pct: 0.32 } }))
    expect((await api.obter(ADMIN, auto.id)).pct).toBe(0.32)
    expect((await api.obter(ADMIN, manual.id)).pct).toBe(0.35)
  })
  it('com o automático desligado, os níveis não mexem em ninguém', async () => {
    const auto = await api.criar(ADMIN, { nome: 'Automático', automatico: true })
    await api.salvarNiveis(ADMIN, tabela(false, { BRONZE: { pct: 0.33 } }))
    expect((await api.obter(ADMIN, auto.id)).pct).toBe(0.3)
    expect((await api.niveis(ADMIN)).auto).toBe(false)
  })
  it('troca os mínimos sem problema', async () => {
    const r = await api.salvarNiveis(ADMIN, tabela(true, { PRATA: { minOperacoes: 4 }, OURO: { minOperacoes: 6 } }))
    expect(r.niveis.map((n) => n.minOperacoes)).toEqual([0, 4, 6, 10])
  })
  it.each([
    ['mínimo repetido', { OURO: { minOperacoes: 3 } }], ['nível de cima ganha menos', { PRATA: { pct: 0.2 } }],
    ['% fora do intervalo', { OURO: { pct: 1.5 } }], ['primeiro nível não começa em 0', { BRONZE: { minOperacoes: 1 } }],
  ])('recusa: %s (400)', async (_n, m) => expect((await falha(api.salvarNiveis(ADMIN, tabela(true, m))))?.status).toBe(400))
  it('recusa lista incompleta', async () => {
    const t = tabela()
    expect((await falha(api.salvarNiveis(ADMIN, { ...t, niveis: t.niveis.slice(0, 3) })))?.status).toBe(400)
  })
})

describe('acesso e desativação', () => {
  it('cria o acesso uma vez; segundo e e-mail repetido são 409; e-mail inválido é 400', async () => {
    const a = await api.criar(ADMIN, { nome: 'Com Acesso', pct: 0.4 })
    const b = await api.criar(ADMIN, { nome: 'Outro Acesso', pct: 0.4 })
    const ok = await api.criarAcesso(ADMIN, a.id, 'Pessoa@Teste.com')
    expect(ok.email).toBe('pessoa@teste.com')
    expect(ok.senhaTemporaria.length).toBeGreaterThanOrEqual(10)
    expect((await api.obter(ADMIN, a.id)).temAcesso).toBe(true)
    expect(await falha(api.criarAcesso(ADMIN, a.id, 'outro@teste.com'))).toMatchObject({ status: 409, codigo: 'ACESSO_EXISTENTE' })
    expect(await falha(api.criarAcesso(ADMIN, b.id, 'pessoa@teste.com'))).toMatchObject({ status: 409, codigo: 'EMAIL_EM_USO' })
    expect((await falha(api.criarAcesso(ADMIN, b.id, 'nao-e-email')))?.status).toBe(400)
  })
  it('indicador desativado não ganha acesso novo, e reativar devolve', async () => {
    const i = await api.criar(ADMIN, { nome: 'Vai Sair', pct: 0.4 })
    expect((await api.atualizar(ADMIN, i.id, { ativo: false })).ativo).toBe(false)
    expect((await falha(api.criarAcesso(ADMIN, i.id, 'x@teste.com')))?.status).toBe(400)
    expect((await api.atualizar(ADMIN, i.id, { ativo: true })).ativo).toBe(true)
  })
  it('ativo precisa ser verdadeiro ou falso', async () => {
    const i = await api.criar(ADMIN, { nome: 'Teste Ativo', pct: 0.4 })
    expect((await falha(api.atualizar(ADMIN, i.id, { ativo: 'nao' as never })))?.status).toBe(400)
  })
})
