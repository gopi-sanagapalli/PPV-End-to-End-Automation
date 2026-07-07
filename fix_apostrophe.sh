#!/bin/bash
set -e

SPEC_FILE="appium/tests/specs/ppv.handoff.spec.ts"

if [ ! -f "$SPEC_FILE" ]; then
  echo "❌ File not found: $SPEC_FILE"
  exit 1
fi

cp "$SPEC_FILE" "${SPEC_FILE}.bak_apostrophe"
echo "📝 Fixing apostrophe encoding and scroll issues in $SPEC_FILE..."

python3 << 'PYTHON'
import re

spec_file = "appium/tests/specs/ppv.handoff.spec.ts"

with open(spec_file, 'r') as f:
    content = f.read()

changes = 0

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 1: Replace the strict XPath in scrollToAndCenterDontMissRail
#         Use "contains" instead of exact "@text=" match
# ═══════════════════════════════════════════════════════════════════════════════

old_xpath_line = '''const dontMissXPath = `//android.widget.TextView[@text="Don't Miss"]`;'''
new_xpath_line = '''const dontMissXPath = `//android.widget.TextView[contains(@text,"Don") and contains(@text,"Miss")]`;'''

if old_xpath_line in content:
    content = content.replace(old_xpath_line, new_xpath_line)
    changes += 1
    print("✅ FIX 1: Replaced strict XPath with contains() for apostrophe-safe matching")
else:
    # Try with different quote styles
    alt1 = 'const dontMissXPath = `//android.widget.TextView[@text="Don\'t Miss"]`;'
    if alt1 in content:
        content = content.replace(alt1, new_xpath_line)
        changes += 1
        print("✅ FIX 1: Replaced strict XPath (alt quote) with contains()")
    else:
        print("⚠️  FIX 1: Could not find dontMissXPath line — searching broadly...")
        # Use regex to find and replace
        pattern = r'const dontMissXPath\s*=\s*`[^`]*`;'
        replacement = 'const dontMissXPath = `//android.widget.TextView[contains(@text,"Don") and contains(@text,"Miss")]`;'
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            content = new_content
            changes += 1
            print("✅ FIX 1: Replaced dontMissXPath via regex")
        else:
            print("❌ FIX 1: FAILED — dontMissXPath not found at all")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 2: Increase scroll attempts from 10 to 25 in scrollToAndCenterDontMissRail
# ═══════════════════════════════════════════════════════════════════════════════

old_loop = "for (let i = 0; i < 10; i++) {"
# Only replace the one inside scrollToAndCenterDontMissRail (near dontMissXPath)
# Find the function and replace within it
func_start = content.find("async function scrollToAndCenterDontMissRail")
if func_start > 0:
    # Find the first "for (let i = 0; i < 10" after the function start
    loop_pos = content.find("for (let i = 0; i < 10; i++) {", func_start)
    if loop_pos > 0 and loop_pos < func_start + 2000:  # Within reasonable range
        content = content[:loop_pos] + "for (let i = 0; i < 25; i++) {" + content[loop_pos + len("for (let i = 0; i < 10; i++) {"):]
        changes += 1
        print("✅ FIX 2: Increased scroll loop from 10 to 25 iterations")
    else:
        print("⚠️  FIX 2: Loop not found near scrollToAndCenterDontMissRail")
else:
    print("⚠️  FIX 2: scrollToAndCenterDontMissRail function not found")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 3: Replace scrollDown(driver) with larger ADB swipe in the heading search
# ═══════════════════════════════════════════════════════════════════════════════

old_scroll_in_loop = '''console.log(`  Don't Miss heading not visible, scrolling down (attempt ${i + 1})...`);
    await scrollDown(driver);
    await driver.pause(700);'''

new_scroll_in_loop = '''console.log(`  Don't Miss heading not visible, scrolling down (attempt ${i + 1})...`);
    // Use aggressive ADB swipe (75% screen height) instead of small scrollDown
    const __screen = getScreenSize();
    adbSwipe(
      Math.round(__screen.width / 2),
      Math.round(__screen.height * 0.82),
      Math.round(__screen.width / 2),
      Math.round(__screen.height * 0.22)
    );
    await driver.pause(1000);'''

if old_scroll_in_loop in content:
    content = content.replace(old_scroll_in_loop, new_scroll_in_loop)
    changes += 1
    print("✅ FIX 3: Replaced scrollDown with aggressive adbSwipe in heading search")
