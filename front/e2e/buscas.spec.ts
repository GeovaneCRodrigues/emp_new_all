import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: clientes Juliana(1), Lucas(2), Fernanda(3), Carlos(4), Mariana(5), Ana Paula Ribeiro(6), Ricardo(7), João(8), Patrícia(9).
// Vendedora Bruna: carteira 1, 2, 5, 9. Empréstimos em andamento: Ricardo, Ana Paula, João, Mariana, Lucas e Patrícia (os dois últimos com o indicador Roberto).
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const campo = (page: Page, nome: string | RegExp) => page.getByRole('searchbox', { name: nome })
const vendas = (page: Page) => page.locator('.fones .card.pad')
const emps = (page: Page) => page.locator('[data-emprestimo]')

test.describe('busca em Operações (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/operacoes') })

  test('iPhones: acha pelo nome sem acento nem maiúscula, e mostra só quem casa', async ({ page }) => {
    const todas = await vendas(page).count()
    expect(todas).toBeGreaterThan(2)
    await campo(page, 'Buscar venda').fill('FERNANDA')
    await expect(vendas(page)).toHaveCount(1)
    await expect(vendas(page).first()).toContainText('Fernanda Almeida')
    await campo(page, 'Buscar venda').fill('ana ribeiro')
    await expect(vendas(page)).toHaveCount(1)
    await expect(vendas(page).first()).toContainText('Ana Paula Ribeiro')
    expect(await semRolagemLateral(page)).toBe(true)
  })

  test('iPhones: acha pelo modelo do aparelho e pelo nome do indicador', async ({ page }) => {
    const todas = await vendas(page).count()
    await campo(page, 'Buscar venda').fill('iphone')
    await expect(vendas(page)).toHaveCount(todas)
    await campo(page, 'Buscar venda').fill('roberto')
    await expect.poll(() => vendas(page).count()).toBeLessThan(todas)
    expect(await vendas(page).count()).toBeGreaterThan(0)
  })

  test('sem resultado avisa; o botão limpar traz a lista de volta', async ({ page }) => {
    const todas = await vendas(page).count()
    await campo(page, 'Buscar venda').fill('zzzxyz')
    await expect(page.getByText('Nada encontrado nesta lista.')).toBeVisible()
    await expect(vendas(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Limpar a busca' }).click()
    await expect(vendas(page)).toHaveCount(todas)
    await expect(campo(page, 'Buscar venda')).toHaveValue('')
  })

  test('a busca vale junto com o filtro de status', async ({ page }) => {
    await campo(page, 'Buscar venda').fill('fernanda')
    await expect(vendas(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Quitadas' }).click()
    await expect(vendas(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Em andamento' }).click()
    await expect(vendas(page)).toHaveCount(1)
  })

  test('os cartões de resumo não mudam com a busca', async ({ page }) => {
    const resumo = page.locator('.resumo3').first()
    const antes = await resumo.innerText()
    await campo(page, 'Buscar venda').fill('fernanda')
    await expect(vendas(page)).toHaveCount(1)
    expect(await resumo.innerText()).toBe(antes)
  })

  test('empréstimos: busca por cliente e por indicador, com campo próprio nessa aba', async ({ page }) => {
    await page.getByRole('button', { name: /Empréstimos/ }).click()
    const todos = await emps(page).count()
    expect(todos).toBeGreaterThan(3)
    await campo(page, 'Buscar empréstimo').fill('RICARDO')
    await expect(emps(page)).toHaveCount(1)
    await expect(emps(page).first()).toContainText('Ricardo Nunes')
    await campo(page, 'Buscar empréstimo').fill('roberto')
    await expect(emps(page)).toHaveCount(2)
    await campo(page, 'Buscar empréstimo').fill('zzzxyz')
    await expect(page.getByText('Nada encontrado nesta lista.')).toBeVisible()
    await page.getByRole('button', { name: 'Limpar a busca' }).click()
    await expect(emps(page)).toHaveCount(todos)
  })

  test('cada aba guarda a sua busca', async ({ page }) => {
    await campo(page, 'Buscar venda').fill('fernanda')
    await expect(vendas(page)).toHaveCount(1)
    await page.getByRole('button', { name: /Empréstimos/ }).click()
    await expect(campo(page, 'Buscar empréstimo')).toHaveValue('')
    await page.getByRole('button', { name: /iPhones/ }).click()
    await expect(campo(page, 'Buscar venda')).toHaveValue('fernanda')
  })
})

test('vendedora: a busca só acha clientes da carteira dela', async ({ page }) => {
  await entrar(page, 'vendedor'); await navegar(page, '/vendas')
  await campo(page, 'Buscar venda').fill('fernanda') // carteira do cobrador
  await expect(page.getByText('Nada encontrado nesta lista.')).toBeVisible()
  await campo(page, 'Buscar venda').fill('juliana')
  await expect(vendas(page)).toHaveCount(1)
})

test.describe('busca em Cobranças, Contratos, Indicadores e Caixa (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin') })

  test('cobranças: filtra por cliente dentro da aba e a soma acompanha', async ({ page }) => {
    await navegar(page, '/cobrancas')
    const linhas = page.locator('[data-cobranca]')
    await expect(linhas.first()).toBeVisible()
    const todas = await linhas.count()
    const antes = await page.getByTestId('cobrancas-total').innerText()
    const primeiro = (await linhas.first().locator('.t').innerText()).trim().split(' ')[0] // o 1º nome de quem aparece primeiro
    await campo(page, 'Buscar cliente').fill(primeiro.toUpperCase())
    await expect.poll(async () => (await linhas.count()) <= todas && (await linhas.filter({ hasNotText: primeiro }).count()) === 0).toBe(true)
    expect(await linhas.count()).toBeGreaterThan(0)
    await campo(page, 'Buscar cliente').fill('zzzxyz')
    await expect(page.getByText('Ninguém com esse nome nesta lista.')).toBeVisible()
    await campo(page, 'Buscar cliente').fill('')
    await expect(page.getByTestId('cobrancas-total')).toHaveText(antes)
    await expect(linhas).toHaveCount(todas)
  })

  test('contratos: acha por cliente (sem acento), por número, e mostra aviso sem resultado', async ({ page }) => {
    await navegar(page, '/contratos'); await expect(page.getByTestId('ct-abas')).toBeVisible()
    const itens = page.getByTestId('ct-lista').locator('[data-contrato]')
    await expect(itens).toHaveCount(9)
    await campo(page, 'Buscar contrato').fill('patricia')
    await expect(itens).toHaveCount(1)
    await expect(itens.first()).toContainText('Patrícia Gomes')
    await campo(page, 'Buscar contrato').fill('2026-')
    await expect(itens).toHaveCount(9)
    await campo(page, 'Buscar contrato').fill('zzzxyz')
    await expect(page.getByTestId('ct-vazio')).toHaveText('Nenhum contrato com essa busca.')
    // os números do topo seguem sendo os de todos os contratos
    await expect(page.getByTestId('ct-assinados')).toHaveText('7')
    await expect(page.getByTestId('ct-esperando')).toHaveText('2')
  })

  test('indicadores: busca nas abas Repasses e Indicadores', async ({ page }) => {
    await navegar(page, '/indicadores')
    await expect(page.locator('[data-repasse]').first()).toBeVisible()
    const todos = await page.locator('[data-repasse]').count()
    await campo(page, 'Buscar indicador').fill('ROBERTO')
    await expect(page.locator('[data-repasse]')).toHaveCount(1)
    await campo(page, 'Buscar indicador').fill('zzzxyz')
    await expect(page.getByText('Nenhum indicador com esse nome.')).toBeVisible()
    await campo(page, 'Buscar indicador').fill('')
    await expect(page.locator('[data-repasse]')).toHaveCount(todos)
    await page.getByRole('button', { name: 'Indicadores', exact: true }).click()
    await campo(page, 'Buscar indicador').fill('ponto')
    await expect(page.locator('.fones .card.pad')).toHaveCount(1)
    await expect(page.locator('.fones .card.pad').first()).toContainText('Loja Ponto Cell')
  })

  test('caixa: filtra o extrato e o saldo continua o de tudo', async ({ page }) => {
    await navegar(page, '/caixa')
    const saldo = await page.getByTestId('caixa-saldo').innerText()
    const extrato = page.getByTestId('caixa-extrato').locator('[data-movimento]')
    const todos = await extrato.count()
    await campo(page, 'Buscar no extrato').fill('SALDO de abertura')
    await expect(extrato).toHaveCount(1)
    await expect(extrato.first()).toContainText('Saldo de abertura')
    expect(await page.getByTestId('caixa-saldo').innerText()).toBe(saldo)
    await campo(page, 'Buscar no extrato').fill('zzzxyz')
    await expect(page.getByText('Nada no extrato com essa busca.')).toBeVisible()
    await page.getByRole('button', { name: 'Limpar a busca' }).click()
    await expect(extrato).toHaveCount(todos)
    expect(await semRolagemLateral(page)).toBe(true)
  })
})

test('indicador: busca nas próprias vendas e empréstimos, e os totais não mudam', async ({ page }) => {
  await entrar(page, 'indicador'); await navegar(page, '/vendas')
  const cartoes = page.getByTestId('minhas-vendas').locator('[data-venda]')
  await expect(cartoes.first()).toBeVisible()
  const todos = await cartoes.count()
  const resumo = await page.getByTestId('resumo-vendas').innerText()
  const nome = (await cartoes.first().locator('.val').first().innerText()).split(' ')[0]
  await campo(page, 'Buscar cliente ou aparelho').fill(nome.toUpperCase())
  expect(await cartoes.count()).toBeGreaterThan(0)
  expect(await cartoes.count()).toBeLessThanOrEqual(todos)
  expect(await page.getByTestId('resumo-vendas').innerText()).toBe(resumo)
  await campo(page, 'Buscar cliente ou aparelho').fill('zzzxyz')
  await expect(page.getByText('Nada encontrado nesta lista.')).toBeVisible()
})
