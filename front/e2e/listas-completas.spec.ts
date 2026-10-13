import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// As listas carregam tudo sozinhas: nada de botão "Carregar mais" / "Mostrar mais", e o aviso de "carregando o resto" some quando termina.
const semBotaoDeMais = async (page: Page) => {
  await expect(page.getByTestId('lista-carregando')).toHaveCount(0)
  await expect(page.getByTestId('lista-cortada')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /carregar mais|mostrar mais|ver mais/i })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test.describe('listas completas, sem botão de "mais" (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin') })

  test('Clientes mostra todos', async ({ page }) => {
    await navegar(page, '/clientes')
    await expect(page.locator('button.li').first()).toBeVisible()
    await semBotaoDeMais(page)
  })

  test('Estoque, em cada filtro', async ({ page }) => {
    await navegar(page, '/estoque')
    for (const nome of [/^Disponível/, /^Encomendado/, /^Vendidos/]) { await page.getByRole('button', { name: nome }).click(); await semBotaoDeMais(page) }
  })

  test('Cobranças, em cada aba, e a quantidade de linhas bate com o número da aba', async ({ page }) => {
    await navegar(page, '/cobrancas')
    for (const [nome, re] of [['Atrasadas', /Atrasadas · (\d+)/], ['Esta semana', /Esta semana · (\d+)/], ['Próximas', /Próximas · (\d+)/]] as const) {
      const aba = page.getByRole('button', { name: new RegExp('^' + nome) })
      await aba.click()
      const n = Number(re.exec((await aba.innerText()).replace(/\s+/g, ' '))?.[1] ?? '0')
      await expect(page.locator('[data-cobranca]')).toHaveCount(n)
      await semBotaoDeMais(page)
    }
  })

  test('Operações: iPhones e empréstimos', async ({ page }) => {
    await navegar(page, '/operacoes')
    await semBotaoDeMais(page)
    await page.getByRole('button', { name: /^Empréstimos/ }).click()
    await semBotaoDeMais(page)
  })

  test('uma busca troca a lista inteira (sem resto da lista anterior)', async ({ page }) => {
    await navegar(page, '/cobrancas')
    const linhas = page.locator('[data-cobranca]')
    await expect(linhas.first()).toBeVisible()
    const todas = await linhas.count()
    await page.getByRole('searchbox', { name: /Buscar cliente/ }).fill('zzzxyz')
    await expect(linhas).toHaveCount(0)
    await page.getByRole('searchbox', { name: /Buscar cliente/ }).fill('')
    await expect(linhas).toHaveCount(todas)
    await semBotaoDeMais(page)
  })
})

test('cobrador: o Recebi mostra tudo, sem botão de "mais"', async ({ page }) => {
  await entrar(page, 'cobrador'); await navegar(page, '/recebi')
  await semBotaoDeMais(page)
})

test('indicador: a Cobrança mostra tudo, sem botão de "mais"', async ({ page }) => {
  await entrar(page, 'indicador'); await navegar(page, '/cobranca')
  await expect(page.locator('[data-cobranca]').first()).toBeVisible()
  await semBotaoDeMais(page)
})
