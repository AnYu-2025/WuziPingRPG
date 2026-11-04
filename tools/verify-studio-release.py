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
assert counts==[36,48,101,39,69,64,34],counts
browser=json.loads((out/'browser-checks.json').read_text(encoding='utf-8'))
assert browser['checks']==30 and browser['android_device_tested'] is False
interaction=json.loads((out/'browser-interaction-0.1.12.json').read_text(encoding='utf-8'))
assert interaction['version']=='0.1.12' and interaction['checks']==len(interaction['passed'])
info=json.loads((root/'studio/src/main/assets/studio/runtime/pyodide-lock.json').read_text())['info']
assert info['version']=='0.27.7' and info['python']=='3.12.7'
for line in (root/'studio/src/main/assets/studio/runtime/SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split();assert hashlib.sha256((root/'studio/src/main/assets/studio/runtime'/name).read_bytes()).hexdigest()==digest,name
report={'version':'0.1.12','version_code':20,'python':info['python'],'pyodide':info['version'],'game_checks':sum(counts[:-1]),'studio_io_checks':counts[-1],'browser_checks':browser['checks'],'browser_interaction_checks':interaction['checks'],'browser_checks_source':'0.1.x full suite + 0.1.12 packaged-asset landing checks','android_device_tested':False,'android_saf_tested':False,'android_upgrade_tested':False,'apks':[]}
dexes=[]
for suffix,package,old_name in [('debug','cn.wuziping.ember','WuziPing-Emberbound-0.7.0-debug.apk'),('parallel-debug','cn.wuziping.ember.preview07','WuziPing-Emberbound-0.7.0-parallel-debug.apk')]:
    path=root/'dist'/('Ember-Studio-0.1.12-'+suffix+'.apk')
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        raw=[entry.orig_filename for entry in z.infolist()]
        bad=[name for name in raw if '\\' in name]
        assert not bad,'APK entry names contain backslashes: %r'%bad[:5]
        assert 'assets/studio/style.css' in raw and 'assets/studio/app.js' in raw and 'assets/studio/lecture.css' in raw and 'assets/audio/boss.wav' in raw
        index_html=z.read('assets/studio/index.html');bundle=z.read('assets/studio/app.js');lecture_css=z.read('assets/studio/lecture.css')
        notes_marker='课堂笔记.md'.encode('utf-8') in bundle or b'\\u8BFE\\u5802\\u7B14\\u8BB0.md' in bundle
        lecture_checks=[
            'data-mode="lecture"' in index_html.decode('utf-8'),
            'id="lectureBar"' in index_html.decode('utf-8') and 'id="recordBtn"' in index_html.decode('utf-8'),
            'id="timelineCanvas"' in index_html.decode('utf-8') and 'id="anchorList"' in index_html.decode('utf-8') and 'id="slideList"' in index_html.decode('utf-8'),
            '01 / 04' in index_html.decode('utf-8'),
            notes_marker,
            b'audio/webm;codecs=opus' in bundle,
            b'cm-note-time' in bundle and b'cm-note-playing' in bundle,
            b'getUserMedia' in bundle and b'MediaRecorder' in bundle,
            b'anchorrow' in bundle and b'slideitem' in bundle,
            b'rec-pulse' in lecture_css and b'cm-note-times' in lecture_css,
        ]
        assert all(lecture_checks),'Lecture mode assets incomplete: %r'%[i for i,ok in enumerate(lecture_checks) if not ok]
        dex=z.read('classes.dex');dexes.append(dex)
        for cls in ['Lcn/wuziping/studio/EditorActivity;','Lcn/wuziping/studio/PreviewActivity;','Lcn/wuziping/studio/AssetServer;','Lcn/wuziping/ember/MainActivity;','Lcn/wuziping/ember/Game;','Lcn/wuziping/ember/MathJourney;']:
            assert cls.encode() in dex,cls
        assert b'onPermissionRequest' in dex and b'RECORD_AUDIO' in dex,'Lecture recording permission flow missing from dex'
        assets=0
        for directory in ['app/src/main/assets','studio/src/main/assets']:
            base=root/directory
            for p in base.rglob('*'):
                if p.is_file() and not any(part.startswith('.') for part in p.relative_to(base).parts):assert z.read('assets/'+p.relative_to(base).as_posix())==p.read_bytes(),p;assets+=1
        assert 'assets/studio/licenses/Pyodide-0.27.7-LICENSE.txt' in z.namelist()
    certificate=cert(path)
    assert certificate==cert(root/'dist'/old_name),'Upgrade signing certificate changed'
    subprocess.run([str(bt/'zipalign.exe'),'-c','4',str(path)],check=True)
    meta=command(bt/'aapt.exe','dump','badging',path)
    assert "package: name='"+package+"' versionCode='20' versionName='0.1.12'" in meta
    assert "application-label:'"+('天工' if suffix=='debug' else '天工 · 试玩')+"'" in meta
    assert "launchable-activity: name='cn.wuziping.studio.EditorActivity'" in meta
    permissions=re.findall(r"uses-permission: name='([^']+)'",meta)
    assert permissions==['android.permission.INTERNET','android.permission.RECORD_AUDIO'],permissions
    manifest=command(bt/'aapt.exe','dump','xmltree',path,'AndroidManifest.xml')
    assert 'cn.wuziping.ember.MainActivity' in manifest and 'cn.wuziping.studio.PreviewActivity' in manifest
    report['apks'].append({'file':path.name,'package':package,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'certificate_sha256':certificate,'upgrade_identity_matches':old_name,'asset_count_verified':assets,'dex_sha256':hashlib.sha256(dex).hexdigest(),'signature_v2_valid':True,'zip_crc_valid':True,'alignment_valid':True})
assert dexes[0]==dexes[1],'The two install variants must contain the same code'
report['lecture_checks']=len(lecture_checks)
for line in (root/'dist/STUDIO-SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split();assert hashlib.sha256((root/'dist'/name).read_bytes()).hexdigest()==digest
old_report=json.loads((root/'artifacts/release-v0.7.json').read_text())
for apk in old_report['apks']:
    assert hashlib.sha256((root/'dist'/apk['file']).read_bytes()).hexdigest()==apk['sha256'],'Original game APK was changed'
(out/'release-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('PASS: game %d + studio I/O %d + legacy browser %d + 0.1.12 packaged-asset interaction %d + lecture mode %d; forward-slash entry names; both APKs and all offline assets; original 0.7 APKs preserved'%(report['game_checks'],report['studio_io_checks'],report['browser_checks'],report['browser_interaction_checks'],report['lecture_checks']))
print(json.dumps(report,ensure_ascii=False,indent=2))
