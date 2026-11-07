import { createHash } from 'node:crypto'
import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { TIPOS_DOCUMENTO, type DocumentoCliente, type DocumentosRepository, type TipoDocumento } from '../models/documentos.repository.js'
import type { ClientesRepository } from '../models/repository.js'
import { escopoDe } from './clientes.service.js'

export const MAX_ARQUIVO = 6 * 1024 * 1024
export const MAX_DOCUMENTOS = 20

/** Só o que dá para conferir pelo começo do arquivo: o tipo declarado tem que bater com o conteúdo. */
const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
}
const EXTENSAO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }

export type ArquivoDocumento = { doc: DocumentoCliente; conteudo: Buffer }
export type DocumentosService = {
  listar(s: Sessao, clienteId: number): Promise<DocumentoCliente[]>
  enviar(s: Sessao, clienteId: number, corpo: Record<string, unknown>): Promise<DocumentoCliente>
  arquivo(s: Sessao, clienteId: number, id: number): Promise<ArquivoDocumento>
  remover(s: Sessao, clienteId: number, id: number): Promise<void>
}

/** Nome para exibir e para o download: sem caminho, sem caracteres de controle, com a extensão do tipo real. */
export function nomeSeguro(bruto: unknown, mime: string): string {
  const ext = EXTENSAO[mime]
  let n = typeof bruto === 'string' ? bruto : ''
  n = n.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, '').trim()
  n = n.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim().slice(0, 100)
  return `${n || 'documento'}.${ext}`
}

export function createDocumentosService(repo: DocumentosRepository, clientes: ClientesRepository, auditoria: AuditoriaRepository): DocumentosService {
  /** Documento pessoal é dado sensível: só administrador e vendedor, e só do cliente que está no escopo deles. */
  async function clienteDoEscopo(s: Sessao, clienteId: number) {
    if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso aos documentos dos clientes')
    const c = await clientes.buscar(clienteId, escopoDe(s))
    if (!c) throw naoEncontrado('Cliente não encontrado')
    return c
  }

  return {
    async listar(s, clienteId) {
      await clienteDoEscopo(s, clienteId)
      return repo.listar(clienteId)
    },

    async enviar(s, clienteId, corpo) {
      await clienteDoEscopo(s, clienteId)
      const tipo = corpo.tipo as TipoDocumento
      if (!TIPOS_DOCUMENTO.includes(tipo)) throw requisicaoInvalida('Tipo de documento inválido')
      const mime = typeof corpo.mime === 'string' ? corpo.mime : ''
      const confere = ASSINATURAS[mime]
      if (!confere) throw requisicaoInvalida('Envie um PDF, JPG ou PNG')
      if (typeof corpo.dados !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(corpo.dados) || corpo.dados.length % 4 !== 0) throw requisicaoInvalida('Arquivo inválido')
      const conteudo = Buffer.from(corpo.dados, 'base64')
      if (!conteudo.length) throw requisicaoInvalida('Arquivo vazio')
      if (conteudo.length > MAX_ARQUIVO) throw requisicaoInvalida('Arquivo grande demais (máximo 6 MB)')
      if (!confere(conteudo)) throw requisicaoInvalida('O arquivo não é do tipo informado')
      if ((await repo.contar(clienteId)) >= MAX_DOCUMENTOS) throw requisicaoInvalida(`Cada cliente aceita até ${MAX_DOCUMENTOS} documentos`)

      const doc = await repo.criar({ clienteId, tipo, nome: nomeSeguro(corpo.nome, mime), mime, conteudo, sha256: createHash('sha256').update(conteudo).digest('hex'), enviadoPor: s.usuarioId })
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DOCUMENTO_CLIENTE_ENVIADO', entidade: 'cliente', entidadeId: clienteId, depois: { documentoId: doc.id, tipo, nome: doc.nome, tamanho: doc.tamanho } })
      return doc
    },

    async arquivo(s, clienteId, id) {
      await clienteDoEscopo(s, clienteId)
      const a = await repo.arquivo(clienteId, id)
      if (!a) throw naoEncontrado('Documento não encontrado')
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DOCUMENTO_CLIENTE_VISTO', entidade: 'cliente', entidadeId: clienteId, depois: { documentoId: id, tipo: a.doc.tipo } })
      return a
    },

    async remover(s, clienteId, id) {
      await clienteDoEscopo(s, clienteId)
      const d = await repo.remover(clienteId, id)
      if (!d) throw naoEncontrado('Documento não encontrado')
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DOCUMENTO_CLIENTE_REMOVIDO', entidade: 'cliente', entidadeId: clienteId, antes: { documentoId: id, tipo: d.tipo, nome: d.nome, sha256: d.sha256 } })
    },
  }
}
