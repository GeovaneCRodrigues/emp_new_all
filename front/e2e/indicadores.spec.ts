import { expect, test } from '@playwright/test'
import { entrar } from './helpers'

// o botão "+ Indicador" do conteúdo (o botão de perfil "Indicador" da barra de demonstração tem o mesmo nome)
const novoIndicador = (page: import('@playwright/test').Page) => page.locator('.content').getByRole('button', { name: 'Indicador', exact: true })

test.describe('indicadores', () => {
  test('cadastra com % definido à mão e com % automático', async ({ page }) => {
    await entrar(page)
    await page.goto('/indicadores')
    await page.locator('.abas').getByRole('button', { name: 'Indicadores' }).click()
    await novoIndicador(page).click()
    await page.getByRole('button', { name: 'Cadastrar indicador' }).click()
    await expect(page.getByText('Informe o nome (ao menos 2 letras)')).toBeVisible()

    await page.fill('#iNome', 'Teste Manual')
    await page.fill('#iZap', '11988124410')
    await expect(page.locator('#iZap')).toHaveValue('(11) 98812-4410')
    await page.getByRole('button', { name: '40%' }).click()
    await page.getByRole('button', { name: 'Cadastrar indicador' }).click()
    await expect(page.locator('.fones .card', { hasText: 'Teste Manual' })).toContainText('40%')

    await novoIndicador(page).click()
    await page.fill('#iNome', 'Teste Automatico')
    await page.getByRole('button', { name: 'Automático' }).click()
    await page.getByRole('button', { name: 'Cadastrar indicador' }).click()
    const card = page.locator('.fones .card', { hasText: 'Teste Automatico' })
    await expect(card).toContainText('Bronze')
    await expect(card).toContainText('30%')
  })

  test('cria o acesso: a senha temporária aparece uma vez só', async ({ page }) => {
    await entrar(page)
    await page.goto('/indicadores')
    await page.locator('.abas').getByRole('button', { name: 'Indicadores' }).click()
    await page.locator('.fones .card', { hasText: 'Roberto Indicações' }).click()
    await page.getByRole('button', { name: 'Criar acesso ao sistema' }).click()
    await page.fill('#aMail', 'roberto@teste.com')
    await page.getByRole('button', { name: 'Criar acesso', exact: true }).click()
    await expect(page.getByTestId('senha-temporaria')).toHaveText(/\S{10,}/)
    await page.getByRole('button', { name: 'Já anotei' }).click()

    await page.locator('.fones .card', { hasText: 'Roberto Indicações' }).click()
    await expect(page.getByRole('dialog')).toContainText('Criado')
    await expect(page.getByRole('button', { name: 'Criar acesso ao sistema' })).toHaveCount(0)
    await expect(page.getByTestId('senha-temporaria')).toHaveCount(0)
  })

  test('níveis: recusa tabela sem sentido e salva a válida', async ({ page }) => {
    await entrar(page)
    await page.goto('/indicadores')
    await page.getByRole('button', { name: 'Níveis' }).click()
    await page.fill('#np1', '20') // Prata ganhando menos que Bronze (30%)
    await page.getByRole('button', { name: 'Salvar níveis' }).click()
    await expect(page.getByRole('alert')).toContainText('não pode ganhar menos que o nível anterior')
    await page.fill('#np1', '42')
    await page.getByRole('button', { name: 'Salvar níveis' }).click()
    await expect(page.getByText('Níveis salvos.')).toBeVisible()
  })

  test('desativar marca como inativo', async ({ page }) => {
    await entrar(page)
    await page.goto('/indicadores')
    await page.locator('.abas').getByRole('button', { name: 'Indicadores' }).click()
    await page.locator('.fones .card', { hasText: 'Loja Ponto Cell' }).click()
    await page.getByRole('button', { name: 'Desativar indicador' }).click()
    await expect(page.getByRole('button', { name: 'Reativar indicador' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.fones .card', { hasText: 'Loja Ponto Cell' })).toContainText('inativo')
  })
})
