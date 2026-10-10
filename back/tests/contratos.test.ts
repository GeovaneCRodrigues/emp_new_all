import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createContratosRepository } from '../src/modules/contratos/models/repository.js'
import { createContratosService } from '../src/modules/contratos/services/contratos.service.js'
import { MODELO_PADRAO } from '../src/modules/contratos/services/modelo.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-15'
const EMPRESA_OK = { nome: 'Mundo dos iPhones LTDA', cnpj: '11.222.333/0001-81', endereco: 'Rua X, 1', email: 'contato@mundo.com', atendente: 'Geovane', avaria: 350, reposicao: 1500, seguro: 39.9, cancelamentoPct: 20, recuperacao: 250 }

type Detalhe = { contrato: { id: number; vendaId: number; numero: string; status: string; seguro: boolean; modeloVersao: number; enviadoEm: string | null; assinadoEm: string | null }; congelado: boolean; trechos: { tipo: string; v: string }[]; faltam: string[]; texto: string }
type Lista = { itens: { id: number; numero: string; status: string; clienteNome: string; seguro: boolean; vendaStatus: string }[]; resumo: { assinados: number; esperando: number; comSeguro: number } }

describe.skipIf(!db)('contratos (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, papel?: string, payload?: object) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const empresaCompleta = () => req('PUT', '/api/contratos/empresa', 'admin', EMPRESA_OK)
  const detalhe = async (cid: number, papel = 'admin') => (await req('GET', `/api/contratos/${cid}`, papel)).json() as Detalhe
  const lista = async (q = '', papel = 'admin') => (await req('GET', `/api/contratos${q}`, papel)).json() as Lista

  let seqImei = 0
  const imei = () => `35693803564${String(3809 + ++seqImei).padStart(4, '0')}`
  async function venda(o: { cliente?: number; vendedor?: number | null; status?: string; legacy?: number | null; data?: string; entrada?: number; troca?: number } = {}) {
    const [b] = await db!('bens').insert({ modelo: 'IPHONE 15', gb: 128, cor: 'PRETO', imei: imei(), preco_venda: 3000, valor_compra: 2000, custos_extras: 0, data_compra: '2026-09-01', estado: 'VENDIDO' }).returning('id')
    const [v] = await db!('vendas').insert({
      bem_id: b.id, cliente_id: o.cliente ?? id.cli, vendedor_id: o.vendedor === undefined ? id.vendedorA : o.vendedor, data_venda: o.data ?? '2026-10-05', preco_acordado: 3000, entrada: o.entrada ?? 1000, troca_valor: o.troca ?? 0,
      valor_investido: 2000, valor_total: 3000, status: o.status ?? 'ATIVA', legacy_id: o.legacy ?? null, contrato_status: o.legacy ? 'SEM_CONTRATO' : 'AGUARDANDO',
    }).returning('id')
    await db!('venda_parcelas').insert([{ venda_id: v.id, numero: 1, vencimento: '2026-11-10', valor: 1000 }, { venda_id: v.id, numero: 2, vencimento: '2026-12-10', valor: 1000 }])
    return v.id as number
  }
  const gerar = async (vendaId: number, papel = 'admin') => req('POST', `/api/contratos/venda/${vendaId}`, papel)
  const contratoDe = async (vendaId: number) => ((await gerar(vendaId)).json() as Detalhe).contrato.id

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    id.ind = (await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id'))[0].id
    for (const [c, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedorA', 'VENDEDOR', {}], ['vendedorB', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.ind }]] as const) {
      id[c] = (await k('users').insert({ nome: c, email: `${c}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'))[0].id
    }
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410', cpf: '52998224725', endereco: 'RUA A, 10', responsavel_id: id.vendedorA }).returning('id'))[0].id
    id.cliB = (await k('clientes').insert({ nome: 'BRUNO LIMA', fone: '11988124411', responsavel_id: id.vendedorB }).returning('id'))[0].id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const contratos = createContratosService({ repo: createContratosRepository(k), auditoria: audit })
    const config = createConfigRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores, estoque: createEstoqueService(createEstoqueRepository(k), audit),
      config: createConfigService(config), recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, contratos,
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => HOJE, gerarContrato: (v, u) => contratos.gerarDaVenda(v, u) }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedorA', 'vendedorB', 'cobrador', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    const k = db!
    for (const tab of ['contratos', 'contrato_modelos', 'recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'vendas', 'bens', 'auditoria']) await k(tab).del()
    await k('sistema_config').whereIn('chave', ['empresa_endereco', 'empresa_email', 'empresa_atendente', 'taxa_avaria', 'taxa_reposicao', 'taxa_seguro_mensal', 'taxa_cancelamento_pct', 'taxa_recuperacao']).del()
    await k('sistema_config').insert({ chave: 'empresa_cnpj', valor: JSON.stringify(null) }).onConflict('chave').merge()
    await k('sistema_config').insert({ chave: 'empresa_nome', valor: JSON.stringify('Mundo dos iPhones') }).onConflict('chave').merge()
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('quem pode o quê', () => {
    it('sem login: 401 em tudo', async () => {
      for (const [m, u] of [['GET', '/api/contratos'], ['GET', '/api/contratos/1'], ['GET', '/api/contratos/modelo'], ['PUT', '/api/contratos/empresa'], ['POST', '/api/contratos/venda/1']] as const) expect((await req(m, u)).statusCode, u).toBe(401)
    })
    it.each(['cobrador', 'indicador'])('%s: 403 nas listas, no modelo, na empresa e ao gerar', async (p) => {
      for (const [m, u] of [['GET', '/api/contratos'], ['GET', '/api/contratos/1'], ['GET', '/api/contratos/venda/1'], ['GET', '/api/contratos/modelo'], ['GET', '/api/contratos/empresa'], ['POST', '/api/contratos/venda/1']] as const) expect((await req(m, u, p)).statusCode, `${p} ${u}`).toBe(403)
    })
    it('vendedor: não vê nem muda o modelo e a empresa, não marca assinado nem muda o seguro', async () => {
      const cid = await contratoDe(await venda())
      for (const [m, u, b] of [['GET', '/api/contratos/modelo'], ['PUT', '/api/contratos/modelo', { texto: MODELO_PADRAO }], ['POST', '/api/contratos/modelo/previa', { texto: 'x', vendaId: 1 }], ['GET', '/api/contratos/empresa'], ['PUT', '/api/contratos/empresa', EMPRESA_OK], ['POST', `/api/contratos/${cid}/assinado`], ['PATCH', `/api/contratos/${cid}`, { seguro: true }]] as const)
        expect((await req(m, u, 'vendedorA', b as object | undefined)).statusCode, `${m} ${u}`).toBe(403)
    })
    it('vendedor só enxerga os contratos das vendas dele (feitas por ele ou de clientes da carteira dele)', async () => {
      const dele = await venda({ vendedor: id.vendedorA }), daCarteira = await venda({ vendedor: null, cliente: id.cli }), doOutro = await venda({ vendedor: id.vendedorB, cliente: id.cliB })
      const [c1, c2, c3] = [await contratoDe(dele), await contratoDe(daCarteira), await contratoDe(doOutro)]
      expect((await lista('', 'vendedorA')).itens.map((i) => i.id).sort()).toEqual([c1, c2].sort())
      expect((await req('GET', `/api/contratos/${c3}`, 'vendedorA')).statusCode).toBe(404)
      expect((await req('GET', `/api/contratos/venda/${doOutro}`, 'vendedorA')).statusCode).toBe(404)
      expect((await req('POST', `/api/contratos/${c3}/enviado`, 'vendedorA')).statusCode).toBe(404)
      expect((await lista('', 'admin')).itens).toHaveLength(3)
    })
  })

  describe('gerar', () => {
    it('gera o contrato com número do ano e da venda, status aguardando e a versão 0 do modelo (o padrão)', async () => {
      const v = await venda()
      const r = await gerar(v)
      expect(r.statusCode).toBe(201)
      const d = r.json() as Detalhe
      expect(d.contrato).toMatchObject({ vendaId: v, numero: `2026-${String(v).padStart(4, '0')}`, status: 'AGUARDANDO', seguro: false, modeloVersao: 0, enviadoEm: null, assinadoEm: null })
      expect(d.congelado).toBe(false)
      expect(d.texto).toContain(`CONTRATO Nº 2026-${String(v).padStart(4, '0')}`)
      expect(d.texto).toContain('ANA SOUZA'); expect(d.texto).toContain('529.982.247-25'); expect(d.texto).toContain('IPHONE 15 128 GB, PRETO')
      expect(d.texto).toContain('PAGAMENTO: 2x de R$ 1.000,00'); expect(d.texto).toContain('VALOR TOTAL DO CONTRATO: R$ 3.000,00')
      expect(await db!('auditoria').where({ acao: 'CONTRATO_GERADO' }).count('* as n').first()).toMatchObject({ n: '1' })
    })
    it('gerar de novo: 409, e continua um só', async () => {
      const v = await venda(); await gerar(v)
      const r = await gerar(v)
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('CONTRATO_JA_EXISTE')
      expect((await lista()).itens).toHaveLength(1)
    })
    it('venda retomada ou cancelada: 409; venda que não existe: 404', async () => {
      for (const status of ['RETOMADA', 'CANCELADA']) { const r = await gerar(await venda({ status })); expect(r.statusCode, status).toBe(409); expect(r.json().codigo).toBe('VENDA_ENCERRADA') }
      expect((await gerar(999999)).statusCode).toBe(404)
    })
    it('venda antiga (migrada) fica sem contrato; só o administrador gera, e passa a esperar assinatura', async () => {
      const v = await venda({ legacy: 777 })
      expect((await db!('vendas').where({ id: v }).first()).contrato_status).toBe('SEM_CONTRATO')
      expect((await lista()).itens).toEqual([]); expect((await lista()).resumo.esperando).toBe(0)
      expect((await gerar(v, 'vendedorA')).statusCode).toBe(403)
      expect((await gerar(v, 'admin')).statusCode).toBe(201)
      expect((await db!('vendas').where({ id: v }).first()).contrato_status).toBe('AGUARDANDO')
    })
    it('vendedor gera o contrato de uma venda dele, mas não de venda de outro', async () => {
      expect((await gerar(await venda({ vendedor: id.vendedorA }), 'vendedorA')).statusCode).toBe(201)
      expect((await gerar(await venda({ vendedor: id.vendedorB, cliente: id.cliB }), 'vendedorA')).statusCode).toBe(404)
    })
    it('a venda nova (pela API) já nasce com contrato, e a resposta traz o status', async () => {
      const [b] = await db!('bens').insert({ modelo: 'IPHONE 16', gb: 256, cor: 'BRANCO', preco_venda: 7500, valor_compra: 5000, custos_extras: 0, data_compra: '2026-09-01' }).returning('id')
      const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: id.cli, preco: 7500, entrada: 1500, parcelas: 10, diaVencimento: 10 })
      expect(r.statusCode).toBe(201)
      const vid = r.json().id as number
      const d = (await req('GET', `/api/contratos/venda/${vid}`, 'admin')).json() as Detalhe
      expect(d.contrato).toMatchObject({ vendaId: vid, status: 'AGUARDANDO' })
      expect(d.texto).toContain('IPHONE 16 256 GB')
    })
    it('a venda à vista (sem parcelas) também gera contrato', async () => {
      const [b] = await db!('bens').insert({ modelo: 'IPHONE 13', gb: 128, cor: 'PRETO', preco_venda: 3000, valor_compra: 2000, custos_extras: 0, data_compra: '2026-09-01' }).returning('id')
      const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: id.cli, preco: 3000, entrada: 3000, parcelas: 0 })
      expect(r.statusCode).toBe(201)
      expect(((await req('GET', `/api/contratos/venda/${r.json().id}`, 'admin')).json() as Detalhe).texto).toContain('0x de não há parcelas')
    })
    it('o contrato que não consegue gerar não derruba a venda (gerarDaVenda engole o erro e registra)', async () => {
      const erros: unknown[] = []
      const quebrado = createContratosService({ repo: { ...createContratosRepository(db!), vendaParaGerar: async () => { throw new Error('banco caiu') } }, auditoria: createAuditoriaRepository(db!), log: (_m, e) => erros.push(e) })
      await expect(quebrado.gerarDaVenda(1, 1)).resolves.toBeUndefined()
      expect(erros).toHaveLength(1)
    })
    it('gerarDaVenda é idempotente e ignora venda que não existe', async () => {
      const v = await venda()
      const svc = createContratosService({ repo: createContratosRepository(db!), auditoria: createAuditoriaRepository(db!) })
      await svc.gerarDaVenda(v, id.admin); await svc.gerarDaVenda(v, id.admin); await svc.gerarDaVenda(999999, id.admin)
      expect((await lista()).itens).toHaveLength(1)
      expect(await db!('auditoria').where({ acao: 'CONTRATO_GERADO' }).count('* as n').first()).toMatchObject({ n: '1' }) // a 2ª chamada não audita
    })
    it('criar o mesmo contrato duas vezes no repositório devolve o que já existe', async () => {
      const v = await venda(); const repo = createContratosRepository(db!)
      const a = await repo.criar(v, 'X-1', 0, id.admin), b = await repo.criar(v, 'X-2', 3, id.admin)
      expect(a.criado).toBe(true); expect(b).toEqual({ id: a.id, criado: false })
      expect(await db!('contratos').where({ id: a.id }).first()).toMatchObject({ numero: 'X-1', modelo_versao: 0 })
    })
  })

  describe('lista e resumo', () => {
    it('conta assinados, esperando (sem retomada) e com seguro; filtra por status', async () => {
      const [v1, v2, v3] = [await venda({ cliente: id.cli }), await venda(), await venda()]
      const [c1, c2, c3] = [await contratoDe(v1), await contratoDe(v2), await contratoDe(v3)]
      await empresaCompleta()
      await req('PATCH', `/api/contratos/${c2}`, 'admin', { seguro: true })
      await req('POST', `/api/contratos/${c1}/enviado`, 'admin'); await req('POST', `/api/contratos/${c1}/assinado`, 'admin')
      await db!('vendas').where({ id: v3 }).update({ status: 'RETOMADA' })
      const l = await lista()
      expect(l.resumo).toEqual({ assinados: 1, esperando: 1, comSeguro: 1 })
      expect(l.itens).toHaveLength(3)
      expect((await lista('?status=ASSINADO')).itens.map((i) => i.id)).toEqual([c1])
      expect((await lista('?status=ESPERANDO')).itens.map((i) => i.id)).toEqual([c2]) // a retomada não espera assinatura
      expect(c3).toBeGreaterThan(0)
    })
    it('venda cancelada depois de gerar não conta como esperando; o item mostra o aparelho com a capacidade (quando há)', async () => {
      const [a, b] = [await venda(), await venda()]
      await contratoDe(a); await contratoDe(b)
      await db!('vendas').where({ id: a }).update({ status: 'CANCELADA' })
      await db!('bens').whereIn('id', db!('vendas').where({ id: b }).select('bem_id')).update({ gb: 0 })
      const l = await lista()
      expect(l.resumo.esperando).toBe(1)
      expect(l.itens.map((i) => (i as unknown as { aparelho: string }).aparelho).sort()).toEqual(['IPHONE 15', 'IPHONE 15 128 GB'])
    })
    it('status inválido: 400; lista mais nova primeiro', async () => {
      expect((await req('GET', '/api/contratos?status=XX', 'admin')).statusCode).toBe(400)
      const [a, b] = [await venda({ data: '2026-09-01' }), await venda({ data: '2026-10-01' })]
      const [ca, cb] = [await contratoDe(a), await contratoDe(b)]
      expect((await lista()).itens.map((i) => i.id)).toEqual([cb, ca])
    })
    it('a lista não traz o texto do contrato (só a ficha)', async () => {
      await contratoDe(await venda())
      expect(JSON.stringify(await lista())).not.toContain('CLÁUSULA')
    })
  })

  describe('enviar e assinar', () => {
    it('com dados faltando (empresa sem CNPJ e taxas): não envia, 409 dizendo o que falta', async () => {
      const cid = await contratoDe(await venda())
      const r = await req('POST', `/api/contratos/${cid}/enviado`, 'admin')
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('DADOS_FALTANDO')
      expect(r.json().erro).toContain('CNPJ'); expect(r.json().erro).toContain('Taxa de avaria')
      expect((await detalhe(cid)).faltam).toEqual(expect.arrayContaining(['CNPJ', 'Taxa de avaria', 'Atendente']))
      expect((await detalhe(cid)).trechos.some((x) => x.tipo === 'falta')).toBe(true)
    })
    it('cliente sem CPF e sem endereço também trava', async () => {
      await empresaCompleta()
      const cid = await contratoDe(await venda({ cliente: id.cliB }))
      const r = await req('POST', `/api/contratos/${cid}/enviado`, 'admin')
      expect(r.statusCode).toBe(409); expect(r.json().erro).toContain('CPF'); expect(r.json().erro).toContain('Endereço')
    })
    it('completo: marca enviado, congela o texto e a venda passa a ENVIADO; depois assina (só o administrador)', async () => {
      await empresaCompleta()
      const v = await venda(); const cid = await contratoDe(v)
      expect((await req('POST', `/api/contratos/${cid}/assinado`, 'admin')).json().codigo).toBe('CONTRATO_NAO_ENVIADO')
      const e = await req('POST', `/api/contratos/${cid}/enviado`, 'vendedorA')
      expect(e.statusCode).toBe(200)
      const d = e.json() as Detalhe
      expect(d.contrato.status).toBe('ENVIADO'); expect(d.congelado).toBe(true); expect(d.contrato.enviadoEm).not.toBeNull(); expect(d.faltam).toEqual([])
      expect(d.texto).toContain('Mundo dos iPhones LTDA'); expect(d.texto).toContain('11.222.333/0001-81'); expect(d.texto).toContain('multa') // texto fechado
      expect((await db!('vendas').where({ id: v }).first()).contrato_status).toBe('ENVIADO')
      expect((await req('POST', `/api/contratos/${cid}/assinado`, 'vendedorA')).statusCode).toBe(403)
      const a = await req('POST', `/api/contratos/${cid}/assinado`, 'admin')
      expect(a.statusCode).toBe(200); expect((a.json() as Detalhe).contrato).toMatchObject({ status: 'ASSINADO' })
      expect((a.json() as Detalhe).contrato.assinadoEm).not.toBeNull()
      expect((await db!('vendas').where({ id: v }).first()).contrato_status).toBe('ASSINADO')
      expect((await db!('auditoria').whereIn('acao', ['CONTRATO_ENVIADO', 'CONTRATO_ASSINADO']).orderBy('id')).map((x: { acao: string }) => x.acao)).toEqual(['CONTRATO_ENVIADO', 'CONTRATO_ASSINADO'])
    })
    it('enviar duas vezes ou assinar duas vezes: 409; enviar um já assinado: 409', async () => {
      await empresaCompleta()
      const cid = await contratoDe(await venda())
      await req('POST', `/api/contratos/${cid}/enviado`, 'admin')
      expect((await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).json().codigo).toBe('CONTRATO_JA_ENVIADO')
      await req('POST', `/api/contratos/${cid}/assinado`, 'admin')
      expect((await req('POST', `/api/contratos/${cid}/assinado`, 'admin')).json().codigo).toBe('CONTRATO_JA_ASSINADO')
      expect((await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).statusCode).toBe(409)
    })
    it('venda retomada depois de gerar: não envia', async () => {
      await empresaCompleta()
      const v = await venda(); const cid = await contratoDe(v)
      await db!('vendas').where({ id: v }).update({ status: 'RETOMADA' })
      expect((await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('depois de enviado, o texto não muda: nem com cliente corrigido, nem com empresa nova, nem com modelo novo', async () => {
      await empresaCompleta()
      const cid = await contratoDe(await venda())
      const antes = (await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).json() as Detalhe
      await db!('clientes').where({ id: id.cli }).update({ nome: 'ANA TROCOU DE NOME' })
      await req('PUT', '/api/contratos/empresa', 'admin', { atendente: 'Outra pessoa', avaria: 999 })
      await req('PUT', '/api/contratos/modelo', 'admin', { texto: MODELO_PADRAO.replace('CLÁUSULA PRIMEIRA', 'CLÁUSULA 1') })
      expect((await detalhe(cid)).texto).toBe(antes.texto)
      await db!('clientes').where({ id: id.cli }).update({ nome: 'ANA SOUZA' })
    })
    it('antes de enviar, o contrato acompanha o cadastro: completar o CPF do cliente tira a falta', async () => {
      await empresaCompleta()
      const cid = await contratoDe(await venda({ cliente: id.cliB }))
      expect((await detalhe(cid)).faltam).toEqual(expect.arrayContaining(['CPF']))
      await db!('clientes').where({ id: id.cliB }).update({ cpf: '11144477735', endereco: 'RUA B, 5' })
      expect((await detalhe(cid)).faltam).toEqual([])
      expect((await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).statusCode).toBe(200)
      await db!('clientes').where({ id: id.cliB }).update({ cpf: null, endereco: null })
    })
  })

  describe('seguro', () => {
    it('muda antes de enviar: o texto passa a falar do seguro e a lista conta; depois de enviado não muda', async () => {
      await empresaCompleta()
      const cid = await contratoDe(await venda())
      expect((await detalhe(cid)).texto).toContain('SEGURO: não contratado pelo cliente.')
      const r = await req('PATCH', `/api/contratos/${cid}`, 'admin', { seguro: true })
      expect((r.json() as Detalhe).contrato.seguro).toBe(true); expect((r.json() as Detalhe).texto).toContain('SEGURO: contratado, R$ 39,90 por mês junto da parcela.')
      await req('POST', `/api/contratos/${cid}/enviado`, 'admin')
      expect((await req('PATCH', `/api/contratos/${cid}`, 'admin', { seguro: false })).json().codigo).toBe('CONTRATO_JA_ENVIADO')
      expect(await db!('auditoria').where({ acao: 'CONTRATO_SEGURO' }).count('* as n').first()).toMatchObject({ n: '1' })
    })
    it('valor que não é verdadeiro/falso: 400; igual ao que já está: não audita', async () => {
      const cid = await contratoDe(await venda())
      expect((await req('PATCH', `/api/contratos/${cid}`, 'admin', { seguro: 'sim' })).statusCode).toBe(400)
      expect((await req('PATCH', `/api/contratos/${cid}`, 'admin', {})).statusCode).toBe(400)
      await req('PATCH', `/api/contratos/${cid}`, 'admin', { seguro: false })
      expect(await db!('auditoria').where({ acao: 'CONTRATO_SEGURO' }).count('* as n').first()).toMatchObject({ n: '0' })
    })
    it('com seguro e sem o valor do seguro cadastrado: falta, e não envia', async () => {
      await req('PUT', '/api/contratos/empresa', 'admin', { ...EMPRESA_OK, seguro: null })
      const cid = await contratoDe(await venda())
      await req('PATCH', `/api/contratos/${cid}`, 'admin', { seguro: true })
      expect((await req('POST', `/api/contratos/${cid}/enviado`, 'admin')).json().erro).toContain('Seguro')
    })
  })

  describe('modelo', () => {
    it('sem nada salvo: devolve o padrão na versão 0, com a lista de campos', async () => {
      const m = (await req('GET', '/api/contratos/modelo', 'admin')).json()
      expect(m).toMatchObject({ versao: 0, texto: MODELO_PADRAO, padrao: MODELO_PADRAO })
      expect(m.variaveis.length).toBeGreaterThan(20)
    })
    it('salvar cria a versão seguinte; salvar o mesmo texto não cria outra; o contrato já gerado guarda a versão dele', async () => {
      const cid = await contratoDe(await venda())
      const novo = MODELO_PADRAO.replace('CLÁUSULA PRIMEIRA', 'CLÁUSULA UM')
      const r = await req('PUT', '/api/contratos/modelo', 'admin', { texto: novo })
      expect(r.statusCode).toBe(200); expect(r.json().versao).toBe(1)
      expect((await req('PUT', '/api/contratos/modelo', 'admin', { texto: novo })).json().versao).toBe(1)
      expect((await req('PUT', '/api/contratos/modelo', 'admin', { texto: novo + '\nmais uma linha' })).json().versao).toBe(2)
      expect(await db!('contrato_modelos').count('* as n').first()).toMatchObject({ n: '2' })
      expect((await detalhe(cid)).texto).toContain('CLÁUSULA PRIMEIRA') // gerado com o padrão (versão 0)
      const outro = await contratoDe(await venda())
      expect((await detalhe(outro)).contrato.modeloVersao).toBe(2); expect((await detalhe(outro)).texto).toContain('mais uma linha')
    })
    it('voltar ao padrão (salvar o texto padrão) cria uma versão nova com o texto padrão', async () => {
      await req('PUT', '/api/contratos/modelo', 'admin', { texto: MODELO_PADRAO + '\nextra' })
      expect((await req('PUT', '/api/contratos/modelo', 'admin', { texto: MODELO_PADRAO })).json()).toMatchObject({ versao: 2, texto: MODELO_PADRAO })
    })
    it('texto curto, comprido, de outro tipo ou com campo que não existe: 400', async () => {
      for (const texto of ['curto', 'x'.repeat(30_001), 123, null, MODELO_PADRAO + '\n{{campo_que_nao_existe}}']) expect((await req('PUT', '/api/contratos/modelo', 'admin', { texto } as never)).statusCode, String(texto).slice(0, 20)).toBe(400)
      expect((await req('PUT', '/api/contratos/modelo', 'admin', { texto: MODELO_PADRAO + '\n{{campo_que_nao_existe}}' })).json().erro).toContain('{{campo_que_nao_existe}}')
      expect(await db!('contrato_modelos').count('* as n').first()).toMatchObject({ n: '0' })
    })
    it('quebra de linha do Windows vira a do sistema', async () => {
      await req('PUT', '/api/contratos/modelo', 'admin', { texto: MODELO_PADRAO.replace(/\n/g, '\r\n') + '\r\nfim' })
      expect((await req('GET', '/api/contratos/modelo', 'admin')).json().texto).not.toContain('\r')
    })
    it('prévia: preenche o texto que veio com a venda escolhida, sem salvar nada', async () => {
      const v = await venda()
      const r = await req('POST', '/api/contratos/modelo/previa', 'admin', { texto: 'Cliente {{cliente_nome}} / {{taxa_avaria}} / {{xx}}', vendaId: v })
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ faltam: ['Taxa de avaria'], texto: 'Cliente ANA SOUZA /  / {{xx}}' })
      expect(await db!('contrato_modelos').count('* as n').first()).toMatchObject({ n: '0' })
      expect((await req('POST', '/api/contratos/modelo/previa', 'admin', { texto: 'x', vendaId: 999999 })).statusCode).toBe(404)
      expect((await req('POST', '/api/contratos/modelo/previa', 'admin', { texto: 'x' })).statusCode).toBe(400)
      expect((await req('POST', '/api/contratos/modelo/previa', 'admin', { vendaId: v })).statusCode).toBe(400)
    })
  })

  describe('empresa e taxas', () => {
    it('começa com a razão social do recibo e o resto vazio (nenhuma taxa inventada)', async () => {
      expect((await req('GET', '/api/contratos/empresa', 'admin')).json()).toEqual({ nome: 'Mundo dos iPhones', cnpj: null, endereco: null, email: null, atendente: null, avaria: null, reposicao: null, seguro: null, cancelamentoPct: null, recuperacao: null })
    })
    it('salva tudo, devolve, e o recibo continua lendo nome e CNPJ da mesma configuração', async () => {
      const r = await empresaCompleta()
      expect(r.statusCode).toBe(200); expect(r.json()).toEqual(EMPRESA_OK)
      expect((await req('GET', '/api/contratos/empresa', 'admin')).json()).toEqual(EMPRESA_OK)
      expect(await db!('sistema_config').where({ chave: 'empresa_cnpj' }).first()).toMatchObject({ valor: '11.222.333/0001-81' })
      const log = await db!('auditoria').where({ acao: 'CONTRATO_EMPRESA_SALVA' }).first()
      expect(log.antes).toMatchObject({ cnpj: null, avaria: null }); expect(log.depois).toMatchObject({ cnpj: '11.222.333/0001-81', avaria: 350 })
    })
    it('sem razão social gravada, usa Mundo dos iPhones', async () => {
      await db!('sistema_config').where({ chave: 'empresa_nome' }).del()
      expect((await req('GET', '/api/contratos/empresa', 'admin')).json().nome).toBe('Mundo dos iPhones')
    })
    it('salvar só um campo mantém os outros; vazio ou null limpa (menos a razão social)', async () => {
      await empresaCompleta()
      expect((await req('PUT', '/api/contratos/empresa', 'admin', { avaria: 400 })).json()).toEqual({ ...EMPRESA_OK, avaria: 400 })
      expect((await req('PUT', '/api/contratos/empresa', 'admin', { email: '', reposicao: null })).json()).toMatchObject({ email: null, reposicao: null, avaria: 400 })
      expect((await req('PUT', '/api/contratos/empresa', 'admin', { nome: '' })).statusCode).toBe(400)
    })
    it.each([
      ['CNPJ com poucos números', { cnpj: '123' }], ['e-mail sem arroba', { email: 'abc' }], ['taxa negativa', { avaria: -1 }], ['taxa gigante', { reposicao: 1e7 }],
      ['taxa em texto', { seguro: '10' }], ['multa acima de 100%', { cancelamentoPct: 101 }], ['multa negativa', { cancelamentoPct: -1 }], ['nome gigante', { nome: 'x'.repeat(121) }],
      ['endereço gigante', { endereco: 'x'.repeat(201) }], ['texto onde vai número', { recuperacao: 'muito' }], ['nome que não é texto', { nome: 5 }],
    ])('%s: 400 e nada é gravado', async (_n, corpo) => {
      expect((await req('PUT', '/api/contratos/empresa', 'admin', corpo)).statusCode).toBe(400)
      expect(await db!('auditoria').where({ acao: 'CONTRATO_EMPRESA_SALVA' }).count('* as n').first()).toMatchObject({ n: '0' })
    })
    it('arredonda os centavos', async () => {
      expect((await req('PUT', '/api/contratos/empresa', 'admin', { seguro: 39.899, cancelamentoPct: 12.345 })).json()).toMatchObject({ seguro: 39.9, cancelamentoPct: 12.35 })
    })
  })

  describe('por venda e detalhe', () => {
    it('achar o contrato pela venda; venda sem contrato: 404; id inválido: 400', async () => {
      const v = await venda(); const cid = await contratoDe(v)
      expect(((await req('GET', `/api/contratos/venda/${v}`, 'admin')).json() as Detalhe).contrato.id).toBe(cid)
      expect((await req('GET', `/api/contratos/venda/${await venda()}`, 'admin')).statusCode).toBe(404)
      expect((await req('GET', '/api/contratos/abc', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/contratos/0', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/contratos/999999', 'admin')).statusCode).toBe(404)
    })
    it('o contrato mostra os trechos: o que veio do sistema (ok) e o texto fixo (txt)', async () => {
      const d = await detalhe(await contratoDe(await venda()))
      expect(d.trechos.some((x) => x.tipo === 'ok' && x.v === 'ANA SOUZA')).toBe(true)
      expect(d.trechos.some((x) => x.tipo === 'txt' && x.v.includes('CLÁUSULA PRIMEIRA'))).toBe(true)
    })
    it('o apagar da venda leva o contrato junto (cascata)', async () => {
      const v = await venda(); await gerar(v)
      await db!('venda_parcelas').where({ venda_id: v }).del(); await db!('vendas').where({ id: v }).del()
      expect(await db!('contratos').count('* as n').first()).toMatchObject({ n: '0' })
    })
  })
})
