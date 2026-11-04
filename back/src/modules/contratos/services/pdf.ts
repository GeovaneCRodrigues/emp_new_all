import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = { largura: 595.28, altura: 841.89 }
const MARGEM = 50
const TAMANHO = 9.5
const ENTRELINHA = 13.5

/** A fonte padrão do PDF cobre o português; o que ela não tem (emoji, setas…) vira "?" em vez de derrubar a geração. */
const limpar = (t: string) => t.replace(/[^\n\x20-\x7E -ÿ–—‘’“”•€]/g, '?')

/** O texto do contrato (já fechado) em PDF de texto selecionável, que é o que o ZapSign aceita para assinar. */
export async function gerarPdfDoContrato(titulo: string, texto: string): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(titulo); pdf.setCreator('Mundo dos iPhones')
  const fonte = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const largura = A4.largura - MARGEM * 2

  const quebrar = (linha: string): string[] => {
    if (!linha.trim()) return ['']
    const palavras = linha.split(/\s+/)
    const saida: string[] = []
    let atual = ''
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p
      if (fonte.widthOfTextAtSize(tentativa, TAMANHO) <= largura) { atual = tentativa; continue }
      if (atual) saida.push(atual)
      // palavra maior que a linha (um link, por exemplo): corta onde couber
      let resto = p
      while (fonte.widthOfTextAtSize(resto, TAMANHO) > largura) {
        // busca binária do maior pedaço que cabe (o laço letra a letra era lento para palavras enormes)
        let lo = 1, hi = resto.length
        while (lo < hi) { const meio = Math.ceil((lo + hi) / 2); if (fonte.widthOfTextAtSize(resto.slice(0, meio), TAMANHO) <= largura) lo = meio; else hi = meio - 1 }
        saida.push(resto.slice(0, lo)); resto = resto.slice(lo)
      }
      atual = resto
    }
    if (atual) saida.push(atual)
    return saida
  }

  let pagina = pdf.addPage([A4.largura, A4.altura])
  let y = A4.altura - MARGEM
  const novaPagina = () => { pagina = pdf.addPage([A4.largura, A4.altura]); y = A4.altura - MARGEM }

  pagina.drawText(limpar(titulo), { x: MARGEM, y, size: 13, font: negrito, color: rgb(0, 0, 0) })
  y -= 26
  for (const bruta of limpar(texto.replace(/\r\n/g, '\n')).split('\n')) {
    const titulo2 = /^(CLÁUSULA|CLAUSULA|ANEXO)\b/i.test(bruta.trim())
    for (const linha of quebrar(bruta)) {
      if (y < MARGEM + ENTRELINHA) novaPagina()
      if (linha) pagina.drawText(linha, { x: MARGEM, y, size: TAMANHO, font: titulo2 ? negrito : fonte, color: rgb(0.05, 0.05, 0.05) })
      y -= ENTRELINHA
    }
  }
  return Buffer.from(await pdf.save())
}
