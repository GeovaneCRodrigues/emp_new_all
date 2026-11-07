import type { DocumentoClienteApi, TipoDocumento } from '@/api/clientes'

export const TIPOS_DOCUMENTO: { tipo: TipoDocumento; rotulo: string; dica: string; obrigatorio: boolean }[] = [
  { tipo: 'DOC_IDENTIDADE', rotulo: 'CNH ou RG', dica: 'frente e verso', obrigatorio: true },
  { tipo: 'COMPROVANTE_RESIDENCIA', rotulo: 'Comprovante de residência', dica: 'conta recente', obrigatorio: true },
  { tipo: 'SELFIE', rotulo: 'Selfie', dica: 'opcional', obrigatorio: false },
  { tipo: 'OUTRO', rotulo: 'Outros', dica: 'opcional', obrigatorio: false },
]

/** Os documentos obrigatórios que ainda não têm nenhum arquivo. */
export function documentosFaltando(docs: Pick<DocumentoClienteApi, 'tipo'>[]): string[] {
  return TIPOS_DOCUMENTO.filter((t) => t.obrigatorio && !docs.some((d) => d.tipo === t.tipo)).map((t) => t.rotulo)
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}
