import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // os testes de integração compartilham o mesmo banco: arquivos em sequência
    fileParallelism: false,
  },
})
