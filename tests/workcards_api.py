"""Local preview only: shared timers, progress, rating and reminder boundaries."""
import urllib.request,urllib.error,json,uuid,time,concurrent.futures
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def call(body=None,cookie=''):
 req=urllib.request.Request('http://127.0.0.1:4173/api/service',data=json.dumps(body).encode() if body is not None else None,headers={'Host':'terminal.local:4173','Cookie':cookie,'Content-Type':'application/json'})
 try:r=op.open(req,timeout=60)
 except urllib.error.HTTPError as e:r=e
 raw=r.read()
 try:data=json.loads(raw)
 except:raise AssertionError(raw[:500])
 return r.status,data,r.headers

def ok(b=None,c=''):
 s,d,_=call(b,c);assert s==200,(s,d);return d

def login(name,password):
 s,d,h=call({'action':'login','id':name,'pin':password});assert s==200,d
 return h['Set-Cookie'].split(';')[0]
master=login('master','LocalMaster_12345');w1=login('worker1','LocalWorker1_12345');w2=login('worker2','LocalWorker2_12345')
for worker,c in [('worker1',w1),('worker2',w2)]:
 for l in ok(c=c).get('worklogs',[]):
  for a in l['entries']:
   if a['status']=='active':ok({'action':'work-cancel','id':a['id'],'note':'Cleanup local test'},c)
assert call({'action':'work-start','worker':'worker2','title':'Forbidden','minutes':60},w1)[0]!=200
assert call({'action':'work-start','title':'Invalid','minutes':1,'remindMinutes':2},w1)[0]!=200
assert call({'action':'work-start','title':'Invalid','minutes':'NaN'},w1)[0]!=200
request={'action':'work-start','title':'Timed local test','minutes':1,'remindMinutes':1,'requestId':str(uuid.uuid4())}
card=ok(request,w1)['id'];ok(request,w1)
assert call({'action':'work-start','title':'Concurrent work','minutes':60},w1)[0]!=200
assert all(l['id']=='worker2' for l in ok(c=w2)['worklogs'])
assert any(a.get('workcard')==card and 'Напоминание' in a['title'] for a in ok(c=master)['alerts'])
ok({'action':'work-progress','id':card,'progress':40,'workedMinutes':0.5,'note':'Первый этап'},w1)
log=next(l for l in ok(c=master)['worklogs'] if l['id']=='worker1');assert log['entries'][0]['progress']==40
assert call({'action':'work-progress','id':card,'progress':20,'workedMinutes':1,'note':'Backwards'},w1)[0]!=200
assert call({'action':'work-finish','worker':'worker1','id':card,'note':'Forbidden'},w2)[0]!=200
# Independent worker finishes early; quality can only be rated by a master.
early=ok({'action':'work-start','title':'Early work','minutes':60,'remindMinutes':10},w2)['id']
ok({'action':'work-finish','id':early,'workedMinutes':3,'note':'Выполнен контрольный пуск'},w2)
assert call({'action':'work-review','id':early,'score':5,'comment':'Own score'},w2)[0]!=200
ok({'action':'work-review','worker':'worker2','id':early,'score':4,'comment':'Проверено мастером'},master)
log=next(l for l in ok(c=w2)['worklogs'] if l['id']=='worker2');assert log['entries'][0]['review']['score']==4
assert any(a.get('workcard')==early and 'досрочно' in a['title'] for a in ok(c=master)['alerts'])
assert call({'action':'work-progress','id':early,'progress':90,'workedMinutes':4,'note':'After finish'},w2)[0]!=200
print('PASS: shared cards, own-only access, durations, monotonic progress, early completion, rating permissions and durable alerts.',flush=True)
# Expiry is a real one-minute countdown; allow up to 30s server tick window.
end=time.monotonic()+100
while time.monotonic()<end:
 d=ok(c=master)
 if any(a.get('workcard')==card and 'Время закончилось' in a['title'] for a in d['alerts']):break
 time.sleep(4)
else:raise AssertionError('Expiry alert not delivered')
log=next(l for l in d['worklogs'] if l['id']=='worker1');assert log['entries'][0]['status']=='active'
for _ in range(2):d=ok(c=master)
assert sum(a.get('workcard')==card and 'Время закончилось' in a['title'] for a in d['alerts'])==1
ok({'action':'work-plan','id':card,'minutes':10,'remindMinutes':2,'note':'Нужен дополнительный этап'},w1)
ok({'action':'work-finish','id':card,'workedMinutes':2,'note':'Длительная работа завершена'},w1)
print('PASS: actual expiry alert, deduplication, remains active until confirmation, extension and completion.',flush=True)
