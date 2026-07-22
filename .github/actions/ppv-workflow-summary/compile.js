const fs = require('fs');
const path = require('path');

// Inputs from environment variables
const reportTitle = process.env.REPORT_TITLE || 'PPV Workflow Report';
const ppvConfig = process.env.PPV_CONFIG || 'unknown';
const country = process.env.COUNTRY || 'unknown';
const runId = process.env.GITHUB_RUN_ID || 'unknown';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

const baseDir = path.resolve(process.cwd(), 'ppv-workflow-summary');
const artifactsDir = path.join(baseDir, 'job-artifacts');

// Helper to find files recursively
function findFiles(dir, filter, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(res, filter, files);
    } else if (filter(entry.name, res)) {
      files.push(res);
    }
  }
  return files;
}

// Group stats for each of the 3 main workflows
const workflowStats = {
  'new-user': { title: 'New User', total: 0, passed: 0, failed: 0, skipped: 0, runs: [] },
  'signin-during': { title: 'Existing User - Sign In During Flow', total: 0, passed: 0, failed: 0, skipped: 0, runs: [] },
  'already-signed': { title: 'Existing User - Already Signed In', total: 0, passed: 0, failed: 0, skipped: 0, runs: [] }
};

if (fs.existsSync(artifactsDir)) {
  const jobDirs = fs.readdirSync(artifactsDir).filter(name => {
    return fs.statSync(path.join(artifactsDir, name)).isDirectory();
  });

  for (const dirName of jobDirs) {
    const jobPath = path.join(artifactsDir, dirName);
    
    // Determine the workflow/stage from directory name or spec file inside
    let stage = 'signin-during'; // fallback default
    if (dirName.includes('new-user') || dirName.includes('new_user') || dirName.includes('-new-') || dirName.includes('-new')) {
      stage = 'new-user';
    } else if (dirName.includes('already-signed') || dirName.includes('already_signed') || dirName.includes('-signed-in') || dirName.includes('-signed')) {
      stage = 'already-signed';
    } else if (dirName.includes('signin') || dirName.includes('sign-in')) {
      stage = 'signin-during';
    }

    // Find custom PDF, HTML, Excel, and Video files recursively
    const pdfFiles = findFiles(jobPath, name => name.toLowerCase().endsWith('.pdf'));
    const htmlFiles = findFiles(jobPath, (name, filepath) => {
      return name.toLowerCase().endsWith('.html') && !filepath.includes('playwright-report');
    });
    const xlsxFiles = findFiles(jobPath, name => name.toLowerCase().endsWith('.xlsx'));
    const videoFiles = findFiles(jobPath, name => name.toLowerCase().endsWith('.webm') || name.toLowerCase().endsWith('.mp4'));

    const pdfRelative = pdfFiles.length > 0 ? path.relative(baseDir, pdfFiles[0]) : null;
    const customHtmlRelative = htmlFiles.length > 0 ? path.relative(baseDir, htmlFiles[0]) : null;
    const xlsxRelative = xlsxFiles.length > 0 ? path.relative(baseDir, xlsxFiles[0]) : null;
    const videoRelative = videoFiles.length > 0 ? path.relative(baseDir, videoFiles[0]) : null;

    // Check Playwright JSON report
    const jsonFiles = findFiles(jobPath, name => name === 'results.json');
    
    if (jsonFiles.length > 0) {
      try {
        const jsonContent = JSON.parse(fs.readFileSync(jsonFiles[0], 'utf-8'));
        const stats = jsonContent.stats || { expected: 0, unexpected: 0, skipped: 0 };
        
        const passed = stats.expected || 0;
        const failed = stats.unexpected || 0;
        const skipped = stats.skipped || 0;
        const total = passed + failed + skipped;
        
        let status = 'SKIP';
        if (failed > 0) status = 'FAIL';
        else if (passed > 0) status = 'PASS';

        // Extract spec title, duration, error, and Jira link
        let specTitle = dirName;
        let duration = 'N/A';
        let errorMsg = '';
        let jiraUrl = null;
        let jiraKey = null;

        // Traverse suites to find spec results
        const specsList = [];
        function collectSpecs(suite) {
          if (suite.specs) {
            for (const spec of suite.specs) specsList.push(spec);
          }
          if (suite.suites) {
            for (const subSuite of suite.suites) collectSpecs(subSuite);
          }
        }
        if (jsonContent.suites) {
          jsonContent.suites.forEach(collectSpecs);
        }

        if (specsList.length > 0) {
          const firstSpec = specsList[0];
          specTitle = firstSpec.title || specTitle;
          
          const result = firstSpec.tests?.[0]?.results?.[0];
          if (result) {
            if (result.duration) {
              const secs = Math.round(result.duration / 1000);
              duration = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
            }
            if (result.error) {
              errorMsg = result.error.message || result.error.stack || 'Test failed';
            }
            
            // Extract Jira ticket from stdout logs
            const stdout = result.stdout || [];
            for (const log of stdout) {
              if (log.text) {
                const match = log.text.match(/🔗 \[Jira\] Ticket:\s*(https:\/\/\S+)/);
                if (match) {
                  jiraUrl = match[1].trim();
                  jiraKey = jiraUrl.substring(jiraUrl.lastIndexOf('/') + 1);
                  break;
                }
              }
            }
          }
        }

        // Determine Playwright report link if available
        const playwrightReportPath = path.join(jobPath, 'playwright-report', 'index.html');
        const playwrightHtmlRelative = fs.existsSync(playwrightReportPath) 
          ? path.relative(baseDir, playwrightReportPath) 
          : null;

        const record = {
          dirName,
          specTitle,
          status,
          duration,
          errorMsg,
          jiraUrl,
          jiraKey,
          pdfPath: pdfRelative,
          customHtmlPath: customHtmlRelative,
          xlsxPath: xlsxRelative,
          videoPath: videoRelative,
          playwrightHtmlPath: playwrightHtmlRelative,
          rawDirLink: path.relative(baseDir, jobPath)
        };

        // Increment stats
        const target = workflowStats[stage];
        target.total += 1;
        if (status === 'PASS') target.passed += 1;
        else if (status === 'FAIL') target.failed += 1;
        else target.skipped += 1;
        target.runs.push(record);

      } catch (err) {
        console.error(`Error parsing results.json for ${dirName}:`, err.message);
      }
    } else {
      // Fallback for non-Playwright/Appium runs (Heuristics)
      const pngFiles = findFiles(jobPath, name => name.toLowerCase().endsWith('.png'));
      
      // If there are screenshot failure shots, assume failed
      let hasFailures = pngFiles.some(f => f.toLowerCase().includes('fail') || f.toLowerCase().includes('shot'));
      let status = hasFailures ? 'FAIL' : 'PASS';
      
      const record = {
        dirName,
        specTitle: dirName.replace('ppv-android-', 'Android: ').replace(/-/g, ' '),
        status,
        duration: 'N/A',
        errorMsg: hasFailures ? 'Appium run failed. Screenshots captured.' : '',
        jiraUrl: null,
        jiraKey: null,
        pdfPath: pdfRelative,
        customHtmlPath: customHtmlRelative,
        xlsxPath: xlsxRelative,
        videoPath: videoRelative,
        playwrightHtmlPath: null,
        rawDirLink: path.relative(baseDir, jobPath)
      };

      const target = workflowStats[stage];
      target.total += 1;
      if (status === 'PASS') target.passed += 1;
      else if (status === 'FAIL') target.failed += 1;
      else target.skipped += 1;
      target.runs.push(record);
    }
  }
}

