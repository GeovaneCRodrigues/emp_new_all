import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

/** "10x de R$ 1.200,00" → { n: 10, valor: 1200 } */
const lerParcela = (t: string) => { const m = t.match(/(\d+)x de R\$\s*([\d.]+),(\d{2})/)!; return { n: Number(m[1]), valor: Number(m[2].replace(/\./g, '') + '.' + m[3]) } }
const digitos = (v: number) => String(Math.round(v * 100))

async function ate_pagamento(page: Page, conta: 'admin' | 'vendedor') {
  await entrar(page, conta)
  await page.goto('/vender')
  await page.locator('[data-aparelho]').first().click()
  await page.locator('[data-cliente]').first().click()
  await expect(page.getByTestId('valor-parcela')).toBeVisible()
}

test.describe('valor da parcela na venda', () => {
  test('o valor da parcela aparece em destaque, com a data da 1ª e o total', async ({ page }) => {
    await ate_pagamento(page, 'admin')
    await expect(page.getByTestId('parcela-valor')).toContainText(/\d+x de R\$/)
    await expect(page.getByTestId('valor-parcela')).toContainText('1ª vence em')
    await expect(page.getByTestId('valor-parcela')).toContainText('o cliente paga')
    await expect(page.getByTestId('parcela-editada')).toHaveCount(0)
  })

  test('admin edita: marca "valor editado", mostra o sugerido, refaz o total e dá para voltar', async ({ page }) => {
    await ate_pagamento(page, 'admin')
    const antes = lerParcela(await page.getByTestId('parcela-valor').innerText())
    const total = await page.getByTestId('resumo-total').innerText()
    await page.getByTestId('parcela-editar').click()
    await page.fill('#vParcela', digitos(antes.valor - 50))
    const depois = lerParcela(await page.getByTestId('parcela-valor').innerText())
    expect(depois.valor).toBe(antes.valor - 50)
    await expect(page.getByTestId('parcela-editada')).toBeVisible()
    await expect(page.getByTestId('valor-parcela')).toContainText('sugerido')
    expect(await page.getByTestId('resumo-total').innerText()).not.toBe(total)
    await page.getByTestId('parcela-voltar').click()
    expect(lerParcela(await page.getByTestId('parcela-valor').innerText()).valor).toBe(antes.valor)
    await expect(page.getByTestId('parcela-editada')).toHaveCount(0)
    await expect(page.getByTestId('resumo-total')).toHaveText(total)
  })

  test('mudar o número de parcelas descarta o valor editado (a conta é outra)', async ({ page }) => {
    await ate_pagamento(page, 'admin')
    await page.getByTestId('parcela-editar').click()
    await page.fill('#vParcela', digitos(500))
    await expect(page.getByTestId('parcela-editada')).toBeVisible()
    await page.getByRole('button', { name: '5x', exact: true }).click()
    await expect(page.getByTestId('parcela-editada')).toHaveCount(0)
  })

  test('parcela que dá prejuízo ou paga menos que o financiado: avisa, mas deixa o admin decidir', async ({ page }) => {
    await ate_pagamento(page, 'admin')
    await page.getByTestId('parcela-editar').click()
    await page.fill('#vParcela', digitos(10))
    await expect(page.getByTestId('parcela-aviso')).toContainText('Atenção')
    await expect(page.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled()
  })

  test('confirma a venda com o valor editado e a tela de venda feita mostra a parcela combinada', async ({ page }) => {
    await ate_pagamento(page, 'admin')
    const antes = lerParcela(await page.getByTestId('parcela-valor').innerText())
    await page.getByTestId('parcela-editar').click()
    await page.fill('#vParcela', digitos(antes.valor - 100))
    await page.getByRole('button', { name: 'Confirmar venda' }).click()
    const feita = page.getByTestId('venda-feita')
    await expect(feita).toBeVisible()
    const r = lerParcela(await feita.innerText())
    expect(r.valor).toBe(antes.valor - 100)
    expect(r.n).toBe(antes.n)
  })

  test('vendedor vê o valor da parcela, mas não tem como editar', async ({ page }) => {
    await ate_pagamento(page, 'vendedor')
    await expect(page.getByTestId('parcela-valor')).toContainText(/\d+x de R\$/)
    await expect(page.getByTestId('parcela-editar')).toHaveCount(0)
  })
})
