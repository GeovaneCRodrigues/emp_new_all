import type { IndicadorComNivel, TabelaNiveis } from '../services/indicadores.service.js'

const nivelView = (n: { id: string; nome: string; minOperacoes: number; pct: number }) => ({ id: n.id, nome: n.nome, minOperacoes: n.minOperacoes, pct: n.pct })

export const indicadorView = (i: IndicadorComNivel) => ({
  id: i.id, nome: i.nome, whatsapp: i.whatsapp, chavePix: i.chavePix, pct: i.pct, pctManual: i.pctManual, ativo: i.ativo,
  operacoes: i.operacoes, temAcesso: i.temAcesso,
  nivel: nivelView(i.nivel), proximoNivel: i.proximoNivel ? nivelView(i.proximoNivel) : null, faltamParaProximo: i.faltamParaProximo,
})

export const niveisView = (t: TabelaNiveis) => ({ niveis: t.niveis.map(nivelView), auto: t.auto })
