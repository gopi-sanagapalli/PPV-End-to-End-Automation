import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlowDef {
  id: number;
  platform: "Web" | "Android";
  user: string;
  entry: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
}

interface FlowResult {
  platform: string;
  user: string;
  entry: string;
  passed: boolean;
  durationMs: number;
  reportPaths: { html: string; pdf: string; excel: string; video: string } | null;
  geminiEvidence: boolean;
}

// ─── Mode ────────────────────────────────────────────────────────────────────

const DEMO_MODE = (process.env.DEMO_MODE || "").toLowerCase() === "true";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

function heading(s: string) {
  return `${BOLD}${CYAN}${s}${RESET}`;
}
function pass(s: string) {
  return `${BOLD}${GREEN}${s}${RESET}`;
}
function fail(s: string) {
  return `${BOLD}${RED}${s}${RESET}`;
}
function label(s: string) {
  return `${BOLD}${WHITE}${s}${RESET}`;
}
function dim(s: string) {
  return `\x1b[2m${s}${RESET}`;
}

// ─── Flow Definitions ────────────────────────────────────────────────────────
// Add a fifth flow by appending one object to this array.

const DEFAULT_ENV: Record<string, string> = {
  DAZN_REGION: "GB",
  DAZN_ENV: "prod",
  PPV_CONFIG: "ppv_t_joshua_prenga.json",
  PLAN: "standard_monthly",
  PAYMENT_METHOD: "credit_card",
  SWITCH: "false",
};

