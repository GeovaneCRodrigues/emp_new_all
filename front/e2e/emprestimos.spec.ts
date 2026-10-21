import { expect, test, type Page } from '@playwright/test'
import { confirmarEmprestimo, entrar, preencherEmprestimo } from './helpers'

/** Entra nas Operações > Empréstimos e cria um só juros de 3.000 a 12% em 3x (360, 360 e 3.360). A ficha abre sozinha. */
async function criarSoJuros(page: Page) {
  await entrar(page)
  await preencherEmprestimo(page, { capital: '300000', tipo: 'JUROS', n: 3, taxa: 12 })
  await confirmarEmprestimo(page)
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

  test('botão Detalhes: texto simplificado e extenso para mandar ao cliente, sem capital nem lucro', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-detalhamento]').click()
    const texto = page.getByTestId('detalhamento-texto')
    await expect(texto).toContainText('Já pago: R$ 0,00')
    await expect(texto).toContainText('Falta pagar: R$ 4.080,00')
    await expect(texto).toContainText('Próxima parcela')
    await expect(texto).not.toContainText('Parcelas em aberto')
    await expect(texto).not.toContainText(/capital|lucro|indicador/i)
    await page.locator('[data-modo="EXTENSO"]').click()
    await expect(texto).toContainText('Parcelas em aberto')
    await expect(texto).not.toContainText(/lucro|indicador/i)
    await expect(page.locator('[data-whatsapp]')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/)
    await expect(page.locator('[data-copiar]')).toBeVisible()
  })

  test('botão Quitou (só juros em dia): cobra só o capital, o juro que não venceu fica de fora e quita tudo', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-quitar]').click()
    await expect(page.getByRole('heading', { name: 'Quitar empréstimo' })).toBeVisible()
    await expect(page.getByTestId('quitar-capital')).toHaveText('R$ 3.000,00')
    await expect(page.getByTestId('quitar-juros')).toHaveText('R$ 0,00')
    await expect(page.getByTestId('quitar-cheio')).toHaveText('R$ 3.000,00')
    await expect(page.getByTestId('quitar-perdoado')).toContainText('1.080,00')
    await expect(page.getByTestId('quitar-receber')).toHaveText('R$ 3.000,00')
    await expect(page.getByTestId('previa')).toContainText('abate R$ 3.000,00 do capital')
    await page.getByRole('button', { name: 'Confirmar quitação' }).click()
    await expect(page.getByTestId('recibo')).toContainText('Tudo quitado')
    await page.keyboard.press('Escape')
    for (const n of [1, 2, 3]) await expect(page.locator(`[data-parcela="${n}"]`)).toContainText('paga')
    await expect(page.locator('[data-quitar]')).toHaveCount(0) // já quitado: o botão some
  })

  test('Quitou: dá para cobrar também o juro da próxima parcela', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-quitar]').click()
    await page.locator('[data-quitar-proximo]').check()
    await expect(page.getByTestId('quitar-cheio')).toHaveText('R$ 3.360,00')
    await expect(page.getByTestId('quitar-receber')).toHaveText('R$ 3.360,00')
    await expect(page.getByTestId('quitar-perdoado')).toContainText('720,00')
  })

  test('Registrar recebimento: "Quitou tudo" vira a quitação na própria tela, e dá para voltar para só a parcela', async ({ page }) => {
    await entrar(page)
    await preencherEmprestimo(page, { capital: '300000', n: 3, taxa: 10 })
    await confirmarEmprestimo(page)
    await page.locator('[data-receber="1"]').click()
    await expect(page.getByRole('heading', { name: 'Registrar recebimento' })).toBeVisible()
    await page.locator('[data-quitou-tudo]').click()
    await expect(page.getByRole('heading', { name: 'Quitar empréstimo' })).toBeVisible()
    await expect(page.getByTestId('quitar-cheio')).toHaveText('R$ 3.300,00')
    await page.locator('[data-so-parcela]').click()
    await expect(page.getByRole('heading', { name: 'Registrar recebimento' })).toBeVisible()
    await expect(page.locator('#rValor')).toHaveValue('1.100,00')
    await page.locator('[data-quitou-tudo]').click()
    await page.getByRole('button', { name: 'Confirmar quitação' }).click()
    await expect(page.getByTestId('recibo')).toContainText('Tudo quitado')
  })

  test('Quitou com desconto: o cliente paga o valor cheio menos o desconto e a prévia avisa', async ({ page }) => {
    await criarSoJuros(page)
    await page.locator('[data-quitar]').click()
    await page.locator('#rDesc').fill('40000')
    await expect(page.getByTestId('quitar-receber')).toHaveText('R$ 2.600,00')
    await expect(page.getByTestId('previa')).toContainText('desconto de R$ 400,00')
    await page.getByRole('button', { name: 'Confirmar quitação' }).click()
    await expect(page.getByTestId('recibo')).toContainText('Tudo quitado')
  })

  test('botão Quitou em empréstimo parcelado: o valor é tudo que falta e todas as parcelas ficam pagas', async ({ page }) => {
    await entrar(page)
    await preencherEmprestimo(page, { capital: '300000', n: 3, taxa: 10 })
    await confirmarEmprestimo(page)
    await expect(page.getByTestId('dados-admin')).toContainText('3.000,00')
    await page.locator('[data-quitar]').click()
    await expect(page.getByTestId('quitar-cheio')).toHaveText('R$ 3.300,00') // tudo que falta: as 3 parcelas de 1.100,00
    await expect(page.locator('[data-quitar-proximo]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Confirmar quitação' }).click()
    await page.keyboard.press('Escape')
    for (const n of [1, 2, 3]) await expect(page.locator(`[data-parcela="${n}"]`)).toContainText('paga')
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
