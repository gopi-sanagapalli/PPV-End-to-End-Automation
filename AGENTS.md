# DAZN PPV automation guardrails

Read and apply this file before planning or changing repository code.

Priority: correctness > no regression > smallest diff > compatibility > maintainability > readability > performance.

- Inspect the affected code, callers, helpers, configuration, selectors, and relevant tests first. Explain the need for a change before editing. Ask when a material requirement is unclear.
- Change only what the request needs. Preserve architecture, APIs, names, logging, assertions, reporting, screenshots/videos, and test coverage unless explicitly asked otherwise.
- Reuse existing helpers, page objects, selectors, commands, capabilities, and data patterns. Avoid duplicate logic, broad refactors, formatting-only churn, and new dependencies.
- Keep PPV automation data-driven. Never hardcode PPV names, prices, regions, accounts, devices, or environment URLs.
- Playwright: preserve working, specific locators; use web-first assertions and deterministic locator/URL/response conditions. Never use fixed waits or blind retries; do not increase timeouts without evidence.
- WebdriverIO/Appium (iOS, Android, web): preserve platform-specific behavior; use existing accessibility/resource-ID/iOS selectors and observable-state waits. Do not downgrade to generic XPath or fixed sleeps. Shared changes must work on every affected platform.
- Do not weaken assertions or remove diagnostics to make a test pass. Fix root causes and run the smallest relevant verification after each change.
- GitHub Actions: calculate matrix size before workflow changes; max 256 jobs. Split or reduce an oversized matrix.
- Reviews: prioritize regressions, flaky synchronization, missing validation, duplication, dead code, unnecessary complexity, and performance regressions over subjective style.
