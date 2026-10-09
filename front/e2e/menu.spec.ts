import { expect, test } from '@playwright/test'
import { entrar, sair } from './helpers'

const ehComputador = () => test.info().project.name === 'computador'

test.describe('menu do administrador', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  test('computador: itens em grupos (Dia a dia, Cadastros, Gestão) e Configurações sozinho no rodapé', async ({ page }) => {
    test.skip(!ehComputador(), 'só no computador')
    const lateral = page.locator('aside.side')
    await expect(lateral.locator('.titulo')).toHaveText(['Dia a dia', 'Cadastros', 'Gestão'])
    const ordem = await lateral.locator('[data-menu]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-menu')))
    expect(ordem).toEqual(['inicio', 'cobrancas', 'cronograma', 'caixa', 'simulador', 'clientes', 'estoque', 'operacoes', 'contratos', 'indicadores', 'equipe', 'relatorios', 'config'])
    // Configurações fica logo acima do usuário, depois de todos os grupos
    const conf = await lateral.locator('[data-menu="config"]').boundingBox()
    const rodape = await lateral.locator('.rod').boundingBox()
    const relat = await lateral.locator('[data-menu="relatorios"]').boundingBox()
    expect(conf!.y).toBeGreaterThan(relat!.y)
    expect(conf!.y).toBeLessThan(rodape!.y)
    await expect(lateral.getByRole('button', { name: 'Sair do sistema' })).toHaveCount(1) // o ícone ao lado do nome
    await expect(lateral.locator('.rod')).toContainText('Geovane Cataneo')
  })

  test('o número vermelho da Equipe soma os pedidos e os fechamentos esperando', async ({ page }) => {
    test.skip(!ehComputador(), 'só no computador')
    await expect(page.locator('aside.side [data-menu="equipe"] .cnt')).toHaveText('4') // 3 pedidos + 1 fechamento de exemplo
  })

  test('celular: a barra tem Início, Cobranças, Novo, Estoque e Mais; o Mais mostra os grupos sem repetir a barra', async ({ page }) => {
    test.skip(ehComputador(), 'só no celular')
    const barra = page.locator('nav.tabs')
    for (const n of ['Início', 'Cobranças', 'Novo', 'Estoque', 'Mais']) await expect(barra.getByRole('button', { name: new RegExp('^' + n) }).first()).toBeVisible()
    await barra.getByRole('button', { name: /^Mais/ }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.locator('.mais-grupo')).toHaveText(['Dia a dia', 'Cadastros', 'Gestão'])
    const itens = await dialogo.locator('[data-menu]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-menu')))
    expect(itens).toEqual(['cronograma', 'caixa', 'simulador', 'clientes', 'operacoes', 'contratos', 'indicadores', 'equipe', 'relatorios', 'config'])
    for (const repetido of ['inicio', 'cobrancas', 'estoque']) expect(itens).not.toContain(repetido)
    await expect(dialogo.getByRole('button', { name: 'Sair do sistema' })).toBeVisible()
  })

  test('celular: "Sair do sistema" no fim do Mais leva ao login', async ({ page }) => {
    test.skip(ehComputador(), 'só no celular')
    await sair(page)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('um item do Mais abre a tela e fecha a folha', async ({ page }) => {
    test.skip(ehComputador(), 'só no celular')
    await page.locator('nav.tabs').getByRole('button', { name: /^Mais/ }).click()
    await page.getByRole('dialog').locator('[data-menu="equipe"]').click()
    await expect(page).toHaveURL(/\/equipe$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

for (const conta of ['cobrador', 'vendedor', 'indicador'] as const) {
  test.describe(`menu do ${conta}`, () => {
    test.beforeEach(async ({ page }) => { await entrar(page, conta) })

    test('computador: "Sair do sistema" no fim da lista (sem o ícone ao lado do nome)', async ({ page }) => {
      test.skip(!ehComputador(), 'só no computador')
      const lateral = page.locator('aside.side')
      await expect(lateral.locator('.item.sair')).toHaveText(/Sair do sistema/)
      await expect(lateral.locator('.rod button')).toHaveCount(0)
    })

    test('celular: a bolinha com as iniciais abre "Minha conta" com nome, perfil, login e sair', async ({ page }) => {
      test.skip(ehComputador(), 'só no celular')
      await expect(page.locator('nav.tabs').getByRole('button', { name: /^Mais/ })).toHaveCount(0)
      await page.getByRole('button', { name: 'Minha conta' }).click()
      const d = page.getByRole('dialog')
      await expect(d).toContainText(`${conta}@demo.com`)
      await expect(d.getByRole('button', { name: 'Sair do sistema' })).toBeVisible()
      await d.getByRole('button', { name: 'Sair do sistema' }).click()
      await expect(page).toHaveURL(/\/login$/)
    })
  })
}
