import { expect, test, type Page } from '@playwright/test'
import { entrar } from './helpers'

/** Abre o novo empréstimo e vai ao passo 3, onde está o campo do 1º vencimento (demonstração: hoje é 08/10/2026). */
async function noPasso3(page: Page) {
  await entrar(page)
  await page.goto('/operacoes')
  await page.getByRole('button', { name: /Empréstimos/ }).click()
  await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
  await page.locator('[data-cliente]').first().click()
  await page.locator('#eCapital').fill('100000')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
}

test.describe('campo de data', () => {
  test('digitar só os números vira dd/mm/aaaa no caminho e a data vale', async ({ page }) => {
    await noPasso3(page)
    const campo = page.locator('#ePrimeira')
    await campo.fill('')
    await campo.pressSequentially('15102026')
    await expect(campo).toHaveValue('15/10/2026')
    await expect(page.getByTestId('lista-parcelas').locator('.li').first()).toContainText('15/10')
  })

  test('letras são ignoradas e data incompleta ou inexistente mostra o problema', async ({ page }) => {
    await noPasso3(page)
    const campo = page.locator('#ePrimeira')
    await campo.fill('')
    await campo.pressSequentially('1a5')
    await expect(campo).toHaveValue('15')
    await campo.fill('31/02/2027')
    await expect(page.getByTestId('problema-passo')).toContainText('1º vencimento')
    await expect(page.getByRole('button', { name: 'Fazer empréstimo' })).toBeDisabled()
  })

  test('o calendário abre embaixo do campo, mostra o mês e apaga os dias antes do empréstimo', async ({ page }) => {
    await noPasso3(page)
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    const cal = page.getByTestId('calendario')
    await expect(cal).toBeVisible()
    await expect(cal).toContainText('Novembro de 2026') // o 1º vencimento sugerido é 08/11
    await cal.getByRole('button', { name: 'Mês anterior' }).click()
    await expect(cal).toContainText('Outubro de 2026')
    await expect(cal.locator('[data-dia="2026-10-07"]')).toBeDisabled() // antes do empréstimo (08/10)
    await expect(cal.locator('[data-dia="2026-10-08"]')).toBeEnabled()
  })

  test('escolher um dia no calendário preenche o campo e fecha', async ({ page }) => {
    await noPasso3(page)
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await page.getByTestId('calendario').locator('[data-dia="2026-11-20"]').click()
    await expect(page.locator('#ePrimeira')).toHaveValue('20/11/2026')
    await expect(page.getByTestId('calendario')).toBeHidden()
    await expect(page.getByTestId('lista-parcelas').locator('.li').first()).toContainText('20/11')
  })

  test('atalhos "Hoje" e "Daqui a 30 dias"', async ({ page }) => {
    await noPasso3(page)
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await page.locator('[data-atalho="30dias"]').click()
    await expect(page.locator('#ePrimeira')).toHaveValue('07/11/2026')
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await page.locator('[data-atalho="hoje"]').click()
    await expect(page.locator('#ePrimeira')).toHaveValue('08/10/2026')
  })

  test('Esc fecha só o calendário (a folha continua) e clicar fora também fecha', async ({ page }) => {
    await noPasso3(page)
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await expect(page.getByTestId('calendario')).toBeVisible()
    await page.locator('#ePrimeira').focus()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('calendario')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Novo empréstimo' })).toBeVisible()
    await page.getByRole('button', { name: 'Escolher no calendário' }).click()
    await page.getByRole('heading', { name: 'Novo empréstimo' }).click()
    await expect(page.getByTestId('calendario')).toBeHidden()
  })

  test('a data de recebimento do administrador usa o mesmo campo e não aceita dia no futuro', async ({ page }) => {
    await entrar(page)
    await page.goto('/cobrancas')
    await page.locator('.cob').first().getByRole('button', { name: 'Recebi' }).click()
    await page.getByRole('button', { name: 'Escolher no calendário' }).first().click()
    await expect(page.getByTestId('calendario').locator('[data-dia="2026-10-09"]')).toBeDisabled() // amanhã
    await expect(page.getByTestId('calendario').locator('[data-dia="2026-10-08"]')).toBeEnabled()
  })
})

test.describe('modal', () => {
  test('tem o x redondo, que fecha, e Esc e clicar fora também fecham', async ({ page }) => {
    await entrar(page)
    await page.goto('/estoque')
    await page.locator('.fone').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fechar' })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.fone').first().click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.fone').first().click()
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('o x fica fora da área que rola e saindo um pouco pra fora da folha', async ({ page }) => {
    await entrar(page)
    await page.goto('/estoque')
    await page.locator('.fone').first().click()
    const x = await page.locator('.xfechar').boundingBox()
    const folha = await page.locator('.sheet').boundingBox()
    expect(x && folha).toBeTruthy()
    expect(x!.y).toBeLessThan(folha!.y + 10) // começa na borda de cima (ou acima dela)
    await expect(page.locator('.sheet .xfechar')).toHaveCount(0) // não está dentro do que rola
  })

  test('trocar uma opção dentro da folha não reabre nem volta a rolagem para o topo', async ({ page }) => {
    await entrar(page)
    await page.goto('/operacoes')
    await page.getByRole('button', { name: /Empréstimos/ }).click()
    await page.getByRole('button', { name: 'Empréstimo', exact: true }).click()
    await page.locator('[data-cliente]').first().click()
    await page.locator('#eCapital').fill('100000')
    await page.getByRole('button', { name: 'Continuar' }).click()
    const folha = page.locator('.sheet')
    await folha.evaluate((el) => { el.scrollTop = 120 })
    const antes = await folha.evaluate((el) => el.scrollTop)
    expect(antes).toBeGreaterThan(0)
    await page.locator('[data-freq="SEMANAL"]').click()
    await page.locator('[data-mod="JUROS"]').click()
    expect(await folha.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(antes - 1)
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })
})
