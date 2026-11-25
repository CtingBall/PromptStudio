<script setup lang="ts">
// Anime-style colour icons (Fluent Emoji Flat, MIT © Microsoft), bundled from src/assets/icons.
const files = import.meta.glob('../assets/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const MAP: Record<string, string> = {}
for (const [p, url] of Object.entries(files)) MAP[p.slice(p.lastIndexOf('/') + 1, -4)] = url
defineProps<{ name: string; size?: number | string }>()
</script>

<template>
  <img v-if="MAP[name]" :src="MAP[name]" class="ico" alt="" draggable="false"
    :style="size ? { width: typeof size === 'number' ? size + 'px' : size, height: typeof size === 'number' ? size + 'px' : size } : undefined" />
</template>
