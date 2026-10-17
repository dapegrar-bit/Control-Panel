from pathlib import Path
root=Path(__file__).resolve().parent
for p in root.rglob('*.html'):
    if any(x in p.parts for x in ('.git','node_modules','templates')): continue
    s=p.read_text(encoding='utf-8')
    if 'name="referrer"' in s or "name='referrer'" in s: continue
    if '<head>' not in s.lower(): continue
    import re
    s=re.sub(r'<head>', '<head><meta name="referrer" content="strict-origin-when-cross-origin">',s,count=1,flags=re.I)
    p.write_text(s,encoding='utf-8')
    print('Updated:',p.relative_to(root))
