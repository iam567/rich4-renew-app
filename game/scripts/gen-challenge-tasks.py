"""docs/rules/26-challenge-tasks.md -> game/src/core/challenge-tasks.ts (id, map, name, stars, once, need, skip, and the
shown text: desc, tiers), the text turned Traditional with opencc-js (game/node_modules)."""
import json,re,subprocess
R='/Users/jingtaoliang/Documents/New project/开发游戏/rich4-renew/'
MAP={'1':-1,'2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':100,'11':101,'12':102,'13':103,'14':104,'15':106,'16':107}
def num(x):
    x=x.strip().replace('*','')
    if not x: return None
    if x.startswith('全部'): return -1
    m=re.search(r'([\d.]+)\s*(万)?',x)
    if not m: return None
    v=float(m.group(1))*(10000 if m.group(2) else 1); return int(v)
def clean(x):
    x=x.replace('**','').replace('`','')
    x=re.sub(r'[；;，,、]\s*(?:见\s*)?\d\d\s*§[\d.]+','',x)    # references to the rules docs
    x=re.sub(r'（[^（）]*§[^（）]*）','',x)
    x=re.sub(r'\s*\d\d\s*§[\d.]+','',x)
    return x.strip()
def text(cond,a,b,cc,once):
    cond=clean(cond)
    if once: return cond,[]
    if a=='地段': return cond+' 整段归你',['整段归你','整段 3 级','整段 5 级']
    if a=='董事長': return '当上'+cond+'的董事長',['连续 30 天','连续 90 天','连续 180 天']
    if a=='设施': return cond,['盖好','3 级','5 级']
    tiers=[clean(x) for x in (a,b,cc) if clean(x)]
    return cond,tiers
SKIP={'G16','G22','G24','G26','G27','G28','G29','G30','G32','G34','G67'}
out=[]; sec=None
for l in open(R+'docs/rules/26-challenge-tasks.md'):
    m=re.match(r'## (\d+) ',l)
    if m: sec=MAP.get(m.group(1)); continue
    m=re.match(r'\| ([A-Z]\d\d) \| \*\*(.+?)\*\* \|(.*)\|\s*$',l)
    if not m or sec is None: continue
    c=[x.strip() for x in m.group(3).split('|')]
    cond,a,b,cc=(c+['','','',''])[:4]
    if '一次就 ★★★' in a: stars,once,need=3,True,[1]
    elif '一次就 ★' in a: stars,once,need=1,True,[1]
    else:
        ns=[num(x) for x in (a,b,cc)]
        stars,once=3,False
        need=ns if all(n is not None for n in ns) else [1,2,3]
    o={'id':m.group(1),'map':sec,'name':m.group(2),'stars':stars,'once':once,'need':need}
    o['desc'],o['tiers']=text(cond,a,b,cc,once)
    if m.group(1) in SKIP: o['skip']=[106,107]
    out.append(o)
# Notes for the developers out; other tasks named by their names, not ids.
names={o['id']:o['name'] for o in out}
for o in out:
    o['desc']=re.sub(r'（用户[^（）]*）','',o['desc'])
    o['desc']=re.sub(r'([A-Z]\d\d)',lambda m:'⟦'+m.group(1)+'⟧' if m.group(1) in names else m.group(1),o['desc'])
# Simplified -> Traditional (Taiwan) for the game's text; the names are already Traditional.
conv=subprocess.run(['node','--input-type=module','-e',
  "import * as O from 'opencc-js'; const c=O.Converter({from:'cn',to:'tw'}); let s='';"
  "process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s); const t=x=>c(x).replace(/臺/g,'台'); for(const o of a){o.desc=t(o.desc); o.tiers=o.tiers.map(t);} process.stdout.write(JSON.stringify(a));});"],
  input=json.dumps(out,ensure_ascii=False),capture_output=True,text=True,cwd=R+'game',check=True)
out=json.loads(conv.stdout)
for o in out: o['desc']=re.sub(r'⟦([A-Z]\d\d)⟧',lambda m:'「'+names[m.group(1)]+'」',o['desc']).replace('」 ','」')
for o in out:
    if not o['tiers']: del o['tiers']
body=',\n'.join('  '+json.dumps(o,ensure_ascii=False,separators=(', ',': ')) for o in out)
open(R+'game/src/core/challenge-tasks.ts','w').write('''/**
 * 挑戰模式's tasks (docs/rules/26-challenge-tasks.md, as the user picked them in the task picker, 2026-11-02): generated
 * from that table by game/scripts/gen-challenge-tasks.py; do not edit by hand. map -1 = the shared library; stars 1 / 3 with once =
 * one-off tasks (done once: that many stars); otherwise need = the three thresholds (-1 = all), [1, 2, 3] = progress levels.
 */
export interface ChallengeTask {
  id: string; map: number; name: string; stars: 1 | 3; once: boolean; need: number[]; skip?: number[];
  /** What counts (shown in the task list) and the three tiers' words (none for one-off tasks). */
  desc: string; tiers?: string[];
}

export const CHALLENGE_TASKS: ChallengeTask[] = [
'''+body+''',
];
''')
print(len(out))
