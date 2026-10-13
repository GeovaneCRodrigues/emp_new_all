import { beforeEach, describe, expect, it } from 'vitest'
import { MODELO_PADRAO } from '@/domain/contrato'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { ClientesApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { ContratosApi } from './contratos'
import { criarContratosFake } from './contratos.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/contratos.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const COBRADOR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const INDICADOR: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let api: ContratosApi, vendas: VendasFake, clientes: ClientesApi, estoque: EstoqueFake
beforeEach(() => {
  estoque = criarEstoqueFake(); clientes = criarClientesFake()
  vendas = criarVendasFake({ estoque, indicadores: criarIndicadoresFake(), clientes })
  api = criarContratosFake({ vendas, clientes, estoque })
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
/** O primeiro contrato que ainda espera: na demonstração, o cliente dele não tem CPF nem endereço. */
const pendente = async () => (await api.listar(ADMIN, { status: 'ESPERANDO' })).itens[0]
async function completarCliente(vendaId: number) {
  const r = vendas._interno.registros.find((x) => x.id === vendaId)!
  const c = await clientes.obter(ADMIN, r.cliente.id)
  await clientes.atualizar(ADMIN, c.id, { nome: c.nome, fone: c.fone, cpf: '52998224725', endereco: 'RUA A, 10' })
}
async function novaVenda(cliente = 3) {
  const a = await estoque.criar(ADMIN, { modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco: 3000, custo: 2000 })
  return (await vendas.criar(ADMIN, { aparelhoId: a.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })).id
}

describe('contratos (demonstração)', () => {
  it('só administrador e vendedor entram; cobrador e indicador levam 403', async () => {
    for (const s of [COBRADOR, INDICADOR]) { expect((await falha(api.listar(s)))?.status).toBe(403); expect((await falha(api.modelo(s)))?.status).toBe(403) }
  })
  it('vendedor não mexe em modelo, empresa, assinatura nem seguro', async () => {
    const V: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
    const p = await pendente()
    for (const f of [() => api.modelo(V), () => api.salvarModelo(V, MODELO_PADRAO), () => api.empresa(V), () => api.salvarEmpresa(V, {}), () => api.marcarAssinado(V, p.id), () => api.definirSeguro(V, p.id, true), () => api.previa(V, 'x', p.vendaId)]) expect((await falha(f()))?.status).toBe(403)
  })
  it('vendedor só enxerga os contratos das vendas dele, e o contrato de venda de outro dá 404', async () => {
    const V: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
    const todos = (await api.listar(ADMIN)).itens, dele = (await api.listar(V)).itens
    expect(dele.length).toBeGreaterThan(0); expect(dele.length).toBeLessThan(todos.length)
    const fora = todos.find((t) => !dele.some((d) => d.id === t.id))!
    expect((await falha(api.obter(V, fora.id)))?.status).toBe(404)
    expect((await falha(api.porVenda(V, fora.vendaId)))?.status).toBe(404)
  })
  it('lista com o resumo; filtra esperando e assinados; os mais novos primeiro', async () => {
    const l = await api.listar(ADMIN)
    expect(l.resumo).toMatchObject({ assinados: 7, esperando: 2, comSeguro: 0 })
    expect((await api.listar(ADMIN, { status: 'ASSINADO' })).itens.every((i) => i.status === 'ASSINADO')).toBe(true)
    expect((await api.listar(ADMIN, { status: 'ESPERANDO' })).itens).toHaveLength(2)
    const datas = l.itens.map((i) => i.dataVenda); expect(datas).toEqual([...datas].sort().reverse())
    expect((await falha(api.listar(ADMIN, { status: 'XX' as never })))?.status).toBe(400)
  })
  it('o número é o ano mais o id da venda, com 4 dígitos', async () => {
    const p = await pendente()
    expect(p.numero).toBe(`${p.dataVenda.slice(0, 4)}-${String(p.vendaId).padStart(4, '0')}`)
  })
  it('contrato esperando sem CPF e endereço do cliente: mostra o que falta e não deixa enviar', async () => {
    const p = await pendente()
    const d = await api.obter(ADMIN, p.id)
    expect(d.faltam).toEqual(['CPF', 'Endereço']); expect(d.trechos.some((t) => t.tipo === 'falta')).toBe(true)
    const e = await falha(api.marcarEnviado(ADMIN, p.id))
    expect(e?.status).toBe(409); expect(e?.codigo).toBe('DADOS_FALTANDO'); expect(e?.message).toContain('CPF')
  })
  it('completo: envia (texto congela, venda vira ENVIADO), depois só o administrador marca assinado', async () => {
    const p = await pendente(); await completarCliente(p.vendaId)
    expect((await falha(api.marcarAssinado(ADMIN, p.id)))?.codigo).toBe('CONTRATO_NAO_ENVIADO')
    const e = await api.marcarEnviado(ADMIN, p.id)
    expect(e.contrato.status).toBe('ENVIADO'); expect(e.congelado).toBe(true); expect(e.texto).toContain('529.982.247-25')
    expect(vendas._interno.registros.find((r) => r.id === p.vendaId)!.contrato).toBe('ENVIADO')
    expect((await falha(api.marcarEnviado(ADMIN, p.id)))?.codigo).toBe('CONTRATO_JA_ENVIADO')
    const a = await api.marcarAssinado(ADMIN, p.id)
    expect(a.contrato.status).toBe('ASSINADO'); expect(a.contrato.assinadoEm).not.toBeNull()
    expect(vendas._interno.registros.find((r) => r.id === p.vendaId)!.contrato).toBe('ASSINADO')
    expect((await falha(api.marcarAssinado(ADMIN, p.id)))?.codigo).toBe('CONTRATO_JA_ASSINADO')
    expect((await api.listar(ADMIN)).resumo).toMatchObject({ assinados: 8, esperando: 1 })
  })
  it('depois de enviado o texto não muda, nem com o cadastro corrigido', async () => {
    const p = await pendente(); await completarCliente(p.vendaId)
    const antes = await api.marcarEnviado(ADMIN, p.id)
    const r = vendas._interno.registros.find((x) => x.id === p.vendaId)!
    const c = await clientes.obter(ADMIN, r.cliente.id)
    await clientes.atualizar(ADMIN, c.id, { nome: 'OUTRO NOME', fone: c.fone, cpf: c.cpf, endereco: c.endereco })
    expect((await api.obter(ADMIN, p.id)).texto).toBe(antes.texto)
  })
  it('antes de enviar, o contrato acompanha o cadastro: completar o CPF tira a falta', async () => {
    const p = await pendente()
    expect((await api.obter(ADMIN, p.id)).faltam).toContain('CPF')
    await completarCliente(p.vendaId)
    expect((await api.obter(ADMIN, p.id)).faltam).toEqual([])
  })
  it('contrato que já veio assinado da demonstração está fechado e com as datas', async () => {
    const a = (await api.listar(ADMIN, { status: 'ASSINADO' })).itens[0]
    const d = await api.obter(ADMIN, a.id)
    expect(d.congelado).toBe(true); expect(d.contrato.enviadoEm).not.toBeNull(); expect(d.contrato.assinadoEm).not.toBeNull()
  })
  it('venda nova já tem contrato aguardando, e gerar de novo dá 409', async () => {
    const v = await novaVenda()
    const d = await api.porVenda(ADMIN, v)
    expect(d.contrato.status).toBe('AGUARDANDO'); expect(d.texto).toContain('iPhone 13')
    expect((await falha(api.gerar(ADMIN, v)))?.codigo).toBe('CONTRATO_JA_EXISTE')
    expect((await falha(api.gerar(ADMIN, 999999)))?.status).toBe(404)
    expect((await api.listar(ADMIN)).resumo.esperando).toBe(3)
  })
  it('venda retomada não conta como esperando e não envia', async () => {
    const p = await pendente(); await completarCliente(p.vendaId)
    const r = vendas._interno.registros.find((x) => x.id === p.vendaId)!
    r.status = 'RETOMADA'
    expect((await api.listar(ADMIN)).resumo.esperando).toBe(1)
    expect((await falha(api.marcarEnviado(ADMIN, p.id)))?.codigo).toBe('VENDA_ENCERRADA')
  })
  it('seguro: muda antes de enviar (e o texto muda), depois não; valor que não é booleano dá 400', async () => {
    const p = await pendente(); await completarCliente(p.vendaId)
    const d = await api.definirSeguro(ADMIN, p.id, true)
    expect(d.contrato.seguro).toBe(true); expect(d.texto).toContain('contratado, R$ 39,90 por mês')
    expect((await api.listar(ADMIN)).resumo.comSeguro).toBe(1)
    expect((await falha(api.definirSeguro(ADMIN, p.id, 'sim' as never)))?.status).toBe(400)
    await api.marcarEnviado(ADMIN, p.id)
    expect((await falha(api.definirSeguro(ADMIN, p.id, false)))?.codigo).toBe('CONTRATO_JA_ENVIADO')
  })
  it('com seguro e sem o valor cadastrado: falta e não envia', async () => {
    const p = await pendente(); await completarCliente(p.vendaId)
    await api.salvarEmpresa(ADMIN, { seguro: null }); await api.definirSeguro(ADMIN, p.id, true)
    expect((await falha(api.marcarEnviado(ADMIN, p.id)))?.message).toContain('Seguro')
  })
  describe('modelo', () => {
    it('começa no padrão (versão 0); salvar cria versão nova; o mesmo texto não cria outra', async () => {
      expect(await api.modelo(ADMIN)).toMatchObject({ versao: 0, texto: MODELO_PADRAO })
      const novo = MODELO_PADRAO.replace('CLÁUSULA PRIMEIRA', 'CLÁUSULA UM')
      expect((await api.salvarModelo(ADMIN, novo)).versao).toBe(1); expect((await api.salvarModelo(ADMIN, novo)).versao).toBe(1)
      expect((await api.salvarModelo(ADMIN, novo + '\nlinha')).versao).toBe(2)
    })
    it('o contrato já gerado guarda a versão dele; a venda feita depois usa o modelo novo', async () => {
      const p = await pendente()
      const antes = await novaVenda()
      await api.salvarModelo(ADMIN, MODELO_PADRAO.replace('CLÁUSULA PRIMEIRA', 'CLÁUSULA UM'))
      expect((await api.obter(ADMIN, p.id)).texto).toContain('CLÁUSULA PRIMEIRA')
      expect((await api.porVenda(ADMIN, antes)).contrato.modeloVersao).toBe(0)
      const depois = await novaVenda()
      const d = await api.porVenda(ADMIN, depois)
      expect(d.contrato.modeloVersao).toBe(1); expect(d.texto).toContain('CLÁUSULA UM')
    })
    it.each([['curto', 'curto'], ['gigante', 'x'.repeat(30_001)], ['campo que não existe', MODELO_PADRAO + '{{nao_existe}}']])('%s: 400', async (_n, texto) => {
      expect((await falha(api.salvarModelo(ADMIN, texto)))?.status).toBe(400)
    })
    it('prévia preenche com a venda escolhida; venda que não existe: 404', async () => {
      const p = await pendente()
      const r = await api.previa(ADMIN, 'Cliente {{cliente_nome}} {{nao}}', p.vendaId)
      expect(r.texto).toContain('Cliente '); expect(r.trechos.some((t) => t.tipo === 'desconhecido')).toBe(true)
      expect((await falha(api.previa(ADMIN, 'x', 999999)))?.status).toBe(404)
    })
  })
  describe('empresa', () => {
    it('salva, mantém o que não veio, limpa com null e arredonda', async () => {
      const e = await api.salvarEmpresa(ADMIN, { avaria: 400.456, cancelamentoPct: 12.345 })
      expect(e).toMatchObject({ avaria: 400.46, cancelamentoPct: 12.35, nome: 'Mundo dos iPhones LTDA' })
      expect(await api.salvarEmpresa(ADMIN, { email: null })).toMatchObject({ email: null, avaria: 400.46 })
    })
    it.each([['CNPJ curto', { cnpj: '1' }], ['e-mail ruim', { email: 'abc' }], ['taxa negativa', { avaria: -1 }], ['multa > 100', { cancelamentoPct: 101 }], ['nome vazio', { nome: '' }], ['taxa em texto', { seguro: '1' }]])('%s: 400', async (_n, corpo) => {
      expect((await falha(api.salvarEmpresa(ADMIN, corpo as never)))?.status).toBe(400)
    })
  })
})
