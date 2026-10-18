import type { EmprestimoApi } from '@/api/emprestimos'
import type { PagamentoApi } from '@/api/recebimentos'
import { dmy, dmyA, fmt } from './format'
import { nomeEmprestimo } from './emprestimo'

export type ModoDetalhamento = 'SIMPLES' | 'EXTENSO'

const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'dinheiro', CARTAO: 'cartão' } as const
const MAX_PAGAMENTOS = 40
const MAX_ABERTAS = 12

const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 864e5)
const primeiroNome = (n: string) => { const p = n.trim().split(/\s+/)[0] ?? ''; return p ? p.charAt(0) + p.slice(1).toLocaleLowerCase('pt-BR') : '' }
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Texto para mandar ao cliente (WhatsApp). Nunca leva capital, taxa, lucro nem indicador: só o que ele pagou e o que falta.
 * SIMPLES: o resumo. EXTENSO: o resumo + cada pagamento + as parcelas que ainda vencem.
 */
export function detalhamentoEmprestimo(e: EmprestimoApi, pagamentos: PagamentoApi[], hoje: string, modo: ModoDetalhamento): string {
  const abertas = e.parcelas.filter((p) => p.acordo !== 'ENCERRADA' && p.falta > 0.009)
  const atrasadas = abertas.filter((p) => p.vencimento < hoje)
  const aVencer = abertas.filter((p) => p.vencimento >= hoje)
  const pagas = e.parcelas.filter((p) => p.acordo !== 'ENCERRADA' && p.falta <= 0.009 && p.pago > 0.009).length
  const feitos = pagamentos.filter((p) => !p.desfeita)
  const l: string[] = []
  l.push(`Olá, ${primeiroNome(e.cliente.nome)}! Segue o resumo do seu ${nomeEmprestimo(e.modalidade, e.periodicidade).toLocaleLowerCase('pt-BR')} (feito em ${dmyA(hoje)}):`)
  l.push('')
  l.push(`✅ Já pago: ${fmt(e.recebido)}${pagas ? ` (${plural(pagas, 'parcela', 'parcelas')})` : ''}`)
  if (e.falta <= 0.009) {
    l.push('🎉 Tudo quitado. Obrigado!')
  } else {
    l.push(`📌 Falta pagar: ${fmt(e.falta)}`)
    if (atrasadas.length) {
      const soma = atrasadas.reduce((x, p) => x + p.falta, 0)
      l.push(`⚠️ Em atraso: ${plural(atrasadas.length, 'parcela', 'parcelas')} · ${fmt(Math.round(soma * 100) / 100)} (a mais antiga venceu em ${dmy(atrasadas[0].vencimento)}, há ${plural(dias(atrasadas[0].vencimento, hoje), 'dia', 'dias')})`)
    }
    if (aVencer[0]) l.push(`📅 Próxima parcela: ${dmyA(aVencer[0].vencimento)} · ${fmt(aVencer[0].falta)}`)
    if (aVencer.length > 1) l.push(`🔢 Restam ${plural(abertas.length, 'parcela', 'parcelas')}, até ${dmyA(abertas[abertas.length - 1].vencimento)}`)
  }
  if (modo === 'EXTENSO') {
    if (feitos.length) {
      l.push('', '*Pagamentos recebidos*')
      const lista = [...feitos].sort((a, b) => a.data.localeCompare(b.data) || a.transacaoId - b.transacaoId)
      const corte = Math.max(0, lista.length - MAX_PAGAMENTOS)
      if (corte) l.push(`… e mais ${plural(corte, 'pagamento anterior', 'pagamentos anteriores')}`)
      for (const p of lista.slice(corte)) l.push(`• ${dmyA(p.data)} · ${fmt(p.valor)} (${NOME_FORMA[p.forma] ?? p.forma})`)
    }
    if (abertas.length) {
      l.push('', '*Parcelas em aberto*')
      const mostrar = [...atrasadas, ...aVencer.slice(0, MAX_ABERTAS)]
      for (const p of mostrar) l.push(`• ${dmyA(p.vencimento)} · ${fmt(p.falta)}${p.vencimento < hoje ? ' (atrasada)' : ''}`)
      const resto = abertas.length - mostrar.length
      if (resto > 0) l.push(`… e mais ${plural(resto, 'parcela', 'parcelas')}, até ${dmyA(abertas[abertas.length - 1].vencimento)}`)
    }
  }
  l.push('', 'Qualquer dúvida é só chamar. 🙂')
  return l.join('\n')
}
