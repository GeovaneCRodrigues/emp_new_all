import { expect, test } from '@playwright/test'
import { botaoNovo, entrar } from './helpers'

test.describe('clientes', () => {
  test('admin vê todos e busca por nome, telefone e CPF', async ({ page }) => {
    await entrar(page)
    await page.goto('/clientes')
    await expect(page.getByText('9 clientes')).toBeVisible()
    await page.getByLabel('Buscar cliente').fill('carlos')
    await expect(page.locator('.li .t')).toHaveText(['Carlos Henrique Souza'])
    await page.getByLabel('Buscar cliente').fill('(11) 99633')
    await expect(page.locator('.li .t')).toHaveText(['Mariana Lopes'])
    await page.getByLabel('Buscar cliente').fill('zzzz')
    await expect(page.getByText('Ninguém encontrado.')).toBeVisible()
  })

  test('cadastra com máscara, recusa CPF inválido e duplicado, e só avisa de telefone repetido', async ({ page }) => {
    await entrar(page)
    await page.goto('/clientes')
    await botaoNovo(page, 'Cliente').click()

    await page.fill('#cNome', 'Marcos Vieira')
    await page.fill('#cFone', '11981112233')
    await expect(page.locator('#cFone')).toHaveValue('(11) 98111-2233')
    await page.fill('#cCpf', '11111111111')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('CPF inválido')).toBeVisible()

    await page.fill('#cCpf', '11144477735')
    await expect(page.locator('#cCpf')).toHaveValue('111.444.777-35')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('10 clientes')).toBeVisible()

    // mesmo CPF de novo: bloqueado, e o formulário continua aberto
    await botaoNovo(page, 'Cliente').click()
    await page.fill('#cNome', 'Outro Nome')
    await page.fill('#cFone', '11977700000')
    await page.fill('#cCpf', '11144477735')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('Já existe um cliente com esse CPF')).toBeVisible()

    // sem CPF e com o telefone de outro cliente: cadastra, mas avisa
    await page.fill('#cCpf', '')
    await page.fill('#cFone', '11981112233')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByRole('status')).toContainText('Já existe um cliente com esse telefone: MARCOS VIEIRA')
  })

  test('abre a ficha, edita e o Esc fecha a folha', async ({ page }) => {
    await entrar(page)
    await page.goto('/clientes')
    await page.locator('.li', { hasText: 'Ricardo Nunes' }).click()
    await expect(page.getByRole('dialog')).toContainText('Ricardo Nunes')
    await page.getByRole('button', { name: 'Editar cadastro' }).click()
    await page.fill('#cEnd', 'Rua das Flores, 120')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await page.locator('.li', { hasText: 'Ricardo Nunes' }).click()
    await expect(page.getByRole('dialog')).toContainText('RUA DAS FLORES, 120')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('formulário recusa nome e telefone vazios, com mensagem em português', async ({ page }) => {
    await entrar(page)
    await page.goto('/clientes')
    await botaoNovo(page, 'Cliente').click()
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('Informe o nome (ao menos 2 letras)')).toBeVisible()
    await expect(page.getByText(/Use DDD \+ número/)).toBeVisible()
  })

  test('vendedor vê só a carteira dele, cadastra na própria carteira e não escolhe responsável', async ({ page }) => {
    await entrar(page, 'vendedor')
    await page.goto('/clientes')
    await expect(page.getByText('4 clientes')).toBeVisible()
    await expect(page.locator('.li .t')).not.toContainText(['Fernanda Almeida'])
    await botaoNovo(page, 'Cliente').click()
    await expect(page.getByText('Responsável (carteira)')).toHaveCount(0)
    await page.fill('#cNome', 'Cliente da Loja')
    await page.fill('#cFone', '11955550000')
    await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
    await expect(page.getByText('5 clientes')).toBeVisible()
  })
})
