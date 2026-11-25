// "What have I run / looked at" — per-set status marks + which features the user has tried.
import { reactive, watch } from 'vue'
import type { PromptSet } from './types'

// ---- set status ----
// new: generated/imported and never opened · seen: opened · copied: prompt copied out to run · shot: has result images
export type SetStatus = 'new' | 'seen' | 'copied' | 'shot'
export const STATUS_INFO: Record<SetStatus, { label: string; icon: string; hint: string }> = {
  new: { label: '未看', icon: 'new', hint: '新生成或导入后还没打开过' },
  seen: { label: '看过', icon: 'eyes', hint: '打开看过，但还没复制去跑' },
  copied: { label: '跑过', icon: 'rocket', hint: '复制过提示词（拿去跑图了），还没传返图' },
  shot: { label: '已出图', icon: 'picture', hint: '已经上传了返图' },
}
export const STATUS_ORDER: SetStatus[] = ['new', 'seen', 'copied', 'shot']

export function setStatus(s: PromptSet): SetStatus {
  if (s.shots?.length) return 'shot'
  if (s.copiedAt) return 'copied'
  if (s.seenAt) return 'seen'
  return 'new'
}
// opening a set marks it seen (only the first time, keeps updatedAt untouched)
export function markSeen(s?: PromptSet) { if (s && !s.seenAt) s.seenAt = Date.now() }
export function markCopied(s?: PromptSet) { if (s) { s.copiedAt = Date.now(); s.seenAt ||= s.copiedAt } }

// ---- feature discovery: red dot on features never used ----
export const FEATURES = {
  gen: '一键生成', layout: '画框布局', aiEdit: 'AI 修改', shot: '上传返图', share: '分享',
  history: '版本历史', random: '随机抽一组', bulk: '批量管理', explorer: '文件夹视图', export: '导入导出',
  rewrite: 'AI 改写格式', review: 'AI 看图点评', theme: '切换主题',
} as const
export type Feature = keyof typeof FEATURES
const KEY = 'ps-used-features'
function load(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} }
}
export const used = reactive<Record<string, number>>(load())
watch(used, () => { try { localStorage.setItem(KEY, JSON.stringify(used)) } catch {} }, { deep: true })
export function markUsed(f: Feature) { if (!used[f]) used[f] = Date.now() }
export const isNew = (f: Feature) => !used[f]
export const unusedCount = () => (Object.keys(FEATURES) as Feature[]).filter(isNew).length
