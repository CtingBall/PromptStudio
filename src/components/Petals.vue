<script setup lang="ts">
// A few sakura petals drifting across the background. Pure CSS animation,
// pointer-events off, hidden by Settings → 外观 → 飘落樱花 / 动画效果.
const petals = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 7.3 + Math.random() * 6) % 100,
  size: 8 + Math.random() * 9,
  dur: 14 + Math.random() * 14,
  delay: -Math.random() * 28,
  sway: 30 + Math.random() * 60,
  op: 0.25 + Math.random() * 0.35,
}))
</script>

<template>
  <div class="petals" aria-hidden="true">
    <i v-for="(p, i) in petals" :key="i" :style="{
      left: p.left + '%', width: p.size + 'px', height: p.size * 0.8 + 'px', opacity: p.op,
      animationDuration: p.dur + 's, ' + p.dur / 3 + 's', animationDelay: p.delay + 's, ' + p.delay + 's',
      '--sway': p.sway + 'px' }" />
  </div>
</template>

<style scoped>
.petals { position: fixed; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
.petals i {
  position: absolute; top: -20px; display: block;
  background: radial-gradient(circle at 30% 30%, #ffe3ee, #ff9ec4 70%);
  border-radius: 80% 0 80% 0;
  animation-name: fall, sway; animation-timing-function: linear, ease-in-out;
  animation-iteration-count: infinite, infinite; animation-direction: normal, alternate;
}
@keyframes fall { to { transform: translateY(110vh) rotate(540deg); } }
@keyframes sway { to { margin-left: var(--sway); } }
:global([data-theme='light']) .petals i { filter: saturate(1.2); }
:global([data-theme='dark']) .petals i, :global([data-theme='warm']) .petals i { filter: brightness(1.1); }
</style>
