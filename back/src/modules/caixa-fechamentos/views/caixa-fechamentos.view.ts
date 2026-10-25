import type { PreviaFechamento, FechamentoLoja } from '../models/types.js'
import type { ListaFechamentosLoja } from '../services/caixa-fechamentos.service.js'

export const listaView = (l: ListaFechamentosLoja) => l
export const previaView = (p: PreviaFechamento) => p
export const fechamentoView = (f: FechamentoLoja) => f
