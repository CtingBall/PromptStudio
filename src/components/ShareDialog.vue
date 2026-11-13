<script setup lang="ts">
import { useDragSelect, listSetter } from '../lib/dragSelect'
// Online share: share code (offline, free) or a secret GitHub Gist link (optional).
// Left: pick sets. Right: exactly what the receiver will get.
import { ref, computed, reactive, watch } from 'vue'
import { doc, promptText } from '../lib/store'
import { RATING_LABEL, type PromptSet } from '../lib/types'
import { imgSrc } from '../lib/imagedb'
import { makeShareCode, readShared, publishGist, gistToken, DEFAULT_SHARE, type ShareOpts } from '../lib/share'

const props = defineProps<{ current?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', m: string): void; (e: 'select', id: string): void }>()

const tab = ref<'send' | 'recv'>('send')
const busy = ref('')
const err = ref('')
async function run(label: string, fn: () => Promise<void>) {
  busy.value = label; err.value = ''
  try { await fn() } catch (e: any) { err.value = e?.message || String(e) } finally { busy.value = '' }
}
async function copy(t: string, what: string) {
  try { await navigator.clipboard.writeText(t); emit('toast', `已复制${what}`) } catch { emit('toast', '复制失败，请手动选中复制') }
}

// ---------- shared helpers ----------
const sectionsOf = (s: PromptSet) => [...new Set(s.tags.map((t) => t.section).filter(Boolean))] as string[]
const zhCount = (s: PromptSet) => s.tags.filter((t) => t.zh).length
const short = (t: string, n = 260) => (t.length > n ? t.slice(0, n) + '…' : t)

// ---------- send ----------
const opts = reactive<ShareOpts>({ ...DEFAULT_SHARE, ...JSON.parse(localStorage.getItem('ps-share-opts') || '{}') })
watch(opts, () => { localStorage.setItem('ps-share-opts', JSON.stringify(opts)); code.value = ''; link.value = '' })

const pick = ref<string[]>(props.current ? [props.current] : [])
const focus = ref<string | undefined>(props.current)
const q = ref('')
const list = computed(() => doc.sets.filter((s) => !q.value || s.name.includes(q.value) || s.tags.some((t) => t.en.includes(q.value) || t.zh?.includes(q.value))))
const picked = computed(() => doc.sets.filter((s) => pick.value.includes(s.id)))
const focused = computed(() => doc.sets.find((s) => s.id === focus.value) || picked.value[0])
const ds = useDragSelect()
const setPickId = listSetter(pick)
watch(pick, () => { code.value = ''; link.value = '' })

const summary = computed(() => {
  const ss = picked.value
  return {
    sets: ss.length,
    tags: ss.reduce((n, s) => n + s.tags.length, 0),
    boxes: opts.regions ? ss.reduce((n, s) => n + (s.regions?.length || 0), 0) : 0,
    shots: ss.reduce((n, s) => n + (s.shots?.length || 0), 0),
    nsfw: ss.filter((s) => s.category === 'NSFW').length,
  }
})

const code = ref('')
const link = ref('')
const token = ref(gistToken.get())
const showToken = ref(!token.value)
const genCode = () => run('生成分享码', async () => {
  if (!picked.value.length) throw new Error('先在左边勾选要分享的提示词组')
  code.value = await makeShareCode(picked.value, opts)
  await copy(code.value, '分享码')
})
const genGist = () => run('发布到 Gist', async () => {
  if (!picked.value.length) throw new Error('先在左边勾选要分享的提示词组')
  gistToken.set(token.value)
  link.value = await publishGist(picked.value, picked.value.map((s) => s.name).join(' / ').slice(0, 100), opts)
  showToken.value = false
  await copy(link.value, '链接')
})

// ---------- receive ----------
const input = ref('')
const incoming = ref<PromptSet[]>([])
const take = ref<string[]>([])
const setTake = listSetter(take)
const rfocus = ref<string>()
const rfocused = computed(() => incoming.value.find((s) => s.id === rfocus.value) || incoming.value[0])
const existingNames = computed(() => new Set(doc.sets.map((s) => s.name)))
const parse = () => run('解析', async () => {
  incoming.value = await readShared(input.value)
  if (!incoming.value.length) throw new Error('里面没有提示词组')
  take.value = incoming.value.map((s) => s.id)
  rfocus.value = incoming.value[0].id
})
async function pasteClip() {
  try { input.value = await navigator.clipboard.readText(); if (input.value.trim()) parse() } catch { emit('toast', '无法读取剪贴板，请手动粘贴') }
}
function doImport() {
  const add = incoming.value.filter((s) => take.value.includes(s.id))
  doc.sets.unshift(...add)
  if (add[0]) emit('select', add[0].id)
  emit('toast', `已导入 ${add.length} 组`)
  emit('close')
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal share-modal">
      <div class="row">
        <h3 style="margin: 0">🔗 在线分享</h3>
        <div class="btn-group" style="margin-left: 10px">
          <button :class="{ on: tab === 'send' }" @click="tab = 'send'">分享出去</button>
          <button :class="{ on: tab === 'recv' }" @click="tab = 'recv'">接收分享</button>
        </div>
        <span class="spacer" />
        <button class="ghost" title="关闭" @click="emit('close')">✕</button>
      </div>

      <!-- ================= SEND ================= -->
      <div v-if="tab === 'send'" class="share-body">
        <div class="share-col">
          <div class="row">
            <input v-model="q" placeholder="🔍 搜索名称或标签" style="flex: 1" />
            <button class="ghost sm" @click="pick = pick.length ? [] : list.map((s) => s.id)">{{ pick.length ? '全不选' : '全选' }}</button>
          </div>
          <div class="xfer-list share-list">
            <div v-for="s in list" :key="s.id" :class="['xfer-item', { picked: pick.includes(s.id), focus: focused?.id === s.id }]"
              @click="focus = s.id" @mouseenter="ds.over(s.id)">
              <span class="ck-hit" @mousedown.stop="ds.start($event, s.id, pick.includes(s.id), setPickId); focus = s.id" @click.stop>
                <input type="checkbox" :checked="pick.includes(s.id)" style="width: auto; pointer-events: none" tabindex="-1" /></span>
              <div class="thumb sm-thumb"><img v-if="s.shots?.[0]" :src="imgSrc(s.shots[0].id)" /><span v-else>✦</span></div>
              <div style="flex: 1; min-width: 0">
                <div class="set-name">{{ s.name }}</div>
                <div class="muted share-sub">{{ s.tags.length }} 标签<template v-if="s.regions?.length"> · {{ s.regions.length }} 框</template></div>
              </div>
              <span v-if="s.category" :class="['rtag', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
            </div>
            <p v-if="!list.length" class="muted" style="text-align: center">没有匹配的组</p>
          </div>
        </div>

        <div class="share-col">
          <!-- what the receiver gets -->
          <div class="share-sum">
            <template v-if="summary.sets">
              将分享 <b>{{ summary.sets }}</b> 组 · <b>{{ summary.tags }}</b> 个标签<template v-if="summary.boxes"> · <b>{{ summary.boxes }}</b> 个画框</template>
            </template>
            <span v-else class="muted">← 勾选左边要分享的组（点名字可预览）</span>
          </div>
          <div class="pills share-opts">
            <span class="pill on" title="一定包含">✓ 正向提示词</span>
            <span class="pill on" title="一定包含">✓ 负向词</span>
            <span :class="['pill', opts.zh ? 'on' : 'off']" @click="opts.zh = !opts.zh">{{ opts.zh ? '✓' : '✕' }} 中文翻译</span>
            <span :class="['pill', opts.regions ? 'on' : 'off']" @click="opts.regions = !opts.regions">{{ opts.regions ? '✓' : '✕' }} 画框布局</span>
            <span :class="['pill', opts.meta ? 'on' : 'off']" @click="opts.meta = !opts.meta">{{ opts.meta ? '✓' : '✕' }} 文件夹/标签</span>
            <span class="pill off" title="图片太大，分享码装不下">✕ 返图{{ summary.shots ? `（${summary.shots} 张不含）` : '' }}</span>
            <span class="pill off" title="永不分享">✕ API Key</span>
          </div>
          <p v-if="summary.nsfw" class="warn-line">⚠ 包含 {{ summary.nsfw }} 组 18+ 内容，请确认对方已成年、发布渠道允许。</p>

          <div v-if="focused" class="share-preview">
            <div class="row" style="gap: 6px">
              <strong class="set-name" style="flex: 1">{{ focused.name }}</strong>
              <span v-if="focused.category" :class="['rtag', 'r-' + focused.category]">{{ RATING_LABEL[focused.category] }}</span>
              <span v-if="!pick.includes(focused.id)" class="muted" style="font-size: .86em">（未勾选）</span>
            </div>
            <div class="muted share-sub">
              {{ focused.tags.length }} 标签<template v-if="opts.zh"> · {{ zhCount(focused) }} 有翻译</template>
              <template v-if="sectionsOf(focused).length"> · {{ sectionsOf(focused).length }} 个分段</template>
              <template v-if="opts.regions && focused.regions?.length"> · {{ focused.regions.length }} 框 {{ focused.canvas?.w }}×{{ focused.canvas?.h }}</template>
              <template v-if="opts.meta && focused.folder"> · 📁 {{ focused.folder }}</template>
            </div>
            <div v-if="opts.meta && focused.labels?.length" class="pills" style="margin-top: 4px">
              <span v-for="l in focused.labels" :key="l" class="pill">{{ l }}</span>
            </div>
            <div class="share-label">正向</div>
            <pre class="share-text">{{ short(promptText(focused, true), 600) }}</pre>
            <template v-if="focused.negative">
              <div class="share-label">负向</div>
              <pre class="share-text">{{ short(focused.negative, 200) }}</pre>
            </template>
          </div>

          <div class="section" style="margin-top: 8px">
            <div class="section-head"><h4>① 分享码</h4><span class="muted share-sub">免费、离线；发给对方粘贴即可</span></div>
            <button class="primary" :disabled="!!busy || !picked.length" @click="genCode">生成并复制分享码</button>
            <template v-if="code">
              <textarea :value="code" rows="3" readonly class="out-box" style="margin-top: 6px" @focus="($event.target as HTMLTextAreaElement).select()" />
              <div class="row"><span class="muted share-sub">{{ code.length.toLocaleString() }} 字符{{ code.length > 6000 ? '，偏长，聊天软件可能截断，建议用链接' : '' }}</span>
                <span class="spacer" /><button class="ghost sm" @click="copy(code, '分享码')">再次复制</button></div>
            </template>
          </div>
          <div class="section">
            <div class="section-head"><h4>② 链接（GitHub Gist，可选）</h4><span class="muted share-sub">内容多时用；对方打开不需要账号</span></div>
            <div v-if="showToken" style="display: flex; flex-direction: column; gap: 6px">
              <input v-model="token" type="password" placeholder="GitHub Token（只勾 gist 权限）" />
              <span class="hint" style="margin: 0">github.com → Settings → Developer settings → Personal access tokens，只勾 <b>gist</b>。Token 只存本机，不会被导出。</span>
            </div>
            <div class="row" style="margin-top: 6px">
              <button :disabled="!!busy || !token || !picked.length" @click="genGist">发布并复制链接</button>
              <button v-if="!showToken" class="ghost sm" @click="showToken = true">更换 Token</button>
            </div>
            <div v-if="link" class="row" style="margin-top: 6px">
              <input :value="link" readonly style="flex: 1" />
              <button class="ghost sm" @click="copy(link, '链接')">复制</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= RECEIVE ================= -->
      <div v-else class="share-body">
        <div class="share-col">
          <textarea v-model="input" rows="5" class="out-box" placeholder="粘贴 PS1. 开头的分享码，或 gist.github.com 链接" />
          <div class="row" style="margin-top: 6px">
            <button class="ghost sm" @click="pasteClip">📋 从剪贴板粘贴</button>
            <span class="spacer" />
            <button class="primary" :disabled="!!busy || !input.trim()" @click="parse">解析</button>
          </div>
          <div v-if="incoming.length" class="xfer-list share-list">
            <div v-for="s in incoming" :key="s.id" :class="['xfer-item', { picked: take.includes(s.id), focus: rfocused?.id === s.id }]" @click="rfocus = s.id" @mouseenter="ds.over(s.id)">
              <span class="ck-hit" @mousedown.stop="ds.start($event, s.id, take.includes(s.id), setTake); rfocus = s.id" @click.stop>
                <input type="checkbox" :checked="take.includes(s.id)" style="width: auto; pointer-events: none" tabindex="-1" /></span>
              <div style="flex: 1; min-width: 0">
                <div class="set-name">{{ s.name }}</div>
                <div class="muted share-sub">{{ s.tags.length }} 标签<template v-if="s.regions?.length"> · {{ s.regions.length }} 框</template>
                  <template v-if="existingNames.has(s.name)"> · <span style="color: var(--c-sfw)">同名已存在</span></template></div>
              </div>
              <span v-if="s.category" :class="['rtag', 'r-' + s.category]">{{ RATING_LABEL[s.category] }}</span>
            </div>
          </div>
        </div>
        <div class="share-col">
          <div v-if="rfocused" class="share-preview">
            <div class="row" style="gap: 6px">
              <strong class="set-name" style="flex: 1">{{ rfocused.name }}</strong>
              <span v-if="rfocused.category" :class="['rtag', 'r-' + rfocused.category]">{{ RATING_LABEL[rfocused.category] }}</span>
            </div>
            <div class="muted share-sub">
              {{ rfocused.tags.length }} 标签 · {{ zhCount(rfocused) }} 有翻译
              <template v-if="sectionsOf(rfocused).length"> · {{ sectionsOf(rfocused).length }} 个分段</template>
              <template v-if="rfocused.regions?.length"> · {{ rfocused.regions.length }} 框 {{ rfocused.canvas?.w }}×{{ rfocused.canvas?.h }}</template>
              <template v-if="rfocused.folder"> · 📁 {{ rfocused.folder }}</template>
            </div>
            <div v-if="rfocused.labels?.length" class="pills" style="margin-top: 4px">
              <span v-for="l in rfocused.labels" :key="l" class="pill">{{ l }}</span>
            </div>
            <div class="share-label">正向</div>
            <pre class="share-text">{{ short(promptText(rfocused, true), 900) }}</pre>
            <template v-if="rfocused.negative">
              <div class="share-label">负向</div>
              <pre class="share-text">{{ short(rfocused.negative, 300) }}</pre>
            </template>
          </div>
          <p v-else class="muted" style="text-align: center; margin-top: 40px">解析后在这里预览内容</p>
          <div v-if="incoming.length" class="row" style="margin-top: 8px">
            <span class="hint" style="margin: 0">作为新组导入，不覆盖已有的。</span>
            <span class="spacer" />
            <button class="primary" :disabled="!take.length" @click="doImport">导入 {{ take.length }} 组</button>
          </div>
        </div>
      </div>

      <p v-if="busy" class="muted" style="margin: 6px 0 0">{{ busy }}中…</p>
      <p v-if="err" style="color: var(--danger); margin: 6px 0 0">{{ err }}</p>
    </div>
  </div>
</template>
