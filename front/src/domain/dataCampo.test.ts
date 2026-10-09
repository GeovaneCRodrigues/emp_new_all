import { describe, expect, it } from 'vitest'
import { brParaIso, foraDoLimite, gradeDoMes, isoParaBr, mascaraData, mudarMes } from './dataCampo'

describe('máscara do campo de data', () => {
  it('só números viram dd/mm/aaaa no caminho (exemplo do plano: 08112026 → 08/11/2026)', () => {
    expect(mascaraData('0')).toBe('0')
    expect(mascaraData('08')).toBe('08')
    expect(mascaraData('081')).toBe('08/1')
    expect(mascaraData('0811')).toBe('08/11')
    expect(mascaraData('08112')).toBe('08/11/2')
    expect(mascaraData('08112026')).toBe('08/11/2026')
  })
  it('ignora letras e símbolos, e corta no 8º dígito', () => {
    expect(mascaraData('08a/11-2026')).toBe('08/11/2026')
    expect(mascaraData('081120269999')).toBe('08/11/2026')
    expect(mascaraData('abc')).toBe('')
  })
  it('colar já formatado funciona', () => { expect(mascaraData('08/11/2026')).toBe('08/11/2026') })
})

describe('conversão entre texto e ISO', () => {
  it('ida e volta', () => { expect(brParaIso('08/11/2026')).toBe('2026-11-08'); expect(isoParaBr('2026-11-08')).toBe('08/11/2026') })
  it('incompleta ou inexistente não vira data', () => {
    for (const t of ['', '08/11', '08/11/202', '31/02/2026', '00/10/2026', '10/13/2026', '29/02/2027']) expect(brParaIso(t), t).toBeNull()
  })
  it('29/02 de ano bissexto existe', () => { expect(brParaIso('29/02/2028')).toBe('2028-02-29') })
  it('ISO vazio ou torto vira texto vazio', () => { expect(isoParaBr('')).toBe(''); expect(isoParaBr('amanhã')).toBe('') })
})

describe('grade do calendário', () => {
  it('outubro de 2026 começa numa quinta e tem 31 dias, em linhas de 7', () => {
    const g = gradeDoMes(2026, 10)
    expect(g.length % 7).toBe(0)
    expect(g.findIndex((c) => c?.dia === 1)).toBe(4) // dom=0 … qui=4
    expect(g.filter(Boolean)).toHaveLength(31)
    expect(g.filter(Boolean)[30]).toEqual({ iso: '2026-10-31', dia: 31 })
  })
  it('fevereiro de 2028 (bissexto) tem 29 dias e fevereiro de 2027 tem 28', () => {
    expect(gradeDoMes(2028, 2).filter(Boolean)).toHaveLength(29)
    expect(gradeDoMes(2027, 2).filter(Boolean)).toHaveLength(28)
  })
  it('um mês que começa no domingo não tem células vazias no começo', () => {
    expect(gradeDoMes(2026, 11)[0]).toEqual({ iso: '2026-11-01', dia: 1 }) // 01/11/2026 é domingo
  })
})

describe('limites e navegação', () => {
  it('apaga o que está antes do mínimo e depois do máximo', () => {
    expect(foraDoLimite('2026-10-07', '2026-10-08', '2026-10-31')).toBe(true)
    expect(foraDoLimite('2026-10-08', '2026-10-08', '2026-10-31')).toBe(false)
    expect(foraDoLimite('2026-10-31', '2026-10-08', '2026-10-31')).toBe(false)
    expect(foraDoLimite('2026-11-01', '2026-10-08', '2026-10-31')).toBe(true)
    expect(foraDoLimite('2030-01-01')).toBe(false)
  })
  it('mês anterior e seguinte viram o ano', () => {
    expect(mudarMes(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 })
    expect(mudarMes(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 })
    expect(mudarMes(2026, 6, 0)).toEqual({ ano: 2026, mes: 6 })
  })
})
