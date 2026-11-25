"""Turn the Fluent Emoji flat icons into hand-drawn sticker style:
wobbly white die-cut border, soft ink outline and a small drop shadow.
Idempotent: icons already wrapped (id="stk") are skipped."""
import re, pathlib
FILTER = '''<defs><filter id="stk" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="7" result="n"/>
<feMorphology in="SourceAlpha" operator="dilate" radius="1.7" result="d"/>
<feDisplacementMap in="d" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="dw"/>
<feMorphology in="dw" operator="dilate" radius=".55" result="d2"/>
<feFlood flood-color="#4a2a3c" flood-opacity=".7"/><feComposite in2="d2" operator="in" result="ink"/>
<feOffset in="ink" dx=".7" dy="1.1" result="sh0"/><feGaussianBlur in="sh0" stdDeviation=".5" result="sh"/>
<feFlood flood-color="#fff"/><feComposite in2="dw" operator="in" result="white"/>
<feMerge><feMergeNode in="sh"/><feMergeNode in="ink"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter></defs>'''
n = 0
for f in sorted(pathlib.Path('src/assets/icons').glob('*.svg')):
    s = f.read_text(encoding='utf-8')
    if 'id="stk"' in s:
        continue
    m = re.match(r'(<svg\b[^>]*>)(.*)(</svg>\s*)$', s, re.S)
    head, body = m.group(1), m.group(2)
    head = re.sub(r'viewBox="[^"]*"', 'viewBox="-3 -3 38 38"', head)
    head = re.sub(r'width="32"', 'width="38"', head); head = re.sub(r'height="32"', 'height="38"', head)
    # existing <defs> (gradients) stay inside the group; filter defs go first
    f.write_text(head + FILTER + '<g filter="url(#stk)">' + body + '</g></svg>\n', encoding='utf-8')
    n += 1
print('stickerized', n)
