import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: "hoje" é 08/10/2026 e o caixa abre com um aporte de R$ 100.000 de saldo de abertura (01/01/2026).
/** "R$ 1.234,50" → 1234.5; "−R$ 5,00" → -5 (o menos do sistema é o sinal de menos tipográfico). */
const numero = (t: string) => (/^[−-]/.test(t.trim()) ? -1 : 1) * Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const saldo = async (page: Page) => numero((await page.getByTestId('caixa-saldo').textContent()) ?? '')
/** O lançamento pode estar mais abaixo no extrato (o mais antigo fica no fim): carrega mais até ele aparecer. */
async function achar(page: Page, texto: string) {
  const alvo = page.locator('[data-categoria="APORTE"]', { hasText: texto })
  for (let i = 0; i < 20 && !(await alvo.count()); i++) {
    const mais = page.getByTestId('caixa-mais')
    if (!(await mais.count())) break
    await mais.click(); await page.waitForTimeout(150)
  }
  return alvo
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

  test('"Mostrar mais" acrescenta o resto do extrato', async ({ page }) => {
    const itens = page.getByTestId('caixa-extrato').locator('[data-movimento]')
    const antes = await itens.count()
    expect(antes).toBeLessThanOrEqual(25)
    const mais = page.getByTestId('caixa-mais')
    if (await mais.count()) {
      await mais.click()
      await expect.poll(async () => itens.count()).toBeGreaterThan(antes)
    }
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
    // apaga o saldo de abertura da demonstração
    await (await achar(page, 'Saldo de abertura')).click()
    await page.getByTestId('lanc-excluir').click(); await page.getByTestId('lanc-excluir').click()
    await expect(page.getByTestId('caixa-sem-marco')).toContainText('Ainda não há aporte nem retirada')
    await expect(page.getByTestId('caixa-marco')).toHaveCount(0)
  })
})

test.describe('caixa: outros perfis', () => {
  test('o cobrador continua com o "Meu caixa" dele, não com o da loja', async ({ page }) => {
    await entrar(page, 'cobrador'); await navegar(page, '/caixa')
    await expect(page.getByTestId('caixa-saldo')).toHaveCount(0)
    await expect(page.getByTestId('caixa-lancar')).toHaveCount(0)
  })
})
