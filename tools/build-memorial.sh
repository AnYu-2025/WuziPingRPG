#!/usr/bin/env bash
# 纪念版独立游戏包：只含 core + app（无工作台/WebView/Python 运行时）。
# 包名与版本从 app/build.gradle 读取，签名沿用 build/manual/debug.keystore。
# 与天工工作台包名不同，可在同一台设备共存。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${SDK_ROOT:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}}"
JDK_ROOT="${JDK_ROOT:-${JAVA_HOME:-}}"
if [[ -z "$JDK_ROOT" ]]; then
  if command -v javac >/dev/null 2>&1; then JDK_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else echo "Set JDK_ROOT or JAVA_HOME" >&2; exit 1; fi
fi
if [[ -z "$SDK_ROOT" ]]; then echo "Set SDK_ROOT or ANDROID_HOME" >&2; exit 1; fi
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
eval "$("$PY" "$ROOT/tools/verify_support.py" --gradle "$ROOT/app/build.gradle" --shell)"
APP_ID="$(sed -n "s/.*applicationId[[:space:]]*'\([^']*\)'.*/\1/p" "$ROOT/app/build.gradle" | head -n 1)"
if [[ -z "$APP_ID" ]]; then echo "Cannot parse applicationId from app/build.gradle" >&2; exit 1; fi

PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
BT="$SDK_ROOT/build-tools/34.0.0"
for required in "$PLATFORM" "$JDK_ROOT/bin/javac" "$JDK_ROOT/bin/jar" "$BT/aapt2" "$BT/aapt" "$BT/zipalign" "$BT/lib/d8.jar" "$BT/lib/apksigner.jar"; do
  if [[ ! -e "$required" ]]; then echo "Missing build dependency: $required" >&2; exit 1; fi
done

WORK="$ROOT/build/memorial"
CLASSES="$WORK/classes"; DEX="$WORK/dex"; DIST="$ROOT/dist"
mkdir -p "$CLASSES" "$DEX" "$DIST"

SOURCES=()
while IFS= read -r -d '' file; do SOURCES+=("$file"); done < <(find "$ROOT/core/src/main/java" "$ROOT/app/src/main/java" -name '*.java' -print0)
"$JDK_ROOT/bin/javac" -encoding UTF-8 --release 8 -classpath "$PLATFORM" -d "$CLASSES" "${SOURCES[@]}"
"$JDK_ROOT/bin/jar" cf "$WORK/classes.jar" -C "$CLASSES" .
"$JDK_ROOT/bin/java" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --lib "$PLATFORM" --min-api 23 --output "$DEX" "$WORK/classes.jar"
"$BT/aapt2" compile --dir "$ROOT/app/src/main/res" -o "$WORK/resources.zip"

MANIFEST="$WORK/AndroidManifest.xml"
sed "s/<manifest /<manifest package=\"$APP_ID\" /" "$ROOT/app/src/main/AndroidManifest.xml" > "$MANIFEST"

UNSIGNED="$WORK/unsigned.apk"
"$BT/aapt2" link -o "$UNSIGNED" --manifest "$MANIFEST" -I "$PLATFORM" -A "$ROOT/app/src/main/assets" -0 wav \
  --min-sdk-version 23 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$WORK/resources.zip"
"$JDK_ROOT/bin/jar" uf "$UNSIGNED" -C "$DEX" classes.dex
ALIGNED="$WORK/aligned.apk"
"$BT/zipalign" -f 4 "$UNSIGNED" "$ALIGNED"

KEY="$ROOT/build/manual/debug.keystore"
if [[ ! -f "$KEY" ]]; then echo "Original development key is missing: $KEY" >&2; exit 1; fi
APK="$DIST/星火远征-纪念版-${VERSION_NAME}.apk"
"$JDK_ROOT/bin/java" -jar "$BT/lib/apksigner.jar" sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android --out "$APK" "$ALIGNED"
rm -f "$APK.idsig"
"$JDK_ROOT/bin/java" -jar "$BT/lib/apksigner.jar" verify --verbose "$APK" | head -4
"$BT/zipalign" -c 4 "$APK"
"$BT/aapt" dump badging "$APK" | head -6
"$PY" "$ROOT/tools/verify_support.py" --merge-checksums "$DIST/SHA256SUMS.txt" "$(basename "$APK")"
echo "Memorial APK ready: $APK"
