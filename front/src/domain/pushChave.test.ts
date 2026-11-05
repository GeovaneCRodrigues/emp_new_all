import { describe, expect, it } from 'vitest'
import { chaveParaNavegador } from './pushChave'

describe('chaveParaNavegador', () => {
  it('converte base64url (com - e _, sem preenchimento) em bytes', () => {
    // "??>" em bytes = 0x3f 0x3f 0x3e → base64 "Pz8+" → base64url "Pz8-"
    expect([...chaveParaNavegador('Pz8-')]).toEqual([0x3f, 0x3f, 0x3e])
    // 0xfb 0xff → base64 "+/8=" → base64url "-_8" (sem o '=')
    expect([...chaveParaNavegador('-_8')]).toEqual([0xfb, 0xff])
  })
  it('chave VAPID de 65 bytes (87 caracteres) vira 65 bytes começando por 0x04', () => {
    const bytes = new Uint8Array(65); bytes[0] = 4
    const b64u = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(b64u).toHaveLength(87)
    const r = chaveParaNavegador(b64u)
    expect(r).toHaveLength(65)
    expect(r[0]).toBe(4)
  })
})
