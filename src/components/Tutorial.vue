<script setup lang="ts">
import { burst } from '../lib/fx'
// Step-by-step guided tour. Shown on first launch and once after each tour version bump.
// Steps with `at` spotlight the element marked data-tour="<at>".
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Icon from './Icon.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'manual'): void }>()
interface Step { title: string; text: string; icon: string; at?: string; art?: string }
const STEPS: Step[] = [
  { title: '欢迎来到千夏绘卷！', icon: 'sakura', art: '/art/welcome.webp',
    text: '我是看板娘千夏～这里是管理 AI 绘画提示词的地方：写标签、自动翻译、一键生成、画框布局、保存返图，一站搞定。花一分钟跟我走一遍吧！' },
  { title: '左边是功能栏', icon: 'compass', at: 'rail',
    text: '一键生成、导入导出、分享、教程、主题和设置都在这里。带小红点的是你还没用过的功能，用过一次红点就会消失。' },
  { title: '一键生成提示词', icon: 'sparkles', at: 'gen',
    text: '用一句话描述想要的画面，或者丢一张参考图，AI 会写出完整的提示词组（标签 / 自然语言 / 标签+自然语言 / GBC 都行）。先在「设置」里填好 API。' },
  { title: '提示词库', icon: 'bookmark', at: 'library',
    text: '所有提示词组都在这里，用法和资源管理器一样：Ctrl / Shift 多选、空白处拖动框选、右键菜单、F2 重命名、Ctrl+X/V 移动，还能新建空文件夹。每组前面的小圆点告诉你它的状态。' },
  { title: '跑过没有？一眼看清', icon: 'rocket', at: 'status',
    text: '🆕 未看：新生成还没打开 · 👀 看过：打开过 · 🚀 跑过：复制过提示词去出图 · 🖼 已出图：传了返图。点这些按钮就能只看某一种状态。' },
  { title: '编辑标签', icon: 'tag', at: 'editor',
    text: '中间是当前提示词组。双击标签改中英文和权重，拖动排序或换分区。顶部的按钮可以翻译、AI 改写、画框布局和复制。' },
  { title: '复制去跑图', icon: 'clipboard', at: 'copy',
    text: '点「复制」把提示词粘到 SD / ComfyUI / MOSS 里出图。复制过的组会自动标成「跑过」。' },
  { title: '返图和 AI 工具', icon: 'picture', at: 'aside',
    text: '出图后把图片拖进右侧「返图」，就会标成「已出图」，还能读出图里的参数。AI 工具可以按一句话修改提示词、看图点评。' },
  { title: '准备好啦！', icon: 'party', art: '/art/done.webp',
    text: '想看更详细的说明，随时点左侧的「教程」重新看这段引导，或者打开「手册」。祝你出图愉快～' },
]
const i = ref(0)
const step = computed(() => STEPS[i.value])
const box = ref<{ x: number; y: number; w: number; h: number } | null>(null)
function locate() {
  const el = step.value.at ? document.querySelector(`[data-tour="${step.value.at}"]`) as HTMLElement | null : null
  if (!el || !el.offsetParent && el.getClientRects().length === 0) { box.value = null; return }
  el.scrollIntoView({ block: 'nearest' })
  const r = el.getBoundingClientRect()
  box.value = { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }
}
watch(i, () => nextTick(locate))
onMounted(() => { nextTick(locate); window.addEventListener('resize', locate); window.addEventListener('keydown', key) })
onBeforeUnmount(() => { window.removeEventListener('resize', locate); window.removeEventListener('keydown', key) })
function go(d: number) { const n = i.value + d; if (n < 0) return; if (n >= STEPS.length) { burst({ x: innerWidth / 2, y: innerHeight / 2 }, 24); return emit('close') } i.value = n }
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
}
// card sits beside the spotlight when there is one, centred otherwise
const cardStyle = computed(() => {
  const b = box.value
  if (!b) return {}
  const W = 380, vw = window.innerWidth, vh = window.innerHeight
  let left = b.x + b.w + 16
  if (left + W > vw - 12) left = b.x - W - 16
  if (left < 12) left = Math.min(vw - W - 12, Math.max(12, b.x))
  const top = Math.min(vh - 300, Math.max(12, left === b.x ? b.y + b.h + 12 : b.y))
  return { left: left + 'px', top: top + 'px', transform: 'none' }
})
</script>

<template>
  <div class="tour">
    <svg class="tour-mask" width="100%" height="100%" @click="go(1)">
      <defs>
        <mask id="tour-hole">
          <rect width="100%" height="100%" fill="white" />
          <rect v-if="box" :x="box.x" :y="box.y" :width="box.w" :height="box.h" rx="14" fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(8,4,16,.62)" mask="url(#tour-hole)" />
    </svg>
    <div v-if="box" class="tour-ring" :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }" />
    <div :key="i" :class="['tour-card', { center: !box }]" :style="cardStyle">
      <img v-if="step.art" :src="step.art" class="tour-art" alt="" />
      <div class="tour-title"><Icon :name="step.icon" :size="26" /><b>{{ step.title }}</b></div>
      <p>{{ step.text }}</p>
      <div class="tour-dots"><span v-for="(_, k) in STEPS" :key="k" :class="{ on: k === i }" @click="i = k" /></div>
      <div class="row">
        <button class="ghost sm" @click="emit('close')">跳过</button>
        <button v-if="i === STEPS.length - 1" class="ghost sm" @click="emit('manual'); emit('close')"><Icon name="book" /> 打开手册</button>
        <span class="spacer" />
        <button v-if="i" class="sm" @click="go(-1)">上一步</button>
        <button class="primary sm" @click="go(1)">{{ i === STEPS.length - 1 ? '开始使用' : '下一步' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 200; }
.tour-mask { position: absolute; inset: 0; }
.tour-ring { position: absolute; border-radius: 14px; border: 2px solid var(--accent); pointer-events: none;
  box-shadow: 0 0 0 4px var(--accent-soft), 0 0 24px var(--accent); transition: all .25s ease; animation: tour-pulse 1.6s infinite; }
@keyframes tour-pulse { 50% { box-shadow: 0 0 0 8px var(--accent-soft), 0 0 30px var(--accent); } }
.tour-card { position: absolute; width: 380px; max-width: calc(100vw - 24px); background: var(--panel); color: var(--text);
  border: 1px solid var(--border2); border-radius: 18px; padding: 16px 18px; box-shadow: var(--shadow); transition: all .25s ease; }
.tour-card { animation: tour-in .3s cubic-bezier(.3,1.4,.5,1); }
@keyframes tour-in { from { opacity: 0; margin-top: 10px } }
.tour-card.center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: 520px; }
.tour-art { width: 100%; border-radius: 12px; margin-bottom: 10px; display: block; max-height: 300px; object-fit: cover; }
.tour-title { display: flex; align-items: center; gap: 8px; font-size: 1.1em; }
.tour-card p { line-height: 1.65; margin: 8px 0 12px; color: var(--text); }
.tour-dots { display: flex; gap: 6px; margin-bottom: 12px; }
.tour-dots span { width: 8px; height: 8px; border-radius: 4px; background: var(--border2); cursor: pointer; transition: all .2s; }
.tour-dots span.on { width: 22px; background: var(--grad); }
</style>
