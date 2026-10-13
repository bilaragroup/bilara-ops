# Bilara resume handoff

Resume keyword: `BILARA-RESUME-2026-09-22`

## Product context

Bilara Purchase & Payment Control is a construction procurement and weekly cash forecast application.

- Projects are numeric only, from 100 to 999. Never display a `PRJ` or `BRJ` prefix.
- Payment and execution weeks start Thursday and run through the following Wednesday.
- Planned requests follow the cutoff and late requests require GM approval; ad hoc requests are separate.
- Rates are confidential to Super Admin, GM, BOQ Team and Audit. Purchase users see the purchasing target, not the original/actual confidential baseline.
- The normal purchasing target is 5% below the BOQ baseline, with BOQ override support.
- Purchase Team enters vendor details and vendor rates after the request is submitted.
- Purchase orders can group multiple items, link one estimate/final bill/receipt to multiple items, and support delivery delay, reschedule, partial delivery, cancellation and closure after final settlement.
- Accounts records payments; Audit has review visibility and approval responsibilities.
- Project configuration assigns project managers by email and site engineers by email. Users & roles is a separate module.

## Current code state

- Workspace: `C:\Users\georg\Desktop\BilaraAudit`
- Sites project ID in `.openai/hosting.json`: `appgprj_6a9eba06c13c81919723844ba7a8d66f`
- Production URL: `https://bilara-purchase-payment-control.georgezenjoe.chatgpt.site/`
- Numeric project label fix was committed and published in commit `350a42f4427054c71aaf6e9cede5470d30c1d7bd`.
- Latest local edits move the Testing role switch into the application sidebar and make long-dialog form footers sticky so Save/Submit remains visible. These edits build successfully but still need commit and production publish.
- Build command: `npm run build` (passes; only Vite native-config and large-chunk warnings).
- A local helper workbook was generated at `outputs\BilaraRateCard-current.xlsx` from the current rate sheet rows for projects 120–122. It has not yet been imported into production settings.

## Rate card source

Google Sheet: `https://docs.google.com/spreadsheets/d/1h3dJG5tZcZe3h-OTXqtCMGoAXMcH1-Zcss3rjxxrfRU/edit?gid=0#gid=0`

The `RateCard` tab uses the headings `Project Number` followed by the 16 standard items. Confirmed values include project 120 Cement = 350, so the automated purchase target is 332.50. The UI warning “No project rate is saved…” means the rate card has not been imported/saved into application Settings yet.

## Next actions

1. Commit the sidebar role-switch and sticky-footer changes.
2. Build/package and publish the exact commit to the existing private Sites project.
3. Verify the live form shows project `120 · Ajin`, the role switch in the sidebar, and visible sticky Save/Submit controls.
4. As Super Admin, open Settings → Project rate catalogue, import the current `BilaraRateCard-current.xlsx` (or export the Google Sheet as XLSX), save changes, and verify project 120 Cement auto-matches BOQ 350 and target 332.50.
5. Run the end-to-end test matrix across Project Manager, Site Engineer, BOQ Team, Purchase Manager, Purchase Team, GM, Audit, Accounts and Super Admin.

## Identity

Current Super Admin email: `georgezenjoe@gmail.com`.

