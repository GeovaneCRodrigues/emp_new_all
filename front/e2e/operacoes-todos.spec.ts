import { expect, test } from '@playwright/test'
import { entrar, navegar } from './helpers'

const lista = (page: import('@playwright/test').Page) => page.getByTestId('lista-todos')
const vendas = (page: import('@playwright/test').Page) => lista(page).locator('.card.pad:not([data-emprestimo])')
const emps = (page: import('@playwright/test').Page) => lista(page).locator('[data-emprestimo]')

test.describe('Operações › Todos (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/operacoes') })

  test('abre em Todos, com as três abas, e mostra iPhones e empréstimos juntos', async ({ page }) => {
    const abas = page.locator('.abas button')
    await expect(abas).toHaveText([/Todos/, /iPhones/, /Empréstimos/])
    await expect(abas.first()).toHaveClass(/on/)
    await expect(emps(page).first()).toBeVisible()
    expect(await vendas(page).count()).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test('o total de Todos é a soma de iPhones e empréstimos', async ({ page }) => {
    const n = async () => { await expect(emps(page).first()).toBeVisible(); return (await vendas(page).count()) + (await emps(page).count()) }
    const todos = await n()
    await page.getByRole('button', { name: /^iPhones/ }).click()
    const soIphone = await page.locator('.fones .card.pad').count()
    await page.getByRole('button', { name: /^Empréstimos/ }).click()
    await expect(page.locator('[data-emprestimo]').first()).toBeVisible()
    expect(soIphone + (await page.locator('[data-emprestimo]').count())).toBe(todos)
  })

  test('a busca vale para os dois; o filtro também', async ({ page }) => {
    await expect(emps(page).first()).toBeVisible()
    const campo = page.getByRole('searchbox', { name: 'Buscar operação' })
    await campo.fill('roberto') // indicador dos dois tipos na demonstração
    await expect.poll(async () => (await vendas(page).count()) > 0 && (await emps(page).count()) > 0).toBe(true)
    await campo.fill('zzzxyz')
    await expect(page.getByText('Nada encontrado nesta lista.')).toBeVisible()
    await campo.fill('')
    await expect(emps(page).first()).toBeVisible()
    await page.getByRole('button', { name: 'Quitados' }).click()
    await expect.poll(async () => (await vendas(page).count()) + (await emps(page).count())).toBeGreaterThanOrEqual(0)
    await page.getByRole('button', { name: 'Em andamento' }).click()
    await expect(emps(page).first()).toBeVisible()
  })

  test('tocar num empréstimo e num iPhone abre a ficha de cada um', async ({ page }) => {
    await expect(emps(page).first()).toBeVisible()
    await emps(page).first().click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await vendas(page).first().click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
  })

  test('o botão Empréstimo abre o formulário', async ({ page }) => {
    await page.getByRole('button', { name: /Empréstimo$/ }).click()
    await expect(page.getByText(/Novo empréstimo/i).first()).toBeVisible()
  })
})

test('vendedor: só iPhones, sem aba Todos', async ({ page }) => {
  await entrar(page, 'vendedor'); await navegar(page, '/vendas')
  await expect(page.getByRole('button', { name: /^Todos/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Empréstimos/ })).toHaveCount(0)
})

test('as abas não mostram barra de rolagem', async ({ page }) => {
  await entrar(page, 'admin'); await navegar(page, '/operacoes')
  const sobra = await page.locator('.abas').evaluate((e) => e.offsetWidth - e.clientWidth)
  expect(sobra).toBe(0)
})
