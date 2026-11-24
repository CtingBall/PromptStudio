"""Turn a reference PDF into a built-in skill (public/skills/<id>.json) for the AI generator.

Usage: python scripts/build-skill.py <pdf> <id> <name> [description]
Only prints counts; the text is split into page-tagged chunks and never shown.
"""
import json, re, sys
from pathlib import Path
from pypdf import PdfReader

CHUNK = 900  # characters per chunk (a few hundred tokens)


def outline_pages(r):
    out = []
    def walk(items):
        for it in items:
            if isinstance(it, list):
                walk(it)
                continue
            try:
                out.append((r.get_destination_page_number(it), str(it.title).strip()))
            except Exception:
                pass
    walk(r.outline or [])
    return sorted(out)


def clean(t):
    t = t.replace('\u3000', ' ')
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n\s*\n+', '\n', t)
    return t.strip()


def main():
    pdf, sid, name = sys.argv[1], sys.argv[2], sys.argv[3]
    desc = sys.argv[4] if len(sys.argv) > 4 else ''
    r = PdfReader(pdf)
    heads = outline_pages(r)
    chunks, buf, title, start = [], '', '', 1

    def flush(page):
        nonlocal buf
        if buf.strip():
            chunks.append({'t': title, 'p': start, 'x': buf.strip()})
        buf = ''

    for i, page in enumerate(r.pages):
        for p, h in heads:
            if p == i:
                flush(i)
                title = h
        for line in clean(page.extract_text() or '').split('\n'):
            if not buf:
                start = i + 1
            buf += line + '\n'
            if len(buf) >= CHUNK:
                flush(i)
    flush(len(r.pages))

    root = Path(__file__).resolve().parent.parent / 'public' / 'skills'
    root.mkdir(parents=True, exist_ok=True)
    (root / f'{sid}.json').write_text(json.dumps({'id': sid, 'name': name, 'desc': desc, 'pages': len(r.pages), 'chunks': chunks}, ensure_ascii=False), encoding='utf-8')
    idx = root / 'index.json'
    lst = json.loads(idx.read_text(encoding='utf-8')) if idx.exists() else []
    lst = [s for s in lst if s.get('id') != sid] + [{'id': sid, 'name': name, 'desc': desc, 'chunks': len(chunks)}]
    idx.write_text(json.dumps(lst, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'pages {len(r.pages)}, sections {len(heads)}, chunks {len(chunks)}, chars {sum(len(c["x"]) for c in chunks)}')


if __name__ == '__main__':
    main()
