<script setup lang="ts">
// Result images ("返图") for one prompt set: upload / paste / drop, lightbox,
// read embedded generation parameters, hand images to the AI tools.
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import type { PromptSet } from '../lib/types'
import { doc, touch } from '../lib/store'
import { uid } from '../lib/tags'
import { putImage, deleteImage, imgSrc } from '../lib/imagedb'
import { fileToDataUrl } from '../lib/image'
import { readPngText, parseGenMeta, metaOf, genInfo, infoLine } from '../lib/pngmeta'

const props = defineProps<{ set: PromptSet }>()
const emit = defineEmits<{
  (e: 'review', id: string): void
  (e: 'reverse', id: string): void
  (e: 'import-meta', meta: { positive: string; negative: string; shotId?: string; raw?: string }): void
  (e: 'toast', msg: string): void
}>()

const shots = computed(() => props.set.shots || [])
const fileEl = ref<HTMLInputElement>()
const busy = ref(false)
const hover = ref(false)

async function add(files: FileList | File[] | null | undefined) {
  if (!files) return
  const set = props.set // capture: images must land on this set even if the user switches
  busy.value = true
  try {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      const meta = parseGenMeta(await readPngText(f).catch(() => ({})))
      const id = uid('img')
      await putImage(id, await fileToDataUrl(f, 1600, 0.88))
      ;(set.shots ||= []).push({ id, at: Date.now(), meta: meta?.raw })
    }
    touch(set)
  } catch (e: any) {
    emit('toast', '图片保存失败：' + (e?.message || e))
  } finally {
    busy.value = false
  }
}
function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files || [])
  if (files.length) { e.preventDefault(); add(files) }
}
function onDrop(e: DragEvent) {
  hover.value = false
  add(e.dataTransfer?.files)
}

function remove(id: string) {
  if (!confirm('删除这张返图？')) return
  props.set.shots = shots.value.filter((x) => x.id !== id)
  const used = doc.sets.some((s) => s.shots?.some((x) => x.id === id))
  if (!used) deleteImage(id).catch(() => {})
  if (view.value >= shots.value.length) view.value = shots.value.length - 1
  touch(props.set)
}
function cover(id: string) {
  const i = shots.value.findIndex((x) => x.id === id)
  if (i <= 0) return
  const [m] = props.set.shots!.splice(i, 1)
  props.set.shots!.unshift(m)
  view.value = 0
  touch(props.set)
}

