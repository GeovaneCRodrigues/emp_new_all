import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ContratosRepository, ContratoCompleto } from '../models/repository.js'
import type { DadosVenda, Empresa, EscopoContratos, LinhaContrato } from '../models/types.js'
import { camposDesconhecidos, MODELO_PADRAO, preencher, VARIAVEIS, type Preenchido, type Trecho, type Variavel } from './modelo.js'

export type ContratoItem = Omit<LinhaContrato, 'textoEnviado'>
export type ContratoDetalhe = {
  contrato: ContratoItem
  /** o contrato já foi marcado como enviado: o texto não muda mais */
  congelado: boolean
  trechos: Trecho[]
  faltam: string[]
  /** o texto final, para copiar */
  texto: string
}
export type ResultadoLista = { itens: ContratoItem[]; resumo: { assinados: number; esperando: number; comSeguro: number } }
export type ModeloView = { versao: number; texto: string; padrao: string; variaveis: Variavel[] }

export type ContratosService = {
  listar(s: Sessao, f: { status?: string }): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<ContratoDetalhe>
  porVenda(s: Sessao, vendaId: number): Promise<ContratoDetalhe>
  /** Gera o contrato de uma venda que ainda não tem (a venda nova gera sozinha). */
  gerar(s: Sessao, vendaId: number): Promise<ContratoDetalhe>
  /** Chamado pela venda nova: não pode derrubar a venda. */
  gerarDaVenda(vendaId: number, usuarioId: number): Promise<void>
  marcarEnviado(s: Sessao, id: number): Promise<ContratoDetalhe>
  marcarAssinado(s: Sessao, id: number): Promise<ContratoDetalhe>
  definirSeguro(s: Sessao, id: number, seguro: unknown): Promise<ContratoDetalhe>
  modelo(s: Sessao): Promise<ModeloView>
  salvarModelo(s: Sessao, texto: unknown): Promise<ModeloView>
  previa(s: Sessao, corpo: Record<string, unknown>): Promise<Preenchido>
  empresa(s: Sessao): Promise<Empresa>
  salvarEmpresa(s: Sessao, corpo: Record<string, unknown>): Promise<Empresa>
}

type Dependencias = { repo: ContratosRepository; auditoria: AuditoriaRepository; log?: (msg: string, err: unknown) => void }

const TEXTO_MIN = 50
const TEXTO_MAX = 30_000
const DINHEIRO_MAX = 1_000_000

const conflito = (msg: string, codigo: string) => new HttpError(409, msg, codigo)
const exigirAdmin = (s: Sessao, msg: string) => { if (s.perfil !== 'ADMIN') throw semPermissao(msg) }
function escopoDe(s: Sessao): EscopoContratos {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'VENDEDOR') return { tipo: 'VENDEDOR', usuarioId: s.usuarioId }
  throw semPermissao('Você não tem acesso aos contratos')
}
const semTexto = ({ textoEnviado: _t, ...resto }: LinhaContrato): ContratoItem => resto
const pendente = (l: LinhaContrato) => l.status !== 'ASSINADO' && l.vendaStatus !== 'RETOMADA' && l.vendaStatus !== 'CANCELADA'

