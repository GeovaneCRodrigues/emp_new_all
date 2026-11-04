import { describe, expect, it } from 'vitest'
import type { AparelhoApi } from '@/api/estoque'
import type { ClienteApi } from '@/api/clientes'
import { pendenciasDoContrato } from './dadosContrato'

const cliente = (o: Partial<ClienteApi> = {}): ClienteApi => ({ id: 1, nome: 'ANA', fone: '11988124410', desde: '2026-01-01', cpf: '52998224725', rg: '123', endereco: 'RUA A', cidade: 'SANTOS', email: 'a@b.com', ...o })
const aparelho = (o: Partial<AparelhoApi> = {}): AparelhoApi => ({ id: 1, modelo: 'iPhone 13', gb: 128, cor: 'Preto', bateria: 90, condicao: 'Seminovo', imei: '352918114471203', serie: 'F2L12345', preco: 3000, estado: 'DISPONIVEL', origem: 'COMPRA', dataCompra: '2026-01-01', paraCliente: null, ...o })

describe('pendências do contrato', () => {
  it('tudo cadastrado: nada falta', () => { expect(pendenciasDoContrato(cliente(), aparelho())).toEqual({ obrigatorias: [], recomendadas: [] }) })
  it('sem CPF, endereço, IMEI e cor: as quatro travam o link', () => {
    const p = pendenciasDoContrato(cliente({ cpf: null, endereco: null }), aparelho({ imei: null, cor: 'A DEFINIR' }))
    expect(p.obrigatorias.map((x) => x.chave)).toEqual(['cpf', 'endereco', 'imei', 'cor'])
  })
  it('RG, cidade, série e e-mail só recomendam', () => {
    const p = pendenciasDoContrato(cliente({ rg: null, cidade: null, email: null }), aparelho({ serie: null }))
    expect(p.obrigatorias).toEqual([]); expect(p.recomendadas.map((x) => x.chave)).toEqual(['rg', 'email', 'cidade', 'serie'])
  })
  it('quem não enxerga o e-mail (vendedor) não é cobrado por ele', () => {
    const { email: _e, ...semEmail } = cliente()
    expect(pendenciasDoContrato(semEmail, aparelho()).recomendadas).toEqual([])
  })
})
