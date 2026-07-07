#!/bin/bash
set -e

SPEC_FILE="appium/tests/specs/ppv.handoff.spec.ts"

if [ ! -f "$SPEC_FILE" ]; then
  echo "❌ Spec file not found: $SPEC_FILE"
  echo "   Please run this from the project root directory."
  exit 1
fi

echo "📝 Patching $SPEC_FILE..."

# Add import for the new helper file at the top (after existing imports)
sed -i.tmp '/import { prepareAndroidApp, waitForHomePage }.*androidSetup/a\
import {\
  findDontMissHeadingFixed,\
  getDontMissRailWindowFixed,\
  scrollToAndCenterDontMissRailFixed,\
  findVisiblePPVTileCandidateFixed,\
  RailSearchWindow as RailSearchWindowFixed,\
} from "../../helpers/dontMissRailHelpers";' "$SPEC_FILE"

echo "✅ Added import statement"

# Now replace the home-boxing-tile block's scrollToAndCenterDontMissRail call
# We use a Python script for more precise multi-line replacement

python3 << 'PYTHON'
import re

spec_file = "appium/tests/specs/ppv.handoff.spec.ts"

with open(spec_file, 'r') as f:
    content = f.read()

# ─�# ─�# ─�# ─�# ─�# ─�# ─�# Do# �ssRail calls ─# ─�# ─�# ─�# ─�# ─�# ─�# �─────────
# In both home-boxing-tile and home-page-dont-miss blocks

old_scroll_call = "let railWindow = await scrollToAndCenterDontMissRail(driver);"
new_scroll_call = "let railWinnew_scroll_call = "let railWinnew_scroll_call = "let railWinnew_scrtScreenSize());"

content = content.replace(old_scroll_call, new_scroll_call)
prinprinprinplprinprinprinplprinprinprinpolprinprinprinplprinprinprerDontMprinprinprinplprinprinprinplprinix 2: Rprinprinprinplprinprinprinplpris in tprinprinprinplprinprinprinplprinpri�───�prinprinprinplprinprinprinplprinprinprinpolprinprinit findDontMissHeading(driver);"
new_heading_call = "const heading = await findDontMissHeadingFixed(driver);"

content = content.replace(old_heading_call, new_heading_call)
print(f"  Replaced findDontMissHeading calls")

# ─── Fix 3: Replace getDontMissRailWindow ca# ─── Fix 3: Replace get��# ─── Fix 3: Re���# ─── Fix 3: Replace getDontMissRailWindow ca# ─── Fix 3: Replace get��# ─── Fix 3: Re���# ─── Fix 3: Replaow# ─── Fix 3: Replace getDontMissRailWindow ca# ver, h# ─── Fix 3: Replace getDontMissRailWindow ca# ─── Fix 3: Replaceil_wi# ─── Fix 3: Replace getDontMissRailWindow ca# ─── Fix 3: Replace get��# ─── Fix 3: Re���# ─alls ─────────────────────────
old_find_tile = "ppvCandidate = await findVisiblePPVTileCandidate(driver, railWindow);"
new_find_tile = "ppvCandidate = await findVisiblePPVTileCandidateFixed(driver, railWindow, PPV_NAME, scorePPVTitleMatch);"

content = content.replace(old_find_tile, new_find_content = content.replace(old_find_tile, new_find_content = content.replaceix content = content.replace(old_find_tile, new_find_content────────────────
# Insert diagnostic block right before the scrollToAndCenterDontMissRailFixed call

diagnostic_block = '''
      // ── DIAGNOSTIC: Log visible page content before Don't Miss search ──
      console.log('🔍 DIAGNOSTIC: Scanning visible text before Don\\'t Miss search...');
      try {
        const diagTexts = await driver.$$('android=new UiSelector().className("android.widget.TextView")');
        const visibleLabels: string[] = [];
        for (const el of diagTexts) {
          try {
            if (await el.isDisplayed()) {
              const t = await el.ge              const t = await el.ge              const t = await el.ge              ;
                                                                                                                          els.                                                                                                before_dont_miss.png');
      // ── END DIAGNOSTIC ──

'''

# Insert before the first occurrence of scrollToAndCenterDontMissRailF# Insert before the first occurrence of scrollToAndCenterDontMissRailF# Insert beMis# Insert before the fbSwipe, getScreenSize());",
    diagnostic_block + "      let railWindow = await scroll    diagnostic_block + "      let railWindow = await scroll    diagnostic_block + "     ccu    di
)
print("  Added diagnostic block before first Don't Miss search")

with open(spec_file, 'w') as f:
    f.write(c    f.write(c    f.write(c    f.write(c  ied successfully")
PYTHON

# Clean up temp file from sed
# Clean up temp file from sed
f.write(c �f.write(c �f.write(c �f.write(c �f.write(c �f.write(c �f.write(c �f.write(c �f.write(c �f.write(c helper functions"
echo "   2. Replaced scrollToAndCenterDontMissRail → scrollToAndCenterDontMissRailFixed"
echo "   3. Replaced findDontMissHeading → findDontMissHeadingFixed"
echo "   4. Replaced getDontMissRailWindow → getDontMissRailWindowFixed"
echo "echo "echo "echo "echo "echo "echo "didate �echo "echo "echo "echo "echo "echo "echo "didate �echo "echo "echo "echo "echo "echo "echo "didate �echo "echo "echo "echo "echo "echo "echo "didate �echo "echo "echo "echo "echo "echo "echo "didate �ee-boxing-tile npm run android"

