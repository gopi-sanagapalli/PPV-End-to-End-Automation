#!/bin/bash
set -e

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
DEVICE=$($ADB devices | grep -v "List" | grep "device" | head -1 | awk '{print $1}')

if [ -z "$DEVICE" ]; then
  echo "❌ No Android device connected!"
  exit 1
fi

echo "📱 Device: $DEVICE"
echo ""

# Take screenshot
echo "📸 Taking screenshot..."
$ADB shell screencap -p /sdcard/boxing_page_debug.png
$ADB pull /sdcard/boxing_page_debug.png ./test-results/boxing_page_debug.png 2>/dev/null || $ADB pull /sdcard/boxing_page_debug.png .
echo "  Saved: boxing_page_debug.png"

# Dump full UI hierarchy
echo ""
echo "📋 Dumping UI hierarchy..."
$ADB shell uiautomator dump /sdcard/ui_dump.xml
$ADB pull /sdcard/ui_dump.xml ./test-results/ui_dump.xml 2>/dev/null || $ADB pull /sdcard/ui_dump.xml .
echo "  Saved: ui_dump.xml"

# Search for "Don't Miss" or similar headings
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 Searching for 'Don't Miss' in UI dump..."
echo "═══════════════════════════════════════════════════════"
grep -i "don" ./test-results/ui_dump.xml 2>/dev/null || grep -i "don" ui_dump.xml 2>/dev/null || echo "  ❌ 'Don' NOT found anywhere in UI"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 Searching for 'Miss' in UI dump..."
echo "═══════════════════════════════════════════════════════"
grep -i "miss" ./test-results/ui_dump.xml 2>/dev/null || grep -i "miss" ui_dump.xml 2>/dev/null || echo "  ❌ 'Miss' NOT found anywhere in UI"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 ALL visible text elements on screen:"
echo "═══════════════════════════════════════════════════════"
grep -oP 'text="[^"]*"' ./test-results/ui_dump.xml 2>/dev/null | sort -u | head -50 || \
grep -oP 'text="[^"]*"' ui_dump.xml 2>/dev/null | sort -u | head -50

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 ALL content-desc values on screen:"
echo "═══════════════════════════════════════════════════════"
grep -oP 'content-desc="[^"]*"' ./test-results/ui_dump.xml 2>/dev/null | grep -v 'content-desc=""' | sort -u | head -50 || \
grep -oP 'content-desc="[^"]*"' ui_dump.xml 2>/dev/null | grep -v 'content-desc=""' | sort -u | head -50

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 Searching for PPV-related text (Joshua, fight, boxing, upcoming):"
echo "═══════════════════════════════════════════════════════"
grep -iE "(joshua|prenga|fight|upcoming|big|ppv|buy)" ./test-results/ui_dump.xml 2>/dev/null | head -20 || \
grep -iE "(joshua|prenga|fight|upcoming|big|ppv|buy)" ui_dump.xml 2>/dev/null | head -20

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 All rail/section headings (looking for alternatives to 'Don't Miss'):"
echo "═══════════════════════════════════════════════════════"
grep -oP 'text="[^"]{4,40}"' ./test-results/ui_dump.xml 2>/dev/null | grep -ivE "(boxing|home|schedule|search|sport|live|settings)" | sort -u | head -30 || \
grep -oP 'text="[^"]{4,40}"' ui_dump.xml 2>/dev/null | grep -ivE "(boxing|home|schedule|search|sport|live|settings)" | sort -u | head -30

echo ""
echo "✅ Diagnostic complete!"
echo ""
echo "📌 NEXT STEPS:"
echo "   1. Open boxing_page_debug.png to see what's on screen"
echo "   2. Check ui_dump.xml for the actual rail heading text"
echo "   3. The heading might NOT be 'Don't Miss' on the Boxing page!"
echo "      It could be: 'Upcoming', 'Big Fights', 'Coming Up', 'Events', etc."