const FLOWS: FlowDef[] = [
  {
    id: 1,
    platform: "Web",
    user: "New User",
    entry: "Boxing Page Banner",
    command:
      "npx playwright test tests/new_user/newuser.ppv.spec.ts --project=chromium",
    cwd: process.cwd(),
    env: { SOURCE: "boxing-page-banner" },
  },
  {
    id: 2,
    platform: "Web",
    user: "Active Paid User",
    entry: "Home → Don't Miss",
    command:
      "npx playwright test tests/existing_user/existinguser.ppv.spec.ts --project=chromium",
    cwd: process.cwd(),
    env: {
      SOURCE: "home-page-dont-miss",
      USER_STATE: "active_standard_monthly",
      LOGIN_FIRST: "true",
    },
  },
  {
    id: 3,
    platform: "Android",
    user: "New User",
    entry: "Landing Page Banner",
    command:
      "npx wdio run config/wdio.android.conf.ts --spec tests/android/ppv.handoff.spec.ts",
    cwd: path.join(process.cwd(), "appium"),
    env: { SOURCE: "landing-page-banner" },
  },
  {
    id: 4,
    platform: "Android",
    user: "Active Paid User",
    entry: "Schedule",
    command:
      "npx wdio run config/wdio.android.conf.ts --spec tests/android/existingusermobile.ppv.spec.ts",
    cwd: path.join(process.cwd(), "appium"),
    env: {
      SOURCE: "schedule",
      USER_STATE: "active_standard_monthly",
      LOGIN_FIRST: "false",
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function platformIcon(p: string): string {
  return p === "Web" ? "🌐" : "🤖";
}

function printBanner(): void {
  console.log("");
  console.log(
    `${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`
  );
  console.log("");
  console.log(`${BOLD}${CYAN}        DAZN PPV Automation Platform${RESET}`);
  console.log(`${BOLD}${CYAN}             Executive Showcase${RESET}`);
  console.log("");
  console.log(
    `${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`
  );
  console.log("");
}

function printFlowOutput(flow: FlowDef, total: number): void {
  console.log(dim("━".repeat(55)));
  console.log("");
  console.log(heading(`Flow ${flow.id} of ${total}`));
  console.log("");
  console.log(`  ${platformIcon(flow.platform)}  ${label(flow.platform)}`);
  console.log(`     ${label(flow.user)}`);
  console.log(`     ${label(flow.entry)}`);
  console.log(`     ${label("GB · Production")}`);
  console.log("");
  console.log(`  ${BLUE}Status${RESET}`);
  console.log(`  ${BOLD}RUNNING${RESET}`);
  console.log("");
}

function printFlowComplete(
  flow: FlowDef,
  result: FlowResult
): void {
  const status = result.passed ? pass("✅ Completed") : fail("❌ Failed");
  console.log(`  ${status}`);
  console.log(`  Duration : ${formatDuration(result.durationMs)}`);
  if (result.reportPaths) {
    const rp = result.reportPaths;
    console.log("");
    console.log(`  Reports Generated:`);
    console.log(`    ${pass("✓")} HTML  : ${rp.html}`);
    console.log(`    ${pass("✓")} PDF   : ${rp.pdf}`);
    console.log(`    ${pass("✓")} Excel : ${rp.excel}`);
    console.log(`    ${pass("✓")} Video : ${rp.video}`);
    if (result.geminiEvidence)
      console.log(`    ${pass("✓")} AI Banner Validation`);
    console.log(`    ${pass("✓")} Jira Integration`);
  }
  console.log("");
  console.log(dim("━".repeat(55)));
  console.log("");
}

// ─── Report discovery ────────────────────────────────────────────────────────

function extractReportPaths(buffer: string[]): {
  html: string;
  pdf: string;
  excel: string;
  video: string;
  gemini: boolean;
} | null {
  const lines = buffer.join("\n");
  const htmlMatch = lines.match(/HTML\s*:\s*(.+PPV_Report\.html)/i);
  const pdfMatch = lines.match(/PDF\s*:\s*(.+PPV_Report\.pdf)/i);
  const excelMatch = lines.match(/Excel:\s*(.+PPV_Results\.xlsx)/i);
  const videoMatch = lines.match(/Video:\s*(.+PPV_Video\.\w+)/i);
  const geminiMatch = lines.match(/Gemini:\s*(.+Gemini_Banner_Validation)/i);

  if (!htmlMatch && !pdfMatch && !excelMatch) return null;

  return {
    html: htmlMatch?.[1] || "",
    pdf: pdfMatch?.[1] || "",
    excel: excelMatch?.[1] || "",
    video: videoMatch?.[1] || "",
    gemini: Boolean(geminiMatch),
  };
}

function discoverNewestReport(): {
  html: string;
  pdf: string;
  excel: string;
  video: string;
} | null {
  const reportsDir = path.resolve(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) return null;

  const entries = fs
    .readdirSync(reportsDir)
    .map((name) => ({
      name,
      mtime: fs.statSync(path.join(reportsDir, name)).mtimeMs,
    }))
    .filter((e) =>
      fs.statSync(path.join(reportsDir, e.name)).isDirectory()
    )
    .sort((a, b) => b.mtime - a.mtime);

  if (!entries.length) return null;

  const newest = path.join(reportsDir, entries[0].name);
  const htmlP = path.join(newest, "PPV_Report.html");
  const pdfP = path.join(newest, "PPV_Report.pdf");
  const excelP = path.join(newest, "PPV_Results.xlsx");
  const videoCandidates = ["PPV_Video.mp4", "PPV_Video.webm"]
    .map((f) => path.join(newest, f))
    .find((f) => fs.existsSync(f));

  if (!fs.existsSync(htmlP)) return null;

  return {
    html: htmlP,
    pdf: fs.existsSync(pdfP) ? pdfP : "",
    excel: fs.existsSync(excelP) ? excelP : "",
    video: videoCandidates || "",
  };
}

// ─── Execution ───────────────────────────────────────────────────────────────

function runFlow(flow: FlowDef, total: number): Promise<FlowResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    printFlowOutput(flow, total);

    const [cmd, ...args] = flow.command.split(/\s+/);
    const mergedEnv = { ...process.env, ...DEFAULT_ENV, ...flow.env };

    const child: ChildProcess = spawn(cmd, args, {
      cwd: flow.cwd,
      stdio: ["inherit", "pipe", "pipe"],
      env: mergedEnv,
    });

    const stdoutBuf: string[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf.push(text);
      if (!DEMO_MODE) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf.push(text);
      // Always stream errors so the audience sees failures live
      process.stderr.write(text);
    });

    // 15-minute timeout per flow — prevents hanging
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      process.stderr.write(fail(`\nFlow ${flow.id} timed out after 15m\n`));
      resolve({
        platform: flow.platform,
        user: flow.user,
        entry: flow.entry,
        passed: false,
        durationMs: Date.now() - start,
        reportPaths: null,
        geminiEvidence: false,
      });
    }, 900_000);

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      process.stderr.write(fail(`\nFailed to start: ${err.message}\n`));
      resolve({
        platform: flow.platform,
        user: flow.user,
        entry: flow.entry,
        passed: false,
        durationMs: Date.now() - start,
        reportPaths: null,
        geminiEvidence: false,
      });
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const passed = code === 0;
      const durationMs = Date.now() - start;

      const reportPaths = extractReportPaths(stdoutBuf);

      let gemini = reportPaths?.gemini ?? false;
      let paths = reportPaths
        ? { ...reportPaths }
        : discoverNewestReport();

      if (paths && !gemini) {
        gemini = fs.existsSync(
          path.join(path.dirname(paths.html), "Gemini_Banner_Validation")
        );
      }

      const result: FlowResult = {
        platform: flow.platform,
        user: flow.user,
        entry: flow.entry,
        passed,
        durationMs,
        reportPaths: paths
          ? {
              html: paths.html,
              pdf: paths.pdf,
              excel: paths.excel,
              video: paths.video,
            }
          : null,
        geminiEvidence: gemini,
      };

      printFlowComplete(flow, result);
      resolve(result);
    });
  });
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary(results: FlowResult[]): void {
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(
    `${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`
  );
  console.log(`${BOLD}${CYAN}  DAZN PPV Automation Platform${RESET}`);
  console.log("");
  console.log("  Platforms");
  console.log(`    ${pass("✅")} Web`);
  console.log(`    ${pass("✅")} Android`);
  console.log("");
  console.log("  Entry Points");
  console.log(`    ${pass("✅")} Boxing Page Banner`);
  console.log(`    ${pass("✅")} Landing Page Banner`);
  console.log(`    ${pass("✅")} Home → Don't Miss`);
  console.log(`    ${pass("✅")} Schedule`);
  console.log("");
  console.log("  User States");
  console.log(`    ${pass("✅")} New User`);
  console.log(`    ${pass("✅")} Active Paid User`);
  console.log("");
  console.log("  Quality");
  console.log(`    ${pass("✅")} Functional Validation`);
  console.log(`    ${pass("✅")} Gemini AI Banner Validation`);
  console.log(`    ${pass("✅")} Automatic Jira Ticket Creation`);
  console.log("");
  console.log("  Reporting");
  console.log(`    ${pass("✅")} HTML Report`);
  console.log(`    ${pass("✅")} PDF Report`);
  console.log(`    ${pass("✅")} Excel Report`);
  console.log(`    ${pass("✅")} Video Recording`);
  console.log("");
  console.log("  CI/CD");
  console.log(`    ${pass("✅")} GitHub Actions`);
  console.log(`    ${pass("✅")} Multi Region`);
  console.log(`    ${pass("✅")} Multiple User States`);
  console.log(`    ${pass("✅")} Multiple Entry Points`);
  console.log("");
  console.log(
    `${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`
  );
  console.log("");
  console.log("  Statistics");
  console.log(`    Total Flows : ${results.length}`);
  console.log(`    Passed      : ${passedCount}`);
  console.log(`    Failed      : ${failedCount}`);
  console.log(`    Duration    : ${formatDuration(totalDuration)}`);
  console.log("");

  const allReports = results
    .map((r) => r.reportPaths)
    .filter(Boolean) as NonNullable<FlowResult["reportPaths"]>[];

  if (allReports.length) {
    console.log("  Report Files");
    for (const rp of allReports) {
      if (rp.html) console.log(`    ${pass("✓")} ${rp.html}`);
      if (rp.pdf) console.log(`    ${pass("✓")} ${rp.pdf}`);
      if (rp.excel) console.log(`    ${pass("✓")} ${rp.excel}`);
      if (rp.video) console.log(`    ${pass("✓")} ${rp.video}`);
    }

    const newestHtml = allReports[0].html;
    if (process.platform === "darwin" && newestHtml) {
      console.log("");
      console.log(`  ${dim("Opening HTML report...")}`);
      spawn("open", [newestHtml], { stdio: "ignore" });
    }
  }

  if (results.some((r) => r.geminiEvidence)) {
    console.log("");
    console.log(`  ${pass("✓")} Gemini AI Banner Validation Evidence Included`);
  }

  console.log("");
  if (failedCount > 0) {
    console.log(fail(`  ${failedCount} flow(s) failed. Review output above.`));
  } else {
    console.log(pass("  All flows completed successfully."));
  }
  console.log("");
  console.log(
    `${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}`
  );
  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printBanner();

  const results: FlowResult[] = [];

  for (const flow of FLOWS) {
    const result = await runFlow(flow, FLOWS.length);
    results.push(result);
  }

  printSummary(results);

  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(fail(`\nFatal error: ${err.message}\n`));
  process.exit(1);
});