"""Verify the standalone memorial game APK without changing published files.

The version comes from app/build.gradle. The historical 0.7.0 log
(artifacts/verification-v0.7.log, 354 checks) is not a pass condition.
Live Java suites are tools/verify-desktop.sh. Signature, alignment and badging
run only when the Android SDK tools are actually present. This does not build
or sign an APK.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

from verify_support import (
    ROOT,
    bytes_match,
    checksum_map,
    locate_release_tools,
    read_gradle_version,
    render_gate,
    sha256_file,
    verify_apk_signature,
)


GAME_CLASSES = (
    "Game",
    "MathJourney",
    "MathRenderer",
    "MainActivity",
    "GameView",
    "PhysicsJourney",
    "HistoryJourney",
    "OpenWorld",
    "OpenWorldRenderer",
    "AcademyTrial",
)
PACKAGE = "cn.wuziping.ember.memorial"
RESULTS: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str) -> None:
    RESULTS.append((name, status, detail))


def packaged_assets(archive: zipfile.ZipFile) -> dict[str, str]:
    found: dict[str, str] = {}
    for name in archive.namelist():
        if not name.startswith("assets/") or name.endswith("/"):
            continue
        logical = name[len("assets/"):].replace("\\", "/")
        found.setdefault(logical, name)
    return found


def check_assets(archive: zipfile.ZipFile) -> tuple[list[str], list[str], list[str]]:
    root = ROOT / "app" / "src" / "main" / "assets"
    packaged = packaged_assets(archive)
    bad: list[str] = []
    newlines: list[str] = []
    for logical, stored in sorted(packaged.items()):
        source = root / logical
        if not source.is_file():
            bad.append(f"{logical} is in the APK but not in app/src/main/assets")
            continue
        kind = bytes_match(archive.read(stored), source.read_bytes())
        if kind is None:
            bad.append(f"{logical} differs from source")
        elif kind == "newline":
            newlines.append(logical)
    extra = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        logical = path.relative_to(root).as_posix()
        if logical not in packaged:
            extra.append(logical)
    return bad, newlines, extra


def record_tools(tools) -> None:
    if tools.java:
        record("java", "PASS", str(tools.java))
    else:
        record("java", "SKIP", tools.java_detail)
    if tools.build_tools:
        record("build-tools", "PASS", str(tools.build_tools))
    else:
        record("build-tools", "SKIP", tools.sdk_detail)


def run_sdk_checks(path: Path, package: str, version, tools) -> None:
    if tools.java and tools.apksigner_jar:
        signature = subprocess.check_output(
            [str(tools.java), "-jar", str(tools.apksigner_jar), "verify", "--verbose", "--print-certs", str(path)],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        digest = verify_apk_signature(signature)
        record(f"signature {path.name}", "PASS", f"v2; certificate SHA-256 {digest}")
    if tools.zipalign:
        subprocess.run([str(tools.zipalign), "-c", "4", str(path)], check=True)
        record(f"alignment {path.name}", "PASS", f"zipalign -c 4 ({tools.build_tools.name})")
    if tools.aapt:
        meta = subprocess.check_output(
            [str(tools.aapt), "dump", "badging", str(path)],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        expected = f"package: name='{package}' versionCode='{version.version_code}' versionName='{version.version_name}'"
        if expected not in meta:
            raise AssertionError(f"badging missing {expected}")
        if "launchable-activity: name='cn.wuziping.ember.MainActivity'" not in meta:
            raise AssertionError("launchable activity is not MainActivity")
        record(f"badging {path.name}", "PASS", expected)


def print_table() -> None:
    width = max(5, *(len(name) for name, _, _ in RESULTS))
    print(f"{'CHECK'.ljust(width)}  {'STATUS':6}  DETAIL")
    for name, status, detail in RESULTS:
        print(f"{name.ljust(width)}  {status:6}  {detail}")
    print("Logic suites are not counted here. Run tools/verify-desktop.sh for the live Java checks.")


def finish(strict: bool) -> int:
    code, text = render_gate(RESULTS, strict)
    print(text, end="")
    return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk-root", default=None, help="JDK root. Defaults to JAVA_HOME, then java on PATH.")
    parser.add_argument("--sdk-root", default=None, help="Android SDK root. Defaults to ANDROID_HOME, then ANDROID_SDK_ROOT.")
    parser.add_argument("--build-tools", default=None, help="Build-tools version. Defaults to ANDROID_BUILD_TOOLS, else the highest complete install.")
    parser.add_argument("--strict", action="store_true", help="Release gate: missing SDK tools and known resource gaps exit non-zero.")
    args = parser.parse_args(argv)
    tools = locate_release_tools(jdk_root=args.jdk_root, sdk_root=args.sdk_root, build_tools=args.build_tools)
    record_tools(tools)

    try:
        version = read_gradle_version(ROOT / "app" / "build.gradle")
        record("gradle version", "PASS", f"{version.version_name} versionCode {version.version_code}")
    except Exception as error:
        record("gradle version", "FAIL", str(error))
        print_table()
        return finish(args.strict)

    checksums = checksum_map(ROOT / "dist" / "SHA256SUMS.txt")
    name = f"星火远征-纪念版-{version.version_name}.apk"
    path = ROOT / "dist" / name
    if not path.is_file():
        record(name, "FAIL", "file is not in dist/")
    else:
        digest = sha256_file(path)
        listed = checksums.get(name)
        if listed != digest:
            record(f"checksum {name}", "FAIL", f"listed={listed} computed={digest}")
        else:
            record(f"checksum {name}", "PASS", digest)
        try:
            with zipfile.ZipFile(path) as archive:
                bad_zip = archive.testzip()
                if bad_zip is not None:
                    raise AssertionError(f"corrupt zip entry {bad_zip}")
                dex = archive.read("classes.dex")
                missing = [cls for cls in GAME_CLASSES if f"Lcn/wuziping/ember/{cls};".encode() not in dex]
                if missing:
                    raise AssertionError("dex missing " + ", ".join(missing))
                record(f"dex {name}", "PASS", ", ".join(GAME_CLASSES))
                bad, newlines, extra = check_assets(archive)
                if bad:
                    raise AssertionError("; ".join(bad[:6]))
                if extra:
                    raise AssertionError("assets missing from APK: " + ", ".join(extra))
                detail = f"{len(packaged_assets(archive))} packaged assets match source"
                if newlines:
                    detail += f"; newline-only: {', '.join(newlines)}"
                record(f"assets {name}", "PASS", detail)
            record(f"zip {name}", "PASS", "CRC verified")
            try:
                run_sdk_checks(path, PACKAGE, version, tools)
            except Exception as error:
                record(f"sdk {name}", "FAIL", f"{type(error).__name__}: {error}")
        except Exception as error:
            record(name, "FAIL", f"{type(error).__name__}: {error}")

    print_table()
    return finish(args.strict)


if __name__ == "__main__":
    sys.exit(main())
