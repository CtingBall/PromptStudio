<script setup lang="ts">
// Online share: share code (offline, free) or a secret GitHub Gist link (optional).
import { ref, computed } from 'vue'
import { doc } from '../lib/store'
import type { PromptSet } from '../lib/types'
import { makeShareCode, readShared, publishGist, gistToken } from '../lib/share'

const props = defineProps<{ current?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', m: string): void; (e: 'select', id: string): void }>()

const tab = ref<'send' | 'recv'>('send')
const pick = ref<string[]>(props.current ? [props.current] : [])
const q = ref('')
const list = computed(() => doc.sets.filter((s) => !q.value || s.name.includes(q.value)))
const picked = () => doc.sets.filter((s) => pick.value.includes(s.id))
function toggle(id: string) { pick.value = pick.value.includes(id) ? pick.value.filter((x) => x !== id) : [...pick.value, id] }

const busy = ref('')
const err = ref('')
const code = ref('')
const link = ref('')
const token = ref(gistToken.get())
const showToken = ref(!token.value)

async function run(label: string, fn: () => Promise<void>) {
  busy.value = label; err.value = ''
  try { await fn() } catch (e: any) { err.value = e?.message || String(e) } finally { busy.value = '' }
}
async function copy(t: string, what: string) {
  await navigator.clipboard.writeText(t); emit('toast', `已复制${what}`)
}
const genCode = () => run('生成分享码', async () => {
  if (!pick.value.length) throw new Error('先勾选要分享的提示词组')
  code.value = await makeShareCode(picked()); link.value = ''
  await copy(code.value, '分享码')
})
const genGist = () => run('发布到 Gist', async () => {
  if (!pick.value.length) throw new Error('先勾选要分享的提示词组')
  gistToken.set(token.value)
  link.value = await publishGist(picked(), picked().map((s) => s.name).join(' / ').slice(0, 100))
  showToken.value = false
  await copy(link.value, '链接')
})

// ---- receive ----
const input = ref('')
const incoming = ref<PromptSet[]>([])
const take = ref<string[]>([])
const parse = () => run('解析', async () => {
  incoming.value = await readShared(input.value)
  take.value = incoming.value.map((s) => s.id)
  if (!incoming.value.length) throw new Error('里面没有提示词组')
})
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
    <div class="modal" style="width: min(640px, 94vw)">
      <div class="row">
        <h3 style="margin: 0">在线分享</h3>
        <span class="spacer" />
        <div class="btn-group">
          <button :class="{ on: tab === 'send' }" @click="tab = 'send'">分享出去</button>
          <button :class="{ on: tab === 'recv' }" @click="tab = 'recv'">接收分享</button>
        </div>
        <button class="ghost" @click="emit('close')">✕</button>
      </div>
      <p class="hint">只分享提示词、负向词和画框，不含返图和 API Key。</p>

      <template v-if="tab === 'send'">
        <div class="row" style="margin-top: 8px">
          <input v-model="q" placeholder="🔍 筛选" style="flex: 1" />
          <span class="muted">已选 {{ pick.length }}</span>
          <button class="ghost sm" @click="pick = pick.length ? [] : list.map((s) => s.id)">{{ pick.length ? '全不选' : '全选' }}</button>
        </div>
        <div class="xfer-list" style="max-height: 30vh">
          <div v-for="s in list" :key="s.id" :class="['xfer-item', { picked: pick.includes(s.id) }]" @click="toggle(s.id)">
            <input type="checkbox" :checked="pick.includes(s.id)" style="width: auto" @click.stop="toggle(s.id)" />
            <span class="set-name" style="flex: 1">{{ s.name }}</span>
            <span class="muted" style="font-size: .86em">{{ s.tags.length }} 标签</span>
          </div>
        </div>

        <div class="section" style="margin-top: 10px">
          <div class="section-head"><h4>① 分享码</h4><span class="muted" style="font-size: .86em">完全免费、离线；复制后发给别人，对方在「接收分享」里粘贴</span></div>
          <button class="primary" :disabled="!!busy" @click="genCode">生成并复制分享码</button>
          <template v-if="code">
            <textarea :value="code" rows="3" readonly class="out-box" style="margin-top: 6px" @focus="($event.target as HTMLTextAreaElement).select()" />
            <span class="muted" style="font-size: .86em">{{ code.length }} 个字符</span>
          </template>
        </div>

        <div class="section">
          <div class="section-head"><h4>② 链接（GitHub Gist，可选）</h4><span class="muted" style="font-size: .86em">适合内容很多、分享码太长时；对方打开不需要账号</span></div>
          <div v-if="showToken" style="display: flex; flex-direction: column; gap: 6px">
            <input v-model="token" type="password" placeholder="GitHub Token（只勾 gist 权限）" />
            <span class="hint" style="margin: 0">在 github.com → Settings → Developer settings → Personal access tokens 创建，只勾选 <b>gist</b>。Token 只存在本机，不会被导出或分享。</span>
          </div>
          <div class="row" style="margin-top: 6px">
            <button :disabled="!!busy || !token" @click="genGist">发布并复制链接</button>
            <button v-if="!showToken" class="ghost sm" @click="showToken = true">更换 Token</button>
          </div>
          <div v-if="link" class="row" style="margin-top: 6px">
            <input :value="link" readonly style="flex: 1" />
            <button class="ghost sm" @click="copy(link, '链接')">复制</button>
          </div>
        </div>
      </template>

      <template v-else>
        <textarea v-model="input" rows="4" class="out-box" style="margin-top: 8px"
          placeholder="粘贴 PS1. 开头的分享码，或 gist.github.com 链接" />
        <div class="row" style="margin-top: 6px">
          <span class="spacer" />
          <button class="primary" :disabled="!!busy || !input.trim()" @click="parse">解析</button>
        </div>
        <template v-if="incoming.length">
          <div class="xfer-list" style="max-height: 34vh">
            <div v-for="s in incoming" :key="s.id" :class="['xfer-item', { picked: take.includes(s.id) }]"
              @click="take = take.includes(s.id) ? take.filter((x) => x !== s.id) : [...take, s.id]">
              <input type="checkbox" :checked="take.includes(s.id)" style="width: auto; pointer-events: none" />
              <span class="set-name" style="flex: 1">{{ s.name }}</span>
              <span class="muted" style="font-size: .86em">{{ s.tags.length }} 标签{{ s.regions?.length ? ' · ' + s.regions.length + ' 框' : '' }}</span>
            </div>
          </div>
          <div class="row" style="margin-top: 8px">
            <span class="hint" style="margin: 0">导入为新的组，不会覆盖你已有的。</span>
            <span class="spacer" />
            <button class="primary" :disabled="!take.length" @click="doImport">导入 {{ take.length }} 组</button>
          </div>
        </template>
      </template>

      <p v-if="busy" class="muted">{{ busy }}中…</p>
      <p v-if="err" style="color: var(--danger)">{{ err }}</p>
    </div>
  </div>
</template>
