"""Package only project sources, authored assets and reviewable outputs; exclude local keys/caches."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / 'dist/WuziPingRPG-0.7.0-source.zip'
files = [root / n for n in ['README.md', 'settings.gradle', 'build.gradle', 'gradle.properties', '.gitignore', '.gitattributes']]
for folder in ['app/src', 'core/src', 'tools', 'docs', 'artifacts']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.bin')
files += [root / 'app/build.gradle', root / 'dist/WuziPing-Emberbound-0.7.0-debug.apk', root / 'dist/WuziPing-Emberbound-0.7.0-parallel-debug.apk', root / 'dist/WuziPing-desktop-preview.jar', root / 'dist/SHA256SUMS.txt']
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in sorted(set(files)):
        if p.suffix in ['.keystore', '.jks']:
            raise RuntimeError('Signing key must not enter source bundle')
        archive.write(p, Path(root.name) / p.relative_to(root))
print(target)
