import type { ListaAprovacoes } from '../services/aprovacoes.service.js'
import type { Aprovacao } from '../models/types.js'

export const aprovacaoView = (a: Aprovacao) => a
export const listaView = (l: ListaAprovacoes) => ({ itens: l.itens.map(aprovacaoView), total: l.total, pendentes: l.pendentes, pagina: l.pagina, limite: l.limite })
