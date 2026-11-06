"""Read-only checks for the Studio interface-fix build inputs and outputs."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "studio" / "web"
ASSETS = ROOT / "studio" / "src" / "main" / "assets" / "studio"
EDITOR_ACTIVITY = ROOT / "studio" / "src" / "main" / "java" / "cn" / "wuziping" / "studio" / "EditorActivity.java"
INDEX = WEB / "src" / "index.html"
BUILD_SCRIPT = WEB / "build.mjs"
WORKSPACE_BUNDLE = ASSETS / "app.js"
APK = ROOT / "dist" / "Ember-Studio-0.1.15.apk"

results: list[tuple[str, str, str]] = []


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(name: str, action) -> None:
    try:
        status, detail = action()
    except Exception as error:
        status, detail = "FAIL", f"{type(error).__name__}: {error}"
    results.append((name, status, detail))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_index_link():
    text = INDEX.read_text(encoding="utf-8")
    marker = '<link rel="stylesheet" href="ai.css">'
    require(marker in text, "index.html is missing the ai.css stylesheet link")
    return "PASS", marker


def check_asset_hash():
    source = WEB / "src" / "ai.css"
    bundled = ASSETS / "ai.css"
    require(source.is_file(), f"missing source: {source.relative_to(ROOT)}")
    require(bundled.is_file(), f"missing bundled asset: {bundled.relative_to(ROOT)}")
    source_hash = sha256(source)
    bundled_hash = sha256(bundled)
    require(source_hash == bundled_hash, f"hash mismatch: source={source_hash} bundled={bundled_hash}")
    return "PASS", f"sha256={source_hash}"


def check_copy_manifest():
    text = BUILD_SCRIPT.read_text(encoding="utf-8")
    require("'ai.css'" in text, "build.mjs copyFile list does not contain 'ai.css'")
    return "PASS", "build.mjs copies ai.css"


def packaged_page_source() -> str:
    text = EDITOR_ACTIVITY.read_text(encoding="utf-8")
    start = text.find("private void loadPackagedPage()")
    require(start >= 0, "loadPackagedPage() not found")
    end = text.find("private void escalateTransport()", start)
    require(end > start, "loadPackagedPage() terminator not found")
    return text[start:end]


def check_ai_read():
    section = packaged_page_source()
    require('readText("studio/ai.css")' in section, 'loadPackagedPage() does not read studio/ai.css')
    return "PASS", 'readText("studio/ai.css")'


def check_ai_inline_replace():
    section = packaged_page_source()
    require('href=\\"ai.css\\"' in section, "ai.css link replacement is missing")
    require('"<style>"+aiCss+"</style>"' in section, "aiCss is not inserted as a style element")
    return "PASS", "ai.css link is replaced with inline aiCss"


def check_stylesheet(name: str, variable: str):
    def action():
        section = packaged_page_source()
        require(f'readText("studio/{name}")' in section, f"loadPackagedPage() does not read {name}")
        require(f'href=\\"{name}\\"' in section, f"{name} link replacement is missing")
        require(f'"<style>"+{variable}+"</style>"' in section, f"{name} is not inserted as a style element")
        return "PASS", f"{name} is in the inline fallback"
    return action


def link_node_modules(source: Path, target: Path) -> None:
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(target), str(source)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise OSError((result.stderr or result.stdout or "mklink /J failed").strip())
    else:
        target.symlink_to(source, target_is_directory=True)


def check_bundle_sync():
    node = shutil.which("node")
    if not node:
        return "SKIP", "node executable is unavailable"
    if not (WEB / "node_modules").is_dir():
        return "SKIP", "studio/web/node_modules is unavailable"
    if not WORKSPACE_BUNDLE.is_file():
        return "FAIL", f"missing workspace bundle: {WORKSPACE_BUNDLE.relative_to(ROOT)}"

    workspace_hash = sha256(WORKSPACE_BUNDLE)
    with tempfile.TemporaryDirectory(prefix="wuziping-interface-verify-") as temp_name:
        temp = Path(temp_name)
        temp_web = temp / "studio" / "web"
        temp_out = temp / "studio" / "src" / "main" / "assets" / "studio"
        (temp_web / "src").parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(WEB / "src", temp_web / "src")
        shutil.copy2(BUILD_SCRIPT, temp_web / "build.mjs")
        shutil.copy2(WEB / "package.json", temp_web / "package.json")
        if (WEB / "package-lock.json").is_file():
            shutil.copy2(WEB / "package-lock.json", temp_web / "package-lock.json")
        temp_out.mkdir(parents=True, exist_ok=True)
        link_node_modules(WEB / "node_modules", temp_web / "node_modules")

        npm = shutil.which("npm.cmd") or shutil.which("npm")
        command = [npm, "run", "build"] if npm else [node, "build.mjs"]
        completed = subprocess.run(
            command,
            cwd=temp_web,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            output = (completed.stderr or completed.stdout or "").strip().splitlines()
            tail = " | ".join(output[-16:]) if output else "no build output"
            raise RuntimeError(f"temporary build failed: {tail}")
        generated = temp_out / "app.js"
        require(generated.is_file(), "temporary build did not create app.js")
        generated_hash = sha256(generated)
        runner = "npm run build" if npm else "node build.mjs (npm script target)"
        require(
            generated_hash == workspace_hash,
            f"bundle mismatch: generated={generated_hash} workspace={workspace_hash}",
        )
        return "PASS", f"{runner}; sha256={workspace_hash}"


def check_apk_ai_css():
    if not APK.is_file():
        return "SKIP", f"{APK.relative_to(ROOT)} is unavailable"
    source_size = (WEB / "src" / "ai.css").stat().st_size
    with zipfile.ZipFile(APK) as archive:
        try:
            packed = archive.getinfo("assets/studio/ai.css")
        except KeyError:
            return "FAIL", "assets/studio/ai.css is missing from the APK"
        require(
            packed.file_size == source_size,
            f"ai.css length mismatch: packed={packed.file_size} source={source_size}",
        )
    return "PASS", f"assets/studio/ai.css length={source_size}"


def check_apk_bundle():
    if not APK.is_file():
        return "SKIP", f"{APK.relative_to(ROOT)} is unavailable"
    workspace_hash = sha256(WORKSPACE_BUNDLE)
    with zipfile.ZipFile(APK) as archive:
        try:
            packed = archive.read("assets/studio/app.js")
        except KeyError:
            return "FAIL", "assets/studio/app.js is missing from the APK"
    packed_hash = hashlib.sha256(packed).hexdigest()
    require(
        packed_hash == workspace_hash,
        f"bundle mismatch: apk={packed_hash} workspace={workspace_hash}",
    )
    return "PASS", f"sha256={workspace_hash}"


def print_table() -> None:
    name_width = max(5, *(len(name) for name, _, _ in results))
    print(f"{'CHECK'.ljust(name_width)}  {'STATUS':6}  DETAIL")
    print(f"{'-' * name_width}  {'-' * 6}  {'-' * 48}")
    for name, status, detail in results:
        print(f"{name.ljust(name_width)}  {status:6}  {detail}")
    counts = {key: sum(1 for _, status, _ in results if status == key) for key in ("PASS", "FAIL", "SKIP")}
    print(f"\nSUMMARY: PASS={counts['PASS']} FAIL={counts['FAIL']} SKIP={counts['SKIP']}")


def main() -> int:
    record("index ai.css link", check_index_link)
    record("asset ai.css hash", check_asset_hash)
    record("build ai.css copy", check_copy_manifest)
    record("fallback ai.css read", check_ai_read)
    record("fallback ai.css inline", check_ai_inline_replace)
    record("fallback style.css", check_stylesheet("style.css", "css"))
    record("fallback lecture.css", check_stylesheet("lecture.css", "lectureCss"))
    record("fallback tts.css", check_stylesheet("tts.css", "ttsCss"))
    record("fallback ai.css inline list", check_stylesheet("ai.css", "aiCss"))
    record("generated bundle sync", check_bundle_sync)
    record("APK ai.css", check_apk_ai_css)
    record("APK app.js", check_apk_bundle)

    print_table()
    failed = any(status == "FAIL" for _, status, _ in results)
    print(f"EXIT: {'FAIL' if failed else 'PASS'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
