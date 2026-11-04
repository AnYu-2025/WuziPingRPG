"""Rewrite Windows-style separators in APK entry names.

aapt2 on Windows stores nested assets as ``assets/studio\\style.css``. Python's
zipfile silently converts those names while reading, so checks that only use
zipfile miss the problem; Android's AssetManager and Java's ZipFile use the
stored name verbatim and therefore cannot open ``studio/style.css``.

The patch rewrites the name bytes in both the local file header and the central
directory. Lengths, CRCs, payloads and alignment metadata stay untouched, so
zipalign and apksigner can run normally afterwards.
"""
from pathlib import Path
import struct
import sys

CENTRAL = b'PK\x01\x02'
LOCAL = b'PK\x03\x04'
END = b'PK\x05\x06'


def normalize(path):
    data = bytearray(Path(path).read_bytes())
    end = data.rfind(END)
    if end < 0 or end + 22 > len(data):
        raise SystemExit('%s: end of central directory not found' % path)
    total, cd_size, cd_offset = struct.unpack_from('<HII', data, end + 10)
    position = cd_offset
    changed = 0
    for index in range(total):
        if data[position:position + 4] != CENTRAL:
            raise SystemExit('%s: bad central header at %d' % (path, position))
        name_length, extra_length, comment_length = struct.unpack_from('<HHH', data, position + 28)
        local_offset = struct.unpack_from('<I', data, position + 42)[0]
        name = bytes(data[position + 46:position + 46 + name_length])
        fixed = name.replace(b'\\', b'/')
        if fixed != name:
            data[position + 46:position + 46 + name_length] = fixed
            if data[local_offset:local_offset + 4] != LOCAL:
                raise SystemExit('%s: bad local header for %r' % (path, name))
            local_length = struct.unpack_from('<H', data, local_offset + 26)[0]
            if bytes(data[local_offset + 30:local_offset + 30 + local_length]) != name:
                raise SystemExit('%s: local/central name mismatch for %r' % (path, name))
            data[local_offset + 30:local_offset + 30 + local_length] = fixed
            changed += 1
        position += 46 + name_length + extra_length + comment_length
    if position != cd_offset + cd_size:
        raise SystemExit('%s: central directory walk ended at %d, expected %d' % (path, position, cd_offset + cd_size))
    if changed:
        Path(path).write_bytes(data)
    print('%s: normalized %d of %d entry names' % (Path(path).name, changed, total))
    return changed


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: normalize-apk-assets.py APK [APK ...]')
    for apk in sys.argv[1:]:
        normalize(apk)
