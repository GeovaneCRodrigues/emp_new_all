import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

const numero = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const aba = (page: Page, nome: string) => page.locator('.abas').getByRole('button', { name: nome })

/** Abre Indicadores e repasses (a aba Repasses vem aberta). */
async function abrir(page: Page) {
  await entrar(page)
  await page.goto('/indicadores')
  await expect(page.getByTestId('totais-repasse')).toBeVisible()
}
/** O primeiro indicador com dinheiro liberado. */
const comSaldo = (page: Page) => page.locator('[data-repasse]').filter({ has: page.locator('[data-pagar]:not([disabled])') }).first()

test.describe('repasses do indicador', () => {
  test('a aba Repasses abre primeiro: totais, e por indicador o que pagar, o já pago, o que vai liberar e cada operação', async ({ page }) => {
    await abrir(page)
    await expect(aba(page, 'Repasses')).toHaveClass(/on/)
    const card = comSaldo(page)
    await expect(card.locator('[data-a-pagar]')).toContainText('R$')
    await expect(card.locator('[data-operacao]').first()).toBeVisible()
    await expect(card.locator('[data-operacao]').first()).toContainText(/capital (já voltou|R\$)/)
    // o total do topo é a soma dos indicadores
    const somas = await page.locator('[data-a-pagar]').allInnerTexts()
    expect(numero(await page.getByTestId('total-a-pagar').innerText())).toBeCloseTo(somas.reduce((x, t) => x + numero(t), 0), 2)
  })

  test('quem não tem nada liberado fica com o Pagar desligado', async ({ page }) => {
    await abrir(page)
    const sem = page.locator('[data-repasse]').filter({ hasText: /A pagar\s*R\$ 0,00/ }).first()
    if (await sem.count()) await expect(sem.locator('[data-pagar]')).toBeDisabled()
  })

  test('paga um valor parcial: o a pagar cai, o já pago sobe e entra em "Já pagos"', async ({ page }) => {
    await abrir(page)
    const card = comSaldo(page)
    const antes = numero(await card.locator('[data-a-pagar]').innerText())
    const nome = (await card.locator('.val').first().innerText()).trim()
    await card.locator('[data-pagar]').click()
    await expect(page.getByTestId('a-pagar-form')).toContainText('R$')
    await page.getByRole('button', { name: 'Metade' }).click()
    await expect(page.getByTestId('restaria')).toContainText('Ainda ficam')
    await page.getByRole('button', { name: 'Dinheiro', exact: true }).click()
    await page.fill('#rpObs', 'adiantamento')
    await page.getByRole('button', { name: /^Registrar repasse de/ }).click()
    await expect(page.getByText(/Repasse de R\$ .* registrado/)).toBeVisible()
    const depois = numero(await page.locator('[data-repasse]').filter({ hasText: nome }).first().locator('[data-a-pagar]').innerText())
    expect(depois).toBeCloseTo(antes - Math.floor(antes / 2 * 100) / 100, 0)
    expect(depois).toBeLessThan(antes)
    await aba(page, 'Já pagos').click()
    const linha = page.getByTestId('lista-pagos').locator('.li').first()
    await expect(linha).toContainText(nome)
    await expect(linha).toContainText('Dinheiro')
    await expect(linha).toContainText('adiantamento')
  })

  test('"Pagar tudo" zera o a pagar e desliga o botão; depois não dá para pagar mais', async ({ page }) => {
    await abrir(page)
    const card = comSaldo(page)
    const nome = (await card.locator('.val').first().innerText()).trim()
    await card.locator('[data-pagar]').click()
    await page.locator('[data-pagar-tudo]').click()
    await page.getByRole('button', { name: /^Registrar repasse de/ }).click()
    const mesmo = page.locator('[data-repasse]').filter({ hasText: nome }).first()
    await expect(mesmo.locator('[data-a-pagar]')).toHaveText('R$ 0,00')
    await expect(mesmo.locator('[data-pagar]')).toBeDisabled()
    await expect(mesmo.locator('[data-ja-pago]')).not.toHaveText('R$ 0,00')
  })

  test('valor acima do liberado é barrado na tela com o limite à vista e o botão não envia', async ({ page }) => {
    await abrir(page)
    await comSaldo(page).locator('[data-pagar]').click()
    const limite = numero(await page.getByTestId('a-pagar-form').innerText())
    await page.fill('#rpValor', String(Math.round(limite * 100) + 1)) // um centavo a mais
    await expect(page.getByRole('button', { name: /^Registrar repasse de/ })).toBeDisabled()
    await expect(page.getByText(/Ele tem só R\$/)).toBeVisible()
  })

  test('a data do pagamento usa o campo de data e não aceita dia no futuro', async ({ page }) => {
    await abrir(page)
    await comSaldo(page).locator('[data-pagar]').click()
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await expect(page.getByTestId('calendario').locator('[data-dia="2026-10-09"]')).toBeDisabled()
    await expect(page.getByTestId('calendario').locator('[data-dia="2026-10-08"]')).toBeEnabled()
  })

  test('Já pagos: vazio no começo, e depois de pagar filtra por indicador e soma', async ({ page }) => {
    await abrir(page)
    await aba(page, 'Já pagos').click()
    await expect(page.getByText('Nenhum repasse registrado ainda.')).toBeVisible()
    await aba(page, 'Repasses').click()
    const card = comSaldo(page)
    const nome = (await card.locator('.val').first().innerText()).trim()
    await card.locator('[data-pagar]').click()
    await page.getByRole('button', { name: 'Metade' }).click()
    await page.getByRole('button', { name: /^Registrar repasse de/ }).click()
    await aba(page, 'Já pagos').click()
    await expect(page.getByTestId('lista-pagos').locator('.li')).toHaveCount(1)
    const total = numero(await page.getByTestId('total-pagos').innerText())
    expect(total).toBeGreaterThan(0)
    const filtro = page.getByLabel('Filtrar por indicador')
    await filtro.selectOption({ label: nome }) // o que recebeu: continua tudo
    await expect(page.getByTestId('lista-pagos').locator('.li')).toHaveCount(1)
    expect(numero(await page.getByTestId('total-pagos').innerText())).toBe(total)
    const outro = (await filtro.locator('option').allInnerTexts()).find((t) => t !== nome && !t.startsWith('Todos'))!
    await filtro.selectOption({ label: outro }) // outro indicador: nada
    await expect(page.getByText('Nenhum repasse registrado ainda.')).toBeVisible()
    await expect(page.getByTestId('total-pagos')).toHaveText('R$ 0,00')
  })

  test('o Esc fecha a folha de pagamento sem registrar nada', async ({ page }) => {
    await abrir(page)
    await comSaldo(page).locator('[data-pagar]').click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await aba(page, 'Já pagos').click()
    await expect(page.getByText('Nenhum repasse registrado ainda.')).toBeVisible()
  })
})
