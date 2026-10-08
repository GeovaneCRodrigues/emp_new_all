import { defineConfig, devices } from '@playwright/test'

const PORTA = 5193

/**
 * Testes de tela: abrem o app de verdade no navegador, no modo demonstração (sem backend),
 * em tela de computador e de celular. Rodar: `npm run e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORTA}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'celular', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: `npx vite --port ${PORTA} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORTA}/login`,
    reuseExistingServer: false,
    // VITE_API_URL vazio = modo demonstração, mesmo que o ambiente tenha a variável
    env: { VITE_API_URL: '' },
    timeout: 60_000,
  },
})