// Group runs by Surfacing Point (Source) inside each workflow
for (const stage of Object.keys(workflowStats)) {
  const runs = workflowStats[stage].runs;
  const groups = {};

  runs.forEach(run => {
    // Extract source name (e.g. "boxing-standard-subscription" from "ppv-web-boxing-standard-subscription-...")
    let source = run.dirName.replace(/^ppv-web-|^ppv-android-/, '');
    // Strip profile/plan suffix if present to find source name
    const match = source.match(/^(.*?)-(freemium|frozen|active|standard_monthly|standard_apm|ultimate_apm|ultimate_upfront)/);
    if (match) {
      source = match[1];
    } else {
      // strip last hyphen segment if it looks like a plan key
      const parts = source.split('-');
      if (parts.length > 1) parts.pop();
      source = parts.join('-');
    }

    if (!groups[source]) {
      groups[source] = { source, status: 'PASS', runs: [] };
    }
    
    groups[source].runs.push(run);
    if (run.status === 'FAIL') {
      groups[source].status = 'FAIL';
    }
  });

  // Sort groups: failed groups first, then alphabetically
  const sortedGroups = Object.values(groups).sort((a, b) => {
    if (a.status === 'FAIL' && b.status !== 'FAIL') return -1;
    if (a.status !== 'FAIL' && b.status === 'FAIL') return 1;
    return a.source.localeCompare(b.source);
  });

  // For each group, sort its runs: failures first
  sortedGroups.forEach(g => {
    g.runs.sort((a, b) => {
      if (a.status === 'FAIL' && b.status !== 'FAIL') return -1;
      if (a.status !== 'FAIL' && b.status === 'FAIL') return 1;
      return a.specTitle.localeCompare(b.specTitle);
    });
  });

  workflowStats[stage].groupedRuns = sortedGroups;
}

