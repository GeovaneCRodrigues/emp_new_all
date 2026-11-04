import { expect, test } from '@playwright/test'
import { entrar } from './helpers'

test.describe('sino de avisos', () => {
  test('administrador: contador, lista, abrir um aviso leva à tela e marcar todas zera', async ({ page }) => {
    await entrar(page, 'admin')
    const contador = page.getByTestId('sino-contador')
    await expect(contador).toBeVisible()
    const n = Number(await contador.innerText())
    expect(n).toBeGreaterThan(0)

    await page.getByTestId('sino').click()
    await expect(page.getByTestId('sino-lista')).toBeVisible()
    await expect(page.getByText('Contrato 2026-0104 assinado por ANA SOUZA.')).toBeVisible()

    // abrir um aviso: marca como lido e vai para a tela dele
    await page.getByText('Contrato 2026-0104 assinado por ANA SOUZA.').click()
    await expect(page).toHaveURL(/\/contratos$/)
    await expect(page.getByTestId('sino-contador')).toHaveText(String(n - 1))

    await page.getByTestId('sino').click()
    await page.getByTestId('sino-todas').click()
    await expect(page.getByTestId('sino-contador')).toHaveCount(0)
  })

  test('cobrador vê o sino; vendedor e indicador não', async ({ page }) => {
    await entrar(page, 'cobrador')
    await expect(page.getByTestId('sino')).toBeVisible()
    await page.getByTestId('sino').click()
    await expect(page.getByText('2 parcelas vencem hoje.')).toBeVisible()
  })

  for (const conta of ['vendedor', 'indicador'] as const) {
    test(`${conta} não tem sino`, async ({ page }) => {
      await entrar(page, conta)
      await expect(page.getByTestId('sino')).toHaveCount(0)
    })
  }
})
