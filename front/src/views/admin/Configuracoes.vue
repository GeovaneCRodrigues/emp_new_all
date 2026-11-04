<script setup lang="ts">
import EmpresaForm from '@/components/EmpresaForm.vue'

/** Configurações do sistema (só o administrador): por enquanto, os dados da empresa. */
</script>

<template>
  <div data-testid="config">
    <div class="card pad" style="margin-bottom: 14px">
      <div class="val">Empresa</div>
      <div class="small">Estes dados valem para o contrato, a página de assinatura do cliente e os recibos. Só o administrador altera.</div>
    </div>
    <EmpresaForm />
  </div>
</template>
