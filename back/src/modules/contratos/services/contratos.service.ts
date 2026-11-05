import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ContratosRepository, ContratoCompleto } from '../models/repository.js'
import { soDigitos } from '../../../shared/documentos.js'
import type { Assinatura, DadosVenda, Empresa, EscopoContratos, LinhaContrato } from '../models/types.js'
import { gerarPdfDoContrato } from './pdf.js'
import type { ZapsignClient } from './zapsign.client.js'
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
  /** só depois de assinado pelo link */
  assinatura: Assinatura | null
  /** como foi assinado (LINK próprio, ZAPSIGN ou marcado à mão) */
  assinaturaVia: LinhaContrato['assinaturaVia']
  /** o documento no ZapSign, se o contrato foi enviado por lá */
  zapsign: { status: string; sandbox: boolean; signUrl: string | null; arquivoAssinado: string | null } | null
}
export type LinkGerado = { token: string; expiraEm: string; contrato: ContratoDetalhe }
/** O que a página pública de assinatura mostra (nada além do contrato daquele link). */
export type ContratoParaAssinar = { numero: string; clienteNome: string; aparelho: string; empresa: string; texto: string; expiraEm: string }
export type OrigemDaAssinatura = { ip: string | null; userAgent: string | null }
export type ResultadoLista = { itens: ContratoItem[]; resumo: { assinados: number; esperando: number } }
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
  /** Gera (ou troca) o link de assinatura; o contrato é enviado e o texto congela. O token só aparece aqui. */
  gerarLink(s: Sessao, id: number): Promise<LinkGerado>
  zapsignStatus(s: Sessao): { ativo: boolean; sandbox: boolean; webhook: boolean }
  /** Manda o contrato para o ZapSign (o texto fecha). Se já foi, devolve o que existe sem criar outro documento. */
  enviarZapsign(s: Sessao, id: number): Promise<ContratoDetalhe>
  /** Pergunta ao ZapSign como está o documento e, se o cliente assinou, fecha o contrato. */
  atualizarZapsign(s: Sessao, id: number): Promise<ContratoDetalhe>
  /** Público: aviso do ZapSign. Só vale com o segredo, e o estado é sempre conferido na API do ZapSign (o corpo do aviso não é confiado). */
  webhookZapsign(corpo: Record<string, unknown>, segredo: string | null): Promise<{ ok: true; ignorado?: true }>
  /** Público (sem login): o contrato de um link. */
  verParaAssinar(token: string): Promise<ContratoParaAssinar>
  /** Público (sem login): o cliente confirma o CPF, assina e o contrato fecha. */
  assinarPeloLink(token: string, corpo: Record<string, unknown>, origem: OrigemDaAssinatura): Promise<{ numero: string; assinadoEm: string }>
  modelo(s: Sessao): Promise<ModeloView>
  salvarModelo(s: Sessao, texto: unknown): Promise<ModeloView>
  previa(s: Sessao, corpo: Record<string, unknown>): Promise<Preenchido>
  empresa(s: Sessao): Promise<Empresa>
  salvarEmpresa(s: Sessao, corpo: Record<string, unknown>): Promise<Empresa>
  salvarLogo(s: Sessao, imagem: unknown): Promise<Empresa>
  removerLogo(s: Sessao): Promise<Empresa>
  /** Pública: a imagem da logo para o <img> (o navegador não manda cabeçalho de login). null = não tem. */
  logoPublica(): Promise<{ tipo: string; bytes: Buffer } | null>
}

type Dependencias = {
  repo: ContratosRepository; auditoria: AuditoriaRepository; log?: (msg: string, err: unknown) => void
  /** sem isso o ZapSign fica desligado e o contrato continua assinando pelo link próprio */
  zapsign?: ZapsignClient | null
  /** segredo que o ZapSign manda no aviso (webhook) */
  webhookSecret?: string | null
}

