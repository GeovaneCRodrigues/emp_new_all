import type { Nivel } from '../models/types.js'

/** Em que nível o indicador está, e qual é o próximo. `niveis` precisa vir em ordem crescente de `minOperacoes`. */
export function nivelDe(operacoes: number, niveis: Nivel[]) {
  const i = niveis.reduce((a, n, k) => (operacoes >= n.minOperacoes ? k : a), 0)
  return { atual: niveis[i], proximo: niveis[i + 1] ?? null }
}

/** Confere a tabela de níveis: começa em 0, cresce, e quem está acima nunca ganha menos. Devolve a mensagem do erro, ou null. */
export function validarNiveis(niveis: Nivel[]): string | null {
  if (niveis.length === 0) return 'Informe os níveis'
  if (niveis[0].minOperacoes !== 0) return 'O primeiro nível precisa começar em 0 operações'
  for (const [i, n] of niveis.entries()) {
    if (!Number.isInteger(n.minOperacoes) || n.minOperacoes < 0) return `${n.nome}: o mínimo de operações precisa ser um número inteiro`
    if (!(n.pct > 0 && n.pct <= 1)) return `${n.nome}: o % precisa ficar entre 0 e 100`
    if (i > 0 && n.minOperacoes <= niveis[i - 1].minOperacoes) return `${n.nome}: precisa começar depois do nível anterior`
    if (i > 0 && n.pct < niveis[i - 1].pct) return `${n.nome}: não pode ganhar menos que o nível anterior`
  }
  return null
}
