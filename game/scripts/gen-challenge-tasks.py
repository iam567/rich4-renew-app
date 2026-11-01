"""docs/rules/26-challenge-tasks.md -> game/src/core/challenge-tasks.ts (id, map, name, stars, once, need, skip)."""
import json,re
R='/Users/jingtaoliang/Documents/New project/开发游戏/rich4-renew/'
MAP={'1':-1,'2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':100,'11':101,'12':102,'13':103,'14':104,'15':106,'16':107}
def num(x):
    x=x.strip().replace('*','')
    if not x: return None
    if x.startswith('全部'): return -1
    m=re.search(r'([\d.]+)\s*(万)?',x)
    if not m: return None
    v=float(m.group(1))*(10000 if m.group(2) else 1); return int(v)
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
    if m.group(1) in SKIP: o['skip']=[106,107]
    out.append(o)
body=',\n'.join('  '+json.dumps(o,ensure_ascii=False,separators=(', ',': ')) for o in out)
open(R+'game/src/core/challenge-tasks.ts','w').write('''/**
 * 挑戰模式's tasks (docs/rules/26-challenge-tasks.md, as the user picked them in the task picker, 2026-11-02): generated
 * from that table by game/scripts/gen-challenge-tasks.py; do not edit by hand. map -1 = the shared library; stars 1 / 3 with once =
 * one-off tasks (done once: that many stars); otherwise need = the three thresholds (-1 = all), [1, 2, 3] = progress levels.
 */
export interface ChallengeTask { id: string; map: number; name: string; stars: 1 | 3; once: boolean; need: number[]; skip?: number[] }

export const CHALLENGE_TASKS: ChallengeTask[] = [
'''+body+''',
];
''')
print(len(out))
