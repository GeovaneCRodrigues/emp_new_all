import { describe, expect, it } from 'vitest'
import { TAXAS_PADRAO_PF } from './taxasPadrao'

describe('taxas padrão de mercado (pessoa física)', () => {
  it('todas positivas e a multa de cancelamento não passa de 10%', () => {
    for (const v of Object.values(TAXAS_PADRAO_PF)) expect(v).toBeGreaterThan(0)
    expect(TAXAS_PADRAO_PF.cancelamentoPct).toBeLessThanOrEqual(10)
  })
})
