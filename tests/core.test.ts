// Run: npm test  (Node 22.6+ built-in runner, TS stripped natively; no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promptFormat, promptKey, parseOne, tagsFromPrompt, serializeTags, sanitizeIdentity, groupTags } from '../src/lib/tags.ts'
import { parseChars, parseLayout, charBoxDesc, textBoxDesc } from '../src/lib/layout.ts'
import { parseGenMeta } from '../src/lib/pngmeta.ts'
import { mossJson, gbcText } from '../src/lib/comfy.ts'
import { fmtDate } from '../src/lib/date.ts'

const noZh = () => ''

test('parseOne weights', () => {
  assert.deepEqual(parseOne('tag'), { en: 'tag', weight: 1 })
  assert.deepEqual(parseOne('(tag:1.3)'), { en: 'tag', weight: 1.3 })
  assert.deepEqual(parseOne('((tag:1.4))'), { en: 'tag', weight: 1.4 })
  assert.equal(parseOne('((tag))').weight, 1.21)
  assert.equal(parseOne('[tag]').weight, 0.91)
})

test('sections round-trip', () => {
  const src = '【Subject & Shot】\n1girl, solo, (from below:1.2),\n【Outfit】\nserafuku, loafers.'
  const tags = tagsFromPrompt(src, noZh)
  assert.deepEqual(tags.map((t) => t.section), ['Subject & Shot', 'Subject & Shot', 'Subject & Shot', 'Outfit', 'Outfit'])
  assert.equal(tags[4].en, 'loafers')
  assert.equal(groupTags(tags).length, 2)
  assert.equal(serializeTags(tags, false), '1girl, solo, (from below:1.2), serafuku, loafers')
  assert.deepEqual(tagsFromPrompt(serializeTags(tags, true), noZh).map((t) => [t.en, t.weight, t.section]),
    tags.map((t) => [t.en, t.weight, t.section]))
})

test('identity filter', () => {
  assert.equal(sanitizeIdentity('red eyes'), null)
  assert.equal(sanitizeIdentity('fox ears'), null)
  assert.equal(sanitizeIdentity('heterochromia'), null)
  assert.equal(sanitizeIdentity('long black hair fluttering'), 'long hair fluttering')
  assert.equal(sanitizeIdentity('long hair'), 'long hair')
  assert.equal(sanitizeIdentity('black hair ribbon'), 'black hair ribbon')
  assert.equal(sanitizeIdentity('serafuku'), 'serafuku')
  assert.equal(sanitizeIdentity('silver-haired'), null)
})

test('parseChars', () => {
  const c = parseChars('花火=hanabi | 1girl | black frilled dress\n狐耳少女：sqxMOSS\n\n')
  assert.equal(c.length, 2)
  assert.deepEqual(c[0], { id: 'A', name: '花火', trigger: 'hanabi', guide: '1girl', outfit: 'black frilled dress' })
  assert.equal(c[1].trigger, 'sqxMOSS')
  assert.equal(c[1].guide, undefined)
})

test('parseLayout scales, clamps and filters', () => {
  const b = parseLayout([
    { n: 1, kind: 'char', cid: 'a', x: 100, y: 0, w: 400, h: 900, desc: 'standing' },
    { kind: 'text', x: 0.1, y: 0.1, w: 0.2, h: 0.1 },                 // text without text → dropped
    { kind: 'obj', x: 0, y: 0, w: 1, h: 1, desc: 'background' },       // full-canvas obj → dropped
    { kind: 'obj', x: 0.9, y: 0.9, w: 0.5, h: 0.5, desc: 'cat' },      // clamped to canvas
  ])
  assert.equal(b.length, 2)
  assert.equal(b[0].x, 0.1); assert.equal(b[0].cid, 'A')
  assert.ok(Math.abs(b[1].w - 0.1) < 1e-9)
})

test('char / text box descriptions', () => {
  const chars = parseChars('花火=hanabi | 1girl | black dress')
  const ch = { id: 'r1', x: 0, y: 0, w: 0.5, h: 1, text: 'hanabi, waving', kind: 'char' as const, cid: 'A' }
  assert.equal(charBoxDesc(ch, chars), 'hanabi, 1girl, wearing black dress, waving')
  const tx = { id: 'r2', x: 0, y: 0, w: 0.2, h: 0.1, text: 'Hi!', kind: 'text' as const, speaker: 'A', desc: 'speech bubble' }
  assert.equal(textBoxDesc(tx, [ch, tx], chars), 'speech bubble, spoken by the character in box 1 (hanabi)')
})

test('PNG params parsing (A1111)', () => {
  const m = parseGenMeta({ parameters: '1girl, solo\nNegative prompt: bad hands\nSteps: 28, Sampler: Euler' })
  assert.ok(m)
  assert.equal(m!.positive, '1girl, solo')
  assert.equal(m!.negative, 'bad hands')
})

test('MOSS JSON uses centered yxyx pixels', () => {
  const set: any = { canvas: { w: 1000, h: 1000 }, regions: [{ id: 'r', x: 0, y: 0, w: 0.5, h: 0.5, text: 'a cat' }] }
  const j = JSON.parse(mossJson(set, 'cap'))
  assert.equal(j.bbox_format, 'yxyx')
  assert.deepEqual(j.items[0].bbox, [-500, -500, 0, 0])
  assert.equal(mossJson(set, 'cap', '<|artist|>x<|/artist|>').split('\n')[0], '<|artist|>x<|/artist|>')
})

