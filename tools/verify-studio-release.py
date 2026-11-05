"""Verify delivered APKs, offline assets and upgrade identity independently of building."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
sdk = Path(os.environ.get('SDK_ROOT') or os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or r'D:\AndroidTools\android-sdk')
jdk = Path(os.environ.get('JDK_ROOT') or os.environ.get('JAVA_HOME') or r'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot')
bt = sdk / 'build-tools/34.0.0'
out = root / 'artifacts/studio-v0.1'
out.mkdir(parents=True, exist_ok=True)
VERSION_NAME = '0.1.15'
VERSION_CODE = '23'
# Certificate of dist Ember Studio 0.1.13 / game 0.7.1. An in-place upgrade needs this key.
ORIGINAL_CERT = '0dcafc3b079966a52c69d8292d86078717e42bdc2883485e335aebf0214d5aca'


def existing(*candidates):
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError('Missing build tool: ' + ' or '.join(str(path) for path in candidates))


java = existing(jdk / 'bin/java', jdk / 'bin/java.exe')
apksigner = existing(bt / 'lib/apksigner.jar')
zipalign = existing(bt / 'zipalign', bt / 'zipalign.exe')
aapt = existing(bt / 'aapt', bt / 'aapt.exe')


def command(*args):
    return subprocess.check_output([str(a) for a in args], text=True, encoding='utf-8')


def cert(path):
    result = command(java, '-jar', apksigner, 'verify', '--verbose', '--print-certs', path)
    assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in result
    return re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', result).group(1)


log = (out / 'java-checks.log').read_text(encoding='utf-8')
counts = [int(n) for n in re.findall(r'ALL (\d+) (?:[A-Z0-9. ]+ )?CHECKS PASSED', log)]
assert counts == [36, 48, 101, 39, 69, 64, 34], counts
browser = json.loads((out / 'browser-checks.json').read_text(encoding='utf-8'))
assert browser['checks'] == 30 and browser['android_device_tested'] is False
interaction = json.loads((out / 'browser-interaction-0.1.12.json').read_text(encoding='utf-8'))
assert interaction['version'] == '0.1.12' and interaction['checks'] == len(interaction['passed'])
info = json.loads((root / 'studio/src/main/assets/studio/runtime/pyodide-lock.json').read_text())['info']
assert info['version'] == '0.27.7' and info['python'] == '3.12.7'
for line in (root / 'studio/src/main/assets/studio/runtime/SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split()
    assert hashlib.sha256((root / 'studio/src/main/assets/studio/runtime' / name).read_bytes()).hexdigest() == digest, name
report = {
    'version': VERSION_NAME,
    'version_code': int(VERSION_CODE),
    'python': info['python'],
    'pyodide': info['version'],
    'game_checks': sum(counts[:-1]),
    'studio_io_checks': counts[-1],
    'browser_checks': browser['checks'],
    'browser_interaction_checks': interaction['checks'],
    'browser_checks_source': '0.1.x full suite + 0.1.12 packaged-asset landing checks',
    'android_device_tested': False,
    'android_saf_tested': False,
    'android_upgrade_tested': False,
    'original_certificate_sha256': ORIGINAL_CERT,
    'apks': [],
}
dexes = []
variants = [
    ('Ember-Studio-0.1.15.apk', 'cn.wuziping.ember', '天工', 'WuziPing-Emberbound-0.7.1-debug.apk'),
    ('Ember-Studio-0.1.15-parallel.apk', 'cn.wuziping.ember.preview07', '天工 · 试玩', 'WuziPing-Emberbound-0.7.1-parallel-debug.apk'),
]
for filename, package, label, old_name in variants:
    path = root / 'dist' / filename
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        raw = [entry.orig_filename for entry in z.infolist()]
        bad = [name for name in raw if '\\' in name]
        assert not bad, 'APK entry names contain backslashes: %r' % bad[:5]
        assert 'assets/studio/style.css' in raw and 'assets/studio/app.js' in raw and 'assets/studio/lecture.css' in raw and 'assets/audio/boss.wav' in raw
        index_html = z.read('assets/studio/index.html')
        bundle = z.read('assets/studio/app.js')
        lecture_css = z.read('assets/studio/lecture.css')
        page = index_html.decode('utf-8')
        notes_marker = '课堂笔记.md'.encode('utf-8') in bundle or b'\\u8BFE\\u5802\\u7B14\\u8BB0.md' in bundle
        lecture_checks = [
            'data-mode="lecture"' in page,
            'id="lectureBar"' in page and 'id="recordBtn"' in page,
            'id="timelineCanvas"' in page and 'id="anchorList"' in page and 'id="slideList"' in page,
            '01 / 05' in page,
            notes_marker,
            b'audio/webm;codecs=opus' in bundle,
            b'cm-note-time' in bundle and b'cm-note-playing' in bundle,
            b'getUserMedia' in bundle and b'MediaRecorder' in bundle,
            b'anchorrow' in bundle and b'slideitem' in bundle,
            b'rec-pulse' in lecture_css and b'cm-note-times' in lecture_css,
        ]
        assert all(lecture_checks), 'Lecture mode assets incomplete: %r' % [i for i, ok in enumerate(lecture_checks) if not ok]
        feature_checks = [
            'data-mode="tts"' in page and 'id="ttsBar"' in page,
            'class="brandver">0.1.15' in page,
            b'speechSynthesis' in bundle or b'TextToSpeech' in bundle,
            b'drawStrokes' in bundle and b'drawCanvas' in bundle,
            b'pointerdown' in bundle and b'touchstart' in bundle and b'pointercancel' in bundle,
            b'clientWidth' in bundle and b'style' in bundle,
        ]
        assert all(feature_checks), '0.1.15 read-aloud or drawing bundle incomplete: %r' % [i for i, ok in enumerate(feature_checks) if not ok]
        dex = z.read('classes.dex')
        dexes.append(dex)
        for cls in ['Lcn/wuziping/studio/EditorActivity;', 'Lcn/wuziping/studio/PreviewActivity;', 'Lcn/wuziping/studio/AssetServer;', 'Lcn/wuziping/ember/MainActivity;', 'Lcn/wuziping/ember/Game;', 'Lcn/wuziping/ember/MathJourney;']:
            assert cls.encode() in dex, cls
        assert b'onPermissionRequest' in dex and b'RECORD_AUDIO' in dex, 'Lecture recording permission flow missing from dex'
        assert b'Landroid/speech/tts/TextToSpeech;' in dex, 'English read-aloud engine missing from dex'
        assets = 0
        for directory in ['app/src/main/assets', 'studio/src/main/assets']:
            base = root / directory
            for p in base.rglob('*'):
                if p.is_file() and not any(part.startswith('.') for part in p.relative_to(base).parts):
                    assert z.read('assets/' + p.relative_to(base).as_posix()) == p.read_bytes(), p
                    assets += 1
        assert 'assets/studio/licenses/Pyodide-0.27.7-LICENSE.txt' in z.namelist()
    certificate = cert(path)
    reference = cert(root / 'dist' / old_name)
    assert reference == ORIGINAL_CERT, 'Retained game APK no longer carries the original development certificate'
    assert certificate == ORIGINAL_CERT, (
        'Upgrade signing certificate changed: %s has SHA-256 %s, expected %s (same key as %s).'
        % (filename, certificate, ORIGINAL_CERT, old_name)
    )
    subprocess.run([str(zipalign), '-c', '4', str(path)], check=True)
    meta = command(aapt, 'dump', 'badging', path)
    assert "package: name='" + package + "' versionCode='" + VERSION_CODE + "' versionName='" + VERSION_NAME + "'" in meta
    assert "application-label:'" + label + "'" in meta
    assert "launchable-activity: name='cn.wuziping.studio.EditorActivity'" in meta
    permissions = re.findall(r"uses-permission: name='([^']+)'", meta)
    assert permissions == ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO'], permissions
    manifest = command(aapt, 'dump', 'xmltree', path, 'AndroidManifest.xml')
    assert 'cn.wuziping.ember.MainActivity' in manifest and 'cn.wuziping.studio.PreviewActivity' in manifest
    report['apks'].append({
        'file': path.name,
        'package': package,
        'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'certificate_sha256': certificate,
        'upgrade_identity_matches': old_name,
        'asset_count_verified': assets,
        'dex_sha256': hashlib.sha256(dex).hexdigest(),
        'signature_v2_valid': True,
        'zip_crc_valid': True,
        'alignment_valid': True,
    })
assert dexes[0] == dexes[1], 'The two install variants must contain the same code'
report['lecture_checks'] = len(lecture_checks)
report['feature_checks'] = len(feature_checks)
for line in (root / 'dist/STUDIO-SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split()
    assert hashlib.sha256((root / 'dist' / name).read_bytes()).hexdigest() == digest
# The 0.7.0 standard package in dist was rebuilt after artifacts/release-v0.7.json,
# so that record's hash is not the file this branch must leave untouched.
shipped_game_sha256 = {
    'WuziPing-Emberbound-0.7.0-debug.apk': '7220c1cc0da364bda8cb106d0c56d94cf4e158cf3235f5971636a5d48d896419',
    'WuziPing-Emberbound-0.7.0-parallel-debug.apk': '54cb3d0c1c3199b4871fd6913156206d0010e870e82a0cab66b42552a3493ad2',
}
for name, expected in shipped_game_sha256.items():
    actual = hashlib.sha256((root / 'dist' / name).read_bytes()).hexdigest()
    assert actual == expected, 'Game APK bytes changed: %s' % name
(out / 'release-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('PASS: game %d + studio I/O %d + legacy browser %d + 0.1.12 packaged-asset interaction %d + lecture mode %d; forward-slash entry names; both APKs and all offline assets; original 0.7 APKs preserved' % (report['game_checks'], report['studio_io_checks'], report['browser_checks'], report['browser_interaction_checks'], report['lecture_checks']))
print(json.dumps(report, ensure_ascii=False, indent=2))
