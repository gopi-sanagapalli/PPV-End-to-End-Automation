# Test Reporting Integration Guide

## Quick Start

### Generate Reports from Sample Data

```bash
# Generate PPV test report
npm run report:ppv

# Generate iOS test report  
npm run report:ios

# Generate both reports
npm run report:all

# Open reports in browser
npm run report:open
```

### Programmatic Usage

```typescript
import ReportUtil from './src/utils/report-util';

// Generate from test result JSON file
await ReportUtil.generateReportsFromFile(
  './test/data/my-result.json',
  './test/reports'
);

// Generate from test result object
const result = ReportUtil.createTestResult(
  'My Test',
  startTime,
  endTime,
  pageResults,
  environment,
  device
);

await ReportUtil.generateReports(result, './test/reports');
```

## Test Data Files

### Test Input Files
Define mandatory test inputs before running tests:

- **`test/data/ppv-test-inputs.json`**: PPV checkout flow requirements
- **`test/data/ios-app-test-inputs.json`**: iOS app E2E test requirements

These files define:
- Expected values and element selectors
- Mandatory vs optional checks
- Timeout configurations
- Test scenario steps

### Test Result Files
Generated after running tests:

- **`test/data/sample-test-result.json`**: Example passing test (100% pass rate)
- **`test/data/sample-ios-test-result.json`**: Example with failures (91% pass rate)

## Report Structure

### Generated Report Files
```
test/reports/
├── report-2026-06-25T15-00-14.html    # Passing test report
├── report-2026-06-25T15-00-27.html    # Partial test report
└── [more reports...]
```

### What's Included

Each report contains:

1. **Executive Summary**
   - Total checks, passed, failed counts
   - Overall pass percentage
   - Status badge (PASS/FAIL/PARTIAL)

2. **Execution Metrics**
   - Charts showing overall performance
   - Per-page performance breakdown
   - Pass rate distribution

3. **Run Configuration**
   - Environment (PROD, QA, etc.)
   - Device/Platform details
   - PPV event information
   - Test flow description

4. **Detailed Results**
   - Per-page check tables
   - Expected vs actual values
   - Pass/fail status indicators
   - Mandatory field highlighting

5. **Failure Details** (if applicable)
   - Failed test information
   - Expected vs actual comparison
   - Failure reasons
   - Screenshots with red highlighting

## Using in Test Suite

### 1. Record Checks During Tests

```typescript
import { recordCheck } from './src/utils/report-integration-example';

// In your test
it('should display page title', async () => {
  const titleElement = await $('[data-test="title"]');
  const titleText = await titleElement.getText();
  
  await recordCheck(
    'Login Page',           // page name
    'Page Title Visible',   // check name
    'Login',                // expected value
    titleText,              // actual value
    true                    // mandatory flag
  );
  
  expect(titleText).toBe('Login');
});
```

### 2. Set up Hooks for Report Generation

```typescript
// In your spec file
beforeAll(() => {
  global.testStartTime = new Date();
  global.testChecks = [];
});

afterAll(async () => {
  // This will automatically generate reports
  const testResult = ReportUtil.createTestResult(
    'My Test Suite',
    global.testStartTime,
    new Date(),
    pageResults,
    environment
  );
  
  await ReportUtil.generateReports(testResult, './test/reports');
});
```

### 3. Generate Reports After Test Completion

```bash
# After running tests
npm run report:all

# View the generated reports
npm run report:open
```

## Report Output Files

### HTML Report
- **Format**: Interactive HTML5
- **Size**: ~25-30 KB
- **Browser Support**: All modern browsers
- **Features**: 
  - Responsive design
  - Interactive charts
  - Click-to-expand details
  - Print-friendly CSS

### PDF Report  
- **Format**: PDF (A4)
- **Size**: ~50-100 KB (with images)
- **Features**:
  - Print-optimized
  - Page headers/footers
  - Automatic pagination
  - Requires puppeteer installation

