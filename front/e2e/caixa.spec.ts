import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: "hoje" é 08/10/2026 e o caixa abre com um saldo de abertura (01/01/2026) em cada lado: R$ 60.000 de empréstimos e R$ 40.000 de iPhones.
/** "R$ 1.234,50" → 1234.5; "−R$ 5,00" → -5 (o menos do sistema é o sinal de menos tipográfico). */
const numero = (t: string) => (/^[−-]/.test(t.trim()) ? -1 : 1) * Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const saldo = async (page: Page) => numero((await page.getByTestId('caixa-saldo').textContent()) ?? '')
/** O extrato carrega inteiro, então o lançamento já está na lista (sem botão de "mais"). */
async function achar(page: Page, texto: string) {
  return page.locator('[data-categoria="APORTE"]', { hasText: texto })
}
const abrirLancar = async (page: Page) => { await page.getByTestId('caixa-lancar').click(); await expect(page.getByTestId('lanc-salvar')).toBeVisible() }

test.describe('caixa da loja (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/caixa'); await expect(page.getByTestId('caixa-saldo')).toBeVisible() })

  test('mostra o saldo, o resumo do mês, o marco zero e o extrato com entradas e saídas', async ({ page }) => {
    await expect(page.getByTestId('caixa-saldo')).toHaveText(/R\$/)
    await expect(page.getByTestId('caixa-mes')).toContainText(/outubro/i)
    await expect(page.getByTestId('caixa-mes')).toContainText('entrou')
    await expect(page.getByTestId('caixa-mes')).toContainText('saiu')
    await expect(page.getByTestId('caixa-marco')).toContainText('01/01/2026')
    const extrato = page.getByTestId('caixa-extrato')
    await expect(extrato.locator('[data-movimento]').first()).toBeVisible()
    await expect(extrato.locator('[data-categoria="RECEBIMENTO"]').first()).toContainText('+')
    await expect(extrato.locator('[data-categoria="EMPRESTIMO"], [data-categoria="COMPRA"]').first()).toContainText('−')
  })

  test('o extrato vem inteiro, sem botão de "mostrar mais"', async ({ page }) => {
    const itens = page.getByTestId('caixa-extrato').locator('[data-movimento]')
    await expect(itens.first()).toBeVisible()
    await expect(page.getByTestId('lista-carregando')).toHaveCount(0) // terminou de carregar
    await expect(page.getByTestId('lista-cortada')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /mostrar mais|carregar mais/i })).toHaveCount(0)
    expect(await itens.count()).toBeGreaterThan(25) // antes parava em 25
  })

  test('lançar um aporte soma no saldo e aparece no topo do extrato', async ({ page }) => {
    const antes = await saldo(page)
    await abrirLancar(page)
    await page.locator('#lcValor').fill('150000') // R$ 1.500,00
    await page.locator('#lcObs').fill('reforço de caixa')
    await page.getByTestId('lanc-salvar').click()
    await expect(page.getByTestId('lanc-salvar')).toHaveCount(0)
    await expect.poll(() => saldo(page)).toBe(Math.round((antes + 1500) * 100) / 100)
    const m = page.locator('[data-categoria="APORTE"]', { hasText: 'reforço de caixa' })
    await expect(m).toContainText('+ R$ 1.500,00')
  })

  test('despesa exige dizer com o quê; com a descrição, tira do saldo', async ({ page }) => {
    const antes = await saldo(page)
    await abrirLancar(page)
    await page.getByTestId('lanc-tipo').getByRole('button', { name: 'Despesa' }).click()
    await expect(page.getByTestId('lanc-dica')).toContainText('Gasto da loja')
    await page.locator('#lcValor').fill('9000') // R$ 90,00
    await expect(page.getByTestId('lanc-salvar')).toBeDisabled()
    await expect(page.getByText('Diga com o que foi a despesa')).toBeVisible()
    await page.locator('#lcObs').fill('internet do escritório')
    await expect(page.getByTestId('lanc-salvar')).toBeEnabled()
    await page.getByTestId('lanc-salvar').click()
    await expect.poll(() => saldo(page)).toBe(Math.round((antes - 90) * 100) / 100)
    await expect(page.locator('[data-categoria="DESPESA"]', { hasText: 'internet do escritório' })).toContainText('− R$ 90,00')
  })

  test('toca num lançamento manual para corrigir; o saldo acompanha', async ({ page }) => {
    await abrirLancar(page)
    await page.locator('#lcValor').fill('10000'); await page.locator('#lcObs').fill('para corrigir')
    await page.getByTestId('lanc-salvar').click()
    const antes = await expect.poll(() => saldo(page)).toBeGreaterThan(0).then(() => saldo(page))
    await page.locator('[data-categoria="APORTE"]', { hasText: 'para corrigir' }).click()
    await expect(page.getByRole('heading', { name: 'Corrigir lançamento' })).toBeVisible()
    await expect(page.locator('#lcObs')).toHaveValue('para corrigir')
    await page.locator('#lcValor').fill('25000') // R$ 100 → R$ 250
    await page.getByTestId('lanc-salvar').click()
    await expect.poll(() => saldo(page)).toBe(Math.round((antes + 150) * 100) / 100)
  })

  test('excluir pede confirmação (dois toques) e devolve o saldo', async ({ page }) => {
    await abrirLancar(page)
    await page.locator('#lcValor').fill('20000'); await page.locator('#lcObs').fill('vai sumir')
    await page.getByTestId('lanc-salvar').click()
    await expect(page.locator('[data-categoria="APORTE"]', { hasText: 'vai sumir' })).toBeVisible()
    const comAporte = await saldo(page)
    await page.locator('[data-categoria="APORTE"]', { hasText: 'vai sumir' }).click()
    await page.getByTestId('lanc-excluir').click()
    await expect(page.getByTestId('lanc-excluir')).toContainText('Tem certeza')
    await page.getByTestId('lanc-excluir').click()
    await expect(page.locator('[data-categoria="APORTE"]', { hasText: 'vai sumir' })).toHaveCount(0)
    await expect.poll(() => saldo(page)).toBe(Math.round((comAporte - 200) * 100) / 100)
  })

  test('só recebimento, repasse, empréstimo e compra NÃO se editam (não são botões)', async ({ page }) => {
    const rec = page.locator('[data-categoria="RECEBIMENTO"]').first()
    await expect(rec).toBeVisible()
    expect(await rec.evaluate((n) => n.tagName)).toBe('DIV')
    await rec.click()
    await expect(page.getByTestId('lanc-salvar')).toHaveCount(0)
  })

  test('sem aporte nem retirada, avisa que o saldo soma tudo e sugere o saldo de abertura', async ({ page }) => {
    // apaga os dois saldos de abertura da demonstração
    for (let i = 0; i < 2; i++) {
      await (await achar(page, 'Saldo de abertura')).first().click()
      await page.getByTestId('lanc-excluir').click(); await page.getByTestId('lanc-excluir').click()
      await expect(page.getByTestId('lanc-salvar')).toHaveCount(0)
    }
    await expect(page.getByTestId('caixa-sem-marco')).toContainText('Ainda não há aporte nem retirada')
    await expect(page.getByTestId('caixa-marco')).toHaveCount(0)
  })
})

