import type { UsuarioResumo } from '../models/repository.js'

export const responsaveisView = (us: UsuarioResumo[]) => us.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil }))