export function createContratosService(d: Dependencias): ContratosService {
  /** O texto do modelo com que o contrato foi gerado (versão 0 = o padrão do sistema). */
  async function textoDaVersao(versao: number): Promise<string> {
    return (versao > 0 ? await d.repo.modelo(versao) : null) ?? MODELO_PADRAO
  }
  async function montar(c: ContratoCompleto): Promise<ContratoDetalhe> {
    const item = semTexto(c.linha)
    if (c.linha.textoEnviado !== null) return { contrato: item, congelado: true, trechos: [{ tipo: 'txt', v: c.linha.textoEnviado }], faltam: [], texto: c.linha.textoEnviado }
    const p = preencher(await textoDaVersao(c.linha.modeloVersao), c.dados, await d.repo.empresa())
    return { contrato: item, congelado: false, trechos: p.trechos, faltam: p.faltam, texto: p.texto }
  }
  async function carregar(s: Sessao, id: number): Promise<ContratoCompleto> {
    const c = await d.repo.obter(id, escopoDe(s))
    if (!c) throw naoEncontrado('Contrato não encontrado')
    return c
  }
  async function criarDe(vendaId: number, dados: DadosVenda, usuarioId: number) {
    const versao = (await d.repo.modeloAtual())?.versao ?? 0
    const r = await d.repo.criar(vendaId, dados.numero, versao, usuarioId)
    if (r.criado) await d.auditoria.registrar({ usuarioId, acao: 'CONTRATO_GERADO', entidade: 'contrato', entidadeId: r.id, depois: { vendaId, numero: dados.numero, modeloVersao: versao } })
    return r
  }

  return {
    async listar(s, f) {
      const escopo = escopoDe(s)
      if (f.status !== undefined && f.status !== 'ESPERANDO' && f.status !== 'ASSINADO') throw requisicaoInvalida('status deve ser ESPERANDO ou ASSINADO')
      const todas = await d.repo.listar(escopo)
      const itens = todas.filter((l) => (f.status === 'ASSINADO' ? l.status === 'ASSINADO' : f.status === 'ESPERANDO' ? pendente(l) : true))
      return { itens: itens.map(semTexto), resumo: { assinados: todas.filter((l) => l.status === 'ASSINADO').length, esperando: todas.filter(pendente).length, comSeguro: todas.filter((l) => l.seguro).length } }
    },
    async obter(s, id) { return montar(await carregar(s, id)) },
    async porVenda(s, vendaId) {
      const c = await d.repo.obterPorVenda(vendaId, escopoDe(s))
      if (!c) throw naoEncontrado('Esta venda não tem contrato')
      return montar(c)
    },

    async gerar(s, vendaId) {
      const escopo = escopoDe(s)
      const v = await d.repo.vendaParaGerar(vendaId, escopo)
      if (!v) throw naoEncontrado('Venda não encontrada')
      if (v.temContrato) throw conflito('Esta venda já tem contrato', 'CONTRATO_JA_EXISTE')
      if (v.legado && s.perfil !== 'ADMIN') throw semPermissao('Só o administrador gera contrato de venda antiga')
      if (v.dados.vendaStatus !== 'ATIVA' && v.dados.vendaStatus !== 'QUITADA') throw conflito('Venda retomada ou cancelada não tem contrato', 'VENDA_ENCERRADA')
      const r = await criarDe(vendaId, v.dados, s.usuarioId)
      return montar((await d.repo.obter(r.id, escopo))!)
    },
    async gerarDaVenda(vendaId, usuarioId) {
      try {
        const v = await d.repo.vendaParaGerar(vendaId, { tipo: 'TODOS' })
        if (v && !v.temContrato) await criarDe(vendaId, v.dados, usuarioId)
      } catch (err) { d.log?.(`Falha ao gerar o contrato da venda ${vendaId}`, err) }
    },

    async marcarEnviado(s, id) {
      const c = await carregar(s, id)
      if (c.linha.status !== 'AGUARDANDO') throw conflito(c.linha.status === 'ASSINADO' ? 'Este contrato já foi assinado' : 'Este contrato já foi marcado como enviado', 'CONTRATO_JA_ENVIADO')
      if (c.linha.vendaStatus !== 'ATIVA' && c.linha.vendaStatus !== 'QUITADA') throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      const det = await montar(c)
      if (det.faltam.length) throw conflito(`Falta cadastrar: ${det.faltam.join(', ')}`, 'DADOS_FALTANDO')
      await d.repo.marcarEnviado(id, det.texto)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_ENVIADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId } })
      return montar(await carregar(s, id))
    },
    async marcarAssinado(s, id) {
      exigirAdmin(s, 'Só o administrador marca o contrato como assinado')
      const c = await carregar(s, id)
      if (c.linha.status === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (c.linha.status !== 'ENVIADO') throw conflito('Marque o contrato como enviado antes de marcar como assinado', 'CONTRATO_NAO_ENVIADO')
      await d.repo.marcarAssinado(id)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_ASSINADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId } })
      return montar(await carregar(s, id))
    },
    async definirSeguro(s, id, seguro) {
      exigirAdmin(s, 'Só o administrador muda o seguro do contrato')
      if (typeof seguro !== 'boolean') throw requisicaoInvalida('seguro precisa ser verdadeiro ou falso')
      const c = await carregar(s, id)
      if (c.linha.status !== 'AGUARDANDO') throw conflito('O contrato já foi enviado: o seguro não muda mais', 'CONTRATO_JA_ENVIADO')
      if (c.linha.seguro !== seguro) {
        await d.repo.definirSeguro(id, seguro)
        await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_SEGURO', entidade: 'contrato', entidadeId: id, antes: { seguro: c.linha.seguro }, depois: { seguro } })
      }
      return montar(await carregar(s, id))
    },

    async modelo(s) {
      exigirAdmin(s, 'Só o administrador vê o modelo do contrato')
      const m = await d.repo.modeloAtual()
      return { versao: m?.versao ?? 0, texto: m?.texto ?? MODELO_PADRAO, padrao: MODELO_PADRAO, variaveis: VARIAVEIS }
    },
    async salvarModelo(s, texto) {
      exigirAdmin(s, 'Só o administrador muda o modelo do contrato')
      if (typeof texto !== 'string') throw requisicaoInvalida('texto precisa ser um texto')
      const t = texto.replace(/\r\n/g, '\n').trim()
      if (t.length < TEXTO_MIN) throw requisicaoInvalida(`O modelo precisa ter pelo menos ${TEXTO_MIN} letras`)
      if (t.length > TEXTO_MAX) throw requisicaoInvalida(`O modelo passa de ${TEXTO_MAX} letras`)
      const desconhecidos = camposDesconhecidos(t)
      if (desconhecidos.length) throw requisicaoInvalida(`Campo que não existe: ${desconhecidos.map((k) => `{{${k}}}`).join(', ')}`)
      const atual = await d.repo.modeloAtual()
      if ((atual?.texto ?? MODELO_PADRAO) === t) return { versao: atual?.versao ?? 0, texto: t, padrao: MODELO_PADRAO, variaveis: VARIAVEIS }
      const versao = await d.repo.salvarModelo(t, s.usuarioId)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_MODELO_SALVO', entidade: 'contrato_modelo', entidadeId: versao, depois: { versao, tamanho: t.length } })
      return { versao, texto: t, padrao: MODELO_PADRAO, variaveis: VARIAVEIS }
    },
    async previa(s, corpo) {
      exigirAdmin(s, 'Só o administrador vê a prévia do modelo')
      if (typeof corpo.texto !== 'string' || corpo.texto.length > TEXTO_MAX) throw requisicaoInvalida('texto inválido')
      const id = corpo.vendaId
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw requisicaoInvalida('vendaId inválido')
      const v = await d.repo.vendaParaGerar(id, { tipo: 'TODOS' })
      if (!v) throw naoEncontrado('Venda não encontrada')
      return preencher(corpo.texto, v.dados, await d.repo.empresa())
    },

    async empresa(s) {
      exigirAdmin(s, 'Só o administrador vê os dados da empresa')
      return d.repo.empresa()
    },
    async salvarEmpresa(s, corpo) {
      exigirAdmin(s, 'Só o administrador muda os dados da empresa')
      const atual = await d.repo.empresa()
      const texto = (k: 'nome' | 'cnpj' | 'endereco' | 'email' | 'atendente', max: number): string | null => {
        if (!(k in corpo)) return atual[k]
        const v = corpo[k]
        if (v === null || v === '') { if (k === 'nome') throw requisicaoInvalida('A razão social não pode ficar vazia'); return null }
        if (typeof v !== 'string' || v.trim().length > max) throw requisicaoInvalida(`${k}: no máximo ${max} letras`)
        return v.trim()
      }
      const dinheiro = (k: 'avaria' | 'reposicao' | 'seguro' | 'recuperacao'): number | null => {
        if (!(k in corpo)) return atual[k]
        const v = corpo[k]
        if (v === null || v === '') return null
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > DINHEIRO_MAX) throw requisicaoInvalida(`${k} precisa ser um valor entre 0 e ${DINHEIRO_MAX}`)
        return Math.round(v * 100) / 100
      }
      let cancelamentoPct = atual.cancelamentoPct
      if ('cancelamentoPct' in corpo) {
        const v = corpo.cancelamentoPct
        if (v === null || v === '') cancelamentoPct = null
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw requisicaoInvalida('cancelamentoPct precisa ficar entre 0 e 100')
        else cancelamentoPct = Math.round(v * 100) / 100
      }
      const nova: Empresa = {
        nome: texto('nome', 120)!, cnpj: texto('cnpj', 18), endereco: texto('endereco', 200), email: texto('email', 120), atendente: texto('atendente', 80),
        avaria: dinheiro('avaria'), reposicao: dinheiro('reposicao'), seguro: dinheiro('seguro'), cancelamentoPct, recuperacao: dinheiro('recuperacao'),
      }
      if (nova.cnpj !== null && nova.cnpj.replace(/\D/g, '').length !== 14) throw requisicaoInvalida('CNPJ precisa ter 14 números')
      if (nova.email !== null && !/^\S+@\S+\.\S+$/.test(nova.email)) throw requisicaoInvalida('E-mail inválido')
      await d.repo.salvarEmpresa(nova)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_EMPRESA_SALVA', entidade: 'empresa', entidadeId: 1, antes: atual, depois: nova })
      return nova
    },
  }
}
