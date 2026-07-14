import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

type ValidationResult = {
  page?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  status?: string;
  screenshot?: string;
};

type JiraContext = {
  region: string;
  environment: string;
  platform: string;
  flow: string;
  event?: string;
  userState?: string;
  source?: string;
};

type JiraValidationReport = {
  results: ValidationResult[];
  context: JiraContext;
  htmlReportPath?: string | null;
  pdfReportPath?: string | null;
};

const MAX_ATTACHMENTS = 12;

function jiraConfig() {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, '');
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !apiToken) return null;

  return {
    baseUrl,
    auth: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
    projectKey: process.env.JIRA_PROJECT_KEY || 'QAR',
    issueType: process.env.JIRA_ISSUE_TYPE || 'Bug',
  };
}

async function requestJira(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: Buffer
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function asText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function paragraph(text: string) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: text.slice(0, 3000) }],
  };
}

function createEvidenceFile(
  failures: ValidationResult[],
  context: JiraContext,
  runId: string
): string | null {
  try {
    const evidenceDir = path.resolve(process.cwd(), 'test-results', 'jira-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = path.join(
      evidenceDir,
      `validation-failures-${runId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}.json`
    );
    const evidence = {
      generatedAt: new Date().toISOString(),
      trigger: 'GitHub Actions validation failure',
      github: {
        repository: process.env.GITHUB_REPOSITORY || null,
        workflow: process.env.GITHUB_WORKFLOW || null,
        job: process.env.GITHUB_JOB || null,
        runId: process.env.GITHUB_RUN_ID || null,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
        sha: process.env.GITHUB_SHA || null,
        ref: process.env.GITHUB_REF_NAME || null,
        actor: process.env.GITHUB_ACTOR || null,
      },
      runner: {
        name: process.env.RUNNER_NAME || null,
        os: process.env.RUNNER_OS || null,
        architecture: process.arch,
        nodeVersion: process.version,
      },
      context,
      failures: failures.map(({ screenshot, ...failure }) => ({
        ...failure,
        screenshotFilename: screenshot ? path.basename(screenshot) : null,
      })),
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return evidencePath;
  } catch (error: any) {
    console.warn(`⚠️ [Jira] Could not write diagnostics evidence: ${error?.message || error}`);
    return null;
  }
}

function publishJiraIssueLink(issueKey: string, baseUrl: string): void {
  const issueUrl = `${baseUrl}/browse/${encodeURIComponent(issueKey)}`;
  // GitHub renders URLs in job logs as clickable links.
  console.log(`🔗 [Jira] Ticket: ${issueUrl}`);

  // Also make the ticket prominent in the workflow run's Summary tab.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    fs.appendFileSync(
      summaryPath,
      `\n## Jira validation failure\n\n[${issueKey}](${issueUrl}) — ${issueKey} was created automatically for validation failures.\n`
    );
  } catch (error: any) {
    console.warn(`⚠️ [Jira] Could not add ticket link to GitHub job summary: ${error?.message || error}`);
  }
}