// ---- lightbox ----
const view = ref(-1)
const cur = computed(() => shots.value[view.value])
const curInfo = computed(() => genInfo(cur.value?.meta))
// models / LoRAs used across all result images of this set
const usage = computed(() => {
  const models = new Map<string, number>(), loras = new Map<string, number>()
  for (const s of shots.value) {
    const i = genInfo(s.meta)
    if (!i) continue
    if (i.model) models.set(i.model, (models.get(i.model) || 0) + 1)
    for (const l of i.loras) loras.set(l.name, (loras.get(l.name) || 0) + 1)
  }
  return { models: [...models], loras: [...loras] }
})
async function copyText(t: string, what: string) {
  try { await navigator.clipboard.writeText(t); emit('toast', '已复制' + what) } catch { emit('toast', '复制失败') }
}
const civSearch = (q: string) => 'https://civitai.com/search/models?query=' + encodeURIComponent(q.replace(/^#/, ''))
const curMeta = computed(() => (cur.value?.meta ? metaOf(cur.value.meta) : null))
function key(e: KeyboardEvent) {
  if (view.value < 0) return
  if (e.key === 'Escape') { view.value = -1; return }
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.key === 'ArrowRight') view.value = (view.value + 1) % shots.value.length
  if (e.key === 'ArrowLeft') view.value = (view.value - 1 + shots.value.length) % shots.value.length
}
onMounted(() => window.addEventListener('keydown', key))
onBeforeUnmount(() => window.removeEventListener('keydown', key))
</script>

<template>
  <div class="card" tabindex="0" @paste="onPaste">
    <div class="card-head">
      <strong>🖼 返图</strong>
      <span class="badge">{{ shots.length }}</span>
      <span class="spacer" />
      <button class="ghost sm" :disabled="busy" @click="fileEl?.click()">{{ busy ? '保存中…' : '＋ 上传' }}</button>
      <input ref="fileEl" type="file" accept="image/*" multiple style="display: none"
        @change="add(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
    </div>
    <div v-if="usage.models.length || usage.loras.length" class="usage">
      <span v-for="[m, n] in usage.models" :key="'m' + m" class="pill model-pill" :title="'模型，' + n + ' 张图用过'">🧠 {{ m }}<small v-if="n > 1"> ×{{ n }}</small></span>
      <span v-for="[l, n] in usage.loras" :key="'l' + l" class="pill lora-pill" :title="'LoRA，' + n + ' 张图用过'">🧩 {{ l }}<small v-if="n > 1"> ×{{ n }}</small></span>
    </div>
    <div :class="['drop', { hover }]" @dragover.prevent="hover = true" @dragleave="hover = false" @drop.prevent.stop="onDrop">
      <div v-if="shots.length" class="shot-grid">
        <div v-for="(x, i) in shots" :key="x.id" class="shot" @click="view = i">
          <img v-if="imgSrc(x.id)" :src="imgSrc(x.id)" />
          <span v-if="i === 0" class="shot-badge">封面</span>
          <span v-if="genInfo(x.meta)?.model" class="shot-model" :title="infoLine(genInfo(x.meta)!)">{{ genInfo(x.meta)!.model }}</span>
          <span v-else-if="x.meta" class="shot-badge" style="left: auto; right: 4px">参数</span>
        </div>
      </div>
      <p v-else class="muted" style="text-align: center; margin: 14px 0; font-size: 12px">
        把用这组提示词出的图拖到这里、点上传，或点一下这个区域后 Ctrl+V 粘贴。<br />
        PNG 里带的生成参数（WebUI / ComfyUI / NovelAI）会自动读取。
      </p>
    </div>

    <div v-if="cur" class="modal-mask" @click.self="view = -1">
      <div class="lightbox">
        <img :src="imgSrc(cur.id)" />
        <div class="lb-side">
          <div class="row">
            <span class="muted">{{ view + 1 }} / {{ shots.length }}</span>
            <span class="spacer" />
            <button class="ghost sm" @click="view = (view - 1 + shots.length) % shots.length">←</button>
            <button class="ghost sm" @click="view = (view + 1) % shots.length">→</button>
            <button class="ghost sm" @click="view = -1">✕</button>
          </div>
          <a v-if="/^https:\/\/civitai\./.test(cur.note || '')" :href="cur.note" target="_blank" class="muted" style="font-size: 12px">🌐 C站原图页面</a>
          <textarea v-model="cur.note" class="note-box" rows="3" placeholder="备注：模型 / LoRA / 种子 / 效果…" @change="touch(set)" />
          <button class="primary" @click="emit('review', cur.id); view = -1">✨ AI 对比诊断并给修正版</button>
          <button @click="emit('reverse', cur.id); view = -1">✨ 用这张图反推新提示词组</button>
          <button v-if="curMeta" @click="emit('import-meta', { ...curMeta, shotId: cur.id, raw: cur.meta }); view = -1">📥 用图里的参数新建组</button>
          <button class="ghost" :disabled="view === 0" @click="cover(cur.id)">设为封面</button>
          <button class="ghost danger" @click="remove(cur.id)">删除这张</button>
          <div v-if="curInfo" class="gen-info">
            <div class="muted" style="font-size: 12px">生成信息（{{ curInfo.source }}）</div>
            <dl>
              <template v-if="curInfo.model"><dt>模型</dt><dd><a :href="civSearch(curInfo.model)" target="_blank" title="在 C站搜索这个模型">🧠 {{ curInfo.model }}</a></dd></template>
              <template v-if="curInfo.vae"><dt>VAE</dt><dd>{{ curInfo.vae }}</dd></template>
              <template v-if="curInfo.loras.length"><dt>LoRA</dt><dd><a v-for="l in curInfo.loras" :key="l.name" class="pill lora-pill" :href="civSearch(l.name)" target="_blank" title="在 C站搜索这个 LoRA">🧩 {{ l.name }}<small v-if="l.weight != null"> {{ l.weight }}</small></a></dd></template>
              <template v-if="curInfo.sampler"><dt>采样器</dt><dd>{{ curInfo.sampler }}<span v-if="curInfo.scheduler" class="muted"> / {{ curInfo.scheduler }}</span></dd></template>
              <template v-if="curInfo.steps"><dt>步数</dt><dd>{{ curInfo.steps }}</dd></template>
              <template v-if="curInfo.cfg != null"><dt>CFG</dt><dd>{{ curInfo.cfg }}</dd></template>
              <template v-if="curInfo.size"><dt>尺寸</dt><dd>{{ curInfo.size }}</dd></template>
              <template v-if="curInfo.denoise != null && curInfo.denoise < 1"><dt>重绘幅度</dt><dd>{{ curInfo.denoise }}</dd></template>
              <template v-if="curInfo.seed"><dt>种子</dt><dd><code>{{ curInfo.seed }}</code> <button class="ghost sm" @click="copyText(curInfo.seed!, '种子')">复制</button></dd></template>
            </dl>
            <button class="ghost sm" @click="copyText(infoLine(curInfo), '参数摘要')">复制参数摘要</button>
          </div>
          <div v-if="curMeta" class="meta-box">
            <div class="muted" style="font-size: 12px">图内提示词</div>
            <div><b>正向</b> {{ curMeta.positive }}</div>
            <div v-if="curMeta.negative"><b>负向</b> {{ curMeta.negative }}</div>
            <div v-if="curMeta.params" class="muted">{{ curMeta.params }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
