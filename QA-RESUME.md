# BILARA-ASTRA-QA-2026-09-24

## Non-negotiable scope

- Preserve live Users, Roles, Projects and project assignments.
- Heavy write/load tests must use isolated local data, never live financial records.
- Do not repeat hard reset. Prior reset was reported complete, but independent live counts remain to be verified.
- Never save credentials, auth cookies or tokens in this handoff.

## Verified checkpoint

- Workspace: C:/Users/georg/Desktop/BilaraAudit
- Site: https://bilara-purchase-payment-control.georgezenjoe.chatgpt.site
- Project: appgprj_6a9eba06c13c81919723844ba7a8d66f
- Latest source: 9b81c6104f22b363c2ead784e3f46bb2025da858
- Latest source after Excel baseline: cc2dbf19bb49346847e558198c43f84b604c928e
- Published version 80: appgdep_6ab6263ea2948191906942796822d7e3 succeeded.
- Excel baseline now applies across purchase-plan import/save, rate-card import/save, and weekly backup downloads: visible progress stages, one-time stale dynamic-chunk recovery, 20-second API/document timeouts, and a 60-second overall backup timeout. Archive: outputs/qa/bilara-astra-qa-9.tgz.
- Latest workflow source: 6664eae6c01de7c37b6334f0c7aa59950fa07427
- Published version 81: appgdep_6ab6922a43148191b408b3a7195f3c76 succeeded.
- Latest source after hidden Excel technical IDs: a31d2db21c16c4f974bbffce68083c2fceaccf85
- Published version 82: appgdep_6ab796a538f88191b14f803be865d2fd succeeded.
- Excel baseline now hides Request ID, Payment ID, Requirement ID and Purchase ID columns in operator-facing upload, update, workflow and backup workbooks while retaining the keys internally for exact matching, duplicate prevention and reconciliation. Targeted technical-ID visibility/update-preservation regression passed. Archive: outputs/qa/bilara-astra-qa-11.tgz.
- Added a one-place BOQ release/GM approval queue with batch approve/reject, server-attributed approver identity, role-based rate visibility, controlled purchase-team rescheduling before orders exist, and an Accounts payment archive that retains payment references and linked receipt documents.
- Isolated workflow-controls regression passed: actor-attributed approval, batch endpoint, reschedule, and PM-versus-Purchase-Team rate visibility. Full regression remained 12/12, 566 requests.
- Cleanup deployment appgdep_6ab5394582688191a031172b3272669a succeeded, removing temporary reset endpoint.
- GPT-6 Astra research agent explicitly launched for role/project regression review. Current parent model selection is not asserted.
- Initial usage: 94% five-hour and 70% weekly remaining. Recheck at phase boundaries; checkpoint before either drops below 15%. Do not redeem reset credits without explicit approval.
- Passed: test-calculations, test-rate-card, test-forecast-requests, test-cutoff-templates.
- test-request-fields fails because it still asserts the old BOQ quantity heading; evaluate against latest Required quantity requirement before changing tests.
- Live rate-card data is still not imported because the available browser session is signed out. The helper workbook remains `outputs/BilaraRateCard-current.xlsx`; after signing in as Super Admin, import it in Settings and save, then verify Project 120 Cement = 350 and target 332.50.

## Plan and pending evidence

### 2026-09-24 verified progress

