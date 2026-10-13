<script setup lang="ts">
import { computed } from 'vue'
import {
  Award, BatteryMedium, CalendarRange, Calculator, ChartNoAxesCombined, ChevronLeft, CircleHelp, ClipboardList, Copy,
  FileSignature, HandCoins, House, Landmark, Layers, LogOut, Menu, Send, KeyRound, Check, UserPlus, MessageCircle, Plus, ReceiptText, Search, Settings, Share2,
  Smartphone, UserCog, Users, Wallet, X, ChevronRight, CalendarDays, Handshake, Inbox, BadgeDollarSign, ArrowDownLeft, ArrowUpRight,
} from 'lucide-vue-next'

const ICONES = {
  'arrow-down-left': ArrowDownLeft, 'arrow-up-right': ArrowUpRight,
  'badge-dollar-sign': BadgeDollarSign,
  'award': Award, 'battery-medium': BatteryMedium, 'calendar-range': CalendarRange, 'calculator': Calculator,
  'chart-no-axes-combined': ChartNoAxesCombined, 'chevron-left': ChevronLeft, 'clipboard-list': ClipboardList, 'copy': Copy,
  'file-signature': FileSignature, 'hand-coins': HandCoins, 'house': House, 'landmark': Landmark, 'layers': Layers, 'log-out': LogOut, 'send': Send, 'key-round': KeyRound, 'check': Check, 'user-plus': UserPlus, 'menu': Menu,
  'message-circle': MessageCircle, 'plus': Plus, 'receipt-text': ReceiptText, 'search': Search, 'settings': Settings,
  'share-2': Share2, 'smartphone': Smartphone, 'user-cog': UserCog, 'users': Users, 'wallet': Wallet, 'x': X, 'chevron-right': ChevronRight, 'calendar-days': CalendarDays, 'handshake': Handshake, 'inbox': Inbox,
} as const

const props = defineProps<{ name: string; small?: boolean }>()
const comp = computed(() => (ICONES as Record<string, unknown>)[props.name] ?? CircleHelp)
</script>

<template>
  <component :is="comp" :class="small ? 'icon i-sm' : 'icon'" :size="small ? 15 : 18" aria-hidden="true" />
</template>
