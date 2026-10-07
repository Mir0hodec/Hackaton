"""Shared LAN demo: two independent phone cookie jars and isolated permissions."""
import datetime as dt, http.cookiejar, json, os, urllib.request, urllib.error, urllib.parse, uuid
base=os.environ.get('NARYADAI_ORIGIN','http://127.0.0.1:8788').rstrip('/')
host=urllib.parse.urlparse(base).hostname
import ipaddress
assert host=='localhost' or ipaddress.ip_address(host).is_private, 'Local demo only'
class Phone:
 def __init__(self):
  self.jar=http.cookiejar.CookieJar()
  self.op=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(self.jar))
 def call(self,body=None,path='/api/demo'):
  raw=None if body is None else json.dumps(body).encode()
  req=urllib.request.Request(base+path,data=raw,headers={'Origin':base,'Content-Type':'application/json'})
  try:r=self.op.open(req,timeout=25)
  except urllib.error.HTTPError as e:r=e
  return r.status,json.loads(r.read())
 def ok(self,body=None):
  status,data=self.call(body);assert status==200,(status,data);return data
master=Phone();worker=Phone()
assert master.call(path='/api/lan-discovery')[1]['mode']=='shared-lan-demo'
master.ok({'action':'demo-start'});worker.ok({'action':'demo-start'})
assert all(not c.secure for c in master.jar), 'HTTP LAN cookie must persist'
assert next(iter(master.jar)).value!=next(iter(worker.jar)).value, 'Independent sessions'
data=master.ok(); assert data['capabilities']['lanDemo'] is True; worker_id=next(u['id'] for u in data['users'] if u['role']=='worker' and u.get('onShift') and not any(o['worker']==u['id'] and o['status'] not in ['closed','cancelled','rejected'] for o in data['orders']))
worker.ok({'action':'demo-role','id':worker_id})
assert master.ok()['user']['role']=='master' and worker.ok()['user']['id']==worker_id
order=master.ok({'action':'create','requestId':str(uuid.uuid4()),'data':{'title':'LAN QA '+str(uuid.uuid4())[:8],'equipment':'e0','worker':worker_id,'priority':'normal','type':'planned','norm':60,'due':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).isoformat()}})['id']
assert any(o['id']==order for o in worker.ok()['orders']), 'Phones must see shared order'
worker.ok({'action':'transition','id':order,'status':'accepted'})
assert next(o for o in master.ok()['orders'] if o['id']==order)['status']=='accepted'
assert worker.call({'action':'create','data':{'title':'Unauthorized'}})[0]==400
assert master.call(path='/api/service')[1].get('user') is None
# New join/reconnect must retain shared order and must not overwrite existing data.
third=Phone();third.ok({'action':'demo-start'});assert any(o['id']==order for o in third.ok()['orders'])
for item in master.ok()['orders']:
 if item['title'].startswith('LAN QA ') and item['status'] not in ['closed','cancelled','rejected']:
  master.ok({'action':'edit','id':item['id'],'cancel':True,'reason':'LAN QA завершён'})
print('PASS: LAN health; HTTP cookies; separate roles; shared order creation/update; permissions; reconnect; production API isolated')
