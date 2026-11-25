// Downloads the Fluent Emoji (MIT, Microsoft) flat SVGs used as UI icons into src/assets/icons.
// Run once: node scripts/fetch-icons.mjs   (icons are committed, the app never fetches at runtime)
import fs from 'node:fs'
import path from 'node:path'

const ICONS = {
  sparkles: 'Sparkles', sakura: 'Cherry blossom', tag: 'Label', picture: 'Framed picture',
  palette: 'Artist palette', robot: 'Robot', wand: 'Magic wand', book: 'Open book', gear: 'Gear',
  import: 'Inbox tray', export: 'Outbox tray', link: 'Link', star: 'Star', trash: 'Wastebasket',
  clipboard: 'Clipboard', pencil: 'Pencil', history: 'Mantelpiece clock', ruler: 'Triangular ruler',
  negative: 'Prohibited', eyes: 'Eyes', new: 'New button', camera: 'Camera with flash',
  folder: 'File folder', search: 'Magnifying glass tilted left', translate: 'Globe with meridians',
  bulb: 'Light bulb', party: 'Party popper', heart: 'Sparkling heart', cat: 'Cat face',
  ribbon: 'Ribbon', crystal: 'Crystal ball', puzzle: 'Puzzle piece', moon: 'Crescent moon',
  sun: 'Sun', package: 'Package', refresh: 'Counterclockwise arrows button', warning: 'Warning',
  check: 'Check mark button', plus: 'Plus', shuffle: 'Shuffle tracks button', bookmark: 'Bookmark tabs',
  speech: 'Speech balloon', keyboard: 'Keyboard', scroll: 'Scroll', copy: 'Card index dividers',
  layers: 'Card file box', dango: 'Dango', sparkle_heart: 'Heart with ribbon', lock: 'Locked',
  zoom: 'Magnifying glass tilted right', compass: 'Compass', rocket: 'Rocket', checklist: 'Spiral notepad',
}
const out = path.resolve('src/assets/icons')
fs.mkdirSync(out, { recursive: true })
const bad = []
await Promise.all(Object.entries(ICONS).map(async ([key, name]) => {
  const file = name.toLowerCase().replace(/ /g, '_') + '_flat.svg'
  const url = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${encodeURIComponent(name)}/Flat/${file}`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const svg = (await r.text()).trim()
    if (!svg.startsWith('<svg')) throw new Error('not svg')
    fs.writeFileSync(path.join(out, key + '.svg'), svg + '\n')
  } catch (e) { bad.push(`${key} (${name}): ${e.message}`) }
}))
console.log(`ok ${Object.keys(ICONS).length - bad.length}, failed ${bad.length}`)
if (bad.length) console.log(bad.join('\n'))
