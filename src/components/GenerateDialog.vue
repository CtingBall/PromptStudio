<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { generateSet, type GenSection, type GenMode } from '../lib/translate'
import { doc, settings } from '../lib/store'
import { DEFAULT_GEN_PREFIX, DEFAULT_GEN_NEGATIVE, type Region, type Char } from '../lib/types'
import { fileToDataUrl } from '../lib/image'
import LayoutPanel from './LayoutPanel.vue'
import { parseChars, boxesToRegions } from '../lib/layout'

export interface GenPayload {
  name: string
  prefix: string
  sections: GenSection[]
  negative: string[]
  regions?: Region[]
  canvas?: { w: number; h: number }
  chars?: Char[]
}

const props = defineProps<{ initialRaw?: string; initialMode?: GenMode }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'apply', payload: GenPayload): void
}>()

const mode = ref<GenMode>(props.initialMode || 'theme')
const MODES: Array<{ id: GenMode; label: string }> = [
  { id: 'theme', label: '主题生成' },
  { id: 'rewrite', label: '改写原始提示词' },
  { id: 'layout', label: '画框布局' },
]
const theme = ref('')
const raw = ref(props.initialRaw || '')
const scene = ref('')
const regions = reactive<Region[]>([])
const canvas = reactive({ w: 832, h: 1216 })
const temp = ref(0.7)
const busy = ref(false)
const err = ref('')
const showInject = ref(false)
const removed = ref<string[]>([])
const chars = computed(() => parseChars(doc.settings.genChars || ''))

// ---- optional: AI designs a grid layout too (theme / rewrite modes) ----
const autoLayout = ref(localStorage.getItem('ps-auto-layout') === '1')
const autoGrid = ref(8)
const SIZES = [
  { label: '竖 2:3', w: 832, h: 1216 }, { label: '方 1:1', w: 1024, h: 1024 }, { label: '横 3:2', w: 1216, h: 832 },
  { label: '竖 9:16', w: 768, h: 1344 }, { label: '横 16:9', w: 1344, h: 768 },
]
const autoSize = ref(0)
function setAuto(v: boolean) { autoLayout.value = v; localStorage.setItem('ps-auto-layout', v ? '1' : '0') }

// ---- reference images ----
const images = ref<string[]>([])
const fileEl = ref<HTMLInputElement>()
const maxImages = computed(() => Math.min(8, Math.max(1, settings().maxImages || 4)))
const layoutBg = ref(true)
async function addFiles(files: FileList | File[] | null | undefined) {
  if (!files) return
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue
    if (images.value.length >= maxImages.value) { err.value = `最多 ${maxImages.value} 张参考图（可在设置里改）`; break }
    try { images.value.push(await fileToDataUrl(f)) } catch (e: any) { err.value = e?.message || String(e) }
  }
}
function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files || [])
  if (files.length) addFiles(files)
}

function resetInject() {
  doc.settings.genPrefix = DEFAULT_GEN_PREFIX
  doc.settings.genNegative = DEFAULT_GEN_NEGATIVE
  doc.settings.genRules = ''
  doc.settings.banIdentity = true
}

const useAuto = computed(() => autoLayout.value && mode.value !== 'layout')
const mainText = computed(() => (mode.value === 'theme' ? theme.value : mode.value === 'rewrite' ? raw.value : scene.value).trim())
const canRun = computed(() => {
  if (busy.value) return false
  if (mode.value === 'rewrite') return !!raw.value.trim()
  if (mode.value === 'layout') return regions.length > 0 || !!scene.value.trim()
  return !!theme.value.trim() || images.value.length > 0
})

