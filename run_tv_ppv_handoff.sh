#!/bin/bash

# TV PPV -> Web handoff runner
# Runs the TV Appium PPV flow first, then continues checkout in Playwright
# using the DAZN handoff URL written to mobile_entry_url.txt.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PACKAGE="${APP_PACKAGE:-com.dazn}"
TV_TARGET="${TV_TARGET:-androidtv}"
SOURCE_RAW="${SOURCE:-schedule}"
PLAYWRIGHT_PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
WEB_SPEC="${WEB_SPEC:-tests/existing_user/existinguser.ppv.spec.ts}"
TV_PPV_CONFIG="${PPV_CONFIG:-}"
WEB_PPV_CONFIG="${WEB_PPV_CONFIG:-$TV_PPV_CONFIG}"
WEB_USER_STATE="${WEB_USER_STATE:-${USER_STATE:-active_standard_monthly}}"

SOURCE_NORMALIZED="$(printf '%s' "$SOURCE_RAW" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
case "$SOURCE_NORMALIZED" in
  schdule)
    SOURCE_NORMALIZED="schedule"
    ;;
esac

if [ "$SOURCE_NORMALIZED" != "schedule" ]; then
  echo "❌ TV PPV E2E currently supports SOURCE=schedule only. Received SOURCE=$SOURCE_RAW"
  echo "   home-page-banner is not implemented for the TV PPV handoff runner yet."
  exit 1
fi

if [ -n "$TV_PPV_CONFIG" ] && [ ! -f "$ROOT_DIR/config/events/$TV_PPV_CONFIG" ]; then
  case "$TV_PPV_CONFIG" in
    aj_joshua_prenga.json)
      TV_PPV_CONFIG="ppv_t_joshua_prenga.json"
      ;;
  esac
fi

if [ -n "$WEB_PPV_CONFIG" ] && [ ! -f "$ROOT_DIR/config/events/$WEB_PPV_CONFIG" ]; then
  case "$WEB_PPV_CONFIG" in
    aj_joshua_prenga.json)
      WEB_PPV_CONFIG="ppv_t_joshua_prenga.json"
      ;;
  esac
fi

export APP_PACKAGE
export TV_TARGET
export SOURCE="$SOURCE_NORMALIZED"
export USER_STATE="$WEB_USER_STATE"
export LOGIN_FIRST="${LOGIN_FIRST:-true}"
export HEADLESS="${HEADLESS:-false}"
export TV_HANDOFF_MODE="${TV_HANDOFF_MODE:-true}"
export TV_HANDOFF_STORAGE_STATE="${TV_HANDOFF_STORAGE_STATE:-$ROOT_DIR/tv_handoff_storage_state.json}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

echo "╔════════════════════════════════════════════════════╗"
echo "║  TV PPV -> Web End-to-End Handoff                 ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "TV_TARGET          : $TV_TARGET"
echo "APP_PACKAGE        : $APP_PACKAGE"
echo "DAZN_ENV           : ${DAZN_ENV:-not-set}"
echo "DAZN_REGION        : ${DAZN_REGION:-not-set}"
echo "PLAN               : ${PLAN:-not-set}"
echo "TV_PPV_CONFIG      : ${TV_PPV_CONFIG:-default}"
echo "WEB_PPV_CONFIG     : ${WEB_PPV_CONFIG:-default}"
echo "SOURCE             : $SOURCE"
echo "PLAYWRIGHT_PROJECT : $PLAYWRIGHT_PROJECT"
echo "WEB_SPEC           : $WEB_SPEC"
echo "USER_STATE         : $USER_STATE"
echo "LOGIN_FIRST        : $LOGIN_FIRST"
echo "TV_HANDOFF_MODE    : $TV_HANDOFF_MODE"
echo ""

echo "🧹 Step 1: Clearing and force-stopping DAZN app..."
npm --prefix "$ROOT_DIR/appium" run reset:android-app

echo ""
echo "📺 Step 2: Running TV PPV Appium flow..."
(
  cd "$ROOT_DIR/appium"
  if [ -n "$TV_PPV_CONFIG" ]; then
    PPV_CONFIG="$TV_PPV_CONFIG" npx wdio run config/wdio.android.conf.ts --spec ./tests/android/tv.ppv.spec.ts
  else
    npx wdio run config/wdio.android.conf.ts --spec ./tests/android/tv.ppv.spec.ts
  fi
)

echo ""
echo "🌐 Step 3: Continuing checkout from TV handoff URL in Playwright..."
(
  cd "$ROOT_DIR"
  if [ -n "$WEB_PPV_CONFIG" ]; then
    PPV_CONFIG="$WEB_PPV_CONFIG" npx playwright test "$WEB_SPEC" --project="$PLAYWRIGHT_PROJECT"
  else
    npx playwright test "$WEB_SPEC" --project="$PLAYWRIGHT_PROJECT"
  fi
)

echo ""
echo "✅ TV PPV -> Web end-to-end handoff completed."