<script setup lang="ts">
defineProps<{ tone?: 'error' | 'success' | 'info' }>();
</script>

<template>
  <div
    :role="tone === 'error' || tone === undefined ? 'alert' : 'status'"
    class="rounded-md border px-3 py-2 text-sm"
    :class="{
      'border-red-200 bg-red-50 text-red-800': tone === 'error' || tone === undefined,
      'border-emerald-200 bg-emerald-50 text-emerald-800': tone === 'success',
      'border-shield-100 bg-shield-50 text-shield-700': tone === 'info',
    }"
  >
    <slot />
  </div>
</template>
