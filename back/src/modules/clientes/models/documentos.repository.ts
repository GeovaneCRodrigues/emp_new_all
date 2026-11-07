import type { Knex } from 'knex'

export type TipoDocumento = 'DOC_IDENTIDADE' | 'COMPROVANTE_RESIDENCIA' | 'SELFIE' | 'OUTRO'
export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = ['DOC_IDENTIDADE', 'COMPROVANTE_RESIDENCIA', 'SELFIE', 'OUTRO']

/** O que a lista mostra: nunca o conteúdo do arquivo. */
export type DocumentoCliente = { id: number; clienteId: number; tipo: TipoDocumento; nome: string; mime: string; tamanho: number; sha256: string; enviadoPor: number | null; criadoEm: string }
export type NovoDocumento = { clienteId: number; tipo: TipoDocumento; nome: string; mime: string; conteudo: Buffer; sha256: string; enviadoPor: number }

export interface DocumentosRepository {
  listar(clienteId: number): Promise<DocumentoCliente[]>
  contar(clienteId: number): Promise<number>
  criar(d: NovoDocumento): Promise<DocumentoCliente>
  /** O arquivo em si, só quando o documento é desse cliente. */
  arquivo(clienteId: number, id: number): Promise<{ doc: DocumentoCliente; conteudo: Buffer } | null>
  remover(clienteId: number, id: number): Promise<DocumentoCliente | null>
}

type Linha = { id: number; cliente_id: number; tipo: TipoDocumento; nome: string; mime: string; tamanho: number; sha256: string; enviado_por: number | null; created_at: Date }
const COLUNAS = ['id', 'cliente_id', 'tipo', 'nome', 'mime', 'tamanho', 'sha256', 'enviado_por', 'created_at'] as const
const paraDoc = (l: Linha): DocumentoCliente => ({ id: l.id, clienteId: l.cliente_id, tipo: l.tipo, nome: l.nome, mime: l.mime, tamanho: l.tamanho, sha256: l.sha256, enviadoPor: l.enviado_por, criadoEm: new Date(l.created_at).toISOString() })

export function createDocumentosRepository(db: Knex): DocumentosRepository {
  return {
    async listar(clienteId) {
      const ls = await db('cliente_documentos').where({ cliente_id: clienteId }).select<Linha[]>(COLUNAS as unknown as string[]).orderBy('id')
      return ls.map(paraDoc)
    },
    async contar(clienteId) {
      const [{ n }] = await db('cliente_documentos').where({ cliente_id: clienteId }).count<{ n: string }[]>({ n: '*' })
      return Number(n)
    },
    async criar(d) {
      const [l] = await db('cliente_documentos')
        .insert({ cliente_id: d.clienteId, tipo: d.tipo, nome: d.nome, mime: d.mime, tamanho: d.conteudo.length, sha256: d.sha256, conteudo: d.conteudo, enviado_por: d.enviadoPor })
        .returning<Linha[]>(COLUNAS as unknown as string[])
      return paraDoc(l)
    },
    async arquivo(clienteId, id) {
      const l = await db('cliente_documentos').where({ id, cliente_id: clienteId }).first<(Linha & { conteudo: Buffer }) | undefined>()
      return l ? { doc: paraDoc(l), conteudo: l.conteudo } : null
    },
    async remover(clienteId, id) {
      const [l] = await db('cliente_documentos').where({ id, cliente_id: clienteId }).del().returning<Linha[]>(COLUNAS as unknown as string[])
      return l ? paraDoc(l) : null
    },
  }
}