test('GBC soft text', () => {
  const set: any = { canvas: { w: 1000, h: 1000 }, chars: [{ id: 'A', name: '花火', trigger: 'hanabi' }],
    tags: [{ en: 'A girl waves.', zh: '', weight: 1, section: 'Caption' }, { en: '1girl', zh: '', weight: 1, section: 'Subject & Shot' }],
    regions: [{ id: 'r', x: 0, y: 0, w: 0.5, h: 1, text: 'waving', kind: 'char', cid: 'A' }] }
  const t = gbcText(set).split('\n')
  assert.equal(t[0], '<gbc bbox=yxyx space=abs_centralized canvas=1000x1000>')
  assert.equal(t[1], '# [image] A girl waves.')
  assert.equal(t[2], 'tags: 1girl')
  assert.equal(t[3], '- [hanabi] [-500,-500,500,0] hanabi, waving')
})

test('fmtDate', () => {
  assert.equal(fmtDate(new Date(2026, 10, 3, 9, 5).getTime()), '2026-11-03')
  assert.equal(fmtDate(new Date(2026, 10, 3, 9, 5).getTime(), true), '2026-11-03 09:05')
})

test('promptKey spots duplicates', () => {
  const a = tagsFromPrompt('1girl, (smile:1.2), Red  Dress', noZh)
  const b = tagsFromPrompt('【Outfit】\nred dress,\n【Subject】\n1girl, (smile:1.2)', noZh)
  assert.equal(promptKey(a, 'bad hands, blurry'), promptKey(b, 'blurry,bad hands'))
  assert.notEqual(promptKey(a), promptKey(tagsFromPrompt('1girl, smile, red dress', noZh)))
  assert.notEqual(promptKey(a, 'x'), promptKey(a, 'y'))
})

test('genInfo: A1111 model / loras / params', async () => {
  const { genInfo } = await import('../src/lib/pngmeta.ts')
  const i = genInfo('1girl, <lora:hanabi_v2:0.8>\nNegative prompt: bad\nSteps: 28, Sampler: Euler a, CFG scale: 5.5, Seed: 42, Size: 832x1216, Model: animagine-xl-4.0, Lora hashes: "hanabi_v2: abc, style: def"')!
  assert.equal(i.model, 'animagine-xl-4.0')
  assert.deepEqual(i.loras.map((l) => l.name), ['hanabi_v2', 'style'])
  assert.equal(i.loras[0].weight, 0.8)
  assert.equal(i.steps, 28); assert.equal(i.cfg, 5.5); assert.equal(i.seed, '42'); assert.equal(i.size, '832x1216')
})

test('genInfo: ComfyUI graph', async () => {
  const { genInfo } = await import('../src/lib/pngmeta.ts')
  const g = { 1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl\\noob.safetensors' } },
    2: { class_type: 'LoraLoader', inputs: { lora_name: 'chars/sqx.safetensors', strength_model: 0.9, model: ['1', 0] } },
    3: { class_type: 'KSampler', inputs: { seed: 7, steps: 20, cfg: 4, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } } }
  const i = genInfo(JSON.stringify(g))!
  assert.equal(i.model, 'noob'); assert.equal(i.loras[0].name, 'sqx'); assert.equal(i.loras[0].weight, 0.9)
  assert.equal(i.steps, 20); assert.equal(i.seed, '7'); assert.equal(i.size, '1024x1024')
})

test('promptFormat guesses writing style', () => {
  const t = (en: string, section?: string) => ({ en, section })
  assert.equal(promptFormat([t('1girl'), t('solo')]), 'tags')
  assert.equal(promptFormat([t('A girl stands on the rooftop at dusk, wind in her hair.')]), 'natural')
  assert.equal(promptFormat([t('1girl'), t('solo'), t('masterpiece'), t('she is looking back over her shoulder')]), 'mixed')
  assert.equal(promptFormat([t('a quiet street', 'Caption'), t('1girl')]), 'gbc')
})

test('civitai: ids and meta → parameters', async () => {
  const { civitaiImageIds, metaToParameters } = await import('../src/lib/civitai.ts')
  assert.deepEqual(civitaiImageIds('https://civitai.com/images/12345?x=1\nhttps://civitai.com/images/678'), ['12345', '678'])
  const t = metaToParameters({ prompt: '1girl', negativePrompt: 'bad', steps: 25, cfgScale: 5, seed: 9, Size: '832x1216', Model: 'noobai',
    resources: [{ type: 'lora', name: 'hanabi', weight: 0.8 }] })
  const { genInfo } = await import('../src/lib/pngmeta.ts')
  const i = genInfo(t)!
  assert.equal(i.model, 'noobai'); assert.equal(i.steps, 25); assert.equal(i.loras[0].name, 'hanabi'); assert.equal(i.loras[0].weight, 0.8)
})

test('exif UserComment (JPEG)', async () => {
  const { exifUserComment } = await import('../src/lib/pngmeta.ts')
  const text = 'a cat\nSteps: 20'
  const uc = [...Buffer.from('UNICODE\0'), ...Buffer.from(text, 'utf16le').swap16()]
  // TIFF LE: header, IFD0 with ExifIFD pointer, Exif IFD with UserComment
  const tiff: number[] = [0x49, 0x49, 42, 0, 8, 0, 0, 0]
  const w16 = (v: number) => [v & 255, v >> 8], w32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24]
  tiff.push(...w16(1), ...w16(0x8769), ...w16(4), ...w32(1), ...w32(26), ...w32(0))        // IFD0 @8 → exif @26
  tiff.push(...w16(1), ...w16(0x9286), ...w16(7), ...w32(uc.length), ...w32(44), ...w32(0)) // exif IFD @26 → data @44
  tiff.push(...uc)
  const app1 = [...Buffer.from('Exif\0\0'), ...tiff]
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xd9])
  assert.equal(exifUserComment(jpg), text)
})
