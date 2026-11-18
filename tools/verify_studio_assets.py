"""Compare the Studio shell actually shipped to Android with the web build."""

import re
from pathlib import Path
from zipfile import ZipFile

from verify_support import bytes_match


HASHED_SCRIPT = re.compile(r"-[A-Z0-9]{8}\.js$")
PAGES = ("studio/index.html", "studio/editor.page", "editor.page")


def shell_files(asset_root: Path) -> set[str]:
    return set(PAGES) | {
        path.relative_to(asset_root).as_posix()
        for path in (asset_root / "studio").iterdir()
        if path.is_file() and path.suffix in (".css", ".js")
    }


def check_shell_file(name: str, actual: bytes, expected: bytes) -> None:
    if bytes_match(actual, expected) is None:
        raise ValueError(f"{name} differs from its expected contents")


def check_apk_shell(archive: ZipFile, asset_root: Path, index: Path) -> int:
    expected = shell_files(asset_root)
    packed_scripts = {
        name[len("assets/"):] for name in archive.namelist()
        if name.startswith("assets/studio/") and name.count("/") == 2 and name.endswith((".css", ".js"))
    }
    extra = sorted(packed_scripts - expected)
    if extra:
        raise ValueError("unexpected scripts or styles in APK: " + ", ".join(extra))
    source = index.read_bytes()
    for name in sorted(expected):
        wanted = source if name in PAGES else (asset_root / name).read_bytes()
        check_shell_file(f"assets/{name}", archive.read(f"assets/{name}"), wanted)
    return len(expected)
