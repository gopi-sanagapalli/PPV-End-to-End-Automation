# Workspace Agent Rules

## PROJECT_CONTEXT_AI Framework

> **Before any implementation, read `PROJECT_CONTEXT_AI/99_START_HERE.md`.**
> That file is the single source of truth for workflow, rules, and file lookup.

### Core Directives
- Treat `PROJECT_CONTEXT_AI/` as the primary project knowledge base.
- Use `PROJECT_CONTEXT_AI/20_FILE_INDEX.md` to locate files — never scan the entire repository.
- Use `PROJECT_CONTEXT_AI/DEPENDENCY_MAP.md` before modifying shared code.
- Preserve all existing functionality. Avoid regressions.
- Make the smallest possible change. Never refactor unrelated code.
- Update `PROJECT_CONTEXT_AI/` documentation whenever implementation changes.
- Follow the implementation workflow defined in `PROJECT_CONTEXT_AI/99_START_HERE.md`.
- Use existing framework patterns from `PROJECT_CONTEXT_AI/COMMON_PATTERNS.md` before creating new ones.

---

## Playwright Element Interaction Patterns

### Selector Robustness
- Never restrict locators to a single element type (e.g., `a:has-text(...)`) when the element type is unknown.
- Prefer `text=/pattern/i` (case-insensitive regex text selector) or `getByText()` for text-based matching.
- Always include a fallback strategy: if the primary locator fails, log the page body text to debug.

### Scroll-Before-Visible Pattern
- When an element may be below the fold, do NOT use `waitFor({ state: 'visible' })` first.
- Instead: `waitFor('attached')` → `scrollToElement()` → `waitFor('visible')`.
- Or: scroll to bottom first via `page.evaluate(() => window.scrollTo(...))`, then check visibility.

### Element Existence Verification
- Before interacting with an element that may not exist on all page variants, check with `isVisible().catch(() => false)`.
- If not found, log the page body text for debugging before throwing errors.
- Never assume a UI element exists across all flow variants without verifying.
