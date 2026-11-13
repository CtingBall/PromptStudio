<script setup lang="ts">
// Hidden credits. Triggers: the Konami code anywhere (↑↑↓↓←→←→BA), or 7 quick
// clicks on the version text in Settings (that text dispatches 'ps:ver-tap').
import { ref, onMounted, onBeforeUnmount } from 'vue'

const open = ref(false)
const who = String.fromCharCode(0x6c34, 0x5343, 0x590f)
const SEQ = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
let pos = 0
let taps: number[] = []

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  pos = k === SEQ[pos] ? pos + 1 : k === SEQ[0] ? 1 : 0
  if (pos === SEQ.length) { pos = 0; open.value = true }
}
function onTap() {
  const now = Date.now()
  taps = [...taps.filter((x) => now - x < 2500), now]
  if (taps.length >= 7) { taps = []; open.value = true }
}
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('ps:ver-tap', onTap) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('ps:ver-tap', onTap) })
</script>

<template>
  <div v-if="open" class="modal-mask" style="z-index: 90" @click.self="open = false">
    <div class="modal credits">
      <div class="credits-glow">✦</div>
      <h2 style="margin: 4px 0">千夏绘卷 · Chinatsu Scroll</h2>
      <p class="muted" style="margin: 0 0 14px">你发现了隐藏菜单</p>
      <div class="muted" style="font-size: .86em">作者</div>
      <div class="credits-name">{{ who }}</div>
      <button class="primary" style="margin-top: 18px" @click="open = false">好耶</button>
    </div>
  </div>
</template>

<style scoped>
.credits { width: 320px; text-align: center; animation: pop .35s ease-out; }
.credits-glow { font-size: 2.4em; color: var(--accent); animation: spin 6s linear infinite; display: inline-block; }
.credits-name { font-size: 1.8em; font-weight: 700; letter-spacing: .25em; margin-top: 4px; color: var(--accent);
  text-shadow: 0 0 18px var(--accent-soft); }
@keyframes pop { from { transform: scale(.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes spin { to { transform: rotate(360deg) } }
</style>
