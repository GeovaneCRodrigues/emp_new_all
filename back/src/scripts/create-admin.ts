import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '../config/env.js'
import { createDb } from '../db/connection.js'
import { createUsuariosRepository } from '../modules/auth/models/repository.js'
import { hashSenha } from '../modules/auth/services/password.js'

// uso: ADMIN_PASSWORD=... npm run create-admin -- email@exemplo.com "Nome"
// sem ADMIN_PASSWORD, gera uma senha aleatória e mostra uma vez só (nunca há senha fixa no código)
const [email, nome = 'Administrador'] = process.argv.slice(2)
if (!email) { console.error('Informe o e-mail: npm run create-admin -- email@exemplo.com "Nome"'); process.exit(1) }

const env = parseEnv()
const db = createDb(env)
try {
  const repo = createUsuariosRepository(db.knex)
  if (await repo.buscarPorEmail(email)) { console.error('Já existe um usuário com esse e-mail.'); process.exit(1) }
  const senha = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url')
  await repo.criar({ nome, email, senhaHash: await hashSenha(senha), perfil: 'ADMIN', indicadorId: null, ativo: true })
  console.log(`Administrador criado: ${email}`)
  if (!process.env.ADMIN_PASSWORD) console.log(`Senha gerada (anote, não será mostrada de novo): ${senha}`)
} finally {
  await db.close()
}
