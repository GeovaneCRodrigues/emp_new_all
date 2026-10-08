import { ErroAuth, type AuthApi, type Credenciais, type UsuarioAuth } from './auth'

/**
 * Login de demonstração, só para o front rodar sem backend. A senha é a mesma para todos e
 * aparece na própria tela de login (modo demonstração). Nada disso vai para produção:
 * com `VITE_API_URL` definida o app usa o backend de verdade.
 */
export const SENHA_DEMO = 'demo1234'

export const CONTAS_DEMO: UsuarioAuth[] = [
  { id: 1, nome: 'Geovane Cataneo', email: 'admin@demo.com', perfil: 'ADMIN', indicadorId: null },
  { id: 2, nome: 'Bruna Teixeira', email: 'vendedor@demo.com', perfil: 'VENDEDOR', indicadorId: null },
  { id: 3, nome: 'Diego Ramos', email: 'cobrador@demo.com', perfil: 'COBRADOR', indicadorId: null },
  { id: 4, nome: 'Roberto Indicações', email: 'indicador@demo.com', perfil: 'INDICADOR', indicadorId: 1 },
]

export function criarAuthFake(): AuthApi {
  // sem estado no servidor: o token carrega a conta, assim a sessão sobrevive a recarregar a página
  const emitir = (u: UsuarioAuth): Credenciais => ({ accessToken: `demo-acc-${u.id}`, refreshToken: `demo-ref-${u.id}`, usuario: u })
  const conta = (token: string) => CONTAS_DEMO.find((c) => token === `demo-acc-${c.id}` || token === `demo-ref-${c.id}`)
  return {
    async login(email, senha) {
      const u = CONTAS_DEMO.find((c) => c.email === email.trim().toLowerCase())
      if (!u || senha !== SENHA_DEMO) throw new ErroAuth(401, 'E-mail ou senha incorretos')
      return emitir(u)
    },
    async renovar(refreshToken) {
      const u = conta(refreshToken)
      if (!u) throw new ErroAuth(401, 'Sessão inválida ou expirada')
      return emitir(u)
    },
    async logout() { /* nada a revogar no modo demonstração */ },
    async trocarSenha(_t, atual, nova) {
      if (atual !== SENHA_DEMO) throw new ErroAuth(401, 'Senha atual incorreta')
      if (nova.length < 10) throw new ErroAuth(400, 'A nova senha precisa ter ao menos 10 caracteres')
    },
    async eu(accessToken) {
      const u = conta(accessToken)
      if (!u) throw new ErroAuth(401, 'Sessão inválida ou expirada')
      return u
    },
  }
}
