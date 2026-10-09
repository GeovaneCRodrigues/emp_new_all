import { expect, test } from '@playwright/test'
import { entrar } from './helpers'

test.describe('Início do administrador', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  test('mostra o que cobrar hoje (atrasadas + vencem hoje), o mês, o lucro e o a receber', async ({ page }) => {
    await expect(page.getByTestId('cobrar-hoje')).toContainText('R$')
    await expect(page.getByTestId('cobrar-hoje')).not.toHaveText('—')
    await expect(page.getByText(/\d+ atrasadas? · \d+ vencem? hoje/)).toBeVisible()
    await expect(page.getByTestId('vendas-mes')).toBeVisible()
    await expect(page.getByTestId('lucro-bolso')).toContainText('R$')
    await expect(page.getByTestId('a-receber')).toContainText('R$')
  })

  test('as atrasadas têm WhatsApp e Recebi; receber abre o recibo e o total a cobrar cai', async ({ page }) => {
    const numero = (t: string) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
    const antes = numero(await page.getByTestId('cobrar-hoje').innerText())
    const linha = page.getByTestId('atrasadas').locator('.cob').first()
    await expect(linha.getByRole('link', { name: 'Cobrar no WhatsApp' })).toBeVisible()
    await expect(linha).toContainText('venceu')
    await linha.getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
    await expect(page.getByTestId('recibo')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () => numero(await page.getByTestId('cobrar-hoje').innerText())).toBeLessThan(antes)
  })

  test('"Esperando você" leva à Equipe e conta os pedidos de verdade', async ({ page }) => {
    const card = page.getByTestId('esperando-voce')
    await expect(card).toContainText('pedidos da equipe')
    await expect(card).toContainText('Desconto')
    await card.locator('[data-esperando="equipe"]').click()
    await expect(page).toHaveURL(/\/equipe$/)
  })

  test('"Parado no estoque" lista os aparelhos mais antigos com os dias e o custo', async ({ page }) => {
    const lista = page.getByTestId('parados').locator('.li')
    await expect(lista.first()).toBeVisible()
    await expect(lista.first()).toContainText(/há \d+ dias?|chegou hoje/)
    await expect(lista.first()).toContainText('custo')
    const dias = await lista.evaluateAll((ls) => ls.map((l) => { const t = (l as HTMLElement).innerText; return /chegou hoje/.test(t) ? 0 : Number(/há (\d+) dias?/.exec(t)?.[1]) }))
    expect([...dias].sort((a, b) => b - a)).toEqual(dias) // do mais parado para o menos
  })

  test('Ver cobranças e Nova venda levam para as telas certas', async ({ page }) => {
    await page.getByRole('button', { name: 'Ver cobranças' }).click()
    await expect(page).toHaveURL(/\/cobrancas$/)
    await page.goBack()
    await page.getByRole('button', { name: 'Nova venda' }).first().click()
    await expect(page).toHaveURL(/\/vender$/)
  })
})
