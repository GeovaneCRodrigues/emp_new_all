<script setup lang="ts">
import { useCarregando } from '@/composables/useCarregando'

/** O "enviando…" do app todo: trava a tela (não dá para clicar duas vezes) enquanto uma ação vai para a API. */
const { visivel } = useCarregando()
</script>

<template>
  <Teleport to="body">
    <div v-if="visivel" class="carregando" role="status" aria-live="polite" data-testid="carregando">
      <span class="barra" aria-hidden="true" />
      <span class="chip"><span class="giro" aria-hidden="true" />Enviando…</span>
    </div>
  </Teleport>
</template>

<style scoped>
.carregando { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: color-mix(in oklab, var(--bg) 45%, transparent); cursor: progress; }
.barra { position: absolute; top: 0; left: 0; right: 0; height: 3px; overflow: hidden; background: var(--primary-soft); }
.barra::after { content: ''; position: absolute; inset: 0 auto 0 0; width: 40%; background: var(--primary); animation: corre 1.1s ease-in-out infinite; }
.chip { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 14px; background: var(--surface); color: var(--strong); font-size: 14px; font-weight: 600; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); }
.giro { width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid var(--primary-soft); border-top-color: var(--primary); animation: gira 0.7s linear infinite; }
@keyframes corre { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
@keyframes gira { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .giro, .barra::after { animation-duration: 3s; } }
</style>
