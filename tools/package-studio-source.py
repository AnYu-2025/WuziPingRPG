"""Self-contained studio + game sources and offline runtime; no keys or user data."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / 'dist/Ember-Studio-0.1.15-source.zip'
files = [root / p for p in ['README.md','settings.gradle','build.gradle','gradle.properties','.gitignore','.gitattributes','app/build.gradle']]
for directory in ['studio','core/src','app/src','tools','docs']:
    files += [p for p in (root / directory).rglob('*') if p.is_file() and not any(part in ['node_modules','build','.cache','__pycache__'] for part in p.relative_to(root).parts)]
files += list((root / 'artifacts/studio-v0.1').rglob('*'))
files += list((root / 'dist').glob('Ember-Studio-0.1.15*.apk'))
files += [root / 'dist/STUDIO-SHA256SUMS.txt']
files += [root / p for p in ['artifacts/screenshots-v0.7/08-town.png','artifacts/release-v0.7.json','dist/WuziPing-Emberbound-0.7.0-debug.apk','dist/WuziPing-Emberbound-0.7.0-parallel-debug.apk']]
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in sorted(set(p for p in files if p.is_file())):
        if p.suffix in ['.keystore','.jks','.bin','.idsig','.pyc'] or '.env' in p.name:
            raise RuntimeError('Private/local file would enter source bundle: '+str(p))
        archive.write(p,'WuziPingRPG/'+p.relative_to(root).as_posix())
print(target)
