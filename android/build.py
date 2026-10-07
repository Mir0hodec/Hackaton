#!/usr/bin/env python3
"""Reproducible framework-only universal APK, using official Android SDK build tools."""
import argparse, os, pathlib, secrets, shutil, subprocess, zipfile
p=argparse.ArgumentParser()
p.add_argument('--sdk', default=os.environ.get('ANDROID_HOME'))
p.add_argument('--java-home', default=os.environ.get('JAVA_HOME'))
p.add_argument('--output', default='android/build/NaryadAI-LAN.apk')
a=p.parse_args()
if not a.sdk or not a.java_home: p.error('Set --sdk/ANDROID_HOME and --java-home/JAVA_HOME')
root=pathlib.Path(__file__).resolve().parent
sdk=pathlib.Path(a.sdk).resolve(); jdk=pathlib.Path(a.java_home).resolve()
bt=sdk/'build-tools/37.0.0'; jar=sdk/'platforms/android-37.0/android.jar'
build=root/'build'; build.mkdir(exist_ok=True)
classes=build/'classes'; classes.mkdir(exist_ok=True)
gen=build/'generated'; gen.mkdir(exist_ok=True)
env={**os.environ,'JAVA_HOME':str(jdk),'PATH':str(jdk/'bin')+os.pathsep+os.environ.get('PATH','')}
def run(*args): subprocess.run([str(v) for v in args], check=True, env=env)
run(bt/'aapt2','compile','--dir',root/'res','-o',build/'resources.zip')
run(bt/'aapt2','link','-I',jar,'--manifest',root/'AndroidManifest.xml','--java',gen,'-o',build/'unsigned.apk',build/'resources.zip')
sources=list((root/'src').rglob('*.java'))+list(gen.rglob('*.java'))
run(jdk/'bin/javac','--release','8','-encoding','UTF-8','-classpath',jar,'-d',classes,*sources)
run(bt/'d8','--release','--min-api','26','--lib',jar,'--output',build,*classes.rglob('*.class'))
with zipfile.ZipFile(build/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
    for dex in build.glob('classes*.dex'): z.write(dex,dex.name)
run(bt/'zipalign','-f','-p','4',build/'unsigned.apk',build/'aligned.apk')
# Local signing identity is retained for updates and excluded from source control/distribution ZIPs.
keys=root/'.signing';keys.mkdir(exist_ok=True,mode=0o700)
key=keys/'naryadai-release.jks';password=keys/'password.txt'
if not key.exists():
    password.write_text(secrets.token_urlsafe(32)+'\n');password.chmod(0o600)
    run(jdk/'bin/keytool','-genkeypair','-keystore',key,'-storetype','JKS','-storepass:file',password,'-keypass:file',password,'-alias','naryadai','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=NaryadAI LAN Demo, O=NaryadAI')
    key.chmod(0o600)
if not password.exists(): raise SystemExit('Signing password file missing; preserve the existing signing identity')
out=pathlib.Path(a.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
run(bt/'apksigner','sign','--v4-signing-enabled','false','--ks',key,'--ks-key-alias','naryadai','--ks-pass','file:'+str(password),'--out',out,build/'aligned.apk')
run(bt/'apksigner','verify','--verbose','--print-certs',out)
run(bt/'zipalign','-c','-p','4',out)
print('APK:',out)
