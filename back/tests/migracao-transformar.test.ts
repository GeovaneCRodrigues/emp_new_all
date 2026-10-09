import { describe, expect, it } from 'vitest'
import { converterCliente, converterIndicador, montarEndereco, percentualDoIndicador } from '../src/migracao/transformar.js'
import type { ClienteAntigo, IndicadorAntigo } from '../src/migracao/tipos.js'

const cliente = (o: Partial<ClienteAntigo> = {}): ClienteAntigo => ({
  id: 1, nome: 'Maria da Silva', cpf_cnpj: '529.982.247-25', rg: null, telefone1: '(11) 98812-4410', telefone2: null, email: null, endereco: null, numero: null, complemento: null,
  bairro: null, cidade: null, uf: 'SP', cep: null, indicador_id: null, status: 'ATIVO', obs: null, created_at: '2026-05-05T10:00:00Z', ...o,
})
const indicador = (o: Partial<IndicadorAntigo> = {}): IndicadorAntigo => ({ id: 1, nome: 'Roberto', telefone: '11988124410', email: 'r@x.com', status: 'ATIVO', percentuais: [{ pct: 0.5, qtd: 10 }], ...o })

describe('o % do indicador', () => {
  it('o % mais usado nas operações dele (o exemplo de produção: 0% e 50% → 50%)', () => {
    expect(percentualDoIndicador([{ pct: 0, qtd: 3 }, { pct: 0.5, qtd: 30 }])).toBe(0.5)
  })
  it('o de 30% sozinho vale 30%', () => { expect(percentualDoIndicador([{ pct: 0.3, qtd: 1 }])).toBe(0.3) })
  it('empate de quantidade: o maior %', () => { expect(percentualDoIndicador([{ pct: 0.3, qtd: 2 }, { pct: 0.4, qtd: 2 }])).toBe(0.4) })
  it('o mais frequente ganha mesmo sendo o menor', () => { expect(percentualDoIndicador([{ pct: 0.3, qtd: 9 }, { pct: 0.5, qtd: 2 }])).toBe(0.3) })
  it('só zero, vazio ou valor absurdo: sem % (null)', () => {
    expect(percentualDoIndicador([])).toBeNull()
    expect(percentualDoIndicador([{ pct: 0, qtd: 5 }])).toBeNull()
    expect(percentualDoIndicador([{ pct: 50, qtd: 5 }, { pct: -1, qtd: 1 }])).toBeNull()
  })
  it('chega do MySQL como texto ("0.5000"): converte', () => { expect(percentualDoIndicador([{ pct: '0.5000' as never, qtd: '4' as never }])).toBe(0.5) })
})

describe('converter indicador', () => {
  it('traz nome, whatsapp só com dígitos, % fixo à mão e ativo', () => {
    const r = converterIndicador(indicador({ telefone: '(11) 98812-4410' }))
    expect(r.novo).toEqual({ legacyId: 1, nome: 'Roberto', whatsapp: '11988124410', pct: 0.5, pctManual: true, ativo: true })
    expect(r.avisos).toEqual([])
  })
  it('inativo vira ativo=false e avisa; sem % usa 50% e avisa', () => {
    const r = converterIndicador(indicador({ status: 'INATIVO', percentuais: [] }))
    expect(r.novo).toMatchObject({ ativo: false, pct: 0.5, pctManual: true })
    expect(r.avisos.sort()).toEqual(['indicador_inativo', 'sem_percentual'])
  })
  it('telefone vazio não é problema; telefone torto vira null e avisa', () => {
    expect(converterIndicador(indicador({ telefone: null })).novo?.whatsapp).toBeNull()
    expect(converterIndicador(indicador({ telefone: null })).avisos).toEqual([])
    const r = converterIndicador(indicador({ telefone: '1234' }))
    expect(r.novo?.whatsapp).toBeNull(); expect(r.avisos).toContain('whatsapp_invalido')
  })
  it('espaços sobrando no nome somem; nome vazio não importa (erro)', () => {
    expect(converterIndicador(indicador({ nome: '  Loja   Ponto  Cell ' })).novo?.nome).toBe('Loja Ponto Cell')
    expect(converterIndicador(indicador({ nome: '   ' }))).toMatchObject({ novo: null, erro: 'indicador sem nome' })
  })
})

describe('converter cliente: documento', () => {
  it('CPF com máscara vira só dígitos', () => { expect(converterCliente(cliente()).novo?.cpf).toBe('52998224725') })
  it('CNPJ de 14 dígitos entra como está', () => {
    const r = converterCliente(cliente({ cpf_cnpj: '11.222.333/0001-81' }))
    expect(r.novo?.cpf).toBe('11222333000181'); expect(r.avisos).not.toContain('documento_tamanho_estranho')
  })
  it('sem documento: null e avisa', () => {
    for (const v of [null, '', '   ']) { const r = converterCliente(cliente({ cpf_cnpj: v })); expect(r.novo?.cpf).toBeNull(); expect(r.avisos).toContain('sem_documento') }
  })
  it('tamanho estranho (nem 11 nem 14): não adivinha, null e avisa', () => {
    const r = converterCliente(cliente({ cpf_cnpj: '12345' }))
    expect(r.novo?.cpf).toBeNull(); expect(r.avisos).toContain('documento_tamanho_estranho')
  })
  it('CPF com dígito verificador errado entra mesmo assim (é o dado que a loja tem) e avisa', () => {
    const r = converterCliente(cliente({ cpf_cnpj: '111.111.111-11' }))
    expect(r.novo?.cpf).toBe('11111111111'); expect(r.avisos).toContain('cpf_digito_invalido')
  })
})