// --- HTML Generation Helper Functions ---

function renderStageCard(key, stat) {
  const pct = stat.total > 0 ? ((stat.passed / stat.total) * 100).toFixed(1) : '0.0';
  const hasFails = stat.failed > 0;
  return `
    <div class="stage-card ${hasFails ? 'has-fails' : ''}">
      <div class="stage-title">
        ${stat.title}
        <span class="badge ${hasFails ? 'fail' : 'pass'}">${hasFails ? `${stat.failed} fails` : 'all pass'}</span>
      </div>
      <div class="stage-metrics">
        <div class="metric-value">${stat.passed}<span>/${stat.total}</span></div>
        <div class="metric-percent ${hasFails ? 'fail' : 'pass'}">${pct}%</div>
      </div>
    </div>
  `;
}

function renderTabButton(key, stat, idx) {
  // Determine if it should be active by default
  const isSignInTab = key === 'signin-during';
  const hasSignInFails = workflowStats['signin-during'].failed > 0;
  const active = (hasSignInFails && isSignInTab) || (!hasSignInFails && idx === 0) ? 'active' : '';
  
  return `
    <button class="tab-link ${active}" onclick="switchTab('${key}', this)">
      ${stat.title} <span class="tab-badge ${stat.failed > 0 ? 'fail' : 'pass'}">${stat.total}</span>
    </button>
  `;
}

