import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DadosVenda, Empresa } from '../src/modules/contratos/models/types.js'
import { brl, camposDesconhecidos, MODELO_PADRAO, preencher, VARIAVEIS } from '../src/modules/contratos/services/modelo.js'

const dados = (o: Partial<DadosVenda> = {}): DadosVenda => ({
  vendaId: 92, vendaStatus: 'ATIVA', numero: '2026-0092', dataVenda: '2026-10-05',
  cliente: { nome: 'ANA SOUZA', cpf: '52998224725', fone: '11988124410', endereco: 'RUA A, 10' },
  aparelho: { modelo: 'IPHONE 15', gb: 128, cor: 'PRETO', condicao: 'Seminovo', imei: '356938035643809' },
  entrada: 1000, troca: 0, parcelas: [{ valor: 500, vencimento: '2026-11-10' }, { valor: 500, vencimento: '2026-12-10' }], seguro: false, ...o,
})
const empresa = (o: Partial<Empresa> = {}): Empresa => ({
  nome: 'Mundo dos iPhones LTDA', cnpj: '11.222.333/0001-81', endereco: 'Rua X, 1', email: 'a@b.com', atendente: 'Geovane',
  avaria: 350, reposicao: 1500, seguro: 39.9, cancelamentoPct: 20, recuperacao: 250, ...o,
})
const campo = (chave: string, d = dados(), e = empresa()) => preencher(`{{${chave}}}`, d, e)

