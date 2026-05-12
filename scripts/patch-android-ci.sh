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

remove_permission() {
  local file="$1"
  local permission="$2"
  sed -i -E "\\|<uses-permission[^>]+android:name=\"${permission}\"[^>]*/>|d" "$file"
}

set_manifest_icon() {
  local file="$1"
  set_manifest_attr "$file" icon "@mipmap/ic_launcher"
  set_manifest_attr "$file" roundIcon "@mipmap/ic_launcher_round"
}

install_launcher_icons() {
  mkdir -p \
    android/app/src/main/res/drawable \
    android/app/src/main/res/mipmap-anydpi \
    android/app/src/main/res/mipmap-anydpi-v26 \
    android/app/src/main/res/values

  find android/app/src/main/res -path '*/mipmap-*' -name 'ic_launcher*.png' -delete
  cp assets/android-res/drawable/ic_launcher.xml android/app/src/main/res/drawable/ic_launcher.xml
  cp assets/android-res/drawable/ic_launcher_foreground.xml android/app/src/main/res/drawable/ic_launcher_foreground.xml
  cp assets/android-res/mipmap-anydpi/ic_launcher.xml android/app/src/main/res/mipmap-anydpi/ic_launcher.xml
  cp assets/android-res/mipmap-anydpi/ic_launcher_round.xml android/app/src/main/res/mipmap-anydpi/ic_launcher_round.xml
  cp assets/android-res/mipmap-anydpi-v26/ic_launcher.xml android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
  cp assets/android-res/mipmap-anydpi-v26/ic_launcher_round.xml android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
  cp assets/android-res/values/ic_launcher_background.xml android/app/src/main/res/values/ic_launcher_background.xml
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
set_manifest_icon android/app/src/main/AndroidManifest.xml

# Google Play build is offline-only: no in-app updater, analytics, ads, or network sync.
remove_permission android/app/src/main/AndroidManifest.xml android.permission.INTERNET
remove_permission android/app/src/main/AndroidManifest.xml android.permission.USE_EXACT_ALARM
if grep -qE 'android.permission.(INTERNET|USE_EXACT_ALARM|RECORD_AUDIO)' android/app/src/main/AndroidManifest.xml; then
  echo "Blocked sensitive permission remains in AndroidManifest.xml" >&2
  grep -E 'android.permission.(INTERNET|USE_EXACT_ALARM|RECORD_AUDIO)' android/app/src/main/AndroidManifest.xml >&2
  exit 1
fi

install_launcher_icons

# Keep R8 off until explicit keep rules are maintained for Capacitor plugins.
if grep -q 'minifyEnabled' android/app/build.gradle; then
  sed -i 's/minifyEnabled true/minifyEnabled false/' android/app/build.gradle
fi

echo "--- android/variables.gradle ---"
grep -E "compileSdk|targetSdk|minSdk" android/variables.gradle
echo "--- AndroidManifest.xml application attrs ---"
grep -E "allowBackup|usesCleartextTraffic|android:icon|android:roundIcon|INTERNET|USE_EXACT_ALARM" android/app/src/main/AndroidManifest.xml || true
echo "--- android/app/build.gradle minify ---"
grep -E "minifyEnabled|shrinkResources" android/app/build.gradle || true
