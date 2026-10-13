import { arred2 } from '../../vendas/services/calculo.js'

export type TipoOp = 'VENDA' | 'EMPRESTIMO'

/** Uma venda ou um empréstimo, já com as contas feitas. Retomada e cancelada nem chegam aqui. */
export type OpRelatorio = {
  tipo: TipoOp
  id: number
  /** data da venda ou do empréstimo */
  data: string
  status: 'ATIVA' | 'QUITADA'
  indicadorId: number | null
  /** fração (0,5 = 50%) congelada na hora da operação */
  pct: number
  /** o que a loja colocou: custo do aparelho (com extras) ou o valor emprestado */
  investido: number
  total: number
  recebido: number
  falta: number
  lucroTotal: number
  /** quanto do capital já voltou */
  capitalDeVolta: number
  /** só juros dividido a cada pagamento: quanto do que entrou foi juro */
  jurosRecebidos: number | null
  /** só vendas */
  modelo: string | null
  diasParado: number | null
  parcelas: { vencimento: string; valor: number; desconto: number; pago: number }[]
  /** cada vez que entrou dinheiro (entrada e troca na data da venda, pagamentos, amortização) */
  entradas: { data: string; valor: number }[]
}

export type Janela = string[]
export const mesDe = (d: string) => d.slice(0, 7)
export function somaMes(ym: string, n: number): string {
  const [a, m] = ym.split('-').map(Number)
  const t = a * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
export const janela = (hoje: string, de: number, ate: number): Janela => Array.from({ length: ate - de + 1 }, (_, i) => somaMes(mesDe(hoje), de + i))

/**
 * Quanto do lucro do dono já foi realizado depois de entrar `acum`. Regra do negócio: o dinheiro que entra PRIMEIRO devolve o capital,
 * só o que passa disso é lucro, e com indicador o dono fica com (1 − %). No só juros dividido a cada pagamento, vale o juro recebido.
 */
export function lucroRealizadoAte(o: OpRelatorio, acum: number): number {
  if (o.jurosRecebidos !== null) {
    if (o.recebido <= 0) return 0
    return arred2(o.jurosRecebidos * Math.min(1, acum / o.recebido) * (1 - o.pct))
  }
  return arred2(Math.max(0, acum - o.investido) * (1 - o.pct))
}
export const lucroRealizado = (o: OpRelatorio) => lucroRealizadoAte(o, o.recebido)
/** Lucro do dono se tudo for pago (só a parte dele; negativo quando a operação dá prejuízo). */
export const seuLucro = (o: OpRelatorio) => (o.lucroTotal > 0 ? arred2(o.lucroTotal * (1 - o.pct)) : o.lucroTotal)
const porVir = (o: OpRelatorio) => (o.status === 'ATIVA' ? arred2(Math.max(0, seuLucro(o) - lucroRealizado(o))) : 0)
const naRua = (o: OpRelatorio) => (o.status === 'ATIVA' ? arred2(Math.max(0, o.investido - o.capitalDeVolta)) : 0)

/** Lucro realizado mês a mês (todos os meses, sem janela), na ordem em que o dinheiro entrou. */
export function lucroPorMesTodos(ops: OpRelatorio[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of ops) {
    let acum = 0
    for (const e of [...o.entradas].sort((a, b) => a.data.localeCompare(b.data))) {
      const antes = lucroRealizadoAte(o, acum)
      acum = arred2(acum + e.valor)
      const delta = arred2(lucroRealizadoAte(o, acum) - antes)
      if (delta > 0) m.set(mesDe(e.data), arred2((m.get(mesDe(e.data)) ?? 0) + delta))
    }
  }
  return m
}

const somar = (xs: number[]) => arred2(xs.reduce((s, x) => s + x, 0))
const serie = (meses: Janela, f: (mes: string) => number) => meses.map((m) => arred2(f(m)))

export type DadosExtras = {
  hoje: string
  /** saldo do Caixa */
  caixa: number
  /** custo dos aparelhos disponíveis no estoque */
  estoque: number
  /** aportes − retiradas */
  aportes: number
  repassesAPagar: number
  repassesFuturos: number
  indicadores: { id: number; nome: string }[]
}

export type Relatorios = ReturnType<typeof montarRelatorios>

export function montarRelatorios(ops: OpRelatorio[], x: DadosExtras) {
  const m6 = janela(x.hoje, -5, 0)
  const m7 = janela(x.hoje, -3, 3)
  const lucroMes = lucroPorMesTodos(ops)
  const colocado = (mes: string) => somar(ops.filter((o) => mesDe(o.data) === mes).map((o) => o.investido))
  const recebidoNoMes = (mes: string) => somar(ops.flatMap((o) => o.entradas.filter((e) => mesDe(e.data) === mes).map((e) => e.valor)))

  const grupo = (tipo: TipoOp) => {
    const g = ops.filter((o) => o.tipo === tipo)
    const investido = somar(g.map((o) => o.investido))
    return {
      investido, recebido: somar(g.map((o) => o.recebido)), lucroNoBolso: somar(g.map(lucroRealizado)), lucroPorVir: somar(g.map(porVir)),
      retorno: investido > 0 ? Math.round((somar(g.map((o) => Math.max(0, seuLucro(o)))) / investido) * 10000) / 10000 : 0,
    }
  }
  const iphones = grupo('VENDA'), emprestimos = grupo('EMPRESTIMO')

  const porModelo = new Map<string, { vendas: number; lucro: number; dias: number; comDias: number }>()
  for (const o of ops.filter((o) => o.tipo === 'VENDA')) {
    const g = porModelo.get(o.modelo ?? 'Sem modelo') ?? { vendas: 0, lucro: 0, dias: 0, comDias: 0 }
    g.vendas++; g.lucro += seuLucro(o)
    if (o.diasParado !== null) { g.dias += o.diasParado; g.comDias++ }
    porModelo.set(o.modelo ?? 'Sem modelo', g)
  }
  const modelos = [...porModelo.entries()]
    .map(([modelo, g]) => ({ modelo, vendas: g.vendas, lucroMedio: arred2(g.lucro / g.vendas), diasParado: g.comDias ? Math.round(g.dias / g.comDias) : null }))
    .sort((a, b) => b.vendas - a.vendas || b.lucroMedio - a.lucroMedio || a.modelo.localeCompare(b.modelo))

  const estoque = x.estoque
  const caixa = Math.max(0, x.caixa)
  const vendasNaRua = somar(ops.filter((o) => o.tipo === 'VENDA').map(naRua))
  const emprestimosNaRua = somar(ops.filter((o) => o.tipo === 'EMPRESTIMO').map(naRua))

  const linhaIndicador = (id: number | null, nome: string) => {
    const g = ops.filter((o) => o.indicadorId === id)
    const lucroTotal = somar(g.map((o) => Math.max(0, o.lucroTotal)))
    const parteDele = somar(g.map((o) => Math.max(0, o.lucroTotal) * o.pct))
    return { indicadorId: id, nome, operacoes: g.length, capitalNaRua: somar(g.map(naRua)), lucroTotal, parteDele, suaParte: arred2(lucroTotal - parteDele) }
  }
  const comOperacao = x.indicadores.map((i) => linhaIndicador(i.id, i.nome)).filter((l) => l.operacoes > 0)
  const porIndicador = [linhaIndicador(null, 'Direto'), ...comOperacao.sort((a, b) => b.lucroTotal - a.lucroTotal || a.nome.localeCompare(b.nome))]

  const parcelas = ops.flatMap((o) => o.parcelas)
  const controle = m7.map((mes) => {
    const doMes = parcelas.filter((p) => mesDe(p.vencimento) === mes)
    return {
      mes,
      previsto: somar(doMes.map((p) => p.valor)),
      recebido: somar(doMes.map((p) => p.pago)),
      emAtraso: somar(doMes.filter((p) => p.pago < p.valor - p.desconto - 0.009 && p.vencimento < x.hoje).map((p) => p.valor - p.pago - p.desconto)),
    }
  })

  const aReceberVendas = somar(ops.filter((o) => o.tipo === 'VENDA' && o.status === 'ATIVA').map((o) => o.falta))
  const aReceberEmprestimos = somar(ops.filter((o) => o.tipo === 'EMPRESTIMO' && o.status === 'ATIVA').map((o) => o.falta))
  const ativo = arred2(x.caixa + estoque + aReceberVendas + aReceberEmprestimos)
  const passivo = arred2(x.repassesAPagar + x.repassesFuturos)

  return {
    hoje: x.hoje,
    resumo: {
      meses: m6, lucroPorMes: serie(m6, (mes) => lucroMes.get(mes) ?? 0),
      lucroIphones: iphones.lucroNoBolso, lucroEmprestimos: emprestimos.lucroNoBolso, modelos,
    },
    investimentoELucro: {
      meses: m6, investido: serie(m6, colocado), recebido: serie(m6, recebidoNoMes), lucro: serie(m6, (mes) => lucroMes.get(mes) ?? 0),
      iphones, emprestimos,
    },
    capital: {
      emCaixa: caixa, noEstoque: estoque, vendasNaRua, emprestimosNaRua, total: arred2(caixa + estoque + vendasNaRua + emprestimosNaRua),
      meses: m6, colocadoPorMes: serie(m6, colocado),
    },
    porIndicador,
    controleMensal: controle,
    balancete: {
      caixa: x.caixa, estoque, aReceberVendas, aReceberEmprestimos, ativo,
      repassesAPagar: x.repassesAPagar, parteFuturaIndicadores: x.repassesFuturos, passivo,
      patrimonio: arred2(ativo - passivo), aportes: x.aportes,
    },
  }
}
