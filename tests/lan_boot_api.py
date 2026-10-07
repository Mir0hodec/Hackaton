"""Verify that LAN HTML and its browser boot files belong to one complete build."""
import json, os, re, urllib.parse, urllib.request
base=os.environ.get('NARYADAI_ORIGIN','http://127.0.0.1:8788').rstrip('/')
assert urllib.parse.urlparse(base).hostname in ['127.0.0.1','localhost']
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def read(path):
 r=op.open(base+path,timeout=10);assert r.status==200,path;return r.read().decode()
html=read('/demo')
paths=set(re.findall(r'(?:src|href)="([^" ]+\.(?:js|css))"',html))
assert '/boot-guard.js' in paths
assert any('/page-' in p for p in paths)
checked=set()
while paths:
 path=paths.pop()
 if path in checked:continue
 assert path.startswith('/') and not path.startswith('//')
 body=read(path);checked.add(path)
 if path.endswith('.js'):
  for dep in re.findall(r'(?:from\s*|import\s*\(?)\s*[\'\"](\.[^\'\"]+\.js)[\'\"]',body):
   resolved=urllib.parse.urlparse(urllib.parse.urljoin(base+path,dep)).path
   if resolved not in checked:paths.add(resolved)
assert json.loads(read('/demo.webmanifest'))['start_url']=='/demo'
assert 'Подключить iPhone' in read('/lan')
print('PASS: LAN HTML,',len(checked),'boot assets/imports; hydration recovery; demo manifest and iPhone QR route')
