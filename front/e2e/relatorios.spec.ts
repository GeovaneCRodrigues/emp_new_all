import { expect, test, type Page } from '@playwright/test'
import { entrar, navegar } from './helpers'

// Demonstração: "hoje" é 08/10/2026; o caixa abre com um aporte de R$ 100.000 (01/01/2026).
/** "R$ 1.234,50" → 1234.5; "−R$ 5,00" → -5 (o menos do sistema é o sinal de menos tipográfico). */
const numero = (t: string) => (/^[−-]/.test(t.trim()) ? -1 : 1) * Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
const txt = async (page: Page, id: string) => numero((await page.getByTestId(id).textContent()) ?? '')
const aba = (page: Page, nome: string | RegExp) => page.getByTestId('rel-abas').getByRole('button', { name: nome })
const numeroDe = async (page: Page, seletor: string) => numero((await page.locator(seletor).first().textContent()) ?? '')
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test.describe('relatórios (administrador)', () => {
  test.beforeEach(async ({ page }) => { await entrar(page, 'admin'); await navegar(page, '/relatorios'); await expect(page.getByTestId('rel-abas')).toBeVisible() })

  test('abre no Resumo: barras de 6 meses terminando em outubro, lucro por tipo e modelos que mais vendem', async ({ page }) => {
    const cols = page.getByTestId('rel-resumo').locator('.col')
    await expect(cols).toHaveCount(6)
    await expect(cols.last()).toContainText(/out/i)
    await expect(page.getByTestId('rel-lucro-iphones')).toHaveText(/R\$/)
    await expect(page.getByTestId('rel-lucro-emprestimos')).toHaveText(/R\$/)
    await expect(page.getByTestId('rel-modelos').locator('[data-modelo]').first()).toBeVisible()
  })

  test('Investimento e lucro: três séries por mês e a tabela com o total das duas linhas', async ({ page }) => {
    await aba(page, 'Investimento e lucro').click()
    const painel = page.getByTestId('rel-lucro')
    await expect(painel.locator('.col')).toHaveCount(6)
    await expect(painel.locator('.leg')).toContainText('Investido'); await expect(painel.locator('.leg')).toContainText('Recebido'); await expect(painel.locator('.leg')).toContainText('Seu lucro')
    const celula = async (g: string, i: number) => numero((await page.locator(`[data-grupo="${g}"] td`).nth(i).textContent()) ?? '')
    for (const i of [1, 2, 3, 4]) expect(Math.abs((await celula('iphones', i)) + (await celula('emprestimos', i)) - (await celula('total', i)))).toBeLessThanOrEqual(1)
  })

  test('Capital: as quatro partes somam o total, em porcentagens que fecham', async ({ page }) => {
    await aba(page, 'Capital').click()
    const partes = page.locator('[data-parte]')
    await expect(partes).toHaveCount(4)
    let soma = 0
    for (let i = 0; i < 4; i++) soma += numero((await partes.nth(i).locator('b').textContent()) ?? '')
    expect(Math.abs(soma - (await txt(page, 'rel-capital-total')))).toBeLessThanOrEqual(2)
    await expect(partes.filter({ hasText: 'Em caixa' })).toBeVisible()
  })

  test('Por indicador: a linha "Direto" vem primeiro, e a parte dele mais a sua parte dá o lucro total', async ({ page }) => {
    await aba(page, 'Por indicador').click()
    const linhas = page.getByTestId('rel-indicador').locator('[data-indicador]')
    await expect(linhas.first()).toHaveAttribute('data-indicador', 'direto')
    await expect(linhas.first()).toContainText('sem indicador')
    const n = await linhas.count()
    expect(n).toBeGreaterThan(1)
    for (let i = 0; i < n; i++) {
      const c = linhas.nth(i).locator('td')
      const [total, dele, sua] = [numero((await c.nth(3).textContent()) ?? ''), numero((await c.nth(4).textContent()) ?? ''), numero((await c.nth(5).textContent()) ?? '')]
      expect(Math.abs(total - dele - sua)).toBeLessThanOrEqual(1)
    }
  })

  test('Controle mensal: sete meses de julho a janeiro, com o atraso em vermelho e "—" nos meses que ainda não fecharam', async ({ page }) => {
    await aba(page, 'Controle mensal').click()
    const linhas = page.getByTestId('rel-mensal-tabela').locator('tr[data-mes]')
    await expect(linhas).toHaveCount(7)
    await expect(linhas.first()).toHaveAttribute('data-mes', '2026-07'); await expect(linhas.last()).toHaveAttribute('data-mes', '2027-01')
    await expect(linhas.last().locator('td').last()).toHaveText('—')
    await expect(linhas.first().locator('td').nth(3)).toHaveText('—') // julho fechou sem atraso: traço, não R$ 0
    await expect(page.getByTestId('rel-mensal').locator('.col .hj')).toHaveText(/out/i) // o mês de hoje fica em destaque
    await expect(linhas.first().locator('td').last()).toHaveText(/%/)
  })

  test('Balancete: patrimônio = o que você tem − o que você deve, e o caixa é o saldo da tela Caixa', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const [ativo, passivo, patrimonio, caixa] = [await txt(page, 'rel-ativo'), await txt(page, 'rel-passivo'), await txt(page, 'rel-patrimonio'), await txt(page, 'rel-b-caixa')]
    expect(Math.abs(ativo - passivo - patrimonio)).toBeLessThanOrEqual(0.02)
    await expect(page.getByTestId('rel-aportes')).toContainText('Você colocou R$ 100.000')
    // cresceu ou está abaixo, conforme o patrimônio contra o que foi colocado
    const aportes = numero(((await page.getByTestId('rel-aportes').textContent()) ?? '').match(/colocou (R\$ [\d.,]+)/)![1])
    await expect(page.getByTestId('rel-aportes')).toContainText(patrimonio >= aportes ? 'cresceu' : 'abaixo')
    await navegar(page, '/caixa')
    expect(await txt(page, 'caixa-saldo')).toBe(caixa)
  })

  test('Balancete: o juro de só juros que ainda não venceu fica fora do "a receber" e aparece à parte', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const aReceber = await txt(page, 'rel-b-areceber-emp')
    await expect(page.getByTestId('rel-juros-por-vencer')).toBeVisible()
    const porVencer = numero(((await page.getByTestId('rel-juros-por-vencer').locator('.num').textContent()) ?? ''))
    expect(porVencer).toBeGreaterThan(0)
    // o total do contrato (Operações › Empréstimos) segue mostrando tudo o que o plano prevê: balancete + juro por vencer
    await navegar(page, '/operacoes')
    await page.getByRole('button', { name: /Empréstimos/ }).click()
    const emOperacoes = numero(((await page.locator('.resumo3 .val').first().textContent()) ?? ''))
    expect(Math.abs(aReceber + porVencer - emOperacoes)).toBeLessThanOrEqual(1)
    expect(aReceber).toBeLessThan(emOperacoes)
  })

  test('Previsão: o devido fecha com o "a receber" do Balancete e a conta fecha com o número grande', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const aReceber = await txt(page, 'rel-b-areceber-emp')
    const ativo = await txt(page, 'rel-ativo'), caixa = await txt(page, 'rel-b-caixa')
    await aba(page, 'Previsão').click()
    await expect(page.getByTestId('rel-previsao')).toBeVisible()
    const devido = async () => { let t = 0; for (const g of ['ate7', 'de8a30', 'mais30', 'aVencer']) t += numero(((await page.locator(`[data-grupo="${g}"] td`).nth(2).textContent()) ?? '')); return t }
    // devido (atraso + a vencer) = a receber de vendas + de empréstimos = ativo − caixa − estoque; o estoque aparece na própria aba
    const estoque = numero(((await page.getByTestId('prev-conta').locator('.li').last().locator('.num').textContent()) ?? ''))
    expect(Math.abs((await devido()) - (ativo - caixa - estoque))).toBeLessThanOrEqual(4) // as linhas são arredondadas ao real
    expect(aReceber).toBeGreaterThan(0)
    // os três cenários andam na ordem certa
    const [pess, rea, otim] = [await numeroDe(page, '[data-cenario="pessimista"] .val'), await numeroDe(page, '[data-cenario="realista"] .val'), await numeroDe(page, '[data-cenario="otimista"] .val')]
    expect(pess).toBeLessThan(rea); expect(rea).toBeLessThan(otim)
    expect(Math.abs((await txt(page, 'prev-namao')) - rea)).toBeLessThanOrEqual(1)
  })

  test('Previsão: mudar a perda muda o esperado e o número grande, fica salvo no navegador e "Voltar ao padrão" desfaz', async ({ page }) => {
    await aba(page, 'Previsão').click()
    const antes = await txt(page, 'prev-namao')
    const avencer = await txt(page, 'prev-esperado-aVencer')
    await page.getByTestId('prev-perda-aVencer').fill('50')
    await expect.poll(async () => txt(page, 'prev-esperado-aVencer')).toBeLessThan(avencer)
    expect(await txt(page, 'prev-namao')).toBeLessThan(antes)
    // recarrega a página: o valor continua
    await page.reload(); await expect(page.getByTestId('rel-abas')).toBeVisible(); await aba(page, 'Previsão').click()
    await expect(page.getByTestId('prev-perda-aVencer')).toHaveValue('50')
    await page.getByTestId('prev-padrao').click()
    await expect(page.getByTestId('prev-perda-aVencer')).toHaveValue('5')
    await expect.poll(async () => txt(page, 'prev-namao')).toBe(antes)
  })

  test('Previsão: perda de 100% em tudo não espera receber nada; perda zero espera receber o devido', async ({ page }) => {
    await aba(page, 'Previsão').click()
    const devido = async (g: string) => numero(((await page.locator(`[data-grupo="${g}"] td`).nth(2).textContent()) ?? ''))
    for (const g of ['ate7', 'de8a30', 'mais30', 'aVencer']) await page.getByTestId(`prev-perda-${g}`).fill('100')
    for (const g of ['ate7', 'de8a30', 'mais30', 'aVencer']) expect(await txt(page, `prev-esperado-${g}`), g).toBe(0)
    const rea = await numeroDe(page, '[data-cenario="realista"] .val'), pess = await numeroDe(page, '[data-cenario="pessimista"] .val'), otim = await numeroDe(page, '[data-cenario="otimista"] .val')
    expect(pess).toBe(rea); expect(otim).toBeGreaterThan(rea) // o pessimista não passa de 100%; o otimista (metade) ainda recebe parte
    for (const g of ['ate7', 'de8a30', 'mais30', 'aVencer']) await page.getByTestId(`prev-perda-${g}`).fill('0')
    for (const g of ['ate7', 'de8a30', 'mais30', 'aVencer']) expect(Math.abs((await txt(page, `prev-esperado-${g}`)) - (await devido(g))), g).toBeLessThanOrEqual(1)
  })

  test('Previsão: valor fora de 0 a 100 é limitado e o campo mostra o que a conta usa; vazio volta ao padrão; decimal é mantido', async ({ page }) => {
    await aba(page, 'Previsão').click()
    const campo = page.getByTestId('prev-perda-ate7')
    const devido = numero(((await page.locator('[data-grupo="ate7"] td').nth(2).textContent()) ?? ''))
    await campo.fill('900'); await campo.blur()
    await expect(campo).toHaveValue('100')
    await expect.poll(async () => txt(page, 'prev-esperado-ate7')).toBe(0)
    await campo.fill('-5'); await campo.blur()
    await expect(campo).toHaveValue('0')
    await expect.poll(async () => txt(page, 'prev-esperado-ate7')).toBe(devido)
    await campo.fill(''); await campo.blur() // vazio não vira 0% (o mais otimista): volta ao padrão do grupo
    await expect(campo).toHaveValue('10')
    await campo.fill('2.5'); await campo.blur()
    await expect(campo).toHaveValue('2.5')
    await page.reload(); await expect(page.getByTestId('rel-abas')).toBeVisible(); await aba(page, 'Previsão').click()
    await expect(page.getByTestId('prev-perda-ate7')).toHaveValue('2.5') // não arredonda para 3 ao recarregar
  })

  test('um aporte lançado no Caixa aparece no balancete (patrimônio e "Você colocou")', async ({ page }) => {
    await aba(page, 'Balancete').click()
    const antes = await txt(page, 'rel-patrimonio')
    await navegar(page, '/caixa')
    await page.getByTestId('caixa-lancar').click()
    await page.locator('#lcValor').fill('1000000') // R$ 10.000,00
    await page.getByTestId('lanc-salvar').click()
    await expect(page.getByTestId('lanc-salvar')).toHaveCount(0)
    await navegar(page, '/relatorios'); await aba(page, 'Balancete').click()
    await expect.poll(async () => txt(page, 'rel-patrimonio')).toBe(antes + 10000)
    await expect(page.getByTestId('rel-aportes')).toContainText('Você colocou R$ 110.000')
  })

  test('Lucro e reinvestir: 10% de retirada por padrão, o resto reinveste e a conta fecha', async ({ page }) => {
    await aba(page, 'Lucro e reinvestir').click()
    await expect(page.getByTestId('rei-pct')).toHaveValue('10')
    for (const q of ['realizado', 'previsto']) {
      const lucro = await txt(page, `rei-${q}-lucro`), retirada = await txt(page, `rei-${q}-retirada`), reinvestir = await txt(page, `rei-${q}-reinvestir`)
      expect(Math.abs(lucro - retirada - reinvestir), q).toBeLessThanOrEqual(1)
      expect(Math.abs(retirada - lucro * 0.1), q).toBeLessThanOrEqual(2)
    }
    await expect(page.getByTestId('rei-realizado').locator('[data-mes]')).toHaveCount(6)
    await expect(page.getByTestId('rei-previsto').locator('[data-mes]')).toHaveCount(6)
    expect(await txt(page, 'rei-prev-lucro')).toBeGreaterThan(0)
  })

  test('Lucro e reinvestir: mudar a retirada para 20% refaz a divisão e fica lembrada', async ({ page }) => {
    await aba(page, 'Lucro e reinvestir').click()
    const lucro = await txt(page, 'rei-previsto-lucro')
    await page.getByTestId('rei-pct').fill('20')
    expect(Math.abs((await txt(page, 'rei-previsto-retirada')) - lucro * 0.2)).toBeLessThanOrEqual(2)
    await page.reload(); await aba(page, 'Lucro e reinvestir').click()
    await expect(page.getByTestId('rei-pct')).toHaveValue('20')
  })

  test('Lucro e reinvestir: gráficos de barras empilhadas, acumulado e rosca, e tocar na barra mostra o mês', async ({ page }) => {
    await aba(page, 'Lucro e reinvestir').click()
    const colunas = page.getByTestId('rei-empilhado').locator('.col')
    await expect(colunas.first()).toBeVisible()
    expect(await colunas.count()).toBeGreaterThanOrEqual(7)
    await expect(page.getByTestId('rei-acumulado').locator('polyline')).toHaveCount(2)
    await expect(page.getByTestId('rei-rosca')).toContainText('Você retira')
    await expect(page.getByTestId('rei-rosca')).toContainText('10%')
    // cada barra: retirada + reinvestir = lucro do mês
    const c = colunas.filter({ has: page.locator('[data-parte]') }).nth(2)
    const lucro = Number(await c.getAttribute('data-lucro'))
    const partes = await c.locator('[data-parte]').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight))
    expect(partes.length).toBe(4)
    await c.click()
    await expect(page.getByTestId('rei-detalhe')).toContainText(/lucro/i)
    expect(lucro).toBeGreaterThanOrEqual(0)
    expect(await semRolagemLateral(page)).toBe(true)
  })

  test('a aba escolhida é lembrada ao voltar para a tela', async ({ page }) => {
    await aba(page, 'Capital').click()
    await navegar(page, '/caixa'); await navegar(page, '/relatorios')
    await expect(page.getByTestId('rel-capital')).toBeVisible()
  })

  test('as oito abas abrem sem rolagem lateral na página (as tabelas rolam por dentro)', async ({ page }) => {
    for (const nome of ['Resumo', 'Investimento e lucro', 'Capital', 'Por indicador', 'Controle mensal', 'Previsão', 'Lucro e reinvestir', 'Balancete']) {
      await aba(page, nome).click()
      expect(await semRolagemLateral(page), nome).toBe(true)
    }
  })
})

test.describe('relatórios: só o administrador', () => {
  for (const conta of ['vendedor', 'cobrador', 'indicador'] as const) {
    test(`${conta} não vê os relatórios`, async ({ page }) => {
      await entrar(page, conta); await navegar(page, '/relatorios')
      await expect(page.getByTestId('rel-abas')).toHaveCount(0)
      await expect(page.getByText('Esta tela entra nas próximas etapas.')).toBeVisible()
    })
  }
})
