"""Verify the complete 0.2.5 Gradle APKs, including merged native modules."""
from pathlib import Path
import hashlib, json, os, re, subprocess, zipfile
root=Path(__file__).resolve().parents[1]
sdk=Path(os.getenv('ANDROID_HOME',r'D:\AndroidTools\android-sdk'))/'build-tools/34.0.0'
java=Path(os.getenv('JAVA_HOME',r'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'))/'bin/java.exe'
cert='0dcafc3b079966a52c69d8292d86078717e42bdc2883485e335aebf0214d5aca'
report={'version':'0.2.5','version_code':37,'android_device_tested':False,'apks':[]}
for name,package in [('Ember-Studio-0.2.5.apk','cn.wuziping.ember'),('Ember-Studio-0.2.5-parallel.apk','cn.wuziping.ember.preview07')]:
 p=root/'dist'/name
 subprocess.run([str(sdk/'zipalign.exe'),'-c','4',str(p)],check=True)
 signature=subprocess.check_output([str(java),'-jar',str(sdk/'lib/apksigner.jar'),'verify','--verbose','--print-certs',str(p)],text=True)
 assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in signature and cert in signature
 meta=subprocess.check_output([str(sdk/'aapt.exe'),'dump','badging',str(p)],text=True,encoding='utf8')
 assert "package: name='%s' versionCode='37' versionName='0.2.5'" % package in meta
 with zipfile.ZipFile(p) as z:
  assert z.testzip() is None
  names=z.namelist()
  for item in ['assets/studio/index.html','assets/studio/app.js','assets/studio/style.css','assets/studio/meteor-sky.webp','assets/studio/sky-ripple.js','assets/photo/index.html','assets/studio/runtime/pyodide.js','assets/audio/boss.wav']:
   assert item in names,item
  assert any('gocrchinese' in n for n in names)
  html=z.read('assets/studio/index.html')
  assert b'0.2.5' in html and b'meteor-field' in html and b'brandspark' not in html
  assert html==z.read('assets/studio/editor.page')==z.read('assets/editor.page')
  assert z.read('assets/studio/meteor-sky.webp')==(root/'studio/web/src/meteor-sky.webp').read_bytes()
  for mode in (b'lecture',b'tts',b'scan',b'python',b'notepad',b'photo',b'ai',b'game'):
   assert b'data-mode="'+mode+b'"' in html,mode
  dex=b''.join(z.read(n) for n in names if re.fullmatch(r'classes\d*\.dex',n))
  for cls in (b'Lcom/scan/camera/MainActivity;',b'Lcn/wuziping/studio/PhotoActivity;',b'Lcn/wuziping/ember/Game;',b'Lcn/wuziping/studio/EditorActivity;'):
   assert cls in dex,cls
 digest=hashlib.sha256(p.read_bytes()).hexdigest()
 report['apks'].append({'file':name,'package':package,'bytes':p.stat().st_size,'sha256':digest,'signature_sha256':cert,'zip_crc_valid':True,'alignment_valid':True})
(root/'dist/STUDIO-SHA256SUMS.txt').write_text(''.join(a['sha256']+'  '+a['file']+'\n' for a in report['apks']),encoding='utf8')
(root/'artifacts/studio-v0.1/release-0.2.5.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,indent=2))
