#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

set_gradle_var() {
  local file="$1"
  local name="$2"
  local value="$3"
  if ! grep -qE "${name}[[:space:]]*=" "$file"; then
    echo "Cannot find ${name} in ${file}" >&2
    exit 1
  fi
  sed -i -E "s/${name}[[:space:]]*=[[:space:]]*[0-9]+/${name} = ${value}/" "$file"
}

set_manifest_attr() {
  local file="$1"
  local attr="$2"
  local value="$3"
  if grep -q "android:${attr}=" "$file"; then
    sed -i -E "s/android:${attr}=\"[^\"]*\"/android:${attr}=\"${value}\"/" "$file"
  else
    sed -i -E "0,/<application /s//<application android:${attr}=\"${value}\" /" "$file"
  fi
}

ensure_permission() {
  local file="$1"
  local permission="$2"
  if ! grep -q "$permission" "$file"; then
    sed -i "s|</manifest>|    <uses-permission android:name=\"${permission}\"/>\\n</manifest>|" "$file"
  fi
}

require_file android/variables.gradle
require_file android/app/build.gradle
require_file android/app/src/main/AndroidManifest.xml

# Capacitor 6 defaults are lower than current Android dependency requirements.
set_gradle_var android/variables.gradle compileSdkVersion 35
set_gradle_var android/variables.gradle targetSdkVersion 35
set_gradle_var android/variables.gradle minSdkVersion 23

# Diary data should not be exposed through adb backup, and WebView should stay HTTPS-only.
set_manifest_attr android/app/src/main/AndroidManifest.xml allowBackup false
set_manifest_attr android/app/src/main/AndroidManifest.xml usesCleartextTraffic false

# Exact alarms keep reminder timing reliable on Android 13+.
ensure_permission android/app/src/main/AndroidManifest.xml android.permission.USE_EXACT_ALARM

# Keep R8 off until explicit keep rules are maintained for Capacitor plugins.
if grep -q 'minifyEnabled' android/app/build.gradle; then
  sed -i 's/minifyEnabled true/minifyEnabled false/' android/app/build.gradle
fi

echo "--- android/variables.gradle ---"
grep -E "compileSdk|targetSdk|minSdk" android/variables.gradle
echo "--- AndroidManifest.xml application attrs ---"
grep -E "allowBackup|usesCleartextTraffic|USE_EXACT_ALARM" android/app/src/main/AndroidManifest.xml
echo "--- android/app/build.gradle minify ---"
grep -E "minifyEnabled|shrinkResources" android/app/build.gradle || true