const TEXTO_MIN = 50
const TEXTO_MAX = 30_000
const LINK_DIAS = 7
const LOGO_MAX_BYTES = 300_000
/** O arquivo tem de começar como o tipo que diz ser (não confia só no texto do data URL). */
function assinaturaDoArquivo(tipo: string, b: Buffer): boolean {
  if (tipo === 'image/png') return b.length > 8 && b.readUInt32BE(0) === 0x89504e47
  if (tipo === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  return b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
}
const TENTATIVAS_DE_CPF = 5
const IMAGEM_MAX = 400_000
const PNG_URL = 'data:image/png;base64,'
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')
/**
 * O CPF é o que o cliente digita para provar quem é: a página pública não pode mostrá-lo (quem só tem o link leria e passaria).
 * Na tela ele aparece como ***.***.***-25; o texto gravado e assinado continua com o CPF inteiro.
 */
export function mascararCpf(texto: string, cpf: string | null): string {
  const dig = soDigitos(cpf ?? '')
  if (dig.length !== 11) return texto
  const mascarado = `***.***.***-${dig.slice(9)}`
  const formatado = `${dig.slice(0, 3)}.${dig.slice(3, 6)}.${dig.slice(6, 9)}-${dig.slice(9)}`
  return texto.replaceAll(formatado, mascarado).replaceAll(dig, mascarado)
}
const linkInvalido = () => naoEncontrado('Link inválido. Peça um novo ao vendedor.')

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
  async function montar(c: ContratoCompleto, arquivo?: string | null): Promise<ContratoDetalhe> {
    const item = semTexto(c.linha)
    const assinatura = c.linha.status === 'ASSINADO' ? await d.repo.assinaturaDe(c.linha.id) : null
    const z = c.linha.zapsign
    const extra = { assinatura, assinaturaVia: c.linha.assinaturaVia, zapsign: z ? { status: z.status, sandbox: z.sandbox, signUrl: z.url, arquivoAssinado: arquivo ?? null } : null }
    if (c.linha.textoEnviado !== null) return { contrato: item, congelado: true, trechos: [{ tipo: 'txt', v: c.linha.textoEnviado }], faltam: [], texto: c.linha.textoEnviado, ...extra }
    const p = preencher(await textoDaVersao(c.linha.modeloVersao), c.dados, await d.repo.empresa())
    return { contrato: item, congelado: false, trechos: p.trechos, faltam: p.faltam, texto: p.texto, ...extra }
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

  /** Documento do ZapSign esperando a assinatura (de teste só conta quando o servidor também está em teste). */
  const zapsignVivo = (l: LinhaContrato) => !!l.zapsign && l.zapsign.status === 'pending' && (!d.zapsign || l.zapsign.sandbox === d.zapsign.sandbox)
  const soDig = (v: string | null) => (v ?? '').replace(/\D/g, '')
  const zap = (): ZapsignClient => { if (!d.zapsign) throw new HttpError(503, 'O ZapSign não está ligado neste sistema. Use o link de assinatura.', 'ZAPSIGN_DESLIGADO'); return d.zapsign }
  /** Aplica no contrato o que o ZapSign diz do documento. Documento de teste nunca fecha o contrato (não tem validade jurídica). */
  async function aplicarZapsign(l: LinhaContrato, status: string, usuarioId: number | null) {
    if (l.zapsign && l.zapsign.status !== status) await d.repo.atualizarStatusZapsign(l.id, status)
    if (status === 'signed' && l.status !== 'ASSINADO' && l.zapsign && !l.zapsign.sandbox && (await d.repo.assinarViaZapsign(l.id))) {
      await d.auditoria.registrar({ usuarioId, acao: 'CONTRATO_ASSINADO_ZAPSIGN', entidade: 'contrato', entidadeId: l.id, depois: { vendaId: l.vendaId } })
    }
  }

  /** O contrato do link, se o link ainda vale: não vencido, não assinado e não bloqueado por erros de CPF. */
  async function linkVivo(token: string) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw linkInvalido()
    const l = await d.repo.porLink(sha256(token))
    if (!l || l.linha.textoEnviado === null) throw linkInvalido()
    if (l.linha.status === 'ASSINADO') throw new HttpError(410, 'Este contrato já foi assinado.', 'CONTRATO_JA_ASSINADO')
    if (l.tentativas >= TENTATIVAS_DE_CPF) throw new HttpError(410, 'Link bloqueado por tentativas erradas. Peça um novo ao vendedor.', 'LINK_BLOQUEADO')
    if (!l.expiraEm || l.expiraEm.getTime() < Date.now()) throw new HttpError(410, 'Este link venceu. Peça um novo ao vendedor.', 'LINK_VENCIDO')
    if (l.linha.vendaStatus !== 'ATIVA' && l.linha.vendaStatus !== 'QUITADA') throw new HttpError(410, 'Esta venda foi encerrada.', 'VENDA_ENCERRADA')
    return l
  }

  return {
    async listar(s, f) {
      const escopo = escopoDe(s)
      if (f.status !== undefined && f.status !== 'ESPERANDO' && f.status !== 'ASSINADO') throw requisicaoInvalida('status deve ser ESPERANDO ou ASSINADO')
      const todas = await d.repo.listar(escopo)
      const itens = todas.filter((l) => (f.status === 'ASSINADO' ? l.status === 'ASSINADO' : f.status === 'ESPERANDO' ? pendente(l) : true))
      return { itens: itens.map(semTexto), resumo: { assinados: todas.filter((l) => l.status === 'ASSINADO').length, esperando: todas.filter(pendente).length } }
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
    async gerarLink(s, id) {
      const c = await carregar(s, id)
      if (c.linha.status === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (c.linha.vendaStatus !== 'ATIVA' && c.linha.vendaStatus !== 'QUITADA') throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      if (zapsignVivo(c.linha)) throw conflito('Este contrato já foi enviado pelo ZapSign e espera a assinatura de lá', 'ZAPSIGN_EM_ANDAMENTO')
      const det = await montar(c)
      // o CPF é como o cliente prova quem é na hora de assinar: sem ele não há link, mesmo que o modelo não use o campo
      const faltam = [...det.faltam]
      if (soDigitos(c.dados.cliente.cpf ?? '').length !== 11 && !faltam.includes('CPF')) faltam.push('CPF')
      if (faltam.length) throw conflito(`Falta cadastrar: ${faltam.join(', ')}`, 'DADOS_FALTANDO')
      if (c.linha.status === 'AGUARDANDO') {
        await d.repo.marcarEnviado(id, det.texto)
        await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_ENVIADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId } })
      }
      const token = randomBytes(32).toString('base64url')
      const expira = new Date(Date.now() + LINK_DIAS * 86_400_000)
      await d.repo.gravarLink(id, sha256(token), expira)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_LINK_GERADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId, expiraEm: expira.toISOString() } })
      return { token, expiraEm: expira.toISOString(), contrato: await montar(await carregar(s, id)) }
    },

    zapsignStatus(s) {
      escopoDe(s)
      return { ativo: !!d.zapsign, sandbox: d.zapsign?.sandbox ?? false, webhook: !!d.webhookSecret }
    },

    async enviarZapsign(s, id) {
      const z = zap()
      const c = await carregar(s, id)
      if (c.linha.status === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (c.linha.vendaStatus !== 'ATIVA' && c.linha.vendaStatus !== 'QUITADA') throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      if (zapsignVivo(c.linha)) return montar(c)
      const det = await montar(c)
      const faltam = [...det.faltam]
      if (soDig(c.dados.cliente.cpf).length !== 11 && !faltam.includes('CPF')) faltam.push('CPF')
      if (faltam.length) throw conflito(`Falta cadastrar: ${faltam.join(', ')}`, 'DADOS_FALTANDO')
      if (c.linha.status === 'AGUARDANDO') {
        await d.repo.marcarEnviado(id, det.texto)
        await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_ENVIADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId } })
      }
      const cl = c.dados.cliente
      const doc = await z.criarDocumento({
        nome: `Contrato ${c.linha.numero}`, numero: c.linha.numero, pdf: await gerarPdfDoContrato(`Contrato ${c.linha.numero}`, det.texto),
        signatario: { nome: cl.nome, email: cl.email, foneDigitos: soDig(cl.fone) || null, cpf: soDig(cl.cpf) },
      })
      await d.repo.gravarZapsign(id, { token: doc.token, signerToken: doc.signerToken, url: doc.signUrl, status: doc.status, sandbox: z.sandbox })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_ZAPSIGN_ENVIADO', entidade: 'contrato', entidadeId: id, depois: { vendaId: c.linha.vendaId, documento: doc.token, teste: z.sandbox } })
      return montar(await carregar(s, id))
    },

    async atualizarZapsign(s, id) {
      const z = zap()
      const c = await carregar(s, id)
      if (!c.linha.zapsign) throw conflito('Este contrato não foi enviado pelo ZapSign', 'ZAPSIGN_NAO_ENVIADO')
      const doc = await z.obterDocumento(c.linha.zapsign.token)
      await aplicarZapsign(c.linha, doc.status, s.usuarioId)
      return montar(await carregar(s, id), doc.arquivoAssinado)
    },

    async webhookZapsign(corpo, segredo) {
      if (!d.zapsign || !d.webhookSecret) throw naoEncontrado('Não encontrado')
      const a = createHash('sha256').update(segredo ?? '').digest(); const b = createHash('sha256').update(d.webhookSecret).digest()
      if (!segredo || !timingSafeEqual(a, b)) throw new HttpError(401, 'Não autorizado', 'NAO_AUTORIZADO')
      const token = typeof corpo.token === 'string' ? corpo.token : typeof corpo.document_token === 'string' ? corpo.document_token : ''
      const l = token ? await d.repo.porTokenZapsign(token) : null
      if (!l) return { ok: true, ignorado: true }
      // o aviso só diz "mexeu nesse documento": quem manda é o que o ZapSign responde para o token
      const doc = await d.zapsign.obterDocumento(token)
      if (doc.externalId !== l.numero) return { ok: true, ignorado: true }
      await aplicarZapsign(l, doc.status, null)
      return { ok: true }
    },

    async verParaAssinar(token) {
      const l = await linkVivo(token)
      return {
        numero: l.linha.numero, clienteNome: l.linha.clienteNome, aparelho: l.linha.aparelho, empresa: (await d.repo.empresa()).nome,
        texto: mascararCpf(l.linha.textoEnviado ?? '', l.cpf), expiraEm: l.expiraEm!.toISOString(),
      }
    },

    async assinarPeloLink(token, corpo, origem) {
      const l = await linkVivo(token)
      if (corpo.aceito !== true) throw requisicaoInvalida('Marque que leu e concorda com o contrato')
      const cpf = typeof corpo.cpf === 'string' ? soDigitos(corpo.cpf) : ''
      if (cpf.length !== 11) throw requisicaoInvalida('Digite o CPF completo (11 números)')
      const imagem = corpo.assinatura
      if (typeof imagem !== 'string' || !imagem.startsWith(PNG_URL) || imagem.length > IMAGEM_MAX) throw requisicaoInvalida('Assinatura inválida. Desenhe de novo.')
      const bytes = Buffer.from(imagem.slice(PNG_URL.length), 'base64')
      if (bytes.length < 100 || bytes.readUInt32BE(0) !== 0x89504e47) throw requisicaoInvalida('Assinatura inválida. Desenhe de novo.')
      if (cpf !== l.cpf) {
        const erros = await d.repo.contarErroDeCpf(l.linha.id)
        const restam = Math.max(0, TENTATIVAS_DE_CPF - erros)
        throw new HttpError(403, restam > 0 ? `CPF não confere. Você tem mais ${restam} ${restam === 1 ? 'tentativa' : 'tentativas'}.` : 'CPF não confere e o link foi bloqueado. Peça um novo ao vendedor.', 'CPF_NAO_CONFERE')
      }
      const textoHash = sha256(l.linha.textoEnviado ?? '')
      const ok = await d.repo.assinar(l.linha.id, { imagem, cpf, textoHash, ip: origem.ip, userAgent: origem.userAgent?.slice(0, 300) ?? null })
      if (!ok) throw new HttpError(410, 'Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      await d.auditoria.registrar({ usuarioId: null, acao: 'CONTRATO_ASSINADO_PELO_LINK', entidade: 'contrato', entidadeId: l.linha.id, depois: { vendaId: l.linha.vendaId, ip: origem.ip, textoHash } })
      return { numero: l.linha.numero, assinadoEm: new Date().toISOString() }
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
      const texto = (k: 'nome' | 'cnpj' | 'endereco' | 'email' | 'atendente' | 'telefone' | 'cidade' | 'uf' | 'pixChave', max: number): string | null => {
        if (!(k in corpo)) return atual[k]
        const v = corpo[k]
        if (v === null || v === '') { if (k === 'nome') throw requisicaoInvalida('A razão social não pode ficar vazia'); return null }
        if (typeof v !== 'string' || v.trim().length > max) throw requisicaoInvalida(`${k}: no máximo ${max} letras`)
        return v.trim()
      }
      const nova: Omit<Empresa, 'temLogo'> = {
        nome: texto('nome', 120)!, cnpj: texto('cnpj', 18), endereco: texto('endereco', 200), email: texto('email', 120), atendente: texto('atendente', 80),
        telefone: texto('telefone', 20), cidade: texto('cidade', 100), uf: texto('uf', 2), pixChave: texto('pixChave', 77),
      }
      if (nova.cnpj !== null && nova.cnpj.replace(/\D/g, '').length !== 14) throw requisicaoInvalida('CNPJ precisa ter 14 números')
      if (nova.email !== null && !/^\S+@\S+\.\S+$/.test(nova.email)) throw requisicaoInvalida('E-mail inválido')
      if (nova.telefone !== null) {
        const dig = nova.telefone.replace(/\D/g, '')
        if (dig.length < 10 || dig.length > 11) throw requisicaoInvalida('Telefone precisa ter DDD + número (10 ou 11 números)')
        nova.telefone = dig
      }
      if (nova.uf !== null) {
        if (!/^[A-Za-z]{2}$/.test(nova.uf)) throw requisicaoInvalida('UF deve ter 2 letras, por exemplo SP')
        nova.uf = nova.uf.toUpperCase()
      }
      if (nova.pixChave !== null && (nova.pixChave.length < 3 || /[\u0000-\u001f]/.test(nova.pixChave))) throw requisicaoInvalida('Chave Pix inválida')
      await d.repo.salvarEmpresa(nova)
      const { temLogo, ...antes } = atual
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_EMPRESA_SALVA', entidade: 'empresa', entidadeId: 1, antes, depois: nova })
      return { ...nova, temLogo }
    },

    async salvarLogo(s, imagem) {
      exigirAdmin(s, 'Só o administrador troca a logo da empresa')
      if (typeof imagem !== 'string') throw requisicaoInvalida('imagem precisa ser um texto (data URL)')
      const m = imagem.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
      if (!m) throw requisicaoInvalida('A logo precisa ser PNG, JPEG ou WEBP')
      const bytes = Buffer.from(m[2], 'base64')
      if (bytes.length > LOGO_MAX_BYTES) throw requisicaoInvalida(`A logo passa de ${Math.round(LOGO_MAX_BYTES / 1000)} KB. Use uma imagem menor`)
      if (!assinaturaDoArquivo(m[1], bytes)) throw requisicaoInvalida('O arquivo não é uma imagem válida')
      await d.repo.salvarLogo(imagem)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_EMPRESA_LOGO', entidade: 'empresa', entidadeId: 1, depois: { tipo: m[1], bytes: bytes.length } })
      return d.repo.empresa()
    },
    async removerLogo(s) {
      exigirAdmin(s, 'Só o administrador remove a logo da empresa')
      await d.repo.salvarLogo(null)
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CONTRATO_EMPRESA_LOGO', entidade: 'empresa', entidadeId: 1, depois: { removida: true } })
      return d.repo.empresa()
    },
    async logoPublica() {
      const url = await d.repo.logo()
      const m = url?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
      return m ? { tipo: m[1], bytes: Buffer.from(m[2], 'base64') } : null
    },
  }
}
