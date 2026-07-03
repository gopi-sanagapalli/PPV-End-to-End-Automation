/**
 * Example: Using the Report Generator in WebdriverIO Tests
 * 
 * This file demonstrates how to integrate the report generator
 * into your WebdriverIO test suite for automatic report generation
 */

import ReportUtil from '../src/utils/report-util';
import ReportGenerator from '../src/utils/report-generator';
import { TestResult, PageResult } from '../src/utils/report-types';

/**
 * Example 1: Generate Report from Test Result Object
 */
export async function example1_GenerateFromObject() {
  const testResult: TestResult = {
    testName: 'My Test Suite',
    status: 'PASS',
    startTime: new Date().toLocaleString(),
    endTime: new Date(Date.now() + 5 * 60000).toLocaleString(),
    duration: '5m 0s',
    totalChecks: 20,
    passedChecks: 20,
    failedChecks: 0,
    passPercentage: 100,
    environment: {
      name: 'PROD',
      region: 'US',
      surfacingPoint: 'Home Page',
    },
    pageResults: [
      {
        pageName: 'Login Page',
        passCount: 10,
        failCount: 0,
        totalCount: 10,
        passPercentage: 100,
        checks: [
          {
            checkName: 'Page Title Visible',
            expected: 'Login',
            actual: 'Login',
            status: 'PASS',
            mandatory: true,
          },
          // ... more checks
        ],
      },
    ],
    failedTests: [],
    reportGeneratedAt: new Date().toLocaleString(),
  };

  const generator = new ReportGenerator(testResult, {
    title: 'My Test Report',
    companyName: 'DAZN',
  });

  // Save HTML report
  const htmlPath = generator.saveHTML('./test/reports/my-report.html');
  console.log(`Report saved to: ${htmlPath}`);

  // Generate PDF (optional)
  try {
    const pdfPath = await generator.generatePDF('./test/reports/my-report.pdf');
    console.log(`PDF saved to: ${pdfPath}`);
  } catch (error) {
    console.log('PDF generation skipped - install puppeteer for PDF support');
  }
}

/**
 * Example 2: Generate Report from Test Data File
 */
export async function example2_GenerateFromFile() {
  const { htmlPath, pdfPath } = await ReportUtil.generateReportsFromFile(
    './test/data/sample-test-result.json',
    './test/reports',
    {
      title: 'PPV Test Report',
      includeGraphs: true,
      highlightFailures: true,
    },
  );

  console.log(`Generated: ${htmlPath}`);
  if (pdfPath) console.log(`PDF: ${pdfPath}`);
}

/**
 * Example 3: Create Test Result from Test Data
 */
export async function example3_CreateTestResult() {
  const result = ReportUtil.createTestResult(
    'Login Flow Tests',
    new Date('2024-06-25T12:00:00'),
    new Date('2024-06-25T12:05:00'),
    [
      {
        pageName: 'Login Page',
        checks: [
          {
            checkName: 'Email Input Visible',
            expected: 'Visible',
            actual: 'Visible',
            status: 'PASS',
            mandatory: true,
          },
          {
            checkName: 'Password Input Visible',
            expected: 'Visible',
            actual: 'Visible',
            status: 'PASS',
            mandatory: true,
          },
          {
            checkName: 'Submit Button Enabled',
            expected: 'Enabled',
            actual: 'Enabled',
            status: 'PASS',
            mandatory: true,
          },
        ],
      },
      {
        pageName: 'Forgot Password',
        checks: [
          {
            checkName: 'Recovery Link Visible',
            expected: 'Yes',
            actual: 'Yes',
            status: 'PASS',
            mandatory: false,
          },
        ],
      },
    ],
    {
      name: 'QA',
      region: 'US',
      surfacingPoint: 'Home Page',
    },
    {
      platform: 'iOS',
      version: '15.0',
      deviceType: 'iPhone',
    },
  );

  await ReportUtil.generateReports(result, './test/reports');
}

/**
 * Example 4: Integration with WebdriverIO Hook
 * Add this to your test file for automatic report generation
 */
export async function beforeAll_Setup() {
  global.testStartTime = new Date();
  global.testChecks = [];
}

export async function afterAll_GenerateReport() {
  if (!global.testStartTime || !global.testChecks) {
    return;
  }

  const pageResults = [];
  // Aggregate checks by page
  const checksByPage = new Map<string, any[]>();

  for (const check of global.testChecks) {
    if (!checksByPage.has(check.page)) {
      checksByPage.set(check.page, []);
    }
    checksByPage.get(check.page)!.push(check);
  }

  for (const [pageName, checks] of checksByPage) {
    pageResults.push({
      pageName,
      checks: checks.map((c) => ({
        checkName: c.name,
        expected: c.expected,
        actual: c.actual,
        status: c.status,
        mandatory: c.mandatory,
      })),
    });
  }

  const testResult = ReportUtil.createTestResult(
    'WebdriverIO Test Suite',
    global.testStartTime,
    new Date(),
    pageResults,
    { name: 'PROD', region: 'US', surfacingPoint: 'Web' },
  );

  await ReportUtil.generateReports(testResult, './test/reports');
  console.log('Test report generated successfully!');
}

/**
 * Example 5: Recording Checks During Test
 */
export async function recordCheck(
  pageName: string,
  checkName: string,
  expected: string,
  actual: string,
  mandatory = true,
) {
  if (!global.testChecks) {
    global.testChecks = [];
  }

  const status = expected === actual ? 'PASS' : 'FAIL';
  global.testChecks.push({
    page: pageName,
    name: checkName,
    expected,
    actual,
    status,
    mandatory,
  });

  console.log(`[${pageName}] ${checkName}: ${status}`);
}

/**
 * Example Usage in Test File:
 * 
 * describe('Login Tests', () => {
 *   beforeAll(beforeAll_Setup);
 *   afterAll(afterAll_GenerateReport);
 *
 *   it('should display login form', async () => {
 *     const titleElement = await $('[data-test="login-title"]');
 *     const titleText = await titleElement.getText();
 *     
 *     await recordCheck(
 *       'Login Page',
 *       'Page Title',
 *       'Login',
 *       titleText,
 *       true
 *     );
 *
 *     expect(titleText).toBe('Login');
 *   });
 *
 *   it('should enable submit button when form is filled', async () => {
 *     const emailInput = await $('[data-test="email-input"]');
 *     const passwordInput = await $('[data-test="password-input"]');
 *     const submitBtn = await $('[data-test="submit-btn"]');
 *
 *     await emailInput.setValue('test@example.com');
 *     await passwordInput.setValue('password123');
 *
 *     const isEnabled = await submitBtn.isEnabled();
 *
 *     await recordCheck(
 *       'Login Page',
 *       'Submit Button Enabled',
 *       'true',
 *       String(isEnabled),
 *       true
 *     );
 *
 *     expect(isEnabled).toBe(true);
 *   });
 * });
 */

export default {
  example1_GenerateFromObject,
  example2_GenerateFromFile,
  example3_CreateTestResult,
  recordCheck,
};
