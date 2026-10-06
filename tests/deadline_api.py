"""Checks server-generated deadline events across independent signed-in sessions."""
import urllib.request,urllib.error,json,time
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def call(body=None,cookie=''):
 req=urllib.request.Request('http://127.0.0.1:4173/api/service',data=json.dumps(body).encode() if body else None,headers={'Host':'terminal.local:4173','Cookie':cookie,'Content-Type':'application/json'})
 r=op.open(req,timeout=30);return json.loads(r.read()),r.headers

def login(id,pin):return call({'action':'login','id':id,'pin':pin})[1]['Set-Cookie'].split(';')[0]
m=login('master','LocalMaster_12345');w=login('worker1','LocalWorker1_12345')
id=call({'action':'create','data':{'title':'Проверка серверной просрочки','equipment':'e0','worker':'worker1','priority':'emergency','type':'planned','due':'2020-01-01T10:00:00Z'}},m)[0]['id']
for attempt in range(35):
 data=call(cookie=m)[0]
 if any(a['order']==id and 'просрочка' in a['title'] for a in data['alerts']):break
 time.sleep(1)
else:raise AssertionError('No server deadline event within 35 seconds')
assert any(a['order']==id for a in call(cookie=w)[0]['alerts'])
call({'action':'edit','id':id,'cancel':True,'reason':'Проверка завершена'},m)
print('PASS: deadline tick produces persisted alerts for master and assigned worker, independent of client calculations.')
