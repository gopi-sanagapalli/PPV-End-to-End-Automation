# DAZN PPV Automation Project Instructions
 
## Primary Objective
 
Preserve correctness before improving readability.
 
Always optimize for:
1. Correctness
2. Preserve existing behaviour
3. Smallest possible diff
4. Maintainability
5. Readability
6. Performance
 
---
 
## General Rules
 
- Make the smallest possible change.
- Never rewrite an entire file unless explicitly requested.
- Never refactor unrelated code.
- Preserve existing architecture.
- Preserve public APIs.
- Preserve existing logging unless asked to remove it.
- Do not rename methods, variables or files unless required.
- Explain why a change is needed before making it.
- If there is uncertainty, ask instead of guessing.
 
---
 
## Playwright Rules
 
- Never replace a working selector unless it is proven broken.
- Prefer existing selectors over introducing new ones.
- Never replace a specific locator with a more generic locator.
- Prefer deterministic waits over waitForTimeout().
- Do not increase- Do not increase- Do not increase- Do not ito- Do not increase- Do not increase- Do noddin- Do not increase-rve e- Do not increase- Do not increase- Do not increimply- Do not increase- s.
- Never remove- Never remove- Never r reporti- Never remove- Ned.
- Mai- Mai- Maiatibility- Mai- Ml DAZN - Mai- Maid surfa- ng p- Mai- Mai--
 
## A## A## A## A## A## A## A## A- Reuse e## A## A## A## A## A## A## A## A- Reuse e## A## A## A## chan## A## A## A## A## A##  root-caus## A## A## A## A## A## A## A##ompa## A## A#
- Do not hardcode PPV names, prices or regions.
- Keep the framework data-driven.
 
---
 
## GitHub Workflow Rules
 
Before suggesting workflow changes:
 
- Calculate total matrix size.
- GitHub Actions has a maximum of 256 matrix jobs.
- If- If- If- x exceeds 256 jobs:
  - recommend splitting workflows
  - or reducing combi  - or reducing combi  - or reducing combi  - or reduHu  - or reducing combi  - or reducing combi  - or reducing combessions
- flaky synchronization
- duplicated logic
- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d- d-ding existing code
- extracting reusable helpers
- minimal diffs
 
Avoid:
 
 
oid:
al diffs
sable helpers
- d- d- d- d- d- d- d- d- d- d-ecessary abstractions
- introducing new dependencies without justification
 
When multiple solutions exist, recommend the safest production-ready option first.
 
