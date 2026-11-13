// Run: npm test  (Node 22.6+ built-in runner, TS stripped natively; no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOne, tagsFromPrompt, serializeTags, sanitizeIdentity, groupTags } from '../src/lib/tags.ts'
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
