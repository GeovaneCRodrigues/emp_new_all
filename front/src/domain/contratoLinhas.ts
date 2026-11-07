import type { Trecho } from './contrato'

/** Uma linha do contrato, pronta para a tela: o que ela é (título, cláusula numerada, linha em branco ou texto) e os pedaços (com os campos destacados). */
export type LinhaContrato = {
  tipo: 'titulo' | 'item' | 'vazia' | 'texto'
  /** só nos itens: "6.2.1." ou "iii)", que fica numa coluna fixa para o texto alinhar nas linhas seguintes */
  numero: string | null
  partes: Trecho[]
}

const TITULO = /^(CLÁUSULA\b|ANEXO\b|INSTRUMENTO PARTICULAR\b)/
const ITEM = /^(\d+(?:\.\d+)*\.|[ivx]+\))\s+/

/** Quebra os trechos do contrato em linhas, sem mudar uma letra do texto. O texto que o cliente assina é o mesmo; só a apresentação ganha recuo e respiro. */
export function paraLinhas(trechos: Trecho[]): LinhaContrato[] {
  const linhas: Trecho[][] = [[]]
  for (const t of trechos) {
    const pedacos = t.v.split('\n')
    pedacos.forEach((p, i) => {
      if (i > 0) linhas.push([])
      if (p !== '') linhas[linhas.length - 1]!.push({ tipo: t.tipo, v: p })
    })
  }
  return linhas.map((partes) => {
    const texto = partes.map((p) => p.v).join('')
    if (texto.trim() === '') return { tipo: 'vazia', numero: null, partes: [] }
    if (TITULO.test(texto)) return { tipo: 'titulo', numero: null, partes }
    const primeiro = partes[0]
    const m = primeiro && primeiro.tipo === 'txt' ? ITEM.exec(primeiro.v) : null
    if (m) {
      const resto = primeiro!.v.slice(m[0].length)
      return { tipo: 'item', numero: m[1]!, partes: [...(resto ? [{ tipo: 'txt' as const, v: resto }] : []), ...partes.slice(1)] }
    }
    return { tipo: 'texto', numero: null, partes }
  })
}
