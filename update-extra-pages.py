from pathlib import Path
import re
root=Path(__file__).resolve().parent
logo="https://a.top4top.io/p_3942jt4h81.png"
guard="""<script>document.addEventListener('contextmenu',e=>{if(!e.target.closest('input,textarea,[contenteditable="true"]'))e.preventDefault()});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='u')e.preventDefault()});</script>"""
for p in root.rglob("*.html"):
    if any(x in p.parts for x in (".git","node_modules","templates")):continue
    if p.name in ("index.html","login.html","setup.html"):continue
    s=p.read_text(encoding="utf-8")
    s=s.replace("برنامج المحاسبين المميزين","").replace("أكاديميتي", "")
    s=re.sub(r'<img\b[^>]*\bsrc=["\'][^"\']*p_3939[^"\']*["\'][^>]*>', "",s,flags=re.I)
    if "</body>" in s and "document.addEventListener('contextmenu'" not in s:
        s=s.replace("</body>",guard+"</body>")
    p.write_text(s,encoding="utf-8")
    print("Updated:",p.relative_to(root))
