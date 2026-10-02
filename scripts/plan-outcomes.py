# Per fresh trial: the portal_plan answers (kind), and whether/when the Nether was reached.
import json,glob,os,re,sys,collections,statistics
from datetime import datetime
ts=lambda s: datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
since=sys.argv[1] if len(sys.argv)>1 else '2026-10-01T00'
trials=[]
for f in glob.glob('artifacts/midgame/*.json'):
  try: r=json.load(open(f))
  except: continue
  if r.get('startedAt','')<since or re.search('nether|fortress',r.get('world','')): continue
  v=r.get('verdict') or {}
  trials.append({'port':str(r['port']),'t0':ts(r['startedAt']),'t1':ts(r['startedAt'])+60*(v.get('minutes') or 180),'nether':(v.get('reachedAtMinute') or {}).get('nether'),'world':r['world'],'plans':[]})
byport=collections.defaultdict(list)
for t in trials: byport[t['port']].append(t)
for f in glob.glob('.bot-state/flight/*.jsonl'):
  m=re.search(r'-(255\d\d)-Jev-(\d{4}-\d\d-\d\dT\d\d)',f)
  if not m or m.group(2)<since[:13] or m.group(1) not in byport: continue
  for l in open(f):
    if '"portal_plan"' not in l or '"kind":"decision"' not in l.replace(': ',':'): continue
    a=re.search(r'"at": ?"([^"]+)"',l); lab=re.search(r'"label": ?"([^"]+)"',l)
    if not (a and lab): continue
    t=ts(a.group(1)); kind=re.sub(r'_\d+$','',lab.group(1))
    for tr in byport[m.group(1)]:
      if tr['t0']<=t<=tr['t1']: tr['plans'].append((t,kind)); break
rows=[t for t in trials if t['plans']]
print('fresh trials',len(trials),'with a portal plan',len(rows),'reached nether',sum(t['nether'] is not None for t in rows))
first=collections.defaultdict(lambda:[0,0,[]]); last=collections.defaultdict(lambda:[0,0]); nplans=[[],[]]
for t in rows:
  t['plans'].sort(); k=t['plans'][0][1]; ok=t['nether'] is not None
  first[k][0]+=1; first[k][1]+=ok
  if ok: first[k][2].append(t['nether']-(t['plans'][0][0]-t['t0'])/60)
  kinds=[]; 
  for _,x in t['plans']:
    if not kinds or kinds[-1]!=x: kinds.append(x)
  nplans[ok].append(len(kinds))
  last[t['plans'][-1][1]][0]+=1; last[t['plans'][-1][1]][1]+=ok
print('by the FIRST plan: n, reached, median minutes from the plan to the Nether')
for k,v in sorted(first.items(), key=lambda x:-x[1][0]): print(f'  {k:22s} {v[0]:4d} {v[1]:4d} ({100*v[1]//max(1,v[0])}%)  {round(statistics.median(v[2]),1) if v[2] else "-"}')
print('by the LAST plan:')
for k,v in sorted(last.items(), key=lambda x:-x[1][0]): print(f'  {k:22s} {v[0]:4d} {v[1]:4d} ({100*v[1]//max(1,v[0])}%)')
print('plan changes (distinct runs of kinds): reached median',statistics.median(nplans[1]) if nplans[1] else None,'not reached median',statistics.median(nplans[0]) if nplans[0] else None)
