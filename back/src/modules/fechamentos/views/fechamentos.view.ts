import type { CaixaDoDia, Fechamento } from '../models/types.js'
import type { ListaFechamentos } from '../services/fechamentos.service.js'

export const fechamentoView = (f: Fechamento) => f
export const caixaView = (c: CaixaDoDia) => c
export const listaView = (l: ListaFechamentos) => ({ itens: l.itens.map(fechamentoView), total: l.total, pendentes: l.pendentes, pagina: l.pagina, limite: l.limite })