test.describe('caixa por lado: empréstimos e iPhones', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/caixa'); await expect(page.getByTestId('caixa-saldo')).toBeVisible() })
  const aba = (page: Page, nome: string) => page.getByTestId('caixa-abas').getByRole('button', { name: nome, exact: true })
  const abrir = async (page: Page, nome: string) => { await aba(page, nome).click(); await expect(aba(page, nome)).toHaveClass(/on/); await expect(page.getByTestId('lista-carregando')).toHaveCount(0) }

  test('tem as abas Tudo, Empréstimos e iPhones; em "Tudo" mostra o saldo de cada lado', async ({ page }) => {
    for (const n of ['Tudo', 'Empréstimos', 'iPhones']) await expect(aba(page, n)).toBeVisible()
    await expect(page.getByTestId('caixa-saldo-rotulo')).toHaveText('Saldo em caixa')
    await expect(page.getByTestId('caixa-lados')).toContainText('Empréstimos')
    await expect(page.getByTestId('caixa-lados')).toContainText('iPhones')
  })

  test('a aba iPhones mostra só o que é de iPhone; a de Empréstimos, só o que é de empréstimo', async ({ page }) => {
    const extrato = page.getByTestId('caixa-extrato')
    await abrir(page, 'iPhones')
    await expect(page.getByTestId('caixa-saldo-rotulo')).toHaveText('Saldo · iPhones')
    await expect(extrato.locator('[data-categoria="COMPRA"]').first()).toBeVisible()
    await expect(extrato.locator('[data-categoria="EMPRESTIMO"]')).toHaveCount(0)
    await expect(extrato.locator('[data-categoria="REPASSE"]')).toHaveCount(0)
    await abrir(page, 'Empréstimos')
    await expect(page.getByTestId('caixa-saldo-rotulo')).toHaveText('Saldo · Empréstimos')
    await expect(extrato.locator('[data-categoria="EMPRESTIMO"]').first()).toBeVisible()
    await expect(extrato.locator('[data-categoria="COMPRA"]')).toHaveCount(0)
    await expect(extrato.locator('[data-categoria="ENTRADA_VENDA"]')).toHaveCount(0)
  })

  test('lançar uma despesa na aba iPhones já vem com o lado iPhones e mexe só no saldo dele', async ({ page }) => {
    await abrir(page, 'iPhones')
    const iph = await saldo(page)
    await abrirLancar(page)
    await expect(page.getByTestId('lanc-lado').getByRole('button', { name: 'iPhones' })).toHaveClass(/on/)
    await page.getByTestId('lanc-tipo').getByRole('button', { name: 'Despesa' }).click()
    await page.locator('#lcValor').fill('9000'); await page.locator('#lcObs').fill('frete do lote')
    await page.getByTestId('lanc-salvar').click()
    await expect.poll(() => saldo(page)).toBe(Math.round((iph - 90) * 100) / 100)
    await expect(page.locator('[data-categoria="DESPESA"]', { hasText: 'frete do lote' })).toBeVisible()
    await abrir(page, 'Empréstimos')
    await expect(page.locator('[data-categoria="DESPESA"]', { hasText: 'frete do lote' })).toHaveCount(0)
  })

  test('o lado é escolhido no formulário e pode ser trocado ao corrigir', async ({ page }) => {
    await abrirLancar(page)
    await page.getByTestId('lanc-lado').getByRole('button', { name: 'iPhones' }).click()
    await page.locator('#lcValor').fill('5000'); await page.locator('#lcObs').fill('aporte do lado iphone')
    await page.getByTestId('lanc-salvar').click()
    await abrir(page, 'iPhones')
    await expect(page.locator('[data-categoria="APORTE"]', { hasText: 'aporte do lado iphone' })).toBeVisible()
    await page.locator('[data-categoria="APORTE"]', { hasText: 'aporte do lado iphone' }).click()
    await page.getByTestId('lanc-lado').getByRole('button', { name: 'Empréstimos' }).click()
    await page.getByTestId('lanc-salvar').click()
    await expect(page.locator('[data-categoria="APORTE"]', { hasText: 'aporte do lado iphone' })).toHaveCount(0)
    await abrir(page, 'Empréstimos')
    await expect(page.locator('[data-categoria="APORTE"]', { hasText: 'aporte do lado iphone' })).toBeVisible()
  })

  test('a aba "Sem lado" só aparece quando há algo sem lado (na demonstração não há)', async ({ page }) => {
    await expect(aba(page, 'Sem lado')).toHaveCount(0)
  })
})

