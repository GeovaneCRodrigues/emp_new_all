import { randomUUID } from 'node:crypto'
import type { SessoesRepository, UsuariosRepository } from '../../src/modules/auth/models/repository.js'
import type { SessaoRegistro, Usuario } from '../../src/modules/auth/models/types.js'

/** Repositórios em memória: o mesmo contrato do Postgres, sem precisar de banco nos testes de regra. */
export function usuariosEmMemoria(): UsuariosRepository & { todos: Usuario[] } {
  const todos: Usuario[] = []
  return {
    todos,
    async buscarPorEmail(e) { return todos.find((u) => u.email.toLowerCase() === e.toLowerCase()) ?? null },
    async buscarPorId(id) { return todos.find((u) => u.id === id) ?? null },
    async criar(d) {
      const u: Usuario = { ...d, email: d.email.toLowerCase(), id: todos.length + 1, falhasLogin: 0, bloqueadoAte: null, senhaTemporaria: d.senhaTemporaria ?? false }
      todos.push(u)
      return u
    },
    async registrarFalha(id, limite, ate) {
      const u = todos.find((x) => x.id === id)!
      u.falhasLogin += 1
      if (u.falhasLogin >= limite) u.bloqueadoAte = ate
    },
    async zerarFalhas(id) { const u = todos.find((x) => x.id === id)!; u.falhasLogin = 0; u.bloqueadoAte = null },
    async atualizarSenha(id, h) { const u = todos.find((x) => x.id === id)!; u.senhaHash = h; u.senhaTemporaria = false },
  }
}

export function sessoesEmMemoria(): SessoesRepository & { todas: SessaoRegistro[] } {
  const todas: SessaoRegistro[] = []
  return {
    todas,
    async criar(d) {
      const s: SessaoRegistro = { id: randomUUID(), usuarioId: d.usuarioId, refreshHash: d.refreshHash, refreshHashAnterior: null, expiraEm: d.expiraEm, revogadaEm: null, ip: d.ip, userAgent: d.userAgent, criadaEm: new Date(), ultimoUsoEm: new Date() }
      todas.push(s)
      return s
    },
    async buscar(id) { return todas.find((s) => s.id === id) ?? null },
    async rotacionar(id, novo, anterior, expiraEm) {
      const s = todas.find((x) => x.id === id)!
      Object.assign(s, { refreshHash: novo, refreshHashAnterior: anterior, expiraEm, ultimoUsoEm: new Date() })
    },
    async revogar(id) { const s = todas.find((x) => x.id === id); if (s && !s.revogadaEm) s.revogadaEm = new Date() },
    async revogarTodas(usuarioId, exceto) {
      for (const s of todas) if (s.usuarioId === usuarioId && s.id !== exceto && !s.revogadaEm) s.revogadaEm = new Date()
    },
    async listarAtivas(usuarioId) { return todas.filter((s) => s.usuarioId === usuarioId && !s.revogadaEm && s.expiraEm > new Date()) },
  }
}
