import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

/** Entra nas Operações > Empréstimos e cria um só juros de 3.000 a 12% em 3x (360, 360 e 3.360). A ficha abre sozinha. */
async function criarSoJuros(page: Page) {
  await entrar(page)
  await page.goto('/operacoes')
  await page.getByRole('button', { name: /Empréstimos/ }).click()
  await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
  await page.locator('[data-cliente]').first().click()
  await page.locator('[data-mod="JUROS"]').click()
  await page.locator('#eCapital').fill('300000')
  await page.fill('#eTaxa', '12')
  await page.fill('#eParcelas', '3')
  await page.getByRole('button', { name: 'Fazer empréstimo' }).click()
  await expect(page.getByTestId('dados-admin')).toContainText('3.000,00')
}

test.describe('baixas de empréstimo', () => {
  test('as cobranças mostram os empréstimos junto com as vendas e dá para filtrar por tipo', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'Empréstimos' }).click()
    await expect(page.locator('.cob').first()).toBeVisible()
    for (const t of await page.locator('.cob').allInnerTexts()) expect(t).toContain('Empréstimo')
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'iPhones' }).click()
    await expect(page.locator('.cob').first()).toBeVisible()
    for (const t of await page.locator('.cob').allInnerTexts()) expect(t).not.toContain('Empréstimo')
  })

  test('recebe uma parcela de empréstimo pelas cobranças: abre o recibo de empréstimo e a linha sai dos atrasados', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await page.getByTestId('filtro-tipo').getByRole('button', { name: 'Empréstimos' }).click()
    const linha = page.locator('.cob').first()
    const nome = (await linha.locator('.t').first().innerText()).trim()
    await linha.getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    const recibo = page.getByTestId('recibo')
    await expect(recibo).toContainText('Empréstimo')
    await expect(recibo).toContainText(nome.split(' ')[0])
  })

  test('só juros pela ficha: 1.000 na 1ª parcela abate 640 do capital e o juro seguinte vira 283,20', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-receber="1"]').click()
    await page.locator('#rValor').fill('100000')
    await expect(page.getByTestId('previa')).toContainText('abate R$ 640,00 do capital')
    await expect(page.getByTestId('previa')).toContainText('R$ 2.360,00')
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('amortizacao')).toContainText('abateu o capital')
    await expect(page.getByTestId('amortizacao')).toContainText('R$ 2.360,00')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-parcela="2"]')).toContainText('283,20')
    await expect(page.locator('[data-parcela="3"]')).toContainText('2.643,20')
  })

  test('juro + todo o capital quita o empréstimo; desfazer devolve as parcelas', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-receber="1"]').click()
    await page.locator('#rValor').fill('336000')
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toContainText('Tudo quitado')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-parcela="2"]')).toContainText('paga')
    await page.getByTestId('pagamentos').getByRole('button', { name: 'Desfazer' }).click()
    await expect(page.locator('[data-parcela="2"]')).toContainText('360,00')
    await expect(page.locator('[data-parcela="3"]')).toContainText('3.360,00')
  })

  test('passar de juro + capital é recusado na prévia e o botão trava', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-receber="1"]').click()
    await page.locator('#rValor').fill('340000')
    await expect(page.getByRole('alert')).toContainText('passa do que falta')
    await expect(page.getByRole('button', { name: 'Confirmar recebimento' })).toBeDisabled()
  })

  test('o cobrador vê os empréstimos da carteira nas cobranças, sem capital nem lucro', async ({ page }) => {
    await entrar(page, 'cobrador')
    await page.goto('/cobrancas')
    await expect(page.locator('main, body').first()).not.toContainText(/capital|lucro/i)
  })
})
