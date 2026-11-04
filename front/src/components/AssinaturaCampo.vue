<script setup lang="ts">
import { onMounted, ref } from 'vue'

/** Campo para assinar com o dedo (ou o mouse). Tamanho interno fixo; o desenho é o mesmo em qualquer tela. */
const LARGURA = 800
const ALTURA = 280
const emit = defineEmits<{ mudou: [tem: boolean] }>()

const tela = ref<HTMLCanvasElement | null>(null)
const tem = ref(false)
let desenhando = false
let ultimo: { x: number; y: number } | null = null
let pontos = 0

function ctx() { return tela.value!.getContext('2d')! }
function pintarFundo() {
  const c = ctx()
  c.clearRect(0, 0, LARGURA, ALTURA)
  c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#111'
}
onMounted(pintarFundo)

function ponto(e: PointerEvent) {
  const r = tela.value!.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * LARGURA, y: ((e.clientY - r.top) / r.height) * ALTURA }
}
function comecar(e: PointerEvent) {
  e.preventDefault()
  tela.value!.setPointerCapture(e.pointerId)
  desenhando = true; ultimo = ponto(e)
  const c = ctx(); c.beginPath(); c.arc(ultimo.x, ultimo.y, 1.5, 0, Math.PI * 2); c.fillStyle = '#111'; c.fill()
}
function mover(e: PointerEvent) {
  if (!desenhando || !ultimo) return
  e.preventDefault()
  const p = ponto(e); const c = ctx()
  c.beginPath(); c.moveTo(ultimo.x, ultimo.y); c.lineTo(p.x, p.y); c.stroke()
  ultimo = p; pontos += 1
  if (!tem.value && pontos > 8) { tem.value = true; emit('mudou', true) }
}
function parar() { desenhando = false; ultimo = null }

function limpar() {
  pintarFundo(); tem.value = false; pontos = 0; emit('mudou', false)
}
/** PNG com fundo branco (a assinatura sai legível em qualquer tema e no PDF). */
function exportar(): string {
  const t = document.createElement('canvas'); t.width = LARGURA; t.height = ALTURA
  const c = t.getContext('2d')!
  c.fillStyle = '#fff'; c.fillRect(0, 0, LARGURA, ALTURA); c.drawImage(tela.value!, 0, 0)
  return t.toDataURL('image/png')
}
defineExpose({ exportar, limpar })
</script>

<template>
  <div class="assina">
    <canvas ref="tela" :width="LARGURA" :height="ALTURA" data-testid="assinatura-campo" aria-label="Espaço para assinar" @pointerdown="comecar" @pointermove="mover" @pointerup="parar" @pointercancel="parar" @pointerleave="parar"></canvas>
    <div class="assina-rod">
      <span class="small">{{ tem ? 'Assinatura feita' : 'Assine com o dedo aqui em cima' }}</span>
      <button type="button" class="btn b-ghost b-sm" data-testid="assinatura-limpar" :disabled="!tem" @click="limpar">Limpar</button>
    </div>
  </div>
</template>

<style scoped>
.assina canvas { width: 100%; aspect-ratio: 800 / 280; display: block; background: #fff; border: 1.5px dashed var(--border); border-radius: 12px; touch-action: none; cursor: crosshair; }
.assina-rod { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
</style>
