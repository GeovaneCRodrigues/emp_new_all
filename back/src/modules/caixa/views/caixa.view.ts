import type { LancamentoManual } from '../models/types.js'
import type { ResultadoCaixa } from '../services/caixa.service.js'

export const caixaView = (r: ResultadoCaixa) => r
export const lancamentoView = (l: LancamentoManual) => l
