#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# PPV Regression Suite — PROD only — Event: aj_joshua_prenga
# Covers: new_user + existing_user
#         mid-signin (LOGIN=false) and login-first (LOGIN=true)
#         random surfacing points, plans, user states
#         some cases with AUTH_METHOD=google and SWITCH=true
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
REPORT_DIR="$PROJ/regression_report"
LOG_DIR="$REPORT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SUMMARY="$REPORT_DIR/summary_${TIMESTAMP}.txt"

pass=0; fail=0

log_case() {
  local label="$1"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ▶  $label"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

run() {
  local label="$1"; shift
  local safe="${label// /_}"
  local logfile="$LOG_DIR/${safe}.log"
  log_case "$label"
  if env "$@" HEADLESS=true npx playwright test --project=chromium 2>&1 | tee "$logfile"; then
    echo "✅  PASS — $label" | tee -a "$SUMMARY"
    (( pass++ )) || true
  else
    echo "❌  FAIL — $label" | tee -a "$SUMMARY"
    (( fail++ )) || true
  fi
}

echo "PPV Regression — Event: aj_joshua_prenga — $(date)" > "$SUMMARY"
echo "═══════════════════════════════════════════════════════" >> "$SUMMARY"

# ─── NEW USER CASES ───────────────────────────────────────────────────────────

run "01 NEW_USER·std_monthly·landing-page-banner·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=landing-page-banner \
  tests/new_user/newuser.ppv.spec.ts

run "02 NEW_USER·std_apm·home-page-banner·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_apm SOURCE=home-page-banner \
  tests/new_user/newuser.ppv.spec.ts

run "03 NEW_USER·std_monthly·boxing-page-banner·US" \
  DAZN_ENV=prod DAZN_REGION=US PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=boxing-page-banner \
  tests/new_user/newuser.ppv.spec.ts

run "04 NEW_USER·std_monthly·home-boxing-tile·GB·AUTH=google" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=home-boxing-tile AUTH_METHOD=google \
  tests/new_user/newuser.ppv.spec.ts

run "05 NEW_USER·std_apm·search·US" \
  DAZN_ENV=prod DAZN_REGION=US PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_apm SOURCE=search \
  tests/new_user/newuser.ppv.spec.ts

run "06 NEW_USER·std_monthly·home-page-banner·AU" \
  DAZN_ENV=prod DAZN_REGION=AU PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=home-page-banner \
  tests/new_user/newuser.ppv.spec.ts

run "07 NEW_USER·std_monthly·schedule·SWITCH=true·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=schedule SWITCH=true \
  tests/new_user/newuser.ppv.spec.ts

run "08 NEW_USER·std_monthly·landing-page-dont-miss-live-switch·SWITCH=true·AUTH=google·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=landing-page-dont-miss-live-switch SWITCH=true AUTH_METHOD=google \
  tests/new_user/newuser.ppv.spec.ts

# ─── EXISTING USER CASES ──────────────────────────────────────────────────────

run "09 EXISTING·freemium·mid-signin·std_monthly·home-page-banner·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=home-page-banner USER_STATE=freemium LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

run "10 EXISTING·freemium·login-first·std_apm·boxing-page-banner·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_apm SOURCE=boxing-page-banner USER_STATE=freemium LOGIN=true \
  tests/existing_user/existinguser.ppv.spec.ts

run "11 EXISTING·frozen·mid-signin·std_monthly·home-boxing-tile·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=home-boxing-tile USER_STATE=frozen LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

run "12 EXISTING·frozen·login-first·std_monthly·landing-page-dont-miss-live·US" \
  DAZN_ENV=prod DAZN_REGION=US PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_monthly SOURCE=landing-page-dont-miss-live USER_STATE=frozen LOGIN=true \
  tests/existing_user/existinguser.ppv.spec.ts

run "13 EXISTING·active_standard_monthly·mid-signin·myaccount·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  SOURCE=myaccount USER_STATE=active_standard_monthly LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

run "14 EXISTING·active_standard_apm·login-first·search·US·AUTH=google" \
  DAZN_ENV=prod DAZN_REGION=US PPV_CONFIG=aj_joshua_prenga.json \
  SOURCE=search USER_STATE=active_standard_apm LOGIN=true AUTH_METHOD=google \
  tests/existing_user/existinguser.ppv.spec.ts

run "15 EXISTING·active_standard_monthly·mid-signin·boxing-page-bundle·SWITCH=true·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=ultimate_apm SOURCE=boxing-page-bundle USER_STATE=active_standard_monthly SWITCH=true LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

run "16 EXISTING·active_standard_apm·login-first·home-boxing-banner·SWITCH=true·AUTH=google·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=ultimate_apm SOURCE=home-boxing-banner USER_STATE=active_standard_apm SWITCH=true LOGIN=true AUTH_METHOD=google \
  tests/existing_user/existinguser.ppv.spec.ts

run "17 EXISTING·active_ultimate_apm·mid-signin·myaccount·GB" \
  DAZN_ENV=prod DAZN_REGION=GB PPV_CONFIG=aj_joshua_prenga.json \
  SOURCE=myaccount USER_STATE=active_ultimate_apm LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

run "18 EXISTING·frozen·mid-signin·schedule·std_apm·AU" \
  DAZN_ENV=prod DAZN_REGION=AU PPV_CONFIG=aj_joshua_prenga.json \
  PLAN=standard_apm SOURCE=schedule USER_STATE=frozen LOGIN=false \
  tests/existing_user/existinguser.ppv.spec.ts

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  REGRESSION COMPLETE — $(date)"
echo "  ✅  Passed : $pass"
echo "  ❌  Failed : $fail"
echo "  📄  Report : $SUMMARY"
echo "═══════════════════════════════════════════════════════"
{ echo ""; echo "TOTAL  Pass=$pass  Fail=$fail  Generated=$(date)"; } >> "$SUMMARY"
[ "$fail" -eq 0 ]
