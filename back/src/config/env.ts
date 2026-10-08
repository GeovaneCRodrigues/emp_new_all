export type Env = {
  NODE_ENV: 'development' | 'test' | 'production'
  PORT: number
  DATABASE_URL: string
  DB_POOL_MAX: number
  JWT_SECRET: string
  JWT_EXPIRES_IN: string
  REFRESH_TTL_DIAS: number
  CORS_ORIGIN: string[]
}

/** Lê e valida o ambiente. Falha cedo, com mensagem clara, em vez de subir meio configurado. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const erros: string[] = []
  const texto = (k: string) => source[k]?.trim() ?? ''

  const nodeEnv = texto('NODE_ENV') || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) erros.push('NODE_ENV deve ser development, test ou production')

  const inteiro = (k: string, padrao: number) => {
    const v = texto(k)
    if (!v) return padrao
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) { erros.push(`${k} deve ser um inteiro positivo`); return padrao }
    return n
  }

  const DATABASE_URL = texto('DATABASE_URL')
  if (!DATABASE_URL) erros.push('DATABASE_URL é obrigatória')

  const JWT_SECRET = texto('JWT_SECRET')
  if (JWT_SECRET.length < 32) erros.push('JWT_SECRET é obrigatório e precisa ter ao menos 32 caracteres (openssl rand -hex 32)')

  const PORT = inteiro('PORT', 3000)
  const DB_POOL_MAX = inteiro('DB_POOL_MAX', 10)
  const REFRESH_TTL_DIAS = inteiro('REFRESH_TTL_DIAS', 7)

  if (erros.length) throw new Error('Ambiente inválido:\n- ' + erros.join('\n- '))

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    PORT,
    DATABASE_URL,
    DB_POOL_MAX,
    JWT_SECRET,
    JWT_EXPIRES_IN: texto('JWT_EXPIRES_IN') || '15m',
    REFRESH_TTL_DIAS,
    CORS_ORIGIN: texto('CORS_ORIGIN').split(',').map((s) => s.trim()).filter(Boolean),
  }
}
