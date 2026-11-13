// PromptStudio desktop shell (Electron).
// Serves the built web app from dist/ over a private app:// origin (so localStorage /
// IndexedDB persist across updates), forwards /llm/chat to the user's AI endpoint
// (replaces the Vite dev middleware), and auto-updates from GitHub Releases.
const { app, BrowserWindow, protocol, net, shell, dialog, Menu } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

const DEV = process.argv.includes('--dev')
const DIST = path.join(__dirname, '..', 'dist')

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

if (!app.requestSingleInstanceLock()) app.quit()

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

// Same contract as the Vite llmForwarder: x-base-url + x-api-key headers, body = chat request.
async function forward(req) {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const base = String(req.headers.get('x-base-url') || '').replace(/\/+$/, '')
  const key = req.headers.get('x-api-key') || ''
  if (!base) return json(400, { error: 'missing x-base-url (在设置里填 API 地址)' })
  try {
    // net.fetch uses Chromium's network stack → honours the system proxy
    const r = await net.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: Buffer.from(await req.arrayBuffer()),
    })
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') || 'application/json' } })
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) })
  }
}

function serve(req) {
  const url = new URL(req.url)
  if (url.pathname === '/llm/chat') return forward(req)
  if (url.pathname === '/update/check') return manualCheck()
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'
  const file = path.normalize(path.join(DIST, rel))
  if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 })
  return net.fetch(pathToFileURL(file).toString())
}

let win = null
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 600,
    show: false, backgroundColor: '#1b1d22', title: '千夏绘卷',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  // links (gist, docs…) open in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith('http://localhost:5188')) { e.preventDefault(); shell.openExternal(url) }
  })
  win.loadURL(DEV ? 'http://localhost:5188' : 'app://local/')
}

let updater = null
let downloaded = ''
// Called from the settings page (「检查更新」). Downloads in the background; the
// update-downloaded dialog then offers a restart.
async function manualCheck() {
  const current = app.getVersion()
  if (!updater) return json(200, { state: 'dev', current })
  if (downloaded) {
    setTimeout(() => updater.emit('update-downloaded', { version: downloaded }), 50)
    return json(200, { state: 'downloaded', current, version: downloaded })
  }
  try {
    const r = await updater.checkForUpdates()
    const v = r && r.updateInfo && r.updateInfo.version
    if (r && r.isUpdateAvailable === false) return json(200, { state: 'latest', current })
    if (v && v !== current) return json(200, { state: 'available', current, version: v })
    return json(200, { state: 'latest', current })
  } catch (e) {
    return json(200, { state: 'error', current, error: String((e && e.message) || e) })
  }
}

function setupUpdater() {
  if (DEV || !app.isPackaged) return
  const { autoUpdater } = require('electron-updater')
  updater = autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', async (info) => {
    downloaded = info.version
    const r = await dialog.showMessageBox(win, {
      type: 'info', title: '发现新版本', buttons: ['立即重启更新', '稍后（退出时自动更新）'], defaultId: 0, cancelId: 1,
      message: `千夏绘卷 ${info.version} 已下载好`, detail: '重启后完成更新，你的提示词和图片都不会丢失。',
    })
    if (r.response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', () => {}) // offline / GitHub unreachable: stay quiet
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, 4 * 3600 * 1000)
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('app', serve)
  createWindow()
  setupUpdater()
})

app.on('window-all-closed', () => app.quit())