- GPT-6 Astra reviewer was launched with explicit model `gpt-6-astra`, high reasoning; returned six source-backed findings. Review agent ID 01a0d3ec-57b0-7ef3-b66d-5b5d8327e0a7.
- Added isolated Miniflare API runtime in scripts/qa-runtime.mjs, ephemeral local D1/R2 only. Source-download route excluded (Vite import.meta.glob). This is API integration testing, NOT browser or production-load certification.
- Regression suite: `node scripts/test-qa-regressions.mjs`, 12/12 scenarios passed, 566 measured requests (554 HTTP 200, 1 expected 403, 11 expected 409), plus direct anonymous/malformed checks. Includes 500 reads at concurrency 20. Report outputs/qa/regressions.json.
- Full workflow load: `node scripts/test-qa-load.mjs` passed: 1,283 HTTP requests, all 200; 12 workflow cycles, 60 requirements, 12 grouped POs, 60 purchases/payments, 12 linked bills, six finalized forecasts. Four concurrent flows and 300 reads at concurrency 24. Local p95 433.1 ms, p99 453.5 ms; not production latency. Report outputs/load-test-report.json.
- Fixed QC persistence, stale role assignment removal, transactional project-version guards, SQL-derived role-aware project scope, backup scope leakage, missing QC backup ownership, malformed JSON status.
- Type checking found pre-existing missing Projects onSaved callback; connected callback to refreshed project list. Re-run tsc/build before publication.
- Latest usage check: five-hour 12% remaining, weekly 57% remaining. Additional tests stopped to preserve handoff capacity; no reset credits used. New sessions do not reset account usage.
- TypeScript check passed after Projects callback fix.
- Publication build is in progress via site-workflow session 27302. Build helper hit a local npm launcher issue; equivalent `node node_modules/vinext/dist/cli.js build` is running successfully so far. Deployment must be verified before claiming live fixes. Check later checkpoint below for final result.
- No live user/project/data mutations performed in this test pass.
- Published version 77 successfully: appgdep_6ab618764ef08191953a6a4d28c7bb18.
- Published version 78 successfully: appgdep_6ab619eaf07881918e4cb5ee5c9459dc. Added one-time automatic recovery for stale open tabs that fail to fetch a dynamically imported Excel chunk; the tab reloads once and retries on the fresh deployment.
- Fresh-session Excel workflow smoke reaches the workflow dialog without the reported chunk error. `scripts/test-imports.mjs` still has a pre-existing ExcelJS fixture error (`-1 is out of bounds`) unrelated to this UI recovery change; TypeScript and production build passed.
- Fixed the Users read-only detail email normalization and published source `b2a6b0f192899f9c839405906578f8b7256277da`. TypeScript and production build passed. Live visual verification now shows the selected user's sign-in email; the accessibility snapshot omits the controlled input value, so visual inspection is the authoritative result.
- Live read-only preservation smoke after publication: Users & Roles shows 11 active users; Projects shows preserved project 162 (Ajin Kizhakamabalam) with Biju Vinamsy as Project Manager and Sandeep as QC co-owner. No live writes were performed.
- Regression suite after the fixes: 12/12 scenarios passed; 566 requests (554 HTTP 200, 1 expected 403, 11 expected 409). Full isolated workflow load: 1,283 requests, all HTTP 200; 60 requirements, 12 grouped POs, 60 purchase items/payments, 12 bills, six forecasts; read burst 49.3 RPS; p95 454.1 ms.
- Browser smoke verified the dashboard, Users & Roles filtering by email/name/role, View/Edit actions, Projects, Settings, Purchase requests and Ad hoc requests. Ad hoc reason now renders optional and is optional server-side. The read-only user detail email is now visually present after version 77 publication.
- Remaining product-level risks: the application is admin-dense, purchase forms are long, and the rate catalogue is empty after the reset (expected because only Users/Roles and Projects were preserved). Import the standard rate catalogue before relying on automatic BOQ pricing.
- Do not state full functional completion until pending items are tested. Last failed load attempt was a harness FormData serialization issue; fixed by Request serialization in test-qa-load, then full suite passed.

1. Establish isolated Worker/D1/R2 API test runtime and seed synthetic identities.
2. Reproduce user/project/QC and role-change issues, stale writes and authorization boundaries.
3. Exercise Excel parsing, catalogue rates, BOQ pricing, assignment, vendor, audit, PO, delivery, payments, closure, forecast and document workflows.
4. Run bounded concurrent reads/writes with latency/error reports. Authentication rejection is NOT a successful functional/load test.
5. Fix reproduced failures with regression tests; publish via Sites skill and verify deployment.
6. Authenticated live smoke checks and preservation counts, then report actual coverage and remaining gaps.

## Resume

In a new task open this same workspace, select GPT-6 Astra and say:
`Resume BILARA-ASTRA-QA-2026-09-24. Read QA-RESUME.md and the latest outputs/qa reports before taking action.`

This restores recorded context, not model quotas or tool connections. Reconnect Sites/browser tools if absent. Preserve the existing untracked deployment archives.
