"""Verify delivered APKs, offline assets and upgrade identity independently of building."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile

root=Path(__file__).resolve().parents[1]
java=Path(r'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot\bin\java.exe')
bt=Path(r'D:\AndroidTools\android-sdk\build-tools\34.0.0')
out=root/'artifacts/studio-v0.1'
out.mkdir(parents=True,exist_ok=True)
def command(*args):
    return subprocess.check_output([str(a) for a in args],text=True,encoding='utf-8')
def cert(path):
    result=command(java,'-jar',bt/'lib/apksigner.jar','verify','--verbose','--print-certs',path)
    assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in result
    return re.search(r'certificate SHA-256 digest: ([0-9a-f]+)',result).group(1)
log=(out/'java-checks.log').read_text(encoding='utf-8')
counts=[int(n) for n in re.findall(r'ALL (\d+) (?:[A-Z0-9. ]+ )?CHECKS PASSED',log)]
assert counts==[33,48,101,39,69,64,34],counts
browser=json.loads((out/'browser-checks.json').read_text(encoding='utf-8'))
assert browser['checks']==30 and browser['android_device_tested'] is False
info=json.loads((root/'studio/src/main/assets/studio/runtime/pyodide-lock.json').read_text())['info']
assert info['version']=='0.27.7' and info['python']=='3.12.7'
for line in (root/'studio/src/main/assets/studio/runtime/SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split();assert hashlib.sha256((root/'studio/src/main/assets/studio/runtime'/name).read_bytes()).hexdigest()==digest,name
report={'version':'0.1.2','version_code':10,'python':info['python'],'pyodide':info['version'],'game_checks':sum(counts[:-1]),'studio_io_checks':counts[-1],'browser_checks':browser['checks'],'android_device_tested':False,'android_saf_tested':False,'android_upgrade_tested':False,'apks':[]}
dexes=[]
for suffix,package,old_name in [('debug','cn.wuziping.ember','WuziPing-Emberbound-0.7.0-debug.apk'),('parallel-debug','cn.wuziping.ember.preview07','WuziPing-Emberbound-0.7.0-parallel-debug.apk')]:
    path=root/'dist'/('Ember-Studio-0.1.2-'+suffix+'.apk')
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        dex=z.read('classes.dex');dexes.append(dex)
        for cls in ['Lcn/wuziping/studio/EditorActivity;','Lcn/wuziping/studio/PreviewActivity;','Lcn/wuziping/studio/AssetServer;','Lcn/wuziping/ember/MainActivity;','Lcn/wuziping/ember/Game;','Lcn/wuziping/ember/MathJourney;']:
            assert cls.encode() in dex,cls
        assets=0
        for directory in ['app/src/main/assets','studio/src/main/assets']:
            base=root/directory
            for p in base.rglob('*'):
                if p.is_file():assert z.read('assets/'+p.relative_to(base).as_posix())==p.read_bytes(),p;assets+=1
        assert 'assets/studio/licenses/Pyodide-0.27.7-LICENSE.txt' in z.namelist()
    certificate=cert(path)
    assert certificate==cert(root/'dist'/old_name),'Upgrade signing certificate changed'
    subprocess.run([str(bt/'zipalign.exe'),'-c','4',str(path)],check=True)
    meta=command(bt/'aapt.exe','dump','badging',path)
    assert "package: name='"+package+"' versionCode='10' versionName='0.1.2'" in meta
    assert "application-label:'"+('天工' if suffix=='debug' else '天工 · 试玩')+"'" in meta
    assert "launchable-activity: name='cn.wuziping.studio.EditorActivity'" in meta
    permissions=re.findall(r"uses-permission: name='([^']+)'",meta)
    assert permissions==['android.permission.INTERNET'],permissions
    manifest=command(bt/'aapt.exe','dump','xmltree',path,'AndroidManifest.xml')
    assert 'cn.wuziping.ember.MainActivity' in manifest and 'cn.wuziping.studio.PreviewActivity' in manifest
    report['apks'].append({'file':path.name,'package':package,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'certificate_sha256':certificate,'upgrade_identity_matches':old_name,'asset_count_verified':assets,'dex_sha256':hashlib.sha256(dex).hexdigest(),'signature_v2_valid':True,'zip_crc_valid':True,'alignment_valid':True})
assert dexes[0]==dexes[1],'The two install variants must contain the same code'
for line in (root/'dist/STUDIO-SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split();assert hashlib.sha256((root/'dist'/name).read_bytes()).hexdigest()==digest
old_report=json.loads((root/'artifacts/release-v0.7.json').read_text())
for apk in old_report['apks']:
    assert hashlib.sha256((root/'dist'/apk['file']).read_bytes()).hexdigest()==apk['sha256'],'Original game APK was changed'
(out/'release-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('PASS: game %d + studio I/O %d + browser %d; both APKs and all offline assets; original 0.7 APKs preserved'%(report['game_checks'],report['studio_io_checks'],report['browser_checks']))
print(json.dumps(report,ensure_ascii=False,indent=2))
