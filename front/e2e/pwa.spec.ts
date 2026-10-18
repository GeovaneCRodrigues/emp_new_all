import { expect, test } from '@playwright/test'

// O app é instalável: manifesto, ícones e service worker são servidos e ligados na página.
test.describe('app instalável (PWA)', () => {
  test('a página aponta o manifesto e os ícones do iPhone', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png')
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  })

  test('o manifesto abre em tela cheia, com nome e ícones (inclusive o maskable)', async ({ request }) => {
    const r = await request.get('/manifest.webmanifest')
    expect(r.ok()).toBe(true)
    const m = await r.json()
    expect(m).toMatchObject({ name: 'Mundo dos iPhones', display: 'standalone', start_url: '/', lang: 'pt-BR' })
    const tamanhos = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`)
    expect(tamanhos).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
    for (const i of m.icons) {
      const img = await request.get(i.src)
      expect(img.ok(), i.src).toBe(true)
      expect(img.headers()['content-type']).toContain('image/png')
    }
  })

  test('o service worker existe e não guarda os dados da API', async ({ request }) => {
    const r = await request.get('/sw.js')
    expect(r.ok()).toBe(true)
    const js = await r.text()
    expect(js).toContain("startsWith('/api/')") // /api passa direto, sem cache
    expect(js).toContain('fetch')
  })
})
