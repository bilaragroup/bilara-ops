import json,collections,re,pathlib
p=pathlib.Path('data/source.json');d=json.loads(p.read_text(encoding='utf8'))
a={}
for kind in ['purchase','payment']:
 rows=d[kind];a[kind]={'count':len(rows),'tabs':sum(s['kind']==kind for s in d['sheets']),'missingProject':sum(not r['project'] for r in rows),'statuses':dict(collections.Counter(r['status'] or 'Blank' for r in rows))}
 if kind=='purchase':
  a[kind]['numericBOQ']=sum(isinstance(r.get('boqQty'),(int,float)) and isinstance(r.get('boqRate'),(int,float)) for r in rows)
  a[kind]['numericActual']=sum(isinstance(r.get('actualQty'),(int,float)) and isinstance(r.get('actualRate'),(int,float)) for r in rows)
  key=lambda r:'|'.join(str(r.get(k,'')).strip().upper() for k in ['project','milestone','activity','item'])
 else:
  a[kind]['numericAmount']=sum(isinstance(r.get('amount'),(int,float)) for r in rows)
  a[kind]['completedWithBalance']=sum(r['status'].lower() in ['paid','completed'] and r.get('remaining') not in [None,0,'0',''] for r in rows)
  key=lambda r:'|'.join(str(r.get(k,'')).strip().upper() for k in ['project','vendor','item','amount','bill'])
 counts=collections.Counter(key(r) for r in rows)
 a[kind]['repeatedKeyRows']=sum(counts[key(r)]>1 for r in rows)
 for r in rows:
  if counts[key(r)]>1:r['issues'].append('Repeated matching fields: check carry-forward / duplicate')
d['analysis']=a;p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),encoding='utf8');print(json.dumps(a,indent=2))