## PDF Generation

To generate PDF reports, install puppeteer:

```bash
npm install puppeteer
```

Then PDF reports will be automatically generated alongside HTML reports.

Without puppeteer: HTML reports still work perfectly, PDF generation is skipped.

## Failure Highlighting

When tests fail, reports include:

1. **Red Highlight Boxes** on failure screenshots
2. **Expected vs Actual** comparison
3. **Failure Reason** description
4. **Error Context** and timestamps

Example failure display:
```
Expected: "Login"
Actual:   "Sign In"
Reason:   "Page title text doesn't match expected value"
```

## Customizing Reports

### Report Configuration

```typescript
const config = {
  title: 'Custom Report Title',
  companyName: 'Your Company',
  logoUrl: 'https://your-logo.png',
  footerText: 'Custom footer text',
  includeGraphs: true,           // Toggle charts
  highlightFailures: true,       // Highlight failures in red
  includeScreenshots: true,      // Include test screenshots
};

const generator = new ReportGenerator(testResult, config);
const htmlPath = generator.saveHTML('./path/to/report.html');
```

### Styling

Reports use embedded CSS. To customize appearance:

1. Edit CSS in `src/utils/report-generator.ts`
2. Look for the `<style>` section in `generateHTML()` method
3. Modify colors, fonts, spacing as needed

## Report Sections Breakdown

### 1. Header
```
Title: "Test Report Name"
Status: "ALL PASSED" (green badge)
Generated: Date and time
Duration: Total test execution time
```

### 2. Summary Cards
```
- Total Checks: 52
- Passed: 52
- Failed: 0
- Pass Rate: 100%
```

### 3. Charts
```
- Overall Pass/Fail Doughnut Chart
- Per-Page Performance Bar Chart
- Pass Rate Trend Line Chart
```

### 4. Configuration
```
Environment: PROD
Region: US
Device: iPhone iOS 15
PPV Event: Zayas vs. Boots
Plan: DAZN Ultimate
```

### 5. Per-Page Results
```
Per page:
- Page Name
- Pass/Fail counts
- Pass percentage
- Detailed check table
```

### 6. Failure Details (if applicable)
```
For each failure:
- Page and check name
- Expected vs actual values
- Failure reason
- Screenshot with red highlighting
```

## Command Reference

```bash
# Generate from data files
npm run report:ppv        # PPV test report
npm run report:ios        # iOS test report
npm run report:all        # Both reports

# Open reports
npm run report:open       # Open latest reports in browser

# Manual generation
npx ts-node src/utils/report-util.ts <result-file> [output-dir]

# Example
npx ts-node src/utils/report-util.ts test/data/sample-test-result.json test/reports
```

## Troubleshooting

### Reports not generating
- Ensure output directory exists: `mkdir -p test/reports`
- Check file paths are correct
- Verify test result JSON is valid

### Charts not showing
- Ensure Chart.js CDN is accessible
- Check browser console for errors
- Verify JavaScript is enabled

### PDF generation failing
- Install puppeteer: `npm install puppeteer`
- Check disk space for output file
- Verify output directory is writable

### Screenshots not displaying
- Use base64 encoded images
- Verify image file paths if using file references
- Check image file permissions

## Best Practices

1. **Name checks clearly**: Use descriptive check names for better reports
2. **Set mandatory flags**: Mark critical checks as mandatory
3. **Include device info**: Always capture device/environment data
4. **Generate after tests**: Generate reports in afterAll hook
5. **Archive reports**: Keep historical reports for trend analysis
6. **Review failures**: Always check failure details and screenshots
7. **Use base64 images**: Embed screenshot data for portability

## Integration Examples

See [report-integration-example.ts](./report-integration-example.ts) for:
- Complete integration with WebdriverIO
- Hook-based report generation
- Automated check recording
- Sample test file structure

---

**Version**: 1.0.0  
**Last Updated**: 2024-06-25
