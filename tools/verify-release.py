"""Verify the shipped APKs independently of compilation; no Android runtime claims."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--sdk-root', default=r'D:\AndroidTools\android-sdk')
parser.add_argument('--jdk-root', default=r'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot')
args = parser.parse_args()
java = Path(args.jdk_root) / 'bin/java.exe'
bt = Path(args.sdk_root) / 'build-tools/34.0.0'


def output(*command):
    return subprocess.check_output([str(v) for v in command], text=True, encoding='utf-8')


def certificate(path):
    result = output(java, '-jar', bt / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', path)
    assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in result
    return re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', result).group(1)


log = (root / 'artifacts/verification-v0.7.log').read_text(encoding='utf-8')
counts = [int(n) for n in re.findall(r'ALL (\d+) (?:[A-Z0-9. ]+ )?CHECKS PASSED', log)]
assert counts == [33, 48, 101, 39, 69, 64], counts
screens = list((root / 'artifacts/screenshots-v0.7').glob('*.png'))
assert len(screens) == 49
report = {'version': '0.7.0', 'device_tested': False, 'checks': sum(counts), 'screenshots': len(screens), 'apks': []}
old_cert = certificate(root / 'dist/WuziPing-Emberbound-0.5.0-debug.apk')
external_cert = certificate(root / 'dist/WuziPing-Emberbound-0.6.0-debug.apk')
assets = sorted(p.relative_to(root / 'app/src/main/assets').as_posix() for p in (root / 'app/src/main/assets').rglob('*') if p.is_file())
dexes = []
certs = []
for suffix in ['debug', 'parallel-debug']:
    name = 'WuziPing-Emberbound-0.7.0-' + suffix + '.apk'
    path = root / 'dist' / name
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        dex = archive.read('classes.dex')
        dexes.append(dex)
        for cls in ['Game', 'MathJourney', 'MathRenderer', 'MainActivity', 'GameView']:
            assert ('Lcn/wuziping/ember/' + cls + ';').encode() in dex
        for asset in assets:
            assert archive.read('assets/' + asset) == (root / 'app/src/main/assets' / asset).read_bytes(), asset
    cert = certificate(path)
    certs.append(cert)
    subprocess.run([str(bt / 'zipalign.exe'), '-c', '4', str(path)], check=True)
    meta = output(bt / 'aapt.exe', 'dump', 'badging', path)
    package = 'cn.wuziping.ember.preview07' if suffix == 'parallel-debug' else 'cn.wuziping.ember'
    assert "package: name='" + package + "' versionCode='7' versionName='0.7.0'" in meta
    assert "launchable-activity: name='cn.wuziping.ember.MainActivity'" in meta
    assert "sdkVersion:'23'" in meta and "targetSdkVersion:'34'" in meta
    assert 'uses-permission:' not in meta
    report['apks'].append({'file': name, 'package': package, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'bytes': path.stat().st_size, 'dex_sha256': hashlib.sha256(dex).hexdigest(),
                           'assets_verified': len(assets), 'certificate_sha256': cert,
                           'certificate_matches_local_0_5': cert == old_cert,
                           'certificate_matches_external_0_6': cert == external_cert,
                           'entrypoint': 'cn.wuziping.ember.MainActivity',
                           'zip_crc_valid': True, 'signature_v2_valid': True, 'alignment_valid': True})
assert dexes[0] == dexes[1], 'Parallel APK must contain identical game code'
assert certs[0] == certs[1], 'Both delivery variants must use the same development key'
for line in (root / 'dist/SHA256SUMS.txt').read_text().splitlines():
    digest, filename = line.split()
    assert hashlib.sha256((root / 'dist' / filename).read_bytes()).hexdigest() == digest
(root / 'artifacts/release-v0.7.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('PASS: 354 logic checks, 49 screenshots, both APKs, assets, signatures, entrypoints, DEX identity, alignment and hashes')