async function run() {
  if (!canRun.value) return
  busy.value = true
  err.value = ''
  removed.value = []
  try {
    const s = settings()
    const r = await generateSet(s.model, {
      mode: mode.value,
      text: mainText.value,
      images: images.value,
      regions: mode.value === 'layout' ? regions : undefined,
      canvas: mode.value === 'layout' ? canvas : useAuto.value ? SIZES[autoSize.value] : undefined,
      autoLayout: useAuto.value,
      grid: autoGrid.value,
      chars: chars.value,
    }, { temperature: temp.value, rules: s.genRules, banIdentity: s.banIdentity })
    if (!r.sections.length) throw new Error('模型没有返回可用的标签，请重试或换个模型')
    removed.value = r.removed
    const neg = [...s.genNegative.split(',').map((t) => t.trim()).filter(Boolean), ...r.negative]
    let outRegions: Region[] | undefined
    let outCanvas: { w: number; h: number } | undefined
    if (mode.value === 'layout' && regions.length) {
      // AI rewrites each box by spec; coords stay as drawn (matched by n)
      outRegions = r.boxes.length ? boxesToRegions(r.boxes, 0, regions)
        : regions.map((g) => ({ ...g }))
      // keep boxes the AI forgot
      for (const g of regions) if (!outRegions.some((x) => x.id === g.id)) outRegions.push({ ...g })
      outCanvas = { ...canvas }
    } else if (useAuto.value && r.boxes.length) {
      outRegions = boxesToRegions(r.boxes, autoGrid.value)
      outCanvas = { w: SIZES[autoSize.value].w, h: SIZES[autoSize.value].h }
    } else if (useAuto.value) {
      err.value = '模型没给布局，已只生成提示词'
    }
    const nameSrc = r.name || mainText.value || (mode.value === 'layout' ? '布局' : '参考图生成')
    emit('apply', {
      name: nameSrc.replace(/\s+/g, ' ').slice(0, 20),
      prefix: s.genPrefix,
      sections: r.sections,
      negative: Array.from(new Map(neg.map((t) => [t.toLowerCase(), t])).values()),
      regions: outRegions,
      canvas: outCanvas,
      chars: chars.value.length ? chars.value : undefined,
    })
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal" :style="{ width: mode === 'layout' ? 'min(980px, 96vw)' : 'min(700px, 94vw)' }" @paste="onPaste">
      <div class="row">
        <h3 style="margin: 0">一键生成提示词</h3>
        <span class="spacer" />
        <button v-for="m in MODES" :key="m.id" :class="mode === m.id ? 'primary' : 'ghost'" @click="mode = m.id">{{ m.label }}</button>
      </div>
      <p class="muted" style="margin: 6px 0">
        输出结构：质量词 + 【Common】【Appearance】【Expression】【Pose】【Outfit】【Atmosphere &amp; Dynamic FX】【Background &amp; Lighting】
      </p>

      <textarea v-if="mode === 'theme'" v-model="theme" rows="3"
        placeholder="描述画面主题，例如「天台边缘坐着的水手服少女，乌鸦群，逆光积云」；也可以只放参考图" />
      <textarea v-else-if="mode === 'rewrite'" v-model="raw" rows="8"
        placeholder="粘贴一组原始提示词（任何格式：逗号标签、自然语言、带权重都行），会整理成上面的分段格式" />
      <template v-else>
        <textarea v-model="scene" rows="2" placeholder="整体画面描述（可选），例如「夜晚废墟，少女站在左侧仰望右上角的满月」" />
        <div style="margin-top: 8px">
          <LayoutPanel :regions="regions" :canvas="canvas" :chars="chars" :background="layoutBg ? images[0] : undefined" />
        </div>
      </template>

      <!-- reference images -->
      <div style="margin-top: 10px">
        <div class="row" style="gap: 6px">
          <strong style="font-size: 13px">参考图</strong>
          <span class="muted" style="font-size: 12px">{{ images.length }}/{{ maxImages }}，可点选或直接 Ctrl+V 粘贴；需要模型支持看图</span>
          <span class="spacer" />
          <label v-if="mode === 'layout' && images.length" class="row muted" style="gap: 4px; font-size: 12px">
            <input v-model="layoutBg" type="checkbox" style="width: auto" />第 1 张作画框底图
          </label>
          <button class="ghost" :disabled="images.length >= maxImages" @click="fileEl?.click()">＋ 添加图片</button>
          <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display: none"
            @change="addFiles(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
        </div>
        <div v-if="images.length" class="row" style="gap: 6px; margin-top: 6px; flex-wrap: wrap">
          <div v-for="(src, i) in images" :key="i" style="position: relative">
            <img :src="src" style="height: 72px; border-radius: 6px; border: 1px solid var(--border)" />
            <button class="ghost danger" style="position: absolute; top: 0; right: 0; padding: 0 5px" @click="images.splice(i, 1)">×</button>
          </div>
        </div>
      </div>

      <div v-if="mode !== 'layout'" class="row wrap" style="margin-top: 10px; gap: 6px">
        <label class="row" style="gap: 6px">
          <input type="checkbox" :checked="autoLayout" style="width: auto" @change="setAuto(($event.target as HTMLInputElement).checked)" />
          同时生成画框布局（可选）
        </label>
        <template v-if="autoLayout">
          <select v-model.number="autoSize" style="width: auto">
            <option v-for="(z, i) in SIZES" :key="i" :value="i">{{ z.label }} {{ z.w }}×{{ z.h }}</option>
          </select>
          <label class="row muted" style="gap: 4px">网格
            <select v-model.number="autoGrid" style="width: auto">
              <option :value="0">自由</option><option :value="4">4×4</option><option :value="8">8×8</option>
              <option :value="12">12×12</option><option :value="16">16×16</option>
            </select></label>
          <span class="muted" style="font-size: 12px">生成后可在「画框布局」里继续拖动调整</span>
        </template>
      </div>

      <div style="margin-top: 10px">
        <label class="muted" style="font-size: 12px">画面角色 / 角色 LoRA（每行一个：名字=触发词，没有 LoRA 只写名字；会按 A、B、C 区分，对话框会对应到说话人）</label>
        <textarea v-model="doc.settings.genChars" rows="2" placeholder="花火=hanabi&#10;狐耳少女=sqxMOSS" />
        <div v-if="chars.length" class="muted" style="font-size: 12px">
          <span v-for="c in chars" :key="c.id" style="margin-right: 10px">{{ c.id }}：{{ c.name }}{{ c.trigger ? '（' + c.trigger + '）' : '' }}</span>
        </div>
      </div>

      <div class="row" style="margin-top: 10px">
        <label class="muted">创意度 {{ temp.toFixed(1) }}</label>
        <input type="range" min="0" max="1" step="0.1" v-model.number="temp" style="flex: 1" />
      </div>

      <div class="row" style="margin-top: 10px">
        <label class="row" style="gap: 6px">
          <input type="checkbox" v-model="doc.settings.banIdentity" style="width: auto" />
          不写发色 / 瞳色 / 耳朵（角色 LoRA 用）
        </label>
        <span class="spacer" />
        <button class="ghost" @click="showInject = !showInject">{{ showInject ? '收起注入设置' : '注入设置…' }}</button>
      </div>

      <div v-if="showInject" style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px">
        <label>
          质量词前缀（固定加在最前面）
          <textarea v-model="doc.settings.genPrefix" rows="2" style="margin-top: 4px" />
        </label>
        <label>
          默认负向词（会和模型给的负向词合并）
          <textarea v-model="doc.settings.genNegative" rows="2" style="margin-top: 4px" />
        </label>
        <label>
          附加规则（每次生成都会注入给模型，例如「画风偏厚涂」「必须 cowboy shot」）
          <textarea v-model="doc.settings.genRules" rows="3" style="margin-top: 4px" />
        </label>
        <div class="row"><span class="spacer" /><button class="ghost" @click="resetInject">恢复默认</button></div>
      </div>

      <p v-if="removed.length" class="muted" style="font-size: 12px">已过滤：{{ removed.join('；') }}</p>
      <p v-if="err" style="color: var(--danger)">{{ err }}</p>
      <div class="row" style="margin-top: 14px">
        <span class="spacer" />
        <button class="ghost" :disabled="busy" @click="emit('close')">取消</button>
        <button class="primary" :disabled="!canRun" @click="run">{{ busy ? '生成中…' : '生成' }}</button>
      </div>
    </div>
  </div>
</template>
