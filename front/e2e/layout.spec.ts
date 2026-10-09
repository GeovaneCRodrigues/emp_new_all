import { expect, test } from '@playwright/test'
import { entrar, sair } from './helpers'

const ROTAS_ADMIN = ['/', '/cobrancas', '/estoque', '/operacoes', '/simulador', '/clientes', '/indicadores']

test.describe('layout', () => {
  test('nenhuma tela do admin passa da largura da janela (sem rolagem lateral)', async ({ page }) => {
    await entrar(page)
    for (const rota of ROTAS_ADMIN) {
      await page.goto(rota)
      await expect(page.locator('h1')).toBeVisible()
      const cabe = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      expect(cabe, `rota ${rota} estourou a largura`).toBe(true)
    }
  })

  test('computador usa o menu lateral; celular usa a barra de baixo', async ({ page, isMobile }) => {
    await entrar(page)
    if (isMobile) {
      await expect(page.locator('nav.tabs')).toBeVisible()
      await expect(page.locator('aside.side')).toBeHidden()
      // botão central em destaque
      await expect(page.locator('nav.tabs .vender')).toBeVisible()
    } else {
      await expect(page.locator('aside.side')).toBeVisible()
      await expect(page.locator('nav.tabs')).toBeHidden()
    }
  })

  test('cada perfil tem o seu menu', async ({ page }) => {
    const menus: Record<string, string[]> = {
      cobrador: ['Hoje', 'Carteira', 'Recebi', 'Caixa', 'Pedidos'],
      vendedor: ['Início', 'Estoque', 'Vender', 'Clientes', 'Vendas'],
      indicador: ['Início', 'Cobrança', 'Indicar', '(Meus )?[Cc]lientes', 'Repasse'], // "Meus clientes" na lateral, "Clientes" na barra de baixo
    }
    for (const [conta, itens] of Object.entries(menus)) {
      await entrar(page, conta as 'cobrador')
      const menu = page.locator('nav.tabs:visible, aside.side:visible')
      // o botão pode trazer um contador junto do nome ("Hoje 3")
      // a ação central é "Vender" na barra de baixo e "Nova venda" na lateral
      for (const item of itens) await expect(menu.getByRole('button', { name: new RegExp(item === 'Vender' ? '^(Vender|Nova venda)' : `^${item}`) }).first()).toBeVisible()
      await sair(page)
      await expect(page).toHaveURL(/\/login$/)
    }
  })

  test('vendedor não vê custo nem lucro no estoque', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/estoque')
    await expect(page.locator('.fone').first()).toBeVisible()
    await expect(page.getByText(/custo/i)).toHaveCount(0)
    await expect(page.getByText(/lucro/i)).toHaveCount(0)
  })

  test('simulador: 7.500 com 1.500 de entrada dá 10x de 1.200', async ({ page }) => {
    await entrar(page)
    await page.goto('/simulador')
    await page.fill('#simEntrada', '150000')
    await expect(page.locator('#simEntrada')).toHaveValue('1.500,00')
    await expect(page.locator('.simtab').getByText('10x R$ 1.200,00')).toBeVisible()
    await expect(page.locator('.simtab').getByText('6x R$ 1.600,00')).toBeVisible()
    await expect(page.locator('.simtab').getByText('5x R$ 1.800,00')).toBeVisible()
  })
})
