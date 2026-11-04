import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ATRASO_MS, MINIMO_MS, useCarregando } from './useCarregando'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.runAllTimers(); vi.useRealTimers() })

describe('useCarregando (o "enviando…")', () => {
  it('resposta rápida não mostra nada (não pisca)', () => {
    const c = useCarregando()
    const fim = c.iniciar()
    vi.advanceTimersByTime(ATRASO_MS - 1)
    expect(c.visivel.value).toBe(false)
    fim()
    vi.advanceTimersByTime(ATRASO_MS + MINIMO_MS)
    expect(c.visivel.value).toBe(false)
  })
  it('resposta lenta mostra, e depois de terminar fica ao menos o tempo mínimo', () => {
    const c = useCarregando()
    const fim = c.iniciar()
    vi.advanceTimersByTime(ATRASO_MS)
    expect(c.visivel.value).toBe(true)
    vi.advanceTimersByTime(100) // terminou 100 ms depois de aparecer
    fim()
    expect(c.visivel.value).toBe(true)
    vi.advanceTimersByTime(MINIMO_MS - 100 - 1)
    expect(c.visivel.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(c.visivel.value).toBe(false)
  })
  it('se demorou mais que o mínimo, some na hora', () => {
    const c = useCarregando()
    const fim = c.iniciar()
    vi.advanceTimersByTime(ATRASO_MS + MINIMO_MS + 500)
    fim()
    vi.advanceTimersByTime(0)
    expect(c.visivel.value).toBe(false)
  })
  it('várias ações juntas: só some quando a última termina', () => {
    const c = useCarregando()
    const a = c.iniciar(); const b = c.iniciar()
    vi.advanceTimersByTime(ATRASO_MS + MINIMO_MS)
    expect(c.visivel.value).toBe(true)
    a()
    vi.advanceTimersByTime(MINIMO_MS)
    expect(c.visivel.value).toBe(true)
    b()
    vi.advanceTimersByTime(MINIMO_MS)
    expect(c.visivel.value).toBe(false)
  })
  it('encerrar duas vezes a mesma ação não bagunça a contagem', () => {
    const c = useCarregando()
    const a = c.iniciar(); const b = c.iniciar()
    a(); a()
    vi.advanceTimersByTime(ATRASO_MS)
    expect(c.visivel.value).toBe(true) // b ainda está em andamento
    b()
    vi.advanceTimersByTime(MINIMO_MS)
    expect(c.visivel.value).toBe(false)
  })
  it('enquanto(): termina mesmo se a promessa falhar', async () => {
    const c = useCarregando()
    const falha = Promise.reject(new Error('x'))
    await expect(c.enquanto(falha)).rejects.toThrow('x')
    vi.advanceTimersByTime(ATRASO_MS + MINIMO_MS)
    expect(c.visivel.value).toBe(false)
  })
})
