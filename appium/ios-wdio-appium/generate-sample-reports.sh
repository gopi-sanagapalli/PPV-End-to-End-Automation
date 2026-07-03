#!/bin/bash

# Generate Sample Test Reports
# Usage: ./generate-sample-reports.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PROJECT_ROOT}/test/data"
REPORTS_DIR="${PROJECT_ROOT}/test/reports"

echo "📊 Generating Sample Test Reports..."
echo "=================================="

# Create reports directory
mkdir -p "$REPORTS_DIR"

echo ""
echo "1️⃣  Generating PPV Test Report (100% Pass Rate)..."
npx ts-node src/utils/report-util.ts "$DATA_DIR/sample-test-result.json" "$REPORTS_DIR"

echo ""
echo "2️⃣  Generating iOS App Test Report (91% Pass Rate with Failures)..."
npx ts-node src/utils/report-util.ts "$DATA_DIR/sample-ios-test-result.json" "$REPORTS_DIR"

echo ""
echo "✅ Reports Generated Successfully!"
echo ""
echo "📂 Reports Location: $REPORTS_DIR"
echo ""
echo "Generated Files:"
ls -lh "$REPORTS_DIR"/report-*.html 2>/dev/null | awk '{print "   - " $NF}' || echo "   (HTML reports)"
ls -lh "$REPORTS_DIR"/report-*.pdf 2>/dev/null | awk '{print "   - " $NF}' || echo "   (PDF reports - install puppeteer for PDF support)"
echo ""
echo "📖 To view reports, open the HTML files in your browser"
echo "   Or use: open $REPORTS_DIR/report-*.html"
