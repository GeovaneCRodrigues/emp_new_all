import argon2 from 'argon2'

export const hashSenha = (senha: string) => argon2.hash(senha, { type: argon2.argon2id })

export async function conferirSenha(hash: string, senha: string): Promise<boolean> {
  try { return await argon2.verify(hash, senha) } catch { return false }
}

// hash de uma senha qualquer, usado para gastar o mesmo tempo quando o e-mail não existe (não deixa descobrir quem tem conta)
let falso: Promise<string> | null = null
export const hashFalso = () => (falso ??= hashSenha('senha-que-ninguem-tem'))