describe('modelo do contrato: preencher', () => {
  it('o modelo padrão só usa campos que existem', () => { expect(camposDesconhecidos(MODELO_PADRAO)).toEqual([]) })
  it('o modelo padrão preenche tudo quando o cadastro está completo', () => {
    const p = preencher(MODELO_PADRAO, dados(), empresa())
    expect(p.faltam).toEqual([])
    expect(p.texto).toContain('CONTRATO Nº 2026-0092')
    expect(p.texto).toContain('CPF: 529.982.247-25')
    expect(p.texto).toContain('VALOR TOTAL DO CONTRATO: R$ 2.000,00')
    expect(p.texto).not.toContain('{{')
  })
  it('formata dinheiro e datas do jeito brasileiro', () => {
    expect(brl(1234.5)).toBe('R$ 1.234,50')
    expect(campo('data_venda').texto).toBe('05/10/2026'); expect(campo('data_fim').texto).toBe('10/12/2026'); expect(campo('primeiro_vencimento').texto).toBe('10/11/2026')
    expect(campo('parcelas_qtd').texto).toBe('2'); expect(campo('parcela_valor').texto).toBe('R$ 500,00')
  })
  it('entrada: só dinheiro, só troca, os dois e nenhuma', () => {
    expect(campo('entrada_composicao', dados({ entrada: 1000, troca: 0 })).texto).toBe('R$ 1.000,00 em dinheiro')
    expect(campo('entrada_composicao', dados({ entrada: 0, troca: 800 })).texto).toBe('aparelho na troca, avaliado em R$ 800,00')
    expect(campo('entrada_composicao', dados({ entrada: 500, troca: 800 })).texto).toBe('R$ 500,00 em dinheiro e um aparelho na troca, avaliado em R$ 800,00')
    expect(campo('entrada_composicao', dados({ entrada: 0, troca: 0 })).texto).toBe('sem entrada')
    expect(campo('entrada_valor', dados({ entrada: 500, troca: 800 })).texto).toBe('R$ 1.300,00')
  })
  it('venda sem parcelas (à vista): não quebra nem marca falta', () => {
    const p = preencher('{{parcelas_qtd}} {{parcela_valor}} {{primeiro_vencimento}} {{data_fim}}', dados({ parcelas: [], entrada: 2000 }), empresa())
    expect(p.faltam).toEqual([]); expect(p.texto).toBe('0 não há parcelas não há parcelas 05/10/2026')
  })
  it('CPF, endereço, IMEI e capacidade sem cadastro viram "falta" e saem em branco no texto', () => {
    const d = dados({ cliente: { nome: 'ANA', cpf: null, fone: '11988124410', endereco: '' }, aparelho: { modelo: 'IPHONE 12', gb: 0, cor: 'A DEFINIR', condicao: 'Seminovo', imei: null } })
    const p = preencher('{{cliente_cpf}}|{{cliente_endereco}}|{{aparelho_imei}}|{{aparelho_capacidade}}|{{aparelho_cor}}', d, empresa())
    expect(p.faltam).toEqual(['CPF', 'Endereço', 'IMEI', 'Capacidade', 'Cor'])
    expect(p.texto).toBe('||||')
    expect(p.trechos.filter((t) => t.tipo === 'falta').map((t) => t.v)).toContain('CPF não cadastrado')
  })
  it('taxas e dados da empresa sem cadastro também faltam', () => {
    const p = preencher(MODELO_PADRAO, dados(), empresa({ cnpj: null, avaria: null, cancelamentoPct: null, atendente: null }))
    expect(p.faltam).toEqual(expect.arrayContaining(['Atendente', 'CNPJ', 'Taxa de avaria', 'Multa de cancelamento']))
  })
  it('seguro: não contratado não precisa de taxa; contratado usa o valor, e sem valor falta', () => {
    expect(campo('seguro_texto', dados({ seguro: false }), empresa({ seguro: null })).texto).toBe('não contratado pelo cliente')
    expect(campo('seguro_texto', dados({ seguro: true })).texto).toBe('contratado, R$ 39,90 por mês junto da parcela')
    expect(campo('seguro_texto', dados({ seguro: true }), empresa({ seguro: null })).faltam).toEqual(['Seguro'])
  })
  it('multa de cancelamento sai com vírgula', () => { expect(campo('taxa_cancelamento', dados(), empresa({ cancelamentoPct: 12.5 })).texto).toBe('12,5%') })
  it('campo que não existe fica marcado e não some do texto', () => {
    const p = preencher('Oi {{nao_existe}}!', dados(), empresa())
    expect(p.trechos).toEqual([{ tipo: 'txt', v: 'Oi ' }, { tipo: 'desconhecido', v: '{{nao_existe}}' }, { tipo: 'txt', v: '!' }])
    expect(camposDesconhecidos('{{a}} {{cliente_nome}} {{a}} {{b}}')).toEqual(['a', 'b'])
  })
  it('aceita espaços dentro das chaves e texto sem nenhum campo', () => {
    expect(preencher('{{ cliente_nome }}', dados(), empresa()).texto).toBe('ANA SOUZA')
    expect(preencher('só texto', dados(), empresa())).toEqual({ trechos: [{ tipo: 'txt', v: 'só texto' }], faltam: [], texto: 'só texto' })
  })
  it('a lista de campos oferecida na tela tem grupo, rótulo e chave sem repetir', () => {
    expect(new Set(VARIAVEIS.map((v) => v.chave)).size).toBe(VARIAVEIS.length)
    expect(new Set(VARIAVEIS.map((v) => v.grupo))).toEqual(new Set(['Contrato', 'Cliente', 'Aparelho', 'Pagamento', 'Empresa e taxas']))
  })
  it('um HTML no nome do cliente fica como texto (a tela nunca interpreta)', () => {
    expect(campo('cliente_nome', dados({ cliente: { nome: '<b>X</b>', cpf: null, fone: '1', endereco: null } })).texto).toBe('<b>X</b>')
  })
})

describe('paridade com a demonstração do front', () => {
  it('os cenários combinados dão exatamente o resultado gravado (o front confere o mesmo arquivo)', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/contratos/paridade.json', import.meta.url), 'utf8'))
    expect(f.variaveis).toEqual(VARIAVEIS)
    for (const c of f.casos) expect(preencher(MODELO_PADRAO, c.dados, c.empresa), c.nome).toEqual(c.esperado)
    expect(preencher(f.extra.texto, f.extra.dados, f.extra.empresa)).toEqual(f.extra.esperado)
  })
})
