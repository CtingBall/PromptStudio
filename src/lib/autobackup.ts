// Safety net for updates. All user data lives in the browser (localStorage +
// IndexedDB) and survives a folder/version update as long as the origin
// (localhost:5188) is unchanged. The one risk is an accidental data wipe, so on
// the first run of a NEW app version we silently download a full backup file.
import { doc } from './store'
import { exportSets } from './transfer'

const KEY = 'prompt-studio-app-version'

// Current app version, injected by Vite from package.json (see vite.config.ts).
declare const __APP_VERSION__: string
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

// Download a complete backup (every set + its images). Returns the set count.
export async function backupAll(): Promise<number> {
  await exportSets(doc.sets, 'all', false)
  return doc.sets.length
}

// Call once on startup. If the stored app version differs from the running one
// and there is real data, drop a backup file first, then stamp the new version.
// true inside the desktop app (Electron serves the UI from app://)
export const IS_DESKTOP = location.protocol === 'app:'

export async function autoBackupOnUpdate(): Promise<string> {
  const seen = localStorage.getItem(KEY)
  if (seen === APP_VERSION) return ''
  if (IS_DESKTOP) {
    // installer updates keep the data folder; no download dialog needed
    try { localStorage.setItem(KEY, APP_VERSION) } catch {}
    return seen ? `已更新到 ${APP_VERSION}` : '欢迎使用 PromptStudio 桌面版。用过网页版的话：在网页版设置里「备份全部数据」，再在这里点「导入」。'
  }
  let msg = ''
  try {
    if (seen && doc.sets.length) {
      await backupAll()
      msg = `检测到版本更新（${seen} → ${APP_VERSION}），已自动下载一份完整备份。`
    }
  } catch {
    msg = '自动备份失败，建议在设置里手动「备份全部数据」。'
  }
  try { localStorage.setItem(KEY, APP_VERSION) } catch {}
  return msg
}