async function attachFile(
  issueKey: string,
  filePath: string,
  config: NonNullable<ReturnType<typeof jiraConfig>>
): Promise<void> {
  if (!fs.existsSync(filePath)) return;

  const content = await fs.promises.readFile(filePath);
  const filename = path.basename(filePath).replace(/[\r\n"]/g, '_');
  const boundary = `----dazn-jira-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await requestJira(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
    'POST',
    {
      Authorization: config.auth,
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`attachment upload returned HTTP ${response.statusCode}: ${response.body.slice(0, 300)}`);
  }
}

/**
 * Creates a Jira issue only from GitHub Actions and only when the caller has
 * already established that a flow completed successfully but validations failed.
 * All Jira errors are logged and deliberately do not hide the original test failure.
 */
export async function reportValidationFailuresToJira(report: JiraValidationReport): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

  const failures = report.results.filter(result => String(result.status).toUpperCase() === 'FAIL');
  if (!failures.length) return;

  const config = jiraConfig();
  if (!config) {
    console.warn('⚠️ [Jira] Validation failures found, but Jira secrets are not configured; skipping ticket creation.');
    return;
  }

  const context = report.context;
  const runId = process.env.GITHUB_RUN_ID || 'unknown-run';
  const evidencePath = createEvidenceFile(failures, context, runId);
  const summary = `[Automation][${context.region}][${context.platform}] ${failures.length} validation failure(s) — ${context.flow}`
    .slice(0, 250);
  const runMetadata = [
    `Repository: ${process.env.GITHUB_REPOSITORY || 'unknown'}`,
    `Workflow: ${process.env.GITHUB_WORKFLOW || 'unknown'}`,
    `Job: ${process.env.GITHUB_JOB || 'unknown'}`,
    `Run: ${runId} (attempt ${process.env.GITHUB_RUN_ATTEMPT || '1'})`,
    `Commit: ${process.env.GITHUB_SHA || 'unknown'}`,
    `Runner: ${process.env.RUNNER_NAME || 'unknown'} (${process.env.RUNNER_OS || 'unknown'})`,
  ].join(' | ');

  console.log(`🐞 [Jira] Validation-only failure detected; preparing QAR ticket for ${context.flow}.`);
  console.log(`🔎 [Jira] ${runMetadata}`);
  for (const failure of failures) {
    console.log(
      `❌ [Jira] [${asText(failure.page)}] ${asText(failure.field)} | ` +
      `expected="${asText(failure.expected)}" | actual="${asText(failure.actual)}"`
    );
  }
  const description = {
    type: 'doc',
    version: 1,
    content: [
      paragraph('Created automatically from a completed GitHub Actions validation run.'),
      paragraph(`Region: ${context.region} | Environment: ${context.environment} | Platform: ${context.platform}`),
      paragraph(`Flow: ${context.flow}${context.event ? ` | Event: ${context.event}` : ''}${context.userState ? ` | User state: ${context.userState}` : ''}${context.source ? ` | Source: ${context.source}` : ''}`),
      paragraph(runMetadata),
      paragraph(`Validation failures (${failures.length}):`),
      ...failures.map(result => paragraph(
        `[${asText(result.page)}] ${asText(result.field)} — expected: "${asText(result.expected)}"; actual: "${asText(result.actual)}"`
      )),
      paragraph('Reports and available failure screenshots are attached to this issue.'),
    ],
  };

  try {
    const payload = Buffer.from(JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: config.issueType },
        summary,
        description,
        labels: [
          'automation',
          'validation-failure',
          'github-actions',
          `github-run-${runId}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
        ],
      },
    }));
    const response = await requestJira(
      `${config.baseUrl}/rest/api/3/issue`,
      'POST',
      {
        Authorization: config.auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
      },
      payload
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`issue creation returned HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
    }

    const issue = JSON.parse(response.body) as { key?: string };
    if (!issue.key) throw new Error('issue creation response did not include an issue key');
    console.log(`🐞 [Jira] Created ${issue.key} for ${failures.length} validation failure(s).`);
    publishJiraIssueLink(issue.key, config.baseUrl);

    const attachmentPaths = [
      report.htmlReportPath,
      report.pdfReportPath,
      evidencePath,
      ...failures.map(result => result.screenshot),
    ].filter((filePath): filePath is string => Boolean(filePath && fs.existsSync(filePath)));

    for (const filePath of [...new Set(attachmentPaths)].slice(0, MAX_ATTACHMENTS)) {
      try {
        await attachFile(issue.key, filePath, config);
        console.log(`📎 [Jira] Attached ${path.basename(filePath)} to ${issue.key}.`);
      } catch (error: any) {
        console.warn(`⚠️ [Jira] Could not attach ${path.basename(filePath)}: ${error?.message || error}`);
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ [Jira] Could not create validation issue: ${error?.message || error}`);
  }
}
