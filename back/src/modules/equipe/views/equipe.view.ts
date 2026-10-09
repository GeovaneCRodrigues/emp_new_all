import type { Pessoa } from '../models/types.js'

export const pessoaView = (p: Pessoa) => p
export const listaView = (ps: Pessoa[]) => ps.map(pessoaView)
