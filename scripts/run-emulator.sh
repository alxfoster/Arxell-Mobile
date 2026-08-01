#!/usr/bin/env bash
#
# run-emulator.sh — Build, install, and launch Arxell (prodDebug) on an
# Android emulator/device, with no manual environment setup required.
#
# The prodDebug variant is NOT in the React Gradle Plugin's debuggableVariants,
# so the Hermes JS bundle is pre-packaged into the APK — Metro is NOT needed.
#
# Usage:
#   ./scripts/run-emulator.sh                 # build + install + launch
#   ./scripts/run-emulator.sh --no-build      # install + launch only (reuse APK)
#   ./scripts/run-emulator.sh --build-only    # build only, no install/launch
#   ./scripts/run-emulator.sh --install-only  # install only (reuse APK), no launch
#   ./scripts/run-emulator.sh --clean         # gradle clean before build
#   ./scripts/run-emulator.sh -s <serial>     # target a specific device/emulator
#   ./scripts/run-emulator.sh --start-emulator -avd <name>  # boot an AVD first
#   ./scripts/run-emulator.sh --reset-cache   # pass --rerun-tasks (forces JS re-bundle)
#   ./scripts/run-emulator.sh --help
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config (override via flags or env)
# ---------------------------------------------------------------------------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"
VARIANT="prodDebug"
FLAVOR="prod"
APP_ID="com.pocketpalai"                 # applicationId (installed package name)
APK_REL="app/build/outputs/apk/prod/debug/app-prod-debug.apk"
APK_PATH="$ANDROID_DIR/$APK_REL"

DO_BUILD=1
DO_INSTALL=1
DO_LAUNCH=1
DO_CLEAN=0
RESET_CACHE=0
START_EMU=0
AVD_NAME=""
SERIAL="${ANDROID_SERIAL:-}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
c_bold="\033[1m"; c_green="\033[1;32m"; c_yellow="\033[1;33m"; c_red="\033[1;31m"; c_off="\033[0m"
say()  { printf "${c_green}▶${c_off} %s\n" "$*"; }
note() { printf "${c_bold}•${c_off} %s\n" "$*"; }
warn() { printf "${c_yellow}!${c_off} %s\n" "$*" >&2; }
die()  { printf "${c_red}✗${c_off} %s\n" "$*" >&2; exit 1; }

usage() {
  sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build)      DO_BUILD=0 ;;
    --build-only)    DO_INSTALL=0; DO_LAUNCH=0 ;;
    --install-only)  DO_BUILD=0; DO_LAUNCH=0 ;;
    --clean)         DO_CLEAN=1 ;;
    --reset-cache)   RESET_CACHE=1 ;;
    --start-emulator)START_EMU=1 ;;
    -avd)            AVD_NAME="$2"; shift ;;
    -s|--serial)     SERIAL="$2"; shift ;;
    -h|--help)       usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Resolve environment
# ---------------------------------------------------------------------------
# 1. ANDROID_HOME / ANDROID_SDK_ROOT
if [[ -z "${ANDROID_HOME:-}" ]]; then
  for cand in "$HOME/Android/Sdk" "$HOME/AndroidSDK" "/opt/android-sdk"; do
    [[ -d "$cand" ]] && export ANDROID_HOME="$cand" && break
  done
fi
[[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]] \
  || die "ANDROID_HOME not found. Export ANDROID_HOME or install the SDK at ~/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
[[ -x "$ADB" ]] || die "adb not found at $ADB (install 'platform-tools' via sdkmanager)"