else:
    # Try alternate formatting
    alt_scroll = "Don't Miss heading not visible, scrolling down"
    if alt_scroll in content:
        # Find the scrollDown call after this log line
        idx = content.find(alt_scroll)
        scroll_idx = content.find("await scrollDown(driver);", idx)
        if scroll_idx > 0 and scroll_idx < idx + 200:
            old_part = "await scrollDown(driver);\n    await driver.pause(700);"
            new_part = """// Use aggressive ADB swipe (75% screen height)
    const __screen = getScreenSize();
    adbSwipe(
      Math.round(__screen.width / 2),
      Math.round(__screen.height * 0.82),
      Math.round(__screen.width / 2),
      Math.round(__screen.height * 0.22)
    );
    await driver.pause(1000);"""
            # Replace just this occurrence
            before = content[:scroll_idx]
            after = content[scroll_idx:]
            after = after.replace("await scrollDown(driver);\n    await driver.pause(700);", new_part, 1)
            content = before + after
            changes += 1
            print("✅ FIX 3: Replaced scrollDown (alternate match)")
        else:
            print("⚠️  FIX 3: scrollDown not found near the log line")
    else:
        print("⚠️  FIX 3: Could not find scroll section")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 4: Add UiScrollable as FIRST attempt before manual scroll
# ═══════════════════════════════════════════════════════════════════════════════

uiscrollable_block = '''
  // ── PRE-STEP: Try UiScrollable (fastest way to scroll to text) ──
  console.log('  PRE-STEP: Trying UiScrollable scrollIntoView...');
  const _scrollTargets = ["Don\\'t Miss", "Don\\u2019t Miss", "Dont Miss"];
  for (const _target of _scrollTargets) {
    try {
      const _scrolledEl = await driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(` +
        `new UiSelector().textContains("${_target}"))`
      );
      if (await _scrolledEl.isDisplayed()) {
        console.log(`  ✅ UiScrollable found heading: "${_target}"`);
        // Verify it's the right element
        const _txt = await _scrolledEl.getText().catch(() => '');
        if (_txt && /miss/i.test(_txt)) {
          heading = _scrolledEl;
          console.log(`  ✅ Confirmed heading text: "${_txt}"`);
          break;
        }
      }
    } catch (e: any) {
      console.log(`  UiScrollable failed for "${_target}": ${e.message}`);
    }
  }
  
  if (heading) {
    console.log('  ✅ Heading found via UiScrollable — skipping manual scroll');
  } else {
    console.log('  ⚠️ UiScrollable did not find heading — proceeding with manual scroll...');
  }

'''

# Insert BEFORE the manual scroll loop
marker = "const dontMissXPath = `//android.widget.TextView[contains(@text,\"Don\") and contains(@text,\"Miss\")]`;"
if marker in content:
    content = content.replace(marker, uiscrollable_block + "  " + marker)
    changes += 1
    print("✅ FIX 4: Added UiScrollable pre-step before manual scroll")
else:
    # Try finding any dontMissXPath declaration
    xpath_pattern = r'const dontMissXPath\s*='
    match = re.search(xpath_pattern, content)
    if match:
        insert_pos = match.start()
        content = content[:insert_pos] + uiscrollable_block + "  " + content[insert_pos:]
        changes += 1
        print("✅ FIX 4: Added UiScrollable pre-step (via regex match)")
    else:
        print("⚠️  FIX 4: Could not find insertion point for UiScrollable")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 5: Skip manual scroll if heading already found by UiScrollable
# ═══════════════════════════════════════════════════════════════════════════════

# Wrap the manual scroll loop with "if (!heading)"
old_manual_loop_start = "for (let i = 0; i < 25; i++) {\n    try {\n      heading = await driver.$(dontMissXPath);"
new_manual_loop_start = "if (!heading) {\n  for (let i = 0; i < 25; i++) {\n    try {\n      heading = await driver.$(dontMissXPath);"

if old_manual_loop_start in content:
    content = content.replace(old_manual_loop_start, new_manual_loop_start, 1)
    # Now we need to close the if block after the loop
    # Find the end of the loop (the "if (!heading)" error throw)
    loop_end_marker = "throw new Error('❌ \"Don\\'t Miss\" rail heading not found using XPath.');"
    loop_end_idx = content.find(loop_end_marker)
    if loop_end_idx > 0:
        # Find the closing brace of the if(!heading) block before the throw
        # Insert a closing brace for our new if(!heading) wrapper
        # Look for the line just before the throw
        pre_throw = content[:loop_end_idx].rfind("}")
        if pre_throw > 0:
            # Insert closing brace for our if(!heading) wrapper
            content = content[:pre_throw+1] + "\n  } // end if(!heading) wrapper\n" + content[pre_throw+1:]
            changes += 1
            print("✅ FIX 5: Wrapped manual scroll loop with if(!heading) guard")
    else:
        print("⚠️  FIX 5: Could not find loop end to close if block")