describe('converter cliente: telefone', () => {
  it('o 1º telefone, só dígitos', () => { expect(converterCliente(cliente({ telefone1: '(11) 98812-4410' })).novo?.fone).toBe('11988124410') })
  it('com +55 na frente também', () => { expect(converterCliente(cliente({ telefone1: '+55 (11) 98812-4410' })).novo?.fone).toBe('11988124410') })
  it('fixo de 10 dígitos vale', () => { expect(converterCliente(cliente({ telefone1: '1133334444' })).novo?.fone).toBe('1133334444') })
  it('sem telefone: vazio ("sem telefone") e avisa', () => {
    for (const v of [null, '', '  ']) { const r = converterCliente(cliente({ telefone1: v })); expect(r.novo?.fone).toBe(''); expect(r.avisos).toContain('sem_telefone') }
  })
  it('1º telefone torto e 2º bom: usa o 2º e avisa', () => {
    const r = converterCliente(cliente({ telefone1: '1234', telefone2: '11988124410' }))
    expect(r.novo?.fone).toBe('11988124410'); expect(r.avisos).toContain('telefone_do_segundo_campo')
  })
  it('os dois tortos: vazio e avisa que era inválido (não "sem telefone")', () => {
    const r = converterCliente(cliente({ telefone1: '1234', telefone2: 'abc' }))
    expect(r.novo?.fone).toBe(''); expect(r.avisos).toContain('telefone_invalido'); expect(r.avisos).not.toContain('sem_telefone')
  })
})

describe('converter cliente: endereço, e-mail, observação, indicador e datas', () => {
  it('monta o endereço com o que existe; a UF "SP" padrão sem cidade não aparece', () => {
    expect(montarEndereco({ endereco: 'Rua A', numero: '10', complemento: 'apto 2', bairro: 'Centro', cidade: 'Campinas', uf: 'sp', cep: '13000000' })).toBe('Rua A, 10 - apto 2, Centro, Campinas/SP, CEP 13000-000')
    expect(montarEndereco({ endereco: null, numero: null, complemento: null, bairro: null, cidade: null, uf: 'SP', cep: null })).toBe('')
    expect(montarEndereco({ endereco: 'Rua B', numero: null, complemento: null, bairro: null, cidade: null, uf: 'SP', cep: null })).toBe('Rua B')
    expect(montarEndereco({ endereco: null, numero: '5', complemento: 'fundos', bairro: null, cidade: 'Jundiaí', uf: null, cep: '123' })).toBe('5 - fundos, Jundiaí')
  })
  it('CEP só aparece com 8 dígitos (5 ou 7 dígitos são lixo e ficam de fora)', () => {
    const base = { endereco: 'Rua A', numero: null, complemento: null, bairro: null, cidade: null, uf: null }
    expect(montarEndereco({ ...base, cep: '12345' })).toBe('Rua A')
    expect(montarEndereco({ ...base, cep: '1234567' })).toBe('Rua A')
    expect(montarEndereco({ ...base, cep: '13000-000' })).toBe('Rua A, CEP 13000-000')
  })
  it('endereço vazio vira null', () => { expect(converterCliente(cliente()).novo?.endereco).toBeNull() })
  it('e-mail em minúsculas; inválido vira null e avisa', () => {
    expect(converterCliente(cliente({ email: ' Maria@Exemplo.COM ' })).novo?.email).toBe('maria@exemplo.com')
    const r = converterCliente(cliente({ email: 'sem-arroba' }))
    expect(r.novo?.email).toBeNull(); expect(r.avisos).toContain('email_invalido')
  })
  it('observação mantém as quebras de linha; vazia vira null; enorme é cortada e avisa', () => {
    expect(converterCliente(cliente({ obs: 'linha 1\nlinha 2' })).novo?.observacoes).toBe('linha 1\nlinha 2')
    expect(converterCliente(cliente({ obs: '   ' })).novo?.observacoes).toBeNull()
    const r = converterCliente(cliente({ obs: 'x'.repeat(2500) }))
    expect(r.novo?.observacoes).toHaveLength(2000); expect(r.avisos).toContain('observacao_cortada')
  })
  it('RG longo é cortado em 20 e avisa', () => {
    const r = converterCliente(cliente({ rg: '1'.repeat(30) }))
    expect(r.novo?.rg).toHaveLength(20); expect(r.avisos).toContain('rg_cortado')
  })
  it('nome limpo (espaços) e nome vazio é erro', () => {
    expect(converterCliente(cliente({ nome: '  Maria   da  Silva ' })).novo?.nome).toBe('Maria da Silva')
    expect(converterCliente(cliente({ nome: '' }))).toMatchObject({ novo: null, erro: 'cliente sem nome' })
  })
  it('guarda o indicador (id antigo) e a data de cadastro original', () => {
    const r = converterCliente(cliente({ indicador_id: 3, created_at: '2026-05-05T10:00:00Z' }))
    expect(r.novo?.indicadorLegacyId).toBe(3)
    expect(r.novo?.desde?.toISOString()).toBe('2026-05-05T10:00:00.000Z')
    expect(converterCliente(cliente({ indicador_id: null })).novo?.indicadorLegacyId).toBeNull()
  })
  it('data ruim ou ausente vira null (o banco usa a data de hoje)', () => {
    expect(converterCliente(cliente({ created_at: null })).novo?.desde).toBeNull()
    expect(converterCliente(cliente({ created_at: 'não é data' })).novo?.desde).toBeNull()
  })
  it('cliente inativo entra e avisa', () => {
    const r = converterCliente(cliente({ status: 'INATIVO' }))
    expect(r.novo).not.toBeNull(); expect(r.avisos).toContain('cliente_inativo')
  })
  it('cliente completo e limpo não gera aviso nenhum', () => { expect(converterCliente(cliente()).avisos).toEqual([]) })
})
