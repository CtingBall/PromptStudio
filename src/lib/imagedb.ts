// Result images are stored in IndexedDB (localStorage is limited to ~5 MB).
import { reactive } from 'vue'

const DB = 'prompt-studio-images'
const STORE = 'images'
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbp ||= new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => ok(r.result)
    r.onerror = () => bad(r.error)
  })
  return dbp
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((ok, bad) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => ok(req.result as T)
    req.onerror = () => bad(req.error)
  })
}

// id -> data URL, filled lazily for rendering
export const imageCache = reactive<Record<string, string>>({})
const pending = new Set<string>()

export async function putImage(id: string, dataUrl: string): Promise<void> {
  await tx('readwrite', (s) => s.put(dataUrl, id))
  imageCache[id] = dataUrl
}
export async function getImage(id: string): Promise<string | undefined> {
  if (imageCache[id]) return imageCache[id]
  const v = await tx<string | undefined>('readonly', (s) => s.get(id))
  if (v) imageCache[id] = v
  return v
}
export async function deleteImage(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  delete imageCache[id]
}

// Synchronous accessor for templates: returns '' until loaded, then re-renders.
export function imgSrc(id?: string): string {
  if (!id) return ''
  const v = imageCache[id]
  if (v) return v
  if (!pending.has(id)) {
    pending.add(id)
    queueMicrotask(() => getImage(id).finally(() => pending.delete(id)))
  }
  return ''
}