function renderRunRow(run, stageKey, source) {
  const isFail = run.status === 'FAIL';
  
  // Construct local rerun command
  let rerunCmd = '';
  if (isFail) {
    const isNew = stageKey === 'new-user';
    const file = isNew ? 'tests/new_user/newuser.ppv.spec.ts' : 'tests/existing_user/existinguser.ppv.spec.ts';
    
    // Parse profile/plan from dirName
    let userState = 'freemium';
    let planVal = 'standard_monthly';
    
    if (run.dirName.includes('freemium')) userState = 'freemium';
    else if (run.dirName.includes('frozen')) userState = 'frozen';
    else if (run.dirName.includes('active_')) userState = 'active_standard_monthly';
    
    if (run.dirName.includes('standard_monthly')) planVal = 'standard_monthly';
    else if (run.dirName.includes('standard_apm')) planVal = 'standard_apm';
    else if (run.dirName.includes('ultimate_apm')) planVal = 'ultimate_apm';
    else if (run.dirName.includes('ultimate_upfront')) planVal = 'ultimate_upfront';
    
    rerunCmd = `DAZN_REGION=${country} PPV_CONFIG=${ppvConfig} SOURCE=${source} PLAN=${planVal} USER_STATE=${userState} npx playwright test ${file}`;
  }

  // Determine links
  const links = [];
  if (run.pdfPath) links.push(`<a href="${run.pdfPath}" target="_blank">PDF</a>`);
  if (run.customHtmlPath) links.push(`<a href="${run.customHtmlPath}" target="_blank">HTML</a>`);
  if (run.xlsxPath) links.push(`<a href="${run.xlsxPath}" target="_blank">Excel</a>`);
  if (run.videoPath) links.push(`<a href="${run.videoPath}" target="_blank">Video</a>`);
  if (run.playwrightHtmlPath) links.push(`<a href="${run.playwrightHtmlPath}" target="_blank">Playwright</a>`);
  
  if (links.length === 0 && run.rawDirLink) {
    links.push(`<a href="${run.rawDirLink}" target="_blank">Files Folder</a>`);
  }

  // Escape rerun command for the html attribute
  const escapedCmd = rerunCmd.replace(/'/g, "\\'");

  return `
    <tr class="${isFail ? 'failed-row' : ''}">
      <td>
        <div><strong>${run.specTitle.split(' | ').pop() || run.specTitle}</strong></div>
        ${isFail ? `<div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">Failed spec: <code>${run.specTitle}</code></div>` : ''}
      </td>
      <td>
        <span class="badge ${run.status.toLowerCase()}">${run.status}</span>
        ${run.jiraUrl ? `<a href="${run.jiraUrl}" target="_blank" class="badge jira-badge">${run.jiraKey}</a>` : ''}
      </td>
      <td>${run.duration}</td>
      <td>
        <div class="links-cell">
          ${links.join(' | ')}
          ${isFail ? `<button class="btn-copy" onclick="copyCommand('${escapedCmd}', this)">Copy Rerun Cmd</button>` : ''}
        </div>
        ${isFail && run.errorMsg ? `
          <details style="margin-top: 8px;">
            <summary>View Failure Details</summary>
            <div class="err-details">${run.errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          </details>
        ` : ''}
      </td>
    </tr>
  `;
}

function renderGroup(g, stageKey) {
  return `
    <div class="group-container" data-source="${g.source.toLowerCase()}">
      <div class="group-header ${g.status === 'FAIL' ? 'fail' : 'pass'}" onclick="toggleGroup(this)">
        <strong>${g.source}</strong>
        <span class="badge ${g.status === 'FAIL' ? 'fail' : 'pass'}">${g.runs.filter(r => r.status === 'PASS').length} / ${g.runs.length} Passed</span>
      </div>
      <div class="group-content">
        <table>
          <thead>
            <tr>
              <th style="width: 40%;">User Profile / Plan</th>
              <th style="width: 15%;">Status</th>
              <th style="width: 15%;">Duration</th>
              <th style="width: 30%;">Evidence / Links</th>
            </tr>
          </thead>
          <tbody>
            ${g.runs.map(run => renderRunRow(run, stageKey, g.source)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTabContent(key, stat, idx) {
  const isSignInTab = key === 'signin-during';
  const hasSignInFails = workflowStats['signin-during'].failed > 0;
  const active = (hasSignInFails && isSignInTab) || (!hasSignInFails && idx === 0) ? 'active' : '';

  return `
    <div id="tab-${key}" class="tab-content ${active}">
      ${stat.groupedRuns.map(g => renderGroup(g, key)).join('')}
    </div>
  `;
}

// Generate the final HTML report using helper functions
const htmlReport = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${reportTitle}</title>
  <style>
    :root {
      --bg-color: #0b0f19;
      --card-bg: #151d30;
      --border-color: #24324f;
      --text-main: #f1f5f9;
      --text-muted: #64748b;
      --primary: #3b82f6;
      --success: #10b981;
      --failure: #f43f5e;
      --warning: #f59e0b;
      --skip: #475569;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      margin: 0;
      padding: 24px;
    }
    header {
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 26px;
      font-weight: 700;
    }
    .meta {
      font-size: 14px;
      color: var(--text-muted);
      display: flex;
      gap: 20px;
    }
    .meta strong {
      color: var(--text-main);
    }
    
    .stages-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .stage-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    }
    .stage-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
      color: var(--text-main);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stage-card.has-fails {
      border-color: rgba(244, 63, 94, 0.4);
    }
    .stage-metrics {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .metric-value {
      font-size: 32px;
      font-weight: 700;
      line-height: 1;
    }
    .metric-value span {
      font-size: 16px;
      color: var(--text-muted);
      font-weight: 400;
    }
    .metric-percent {
      font-size: 14px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .metric-percent.pass {
      background-color: rgba(16, 185, 129, 0.1);
      color: var(--success);
    }
    .metric-percent.fail {
      background-color: rgba(244, 63, 94, 0.1);
      color: var(--failure);
    }

    .tabs-nav {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      gap: 8px;
      margin-bottom: 20px;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .tab-link {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      position: relative;
      white-space: nowrap;
      transition: color 0.2s;
    }
    .tab-link:hover {
      color: var(--text-main);
    }
    .tab-link.active {
      color: var(--primary);
    }
    .tab-link.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background-color: var(--primary);
    }
    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 9999px;
      margin-left: 6px;
    }
    .tab-badge.pass {
      background-color: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }
    .tab-badge.fail {
      background-color: rgba(244, 63, 94, 0.15);
      color: var(--failure);
    }

    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }

    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }
    .search-box {
      flex-grow: 1;
      max-width: 400px;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 14px;
    }

    .group-header {
      background-color: rgba(255,255,255,0.02);
      padding: 12px 16px;
      font-weight: 600;
      border: 1px solid var(--border-color);
      border-radius: 8px 8px 0 0;
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }
    .group-header:hover {
      background-color: rgba(255,255,255,0.04);
    }
    .group-header.fail {
      border-left: 4px solid var(--failure);
    }
    .group-header.pass {
      border-left: 4px solid var(--success);
    }
    .group-content {
      margin-bottom: 16px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-top: none;
      border-radius: 0 0 8px 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
      font-size: 14px;
    }
    th {
      background-color: rgba(255,255,255,0.01);
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    tr.failed-row {
      background-color: rgba(244, 63, 94, 0.02);
    }
    tr.failed-row td {
      border-bottom-color: rgba(244, 63, 94, 0.1);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.pass {
      background-color: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }
    .badge.fail {
      background-color: rgba(244, 63, 94, 0.15);
      color: var(--failure);
    }
    .badge.skip {
      background-color: rgba(100, 116, 139, 0.15);
      color: var(--skip);
    }
    
    .jira-badge {
      background-color: rgba(59, 130, 246, 0.15);
      color: var(--primary);
      text-decoration: none;
      margin-left: 8px;
    }
    .jira-badge:hover {
      background-color: rgba(59, 130, 246, 0.25);
    }

    .btn-copy {
      background-color: rgba(255,255,255,0.05);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
      margin-left: 8px;
    }
    .btn-copy:hover {
      background-color: rgba(255,255,255,0.1);
      border-color: var(--primary);
    }

    .links-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .links-cell a {
      color: var(--primary);
      text-decoration: none;
      font-size: 13px;
    }
    .links-cell a:hover {
      text-decoration: underline;
    }
    
    .err-details {
      margin-top: 8px;
      background-color: #070a13;
      border-radius: 6px;
      padding: 12px;
      border-left: 3px solid var(--failure);
      font-family: monospace;
      font-size: 12px;
      color: #fda4af;
      white-space: pre-wrap;
      overflow-x: auto;
    }
    details summary {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 12px;
      user-select: none;
      outline: none;
    }
    details summary:hover {
      color: var(--text-main);
    }
  </style>
</head>
<body>
  <header>
    <h1>${reportTitle}</h1>
    <div class="meta">
      <div>PPV: <strong>${ppvConfig}</strong></div>
      <div>Country: <strong>${country}</strong></div>
      <div>Run ID: <strong>${runId}</strong></div>
    </div>
  </header>

  <!-- 3 Workflow-level progress columns -->
  <div class="stages-summary">
    ${Object.entries(workflowStats).map(([key, stat]) => renderStageCard(key, stat)).join('')}
  </div>

  <!-- Tab Buttons -->
  <div class="tabs-nav">
    ${Object.entries(workflowStats).map(([key, stat], idx) => renderTabButton(key, stat, idx)).join('')}
  </div>

  <div class="controls">
    <input type="text" class="search-box" placeholder="Search surfacing points, plans, errors..." id="search" oninput="filterTable()">
  </div>

  <!-- Tab Contents -->
  ${Object.entries(workflowStats).map(([key, stat], idx) => renderTabContent(key, stat, idx)).join('')}

  <script>
    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById('tab-' + tabId).classList.add('active');
      filterTable();
    }

    function toggleGroup(header) {
      const content = header.nextElementSibling;
      if (content.style.display === 'none') {
        content.style.display = 'block';
      } else {
        content.style.display = 'none';
      }
    }

    function filterTable() {
      const searchVal = document.getElementById('search').value.toLowerCase();
      const activeTabContent = document.querySelector('.tab-content.active');
      const containers = activeTabContent.querySelectorAll('.group-container');

      containers.forEach(container => {
        const sourceName = container.getAttribute('data-source');
        const rows = container.querySelectorAll('tbody tr');
        let groupHasMatch = false;

        rows.forEach(row => {
          const rowText = row.innerText.toLowerCase();
          const matches = rowText.includes(searchVal) || sourceName.includes(searchVal);
          
          if (matches) {
            row.style.display = '';
            groupHasMatch = true;
          } else {
            row.style.display = 'none';
          }
        });

        if (groupHasMatch) {
          container.style.display = 'block';
        } else {
          container.style.display = 'none';
        }
      });
    }

    function copyCommand(cmd, btn) {
      navigator.clipboard.writeText(cmd).then(() => {
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#10b981';
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.borderColor = '';
          btn.style.color = '';
        }, 1500);
      }).catch(err => {
        console.error('Failed to copy command:', err);
      });
    }
  </script>
</body>
</html>
`;

// Save HTML report to index.html
const indexPath = path.join(baseDir, 'index.html');
fs.writeFileSync(indexPath, htmlReport, 'utf-8');
console.log(`📄 Consolidated HTML report written to: ${indexPath}`);

// Generate GitHub Actions Step Summary (Markdown)
if (summaryFile) {
  let md = `## 📊 ${reportTitle}\n\n`;
  md += `**PPV**: \`${ppvConfig}\` · **Country**: \`${country}\`\n\n`;
  
  md += `### 📈 Workflow Level Pass Rates\n`;
  md += `| Workflow / Journey | Pass / Total | Pass Rate | Status |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  
  Object.entries(workflowStats).forEach(([key, stat]) => {
    const pct = stat.total > 0 ? ((stat.passed / stat.total) * 100).toFixed(1) : '0.0';
    const status = stat.failed > 0 ? `🔴 FAIL (${stat.failed} Fails)` : `🟢 PASS`;
    md += `| **${stat.title}** | \`${stat.passed} / ${stat.total}\` | **${pct}%** | ${status} |\n`;
  });
  
  md += `\n---\n\n`;

  // Failures section
  let hasAnyFailures = false;
  let failuresMd = `### 🚨 Failed Jobs (Grouped by Workflow)\n\n`;

  Object.entries(workflowStats).forEach(([key, stat]) => {
    const failedRuns = stat.runs.filter(r => r.status === 'FAIL');
    if (failedRuns.length > 0) {
      hasAnyFailures = true;
      failuresMd += `#### 🔴 ${stat.title} Failures (${failedRuns.length})\n\n`;
      
      failedRuns.forEach((run, index) => {
        const jiraLabel = run.jiraUrl ? ` &nbsp;**Jira**: [${run.jiraKey}](${run.jiraUrl})` : '';
        const pdfLinkText = run.pdfPath ? ` &nbsp;**PDF**: [pdf](${run.pdfPath})` : '';
        const customHtmlText = run.customHtmlPath ? ` &nbsp;**HTML**: [html](${run.customHtmlPath})` : '';
        const xlsxLinkText = run.xlsxPath ? ` &nbsp;**Excel**: [xlsx](${run.xlsxPath})` : '';
        const videoLinkText = run.videoPath ? ` &nbsp;**Video**: [video](${run.videoPath})` : '';
        
        failuresMd += `${index + 1}. **Source**: \`${run.dirName}\` &nbsp;**Duration**: \`${run.duration}\`${jiraLabel}${pdfLinkText}${customHtmlText}${xlsxLinkText}${videoLinkText}\n`;
        if (run.errorMsg) {
          // clean stack trace output for markdown details block
          const cleanErr = run.errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          failuresMd += `<details>\n<summary><b>View Error Log</b></summary>\n\n\`\`\`\n${cleanErr}\n\`\`\`\n\n</details>\n\n`;
        }
      });
    }
  });

  if (hasAnyFailures) {
    md += failuresMd;
  } else {
    const grandTotal = Object.values(workflowStats).reduce((acc, stat) => acc + stat.total, 0);
    md += `### 🟢 All ${grandTotal} tests passed successfully!\n\n`;
  }
  
  md += `*Consolidated HTML Dashboard, Playwright, PDF, and screenshots are archived in the workflow artifacts.*`;
  
  fs.writeFileSync(summaryFile, md, 'utf-8');
  console.log(`📝 Consolidated markdown summary written to GITHUB_STEP_SUMMARY: ${summaryFile}`);
}
