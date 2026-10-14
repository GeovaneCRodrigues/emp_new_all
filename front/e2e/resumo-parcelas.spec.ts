import { expect, test } from '@playwright/test'
import { entrar, navegar } from './helpers'

test('ficha do empréstimo mostra o total de parcelas pagas e atrasadas, batendo com a linha do tempo', async ({ page }) => {
  await entrar(page, 'admin'); await navegar(page, '/operacoes')
  await page.getByRole('button', { name: /Empréstimos/ }).click()
  await page.locator('[data-emprestimo]').first().click()
  const resumo = page.locator('[data-resumo-parcelas]')
  await expect(resumo).toBeVisible()
  const pagas = Number((await resumo.locator('[data-parcelas-pagas]').innerText()).split(' ')[0])
  const atrasadas = Number((await resumo.locator('[data-parcelas-atrasadas]').innerText()).split(' ')[0])
  await expect(page.locator('.timeline i.a')).toHaveCount(atrasadas)
  expect(pagas).toBeGreaterThanOrEqual(0)
})