else:
    print("⚠️  FIX 5: Manual loop start pattern not found (may already be 10 iterations)")
    # Try with original 10
    old_10_loop = "for (let i = 0; i < 10; i++) {\n    try {\n      heading = await driver.$(dontMissXPath);"
    if old_10_loop in content:
        content = content.replace(old_10_loop, new_manual_loop_start.replace("25", "25"), 1)
        changes += 1
        print("✅ FIX 5: Wrapped 10-iteration loop with if(!heading)")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 6: Update findDontMissHeading selectors to handle smart quotes
# ═══════════════════════════════════════════════════════════════════════════════

# Add a regex-based selector that handles any apostrophe variant
old_heading_selectors = '''const headingSelectors = [
    `android=new UiSelector().textContains("Don't Miss")`,
    `android=new UiSelector().textContains("Dont Miss")`,
    `android=new UiSelector().textContains("Don\u2019t Miss")`,
    `//android.widget.TextView[contains(@text,"Don't Miss")]`,
    `//android.widget.TextView[contains(@text,"Dont Miss")]`,
    `//android.widget.TextView[contains(@text,"Don\u2019t Miss")]`,
  ];'''

new_heading_selectors = '''const headingSelectors = [
    `android=new UiSelector().textMatches(".*[Dd]on.*[Mm]iss.*")`,
    `android=new UiSelector().textContains("Don't Miss")`,
    `android=new UiSelector().textContains("Dont Miss")`,
    `android=new UiSelector().textContains("Don\u2019t Miss")`,
    `//android.widget.TextView[contains(@text,"Don") and contains(@text,"Miss")]`,
    `//android.widget.TextView[contains(@text,"Don't Miss")]`,
    `//android.widget.TextView[contains(@text,"Dont Miss")]`,
    `//android.widget.TextView[contains(@text,"Don\u2019t Miss")]`,
    `//android.view.View[contains(@content-desc,"Don") and contains(@content-desc,"Miss")]`,
  ];'''

if old_heading_selectors in content:
    content = content.replace(old_heading_selectors, new_heading_selectors)
    changes += 1
    print("✅ FIX 6: Updated findDontMissHeading selectors with regex and contains()")
else:
    print("⚠️  FIX 6: Exact heading selectors block not found — trying partial replacement")
    # At minimum, add the regex selector
    old_first_sel = '`android=new UiSelector().textContains("Don\'t Miss")`,'
    new_first_sel = '`android=new UiSelector().textMatches(".*[Dd]on.*[Mm]iss.*")`,\n    `android=new UiSelector().textContains("Don\'t Miss")`,'
    if old_first_sel in content:
        content = content.replace(old_first_sel, new_first_sel, 1)
        changes += 1
        print("✅ FIX 6: Added regex selector as first option")

# ═══════════════════════════════════════════════════════════════════════════════
# FIX 7: Add longer pause after clicking Boxing filter (content needs to load)
# ═══════════════════════════════════════════════════════════════════════════════

old_boxing_wait = '''await clickHomeBoxingFilter(driver);
      await waitForBoxingPageRailTitles(driver);'''

new_boxing_wait = '''await clickHomeBoxingFilter(driver);
      console.log('  Waiting for Boxing page content to fully load...');
      await driver.pause(4000);  // Extra wait for lazy-loaded content
      await waitForBoxingPageRailTitles(driver);
      await driver.pause(2000);  // Additional settle time'''

content = content.replace(old_boxing_wait, new_boxing_wait)
if old_boxing_wait not in content:
    # For home-page-dont-miss which doesn't have clickHomeBoxingFilter
    pass
else:
    changes += 1
    print("✅ FIX 7: Added extra wait after Boxing filter click")

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

with open(spec_file, 'w') as f:
    f.write(content)

print(f"\n{'═' * 60}")
print(f"✅ Applied {changes} fix(es) to {spec_file}")
print(f"{'═' * 60}")

if changes == 0:
    print("\n⚠️  NO CHANGES WERE MADE — the file format may differ from expected.")
    print("    Please check the file manually or share the exact error output.")

PYTHON

echo ""
echo "🧪 Now test with:"
echo "   cd appium && SOURCE=home-boxing-tile PPV_NAME=Joshua npm run android"
echo "   cd appium && SOURCE=home-page-dont-miss PPV_NAME=Joshua npm run android"

