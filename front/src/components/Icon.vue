<script setup lang="ts">
import { computed } from 'vue'
import {
  Award, BatteryMedium, CalendarRange, Calculator, ChartNoAxesCombined, ChevronLeft, CircleHelp, ClipboardList, Copy,
  FileSignature, HandCoins, House, Landmark, Layers, LogOut, Menu, Send, KeyRound, MessageCircle, Plus, ReceiptText, Search, Settings, Share2,
  Smartphone, UserCog, Users, Wallet,
} from 'lucide-vue-next'

const ICONES = {
  'award': Award, 'battery-medium': BatteryMedium, 'calendar-range': CalendarRange, 'calculator': Calculator,
  'chart-no-axes-combined': ChartNoAxesCombined, 'chevron-left': ChevronLeft, 'clipboard-list': ClipboardList, 'copy': Copy,
  'file-signature': FileSignature, 'hand-coins': HandCoins, 'house': House, 'landmark': Landmark, 'layers': Layers, 'log-out': LogOut, 'send': Send, 'key-round': KeyRound, 'menu': Menu,
  'message-circle': MessageCircle, 'plus': Plus, 'receipt-text': ReceiptText, 'search': Search, 'settings': Settings,
  'share-2': Share2, 'smartphone': Smartphone, 'user-cog': UserCog, 'users': Users, 'wallet': Wallet,
} as const

const props = defineProps<{ name: string; small?: boolean }>()
const comp = computed(() => (ICONES as Record<string, unknown>)[props.name] ?? CircleHelp)
</script>

<template>
  <component :is="comp" :class="small ? 'icon i-sm' : 'icon'" :size="small ? 15 : 18" aria-hidden="true" />
</template>
