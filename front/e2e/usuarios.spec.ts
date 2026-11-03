import { expect, test } from '@playwright/test'
import { entrar, navegar } from './helpers'

// pelo nome do próprio card (o card do cobrador também cita o nome dos indicadores que ele atende)
const usuario = (page: import('@playwright/test').Page, nome: string) => page.getByTestId('usuario').filter({ has: page.locator('.val', { hasText: nome }) })

test.describe('usuários', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); await navegar(page, '/usuarios') })

  test('lista todos os acessos com nível, último acesso e situação; o menu tem a entrada Usuários', async ({ page }) => {
    await expect(page.getByTestId('usuario')).toHaveCount(4)
    await expect(usuario(page, 'Diego Ramos').getByTestId('usuario-nivel')).toHaveText('Cobrador')
    await expect(usuario(page, 'Roberto Indicações')).toContainText('Nunca entrou')
    await expect(usuario(page, 'Roberto Indicações').getByTestId('usuario-temporaria')).toBeVisible()
    await expect(usuario(page, 'Geovane').getByTestId('usuario-senha')).toHaveCount(0) // a própria senha não se redefine aqui
    await expect(usuario(page, 'Geovane').getByTestId('usuario-ativo')).toHaveCount(0) // nem se desativa
  })

  test('cria um usuário: a senha temporária aparece uma vez e ele entra na lista', async ({ page }) => {
    await page.getByTestId('usuario-novo').click()
    await page.fill('#uNome', 'Matheus Queiroz')
    await page.fill('#uEmail', 'matheus@loja.com')
    await page.getByRole('button', { name: 'Criar acesso' }).click()
    await expect(page.getByTestId('senha-temporaria')).toContainText('matheus@loja.com')
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(usuario(page, 'Matheus Queiroz')).toContainText('Cobrador')
    await expect(usuario(page, 'Matheus Queiroz').getByTestId('atende')).toContainText('Não atende nenhum indicador')
  })

  test('criar administrador só libera depois de confirmar o acesso total', async ({ page }) => {
    await page.getByTestId('usuario-novo').click()
    await page.fill('#uNome', 'Sócio Novo')
    await page.fill('#uEmail', 'socio@loja.com')
    await page.locator('[data-nivel="ADMIN"]').click()
    const criar = page.getByRole('button', { name: 'Criar acesso' })
    await expect(criar).toBeDisabled()
    await page.getByTestId('usuario-confirma-admin').locator('input').check()
    await expect(criar).toBeEnabled()
    await criar.click()
    await expect(page.getByTestId('senha-temporaria')).toContainText('socio@loja.com')
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(usuario(page, 'Sócio Novo').getByTestId('usuario-nivel')).toHaveText('Administrador')
  })

  test('e-mail repetido mostra o erro na própria folha', async ({ page }) => {
    await page.getByTestId('usuario-novo').click()
    await page.fill('#uNome', 'Outro Diego')
    await page.fill('#uEmail', 'cobrador@demo.com')
    await page.getByRole('button', { name: 'Criar acesso' }).click()
    await expect(page.getByRole('alert')).toContainText('e-mail')
  })

  test('edita nome e e-mail e troca o nível de vendedor para cobrador', async ({ page }) => {
    const bruna = usuario(page, 'Bruna Teixeira')
    await bruna.getByTestId('usuario-editar').click()
    await page.fill('#eEmail', 'bruna.nova@loja.com')
    await page.locator('[data-testid="usuario-editar-form"] [data-nivel="COBRADOR"]').click()
    await expect(page.getByTestId('usuario-editar-form')).toContainText('entra de novo com o menu novo')
    await page.getByTestId('usuario-editar-form').getByRole('button', { name: 'Salvar' }).click()
    await expect(usuario(page, 'Bruna Teixeira')).toContainText('bruna.nova@loja.com')
    await expect(usuario(page, 'Bruna Teixeira').getByTestId('usuario-nivel')).toHaveText('Cobrador')
  })

  test('redefinir senha pede confirmação, mostra a nova uma vez e marca como temporária', async ({ page }) => {
    const diego = usuario(page, 'Diego Ramos')
    await expect(diego.getByTestId('usuario-temporaria')).toHaveCount(0)
    await diego.getByTestId('usuario-senha').click()
    await page.getByTestId('usuario-senha-confirmar').click()
    await expect(page.getByTestId('senha-temporaria')).toContainText('cobrador@demo.com')
    await page.getByRole('button', { name: 'Pronto' }).click()
    await expect(usuario(page, 'Diego Ramos').getByTestId('usuario-temporaria')).toBeVisible()
  })

  test('desativar e reativar um usuário, inclusive o acesso de um indicador', async ({ page }) => {
    for (const nome of ['Bruna Teixeira', 'Roberto Indicações']) {
      const u = usuario(page, nome)
      await u.getByTestId('usuario-ativo').click()
      await expect(u).toContainText('sem acesso')
      await u.getByTestId('usuario-ativo').click()
      await expect(u).not.toContainText('sem acesso')
    }
  })

  test('o cobrador mostra quais indicadores atende; o admin escolhe e o card atualiza', async ({ page }) => {
    const cobrador = usuario(page, 'Diego Ramos')
    await expect(cobrador.getByTestId('atende')).toContainText('Atende:')
    await cobrador.getByTestId('atende-editar').click()
    const form = page.getByTestId('atende-form')
    await expect(form.locator('input[type="checkbox"]')).not.toHaveCount(0)
    await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(1)
    await form.locator('input[type="checkbox"]:checked').uncheck()
    await form.getByTestId('atende-salvar').click()
    await expect(cobrador.getByTestId('atende')).toContainText('Não atende nenhum indicador')
    await cobrador.getByTestId('atende-editar').click()
    await page.getByTestId('atende-form').locator('input[type="checkbox"]').nth(1).check()
    await page.getByTestId('atende-salvar').click()
    await expect(cobrador.getByTestId('atende')).toContainText('Atende:')
    await expect(usuario(page, 'Bruna Teixeira').getByTestId('atende')).toHaveCount(0) // vendedor não tem esse bloco
  })
})
