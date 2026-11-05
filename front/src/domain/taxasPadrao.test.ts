import { describe, expect, it } from 'vitest'
import { TAXAS_PADRAO_PF } from './taxasPadrao'

describe('taxas padrão de mercado (pessoa física)', () => {
  it('todas positivas', () => {
    for (const v of Object.values(TAXAS_PADRAO_PF)) expect(v).toBeGreaterThan(0)
  })
})