# 2. JAVA_HOME — prefer env, then Android Studio's bundled JBR (JDK 21 runs Gradle 9).
if [[ -z "${JAVA_HOME:-}" ]] || ! command -v java >/dev/null 2>&1; then
  for cand in /snap/android-studio/*/jbr /opt/android-studio/jbr /opt/google/android-studio/jbr; do
    if [[ -x "$cand/bin/java" ]]; then export JAVA_HOME="$cand"; break; fi
  done
fi
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]] \
  || die "JAVA_HOME not found. Set JAVA_HOME to a JDK 17+ (Android Studio JBR works)."
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
note "ANDROID_HOME = $ANDROID_HOME"
note "JAVA_HOME    = $JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"

# 3. JDK 17 for the Kotlin toolchain (RN plugin forces jvmToolchain(17)).
#    A JDK 17 must be discoverable by Gradle because Foojay auto-download is
#    disabled (the plugin's foojay 0.9.0 is incompatible with Gradle 9).
JDK17="${ARXELL_JDK17:-${POCKETPAL_JDK17:-}}"
if [[ -z "$JDK17" ]]; then
  for cand in "$HOME/jdk-17"* /usr/lib/jvm/java-17-openjdk-* /usr/lib/jvm/temurin-17*; do
    [[ -x "$cand/bin/java" ]] && JDK17="$cand" && break
  done
fi
if [[ -n "$JDK17" ]]; then
  note "JDK17 toolchain = $JDK17"
else
  warn "No JDK 17 detected for the Kotlin toolchain. If the build fails with a"
  warn "toolchain error, set ARXELL_JDK17 or install Temurin 17."
fi

# ---------------------------------------------------------------------------
# (Optional) Boot an emulator
# ---------------------------------------------------------------------------
if [[ $START_EMU -eq 1 ]]; then
  if [[ -z "$AVD_NAME" ]]; then
    say "Available AVDs:"; "$EMULATOR" -list-avds | sed 's/^/    /'
    die "Specify an AVD with -avd <name>"
  fi
  say "Booting emulator for AVD '$AVD_NAME' (detached)…"
  nohup "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-load >/tmp/emulator.log 2>&1 &
  note "Waiting for device to come online…"
  "$ADB" wait-for-device
  note "Waiting for boot completion…"
  for _ in $(seq 1 120); do
    b="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    [[ "$b" == "1" ]] && break
    sleep 2
  done
  [[ "$b" == "1" ]] || die "Emulator did not finish booting (see /tmp/emulator.log)"
fi

# ---------------------------------------------------------------------------
# Select device
# ---------------------------------------------------------------------------
if [[ -z "$SERIAL" ]]; then
  mapfile -t DEVS < <("$ADB" devices | awk 'NR>1 && $2=="device"{print $1}')
  [[ ${#DEVS[@]} -gt 0 ]] || die "No connected devices. Start one with --start-emulator -avd <name>"
  SERIAL="${DEVS[0]}"
  [[ ${#DEVS[@]} -gt 1 ]] && warn "Multiple devices; using '$SERIAL'. Override with -s <serial>."
fi
note "Target device  = $SERIAL"
ADB=("$ANDROID_HOME/platform-tools/adb" -s "$SERIAL")

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if [[ $DO_BUILD -eq 1 ]]; then
  [[ $DO_CLEAN -eq 1 ]] && { say "Gradle clean…"; ( cd "$ANDROID_DIR" && ./gradlew clean --console=plain ); }
  GRADLE_ARGS=(--console=plain)
  [[ $RESET_CACHE -eq 1 ]] && GRADLE_ARGS+=(--rerun-tasks)
  say "Building :app:assemble${VARIANT^}…"
  ( cd "$ANDROID_DIR" && ./gradlew ":app:assemble$VARIANT" "${GRADLE_ARGS[@]}" )
fi
[[ -f "$APK_PATH" ]] || die "APK not found at $APK_PATH (did the build run?)"
note "APK = $APK_PATH ($(du -h "$APK_PATH" | cut -f1))"

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
if [[ $DO_INSTALL -eq 1 ]]; then
  say "Installing on $SERIAL…"
  "${ADB[@]}" install -r -d "$APK_PATH"
fi

# ---------------------------------------------------------------------------
# Launch (resolve the MAIN/LAUNCHER activity dynamically — applicationId
# (com.pocketpalai) differs from the manifest namespace (com.arxell),
# so the activity class is com.arxell.MainActivity, not com.pocketpalai.*).
# ---------------------------------------------------------------------------
if [[ $DO_LAUNCH -eq 1 ]]; then
  COMP="$("${ADB[@]}" shell cmd package resolve-activity --brief \
            -c android.intent.category.LAUNCHER "$APP_ID" 2>/dev/null | tail -n1 | tr -d '\r')"
  [[ -n "$COMP" && "$COMP" != "None" ]] \
    || die "Could not resolve launcher activity for $APP_ID"
  say "Launching $COMP…"
  "${ADB[@]}" shell am start -n "$COMP"
  sleep 3
  if PID="$("${ADB[@]}" shell pidof "$APP_ID" 2>/dev/null | tr -d '\r')"; [[ -n "$PID" ]]; then
    printf "${c_green}✓${c_off} Running — %s (pid %s)\n" "$APP_ID" "$PID"
    "${ADB[@]}" shell dumpsys activity activities 2>/dev/null \
      | grep -m1 -iE "topResumedActivity" | sed 's/^/    /'
  else
    warn "App is not in the foreground; check 'adb logcat' for a crash."
  fi
fi

echo
say "Done."
