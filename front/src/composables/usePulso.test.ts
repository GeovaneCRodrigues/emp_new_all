import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePulso } from './usePulso'

// o ambiente de teste é Node: um `document` mínimo, só com o que o usePulso usa
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
vi.stubGlobal('document', doc)
const visivel = (v: boolean) => { doc.visibilityState = v ? 'visible' : 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) }

describe('usePulso', () => {
  beforeEach(() => { vi.useFakeTimers(); doc.visibilityState = 'visible' })
  afterEach(() => { vi.useRealTimers() })

  it('roda a cada intervalo com a aba visível', () => {
    const fn = vi.fn(); const fim = usePulso(fn, 1000)
    vi.advanceTimersByTime(3000); expect(fn).toHaveBeenCalledTimes(3); fim()
  })
  it('para com a aba escondida e roda na hora ao voltar', () => {
    const fn = vi.fn(); const fim = usePulso(fn, 1000)
    visivel(false); vi.advanceTimersByTime(5000); expect(fn).toHaveBeenCalledTimes(0)
    visivel(true); expect(fn).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(2); fim()
  })
  it('depois de parado não roda mais; erro da função não quebra', async () => {
    const fn = vi.fn(() => { throw new Error('x') }); const fim = usePulso(fn, 1000)
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(1)
    fim(); vi.advanceTimersByTime(5000); expect(fn).toHaveBeenCalledTimes(1)
  })
})