test.describe('caixa: outros perfis', () => {
  test('o cobrador continua com o "Meu caixa" dele, não com o da loja', async ({ page }) => {
    await entrar(page, 'cobrador'); await navegar(page, '/caixa')
    await expect(page.getByTestId('caixa-saldo')).toHaveCount(0)
    await expect(page.getByTestId('caixa-lancar')).toHaveCount(0)
  })
})

test.describe('fechamento do caixa da loja (administrador)', () => {
  // Demonstração: "hoje" é 08/10/2026 e o caixa já foi fechado até 05/10, então há 2 dias sem fechar (06 e 07).
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/caixa'); await expect(page.getByTestId('caixa-fechamento')).toBeVisible() })

  test('mostra o último dia fechado e quantos dias passaram sem fechar', async ({ page }) => {
    await expect(page.getByTestId('fechamento-ultimo')).toHaveText('05/10/2026')
    await expect(page.getByTestId('fechamento-quando')).toContainText('Administrador')
    await expect(page.getByTestId('fechamento-alerta')).toContainText('2 dias sem fechar')
  })

  test('fechar sugere ontem, mostra o que entrou e saiu desde o último fechamento e, ao confirmar, vira o último', async ({ page }) => {
    await page.getByTestId('fechar-caixa').click()
    await expect(page.getByTestId('fechar-periodo')).toHaveText('De 06/10/2026 a 07/10/2026')
    await expect(page.getByTestId('fechar-entrou')).toContainText('R$')
    await expect(page.getByTestId('fechar-saiu')).toContainText('R$')
    await expect(page.getByTestId('fechar-saldo')).toContainText('R$')
    await page.locator('#fcObs').fill('conferi o pix')
    await page.getByTestId('fechar-confirmar').click()
    await expect(page.getByTestId('fechar-confirmar')).toHaveCount(0)
    await expect(page.getByTestId('fechamento-ultimo')).toHaveText('07/10/2026')
    await expect(page.getByTestId('fechamento-quando')).toContainText('conferi o pix')
    await expect(page.getByTestId('fechamento-alerta')).toHaveCount(0)
  })

  test('desfazer o último fechamento volta o anterior; o histórico lista os fechamentos', async ({ page }) => {
    await page.getByTestId('fechar-caixa').click()
    await page.getByTestId('fechar-confirmar').click()
    await expect(page.getByTestId('fechamento-ultimo')).toHaveText('07/10/2026')
    await page.getByTestId('fechamento-historico').click()
    await expect(page.getByTestId('fechamento-lista').locator('[data-fechamento]')).toHaveCount(2)
    await page.getByTestId('fechamento-desfazer').click()
    await expect(page.getByTestId('fechamento-ultimo')).toHaveText('05/10/2026')
    await expect(page.getByTestId('fechamento-alerta')).toContainText('2 dias sem fechar')
  })

  test('lançar em um dia já fechado só avisa (não trava)', async ({ page }) => {
    await abrirLancar(page)
    await expect(page.getByTestId('lanc-dia-fechado')).toHaveCount(0) // hoje (08/10) está aberto
    await page.locator('#lcValor').fill('10000')
    await page.locator('#lcData').fill('05102026')
    await expect(page.getByTestId('lanc-dia-fechado')).toContainText('05/10/2026')
    await expect(page.getByTestId('lanc-salvar')).toBeEnabled()
  })

  test('o Início avisa que o caixa está sem fechar e leva ao Caixa', async ({ page }) => {
    await navegar(page, '/')
    await expect(page.getByTestId('aviso-caixa')).toContainText('2 dias')
    await page.getByTestId('aviso-caixa').click()
    await expect(page).toHaveURL(/\/caixa/)
  })
})

test.describe('fechamento do caixa: outros perfis', () => {
  test('o cobrador não vê o fechamento da loja', async ({ page }) => {
    await entrar(page, 'cobrador'); await navegar(page, '/caixa')
    await expect(page.getByTestId('caixa-fechamento')).toHaveCount(0)
  })
})
