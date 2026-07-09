#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# PPV Regression Suite — AJ Joshua vs. Prenga | GB | ~50 Cases
# ═══════════════════════════════════════════════════════════════════════════════
# Usage: bash scripts/run_regression.sh
#
# Covers:
#   New User       — standard_monthly, standard_apm, ultimate_apm
#   Existing User  — freemium, frozen, active_standard (mid sign-in)
#   Login First    — freemium, frozen, active_standard
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

EVENT="aj_joshua_prenga"
REGION="GB"
ENV="prod"
BASE="DAZN_ENV=${ENV} DAZN_REGION=${REGION} PPV_EVENT=${EVENT}"

PASS=0; FAIL=0; SKIP=0; TOTAL=0
START_TIME=$(date +%s)
SUMMARY_LOG="regression_summary_$(date +%Y%m%dT%H%M%S).log"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "$*" | tee -a "$SUMMARY_LOG"; }
hdr()  { log "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  $*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

run_case() {
  local label="$1"; shift
  local cmd="$*"
  TOTAL=$((TOTAL + 1))
  printf -v n "%02d" "$TOTAL"
  log "\n[${n}] ${label}"
  log "    CMD: ${cmd}"
  set +e
  eval "$cmd --reporter=list" 2>&1 | tee -a "$SUMMARY_LOG"
  local exit_code=${PIPESTATUS[0]}
  set -e
  if [[ $exit_code -eq 0 ]]; then
    log "${GREEN}    ✅ PASSED${NC}"; PASS=$((PASS + 1))
  elif [[ $exit_code -eq 130 ]]; then
    log "${YELLOW}    ⚠️  SKIPPED/INTERRUPTED${NC}"; SKIP=$((SKIP + 1))
  else
    log "${RED}    ❌ FAILED (exit ${exit_code})${NC}"; FAIL=$((FAIL + 1))
  fi
}

# ─── SECTION 1: NEW USER · standard_monthly ──────────────────────────────────
hdr "SECTION 1 — NEW USER · standard_monthly (11 cases)"

run_case "New User | Search | Standard Monthly"             "${BASE} PLAN=standard_monthly SOURCE=search           npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Schedule | Standard Monthly"           "${BASE} PLAN=standard_monthly SOURCE=schedule         npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Boxing Tile | Standard Monthly"   "${BASE} PLAN=standard_monthly SOURCE=home-boxing-tile npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Boxing Banner | Standard Monthly" "${BASE} PLAN=standard_monthly SOURCE=home-boxing-banner npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Boxing Upcoming | Std Monthly"    "${BASE} PLAN=standard_monthly SOURCE=home-boxing-upcoming npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Boxing Page Banner | Standard Monthly" "${BASE} PLAN=standard_monthly SOURCE=boxing-page-banner npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Boxing Upcoming Fights | Std Monthly"  "${BASE} PLAN=standard_monthly SOURCE=boxing-upcoming-fights npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Landing Page Banner | Std Monthly"     "${BASE} PLAN=standard_monthly SOURCE=landing-page-banner npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Page Dont Miss | Std Monthly"     "${BASE} PLAN=standard_monthly SOURCE=home-page-dont-miss npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Biggest Fights | Std Monthly"     "${BASE} PLAN=standard_monthly SOURCE=home-biggest-fights npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Page Popup | Std Monthly"         "${BASE} PLAN=standard_monthly SOURCE=home-page-popup npx playwright test tests/new_user/newuser.ppv.spec.ts"

# ─── SECTION 2: NEW USER · standard_apm ──────────────────────────────────────
hdr "SECTION 2 — NEW USER · standard_apm (5 cases)"

run_case "New User | Search | Standard APM"             "${BASE} PLAN=standard_apm SOURCE=search           npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Schedule | Standard APM"           "${BASE} PLAN=standard_apm SOURCE=schedule         npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Boxing Tile | Standard APM"   "${BASE} PLAN=standard_apm SOURCE=home-boxing-tile npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Boxing Page Banner | Standard APM" "${BASE} PLAN=standard_apm SOURCE=boxing-page-banner npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Landing Page Banner | Std APM"     "${BASE} PLAN=standard_apm SOURCE=landing-page-banner npx playwright test tests/new_user/newuser.ppv.spec.ts"

# ─── SECTION 3: EXISTING USER · freemium (mid sign-in) ───────────────────────
hdr "SECTION 3 — EXISTING USER · freemium · mid sign-in (6 cases)"

run_case "Existing | Search | Freemium"                   "${BASE} SOURCE=search           USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Schedule | Freemium"                 "${BASE} SOURCE=schedule         USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Home Boxing Tile | Freemium"         "${BASE} SOURCE=home-boxing-tile USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Home Page Dont Miss | Freemium"      "${BASE} SOURCE=home-page-dont-miss USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Boxing Page Banner | Freemium"       "${BASE} SOURCE=boxing-page-banner USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Landing Page Banner | Freemium"      "${BASE} SOURCE=landing-page-banner USER_STATE=freemium npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 4: EXISTING USER · frozen (mid sign-in) ─────────────────────────
hdr "SECTION 4 — EXISTING USER · frozen · mid sign-in (4 cases)"

run_case "Existing | Search | Frozen"             "${BASE} SOURCE=search           USER_STATE=frozen npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Schedule | Frozen"           "${BASE} SOURCE=schedule         USER_STATE=frozen npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Home Boxing Tile | Frozen"   "${BASE} SOURCE=home-boxing-tile USER_STATE=frozen npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Boxing Page Banner | Frozen" "${BASE} SOURCE=boxing-page-banner USER_STATE=frozen npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 5: EXISTING USER · active_standard (mid sign-in) ────────────────
hdr "SECTION 5 — EXISTING USER · active_standard · mid sign-in (7 cases)"

run_case "Existing | Search | Active Standard"              "${BASE} SOURCE=search              USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Schedule | Active Standard"            "${BASE} SOURCE=schedule            USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Home Boxing Tile | Active Standard"    "${BASE} SOURCE=home-boxing-tile    USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Home Boxing Banner | Active Standard"  "${BASE} SOURCE=home-boxing-banner  USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Boxing Upcoming | Active Standard"     "${BASE} SOURCE=boxing-upcoming-fights USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | Landing Page Banner | Active Standard" "${BASE} SOURCE=landing-page-banner USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Existing | My Account | Active Standard"          "${BASE} SOURCE=myaccount           USER_STATE=active_standard npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 6: LOGIN FIRST · freemium ───────────────────────────────────────
hdr "SECTION 6 — LOGIN FIRST · freemium (6 cases)"

run_case "Login First | Search | Freemium"             "${BASE} SOURCE=search           USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Schedule | Freemium"           "${BASE} SOURCE=schedule         USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Home Boxing Tile | Freemium"   "${BASE} SOURCE=home-boxing-tile USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Home Page Dont Miss | Freemium" "${BASE} SOURCE=home-page-dont-miss USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Home Biggest Fights | Freemium" "${BASE} SOURCE=home-biggest-fights USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | My Account | Freemium"          "${BASE} SOURCE=myaccount USER_STATE=freemium LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 7: LOGIN FIRST · frozen ─────────────────────────────────────────
hdr "SECTION 7 — LOGIN FIRST · frozen (3 cases)"

run_case "Login First | Search | Frozen"           "${BASE} SOURCE=search           USER_STATE=frozen LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Schedule | Frozen"         "${BASE} SOURCE=schedule         USER_STATE=frozen LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Home Boxing Tile | Frozen" "${BASE} SOURCE=home-boxing-tile USER_STATE=frozen LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 8: LOGIN FIRST · active_standard ────────────────────────────────
hdr "SECTION 8 — LOGIN FIRST · active_standard (5 cases)"

run_case "Login First | Search | Active Standard"           "${BASE} SOURCE=search           USER_STATE=active_standard LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Schedule | Active Standard"         "${BASE} SOURCE=schedule         USER_STATE=active_standard LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Home Boxing Tile | Active Standard" "${BASE} SOURCE=home-boxing-tile USER_STATE=active_standard LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | Boxing Page Banner | Active Std"    "${BASE} SOURCE=boxing-page-banner USER_STATE=active_standard LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"
run_case "Login First | My Account | Active Standard"       "${BASE} SOURCE=myaccount USER_STATE=active_standard LOGIN_FIRST=true npx playwright test tests/existing_user/existinguser.ppv.spec.ts"

# ─── SECTION 9: NEW USER · ultimate_apm ──────────────────────────────────────
hdr "SECTION 9 — NEW USER · ultimate_apm (3 cases)"

run_case "New User | Search | Ultimate APM"           "${BASE} PLAN=ultimate_apm SOURCE=search           npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Schedule | Ultimate APM"         "${BASE} PLAN=ultimate_apm SOURCE=schedule         npx playwright test tests/new_user/newuser.ppv.spec.ts"
run_case "New User | Home Boxing Tile | Ultimate APM" "${BASE} PLAN=ultimate_apm SOURCE=home-boxing-tile npx playwright test tests/new_user/newuser.ppv.spec.ts"

# ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINS=$((DURATION / 60)); SECS=$((DURATION % 60))

log ""
log "╔══════════════════════════════════════════════════════════╗"
log "║          PPV REGRESSION SUITE COMPLETE                  ║"
log "╠══════════════════════════════════════════════════════════╣"
log "║  Total   : ${TOTAL}"
log "║  Passed  : ${GREEN}${PASS}${NC}"
log "║  Failed  : ${RED}${FAIL}${NC}"
log "║  Skipped : ${YELLOW}${SKIP}${NC}"
log "║  Duration: ${MINS}m ${SECS}s"
log "╠══════════════════════════════════════════════════════════╣"
log "║  Reports : reports/  (Excel + PDF per case)"
log "║  Log     : ${SUMMARY_LOG}"
log "╚══════════════════════════════════════════════════════════╝"

[[ $FAIL -gt 0 ]] && exit 1 || exit 0
