# Bilara Purchase & Payment Control

Private owner workspace built from the supplied FY 2026–27 workbooks.

## Included

- Original source row explorer, 26 purchase sheets and 24 payment sheets, with preserved values, hyperlinks, sheet names and Excel row references.
- Review-to-activate purchase requirements and standalone payment schedules. Historical source rows do not silently enter live totals.
- Frozen BOQ quantity, unit rate and identity; editable operational delivery date, owner and notes.
- Multiple PO purchases per requirement, separate quantity/rate variance, discount, freight, other costs, recoverable and non-recoverable tax.
- Ad hoc request creation and owner review, with approval required before purchase entry.
- Purchase-linked and standalone payment schedules, partial payment events, due-date forecast, overpayment and over-scheduling protection.
- Persistent database, optimistic version checks, atomic writes, audit snapshots and CSV exports.

## Boundaries and rollout

The site is owner-private. Department users, enforced independent maker/checker identities and organization role permissions are not configured. Owner review is a recorded decision, not an independent approval control. Agree the BOQ authority, unit conventions, tax treatment and approval roles before wider team rollout.

Source matching flags are warnings, not automatic deduplication. Review repeat weekly lines before activation. Original dates are displayed as stored; activation requires an explicit date. Source prices with text or units require manual confirmation. Imported payment schedules begin unpaid; record verified historical payments with their actual date and reference. Source documents behind hyperlinks were not downloaded or verified.

The app stores document references, not uploaded files. No banking execution or accounting synchronization is performed. Actual purchase cost represents procurement entries; it is not consumed material cost or a full project profit calculation. No tax rates are prescribed.

## Validation

`npm run build` builds the Worker and client. `npx tsc --noEmit` checks application types. `node scripts/test-calculations.mjs` independently checks monetary formulas. `node scripts/test-api.mjs` runs write tests against the local server, and must only run with a disposable local database. It creates project 998 verification records. No test records are included in production.

Database migrations are in `drizzle/`; production applies them through Sites. `0001_payment_controls.sql` adds an expression index for duplicate POs; atomic conditional database writes enforce schedule limits. The forecast snapshot table is added by the 0002 migration.

Source extraction and analysis scripts require the bundled Python runtime and openpyxl for read-only extraction. `data/chunks` contains the deployment source snapshot; do not expose it as static public assets.



## Thursday-to-Wednesday planning cycle

The main view is a one-week, project-based cash forecast. Thursday PM submission is for the following Thursday start. Deadlines are BOQ pricing Friday, vendor finalization Monday, audit approval Tuesday, PO and forecast creation Wednesday. Actual purchase and delivery dates are separate from the assigned execution window. Project codes are integers from 100 through 999.

Requirements progress Submitted -> BOQ priced -> Vendors finalized -> Audit approved (or Rejected). Priced BOQ values and audited commercial terms are frozen. Creating an early or late PO, or recording an actual rate different from the audited quote, requires an exception reason. PO identifiers can be generated automatically. Combined PO quantities may not exceed the audited quantity.

Finalization is project-specific and checks audit completion, PO coverage, and either a payment schedule for the week or explicit credit terms. Early/late finalization requires a reason. Each finalization saves an immutable snapshot; later changes need another finalized version. Legacy records without a window are displayed using the week containing their planned date and must be reviewed before finalization.

Finalization starts a ZIP download with the familiar purchase and payment columns in separate XLSX files, plus full operational JSON and audit data. Editable amount and balance formulas and project summaries support offline continuity. Manual downloads are also available. Save these files to a location outside the app before an outage. There is no unattended external backup destination, and JSON restore / offline spreadsheet re-import is not automated. Snapshots currently have a 1.5 MB limit and report a clear error rather than silently truncating data.

`node scripts/test-weekly.mjs` (also invoked by test-api.mjs) verifies the calendar, review stages, PO generation, payment windows, immutable snapshots and Excel backup against a disposable local database. It creates project 998 test records; its generated cleanup SQL removes their exact UUIDs. It must never run against production. The 0002 migration adds the forecast snapshot table.


## Simple workflow and Excel upload
The main navigation is This week, Purchase requests and Payments. Preparation can move directly from Submitted to Vendors finalized once BOQ and vendor fields are complete; audit approval remains a separate action. Existing intermediate BOQ records remain compatible.
Templates & bulk upload downloads blank request/payment templates or existing rows with IDs. XLSX uploads (up to 500 rows, 5 MB) are parsed locally, reject formulas and possible duplicates, validate dates and project numbers, and run server validation before explicit saving. Rows save sequentially through the existing audited record API; a failure stops the upload and reports saved rows. This is not an all-or-nothing batch. Uploads preserve workflow stages and do not settle payments. Use IDs for updates; blank optional cells preserve existing fields. Backup workbooks remain separate from import templates.
Validation: TypeScript, production build, scripts/test-imports.mjs and scripts/test-weekly.mjs. No browser interaction testing performed.

## Purchase orders and Bilara branding
Purchase orders has a dedicated tab listing approved quantities still to order and created POs. Vendor/rate are prefilled from the audited request; saving generates the existing automatic PO number. View / print opens an A4 print layout with the supplied Bilara logo, buyer/supplier fields, delivery address, item, charges, terms and signature spaces. Browser printing supports Save as PDF. Unknown legal details are blank placeholders; no signatures or external sending are automated. Approved items for the same project, execution week and vendor can be selected into one multi-line PO. Each line retains its request parent; a durable orderId links the lines. Legacy single-line POs remain separate. The printable view reflects current saved values, with per-item required dates and quote references. Shared header details are fixed at creation; quantities, item charges and delivery can be updated within existing controls. Additional company fields remain in the full JSON backup and audit history.
Forms group optional cost, company and delivery details. Planned and ad hoc requirements appear together in Purchase requests. Header wording follows the supplied marked screenshot.
Validation: TypeScript, production build, local HTTP checks for app/PO/logo, existing workflow and upload regression scripts, and persistence assertions for the new PO fields. Browser interaction and print rendering have not been tested.

## Dashboard and themes
Dashboard now contains only week/project filters, cash needed, actual approval queue count, paid totals and a concise project summary. Requests, POs, payment forecasts and backups are separate tabs. Template upload is available within Requests and Payment forecast; forecast finalization is expandable within Payment forecast. Workbook reference controls remain secondary. The header theme toggle defaults to the device preference and saves an explicit light/dark selection locally, with graceful fallback when storage is unavailable. Both supplied logo variants are used. PO paper remains light for printing.
Validation: TypeScript and production build, local route HTTP check. No browser interaction testing performed.

## Shared documents and accounts payments
Documents supports one PDF/PNG/JPG upload (up to 10 MB) linked to 1–100 records in one project/week. Estimates link requirements, final bills link purchases, receipts link payment schedules. Bills/receipts enforce a common vendor. Files persist in R2; metadata and per-item linkage history persist in D1. Item details display documents linked directly or through related records. Downloads use attachment headers and remain behind the private site gate.
Accounts can allocate one vendor transaction across up to 50 schedules. Amount, actual date, bank reference, entered accounts name and optional shared receipt are retained per payment event. Partial/full paid status follows recorded amounts. Atomic version guards and idempotency prevent duplicate or concurrent overpayment. Team member names are recorded declarations, not separate departmental authentication; the app remains owner-private.
Backups include document metadata, payment batches and audit data, with selected-project/week document files inside the ZIP (100 MB per export cap; larger selections must be split). No automatic document extraction/OCR or invoice reconciliation is claimed. No external automatic backup destination or restore is configured.

## Expanded verification (2026-09-09)
- TypeScript, production build, existing weekly and Excel import regressions passed.
- New shared-document/accounts tests passed: wrong vendor/project rejection, file signature checks, download byte equality, partial/full payment, overpayment prevention, idempotent retry, concurrent payment conflict, and document-inclusive ZIP.
- Local browser flow passed: request creation, BOQ/vendor preparation, audit approval, automatic PO creation, printable PO display, payment schedule creation, estimate and receipt uploads, receipt selection, accounts confirmation, Paid status and zero outstanding balance.
- Browser alignment inspected at desktop, tablet and mobile widths in both themes; no page-level horizontal overflow at tested widths. Theme persisted across reload. Upload modal buttons align to a common baseline. Financial-year badge removed.
- Browser testing discovered and fixed workflow dropdown resetting caused by changing its option list after selection. Final selection now remains stable and saves correctly.
- Browser console reported no errors during tested accounts flow. Tests use only local fixtures; production financial records are not altered. This is functional/responsive regression testing, not an exhaustive penetration or large-scale load test. Physical printer/PDF pagination has not been verified.

### Linked weekly plans and grouped orders
The complete weekly plan in Purchase requests links planned and ad hoc items to their orders, payment schedules, payment status and shared documents. Grouped order creation is all-or-nothing with current quantity/version checks and idempotent retries. No extra financial totals are stored for the order header, preventing double counting. Existing Excel and JSON backups retain the item records and their shared order linkage. Run `node scripts/test-orders.mjs` for grouped order validation and concurrency checks.

### Request upload and automatic forecast drafts
New request templates omit Vendor, Vendor rate and Quote reference. Existing update exports retain their preparation fields and older templates remain accepted. Purchase-team vendor phone is saved on the requirement and copied into new POs. Payment forecast derives draft rows directly from active requests, showing pending rates, estimated unordered quantities and unscheduled PO balances. Confirmed schedules in any credit week are deducted once; drafts do not count as confirmed cash or paid amounts. Run `node scripts/test-forecast-requests.mjs` for these calculations.

### Mandatory request closure
Both planned and ad hoc requests can close only after audit approval, delivery/GRN completion, final bill attachment for each purchase line, and payment schedules plus actual settlements equal the full purchase value across all weeks. Accounts must attest final settlement and no unresolved delivery/billing issues. Audit can approve cancellation of the unordered quantity with a recorded reason. Closed requests and their linked purchase/payment records cannot change until reopened with a reason. Closure/reopening/cancellation preserve audit history; weekly plan status derives from every item's closure. Department names remain declared identities in this owner-private app, not separately authenticated roles. Run `node scripts/test-closure.mjs`.

### Drive documents, entities and payment modes
Documents can retain an HTTPS Google Drive/Docs link instead of R2 file bytes; links keep existing Drive permissions and are not fetched or copied. ZIP backups store a text link and metadata, not an offline copy of Drive content. File uploads remain available. Group and Builders are the only new purchasing entities; grouped POs and actual payment batches cannot mix entities. New actual settlements require Cash, UPI or Account Transfer; mode is recorded in history, batch data and Excel payment backup. Legacy payment events show Not recorded. Run `node scripts/test-options.mjs`.

## Purchase plan, audit review and site staffing (2026-10-13)
- **BOQ release by the BOQ Team.** The BOQ release queue in Purchase requests is now open to the BOQ Team as well as the GM. The BOQ Team releases normal requests; late-request exceptions still need the GM.
- **Purchase plan tab (Purchase Manager / Purchase Team).** All BOQ-released items for the selected week in one table. Enter vendor, phone, vendor rate, quotation reference and entity per line, see the purchasing target and the saving per line, then save or send the selected lines to Audit. Rows save one by one through the existing `/api/records` rules, so assignment, frozen BOQ fields and stage rules are unchanged. Purchase users still see only the target rate, never the confidential BOQ rate. Lines sent back by Audit return here with the audit note.
- **Audit review tab (Audit, GM).** The week's purchase plan with the BOQ rate, target, vendor rate, BOQ value, vendor value and saving for every line; totals and saving by project; lines above the BOQ rate or the target are flagged, and lines over the activity BOQ quantity are tagged. One batch decision: Approve, Send back to Purchase (returns the line to "BOQ priced" for renegotiation) or Reject. `POST /api/audit-decision` is Audit/Super Admin only, all-or-nothing with version checks, and records the signed-in auditor (not a typed name) plus the saving at approval (`auditSavings`). POs remain blocked until Audit approval.
- **Projects.** QC is optional. One Site Engineer per site.
- Validation: `node scripts/test-purchase-plan.mjs` (8 checks: staffing rules, BOQ Team release, rate confidentiality, audit permissions, stale-version refusal, return/renegotiate/approve, all-or-nothing batch, PO only after approval with audited rate and auto payment schedule), `node scripts/test-qa-regressions.mjs` (12/12), TypeScript and production build. Browser-checked locally at desktop and phone width with synthetic data. Deadlines are unchanged.
- **Demo data (local only).** With `npm run dev` running, `npm run seed:demo` loads demo people (`@demo.test`) and demo projects 901/902 with one item at each workflow step: waiting for BOQ, late request for the GM, waiting for Purchase rates, with Audit (one above BOQ), sent back by Audit, approved, PO issued, delivered with GRN and bill, paid and closed, and rejected. It refuses any address other than localhost and does nothing if the demo is already loaded.
- **Carry forward when site work slips (2026-10-13).** "Work slipped? Move lines to a later week" on Purchase plan (Purchase) and Purchase requests (PM, GM) moves a project's lines that are BOQ-released, with Audit or Audit-approved, and not yet ordered, to a later Thursday week. No re-approval: stage, vendor rate, audit decision and recorded saving stay. The required date keeps its weekday in the new week. All-or-nothing per batch, one project at a time, later weeks only; lines that already have a PO are listed but must be rescheduled from Purchase orders. Each move is kept in `carryForwards` and the history log, and the line shows "Moved from …". `node scripts/test-carry-forward.mjs` (6 checks).
- **Viewing several weeks (2026-10-13).** Purchase requests, Ad hoc requests, Purchase plan, Audit review, Purchase orders and the Dashboard now filter by a period instead of one Thursday: This week, Next week, Week after next, Next 4 weeks (default), All upcoming, All weeks, a single week, or a date range, with earlier/later arrows. Any date picks its Thu–Wed week. Rows are sorted by week and show their week when more than one week is shown; POs are still grouped per project, week and vendor. Payment forecast, Documents and Backups stay one week at a time because they act on a single payment week.
- **Goods received, bill check and payment on accepted quantity (2026-10-13).** New **Receive goods (GRN)** tab for the Site Engineer (also PM and Purchase): one GRN per PO with the GRN number, date, challan, vehicle and, per line, quantity received and accepted (rejected = the difference). Partial and repeated deliveries are allowed; accepting more than ordered or reusing a GRN number is refused. Each GRN creates a payment schedule for the accepted value only (due = GRN date + credit days) and takes the same amount out of the PO's forecast schedule, using any advance first. Purchase can close a line short when the vendor will not send the rest; the line's quantity and value become what was accepted. The old "Mark delivered" action is retired; delivery status cannot be edited by hand. **Bills to check** on Payment forecast (Accounts, Purchase): bill number, date, quantity, rate and amount per PO line, compared with accepted quantity, PO rate and accepted value. Payments for goods received are blocked until the bill matches or the GM / Audit approves the mismatch with a reason, and can never exceed the billed amount. Closure also needs the bill check. `node scripts/test-grn-bills.mjs` (8 checks). Note: `scripts/test-qa-load.mjs` and `scripts/test-delivery.mjs` already failed on fixed past dates and still use the retired "Mark delivered" step; they need updating.

## Plumbing & electrical (photo → quotes → BOQ → Audit → PO)

Plumbing and electrical are bought against a cost budget per house, not item by item.

1. **BOQ / GM** set the plumbing and electrical budget once per project (*Purchase requests → Plumbing & electrical → Budgets per house*).
2. **Site engineer or PM** uploads a photo of the plumber's or electrician's handwritten list with the date it is needed.
3. **Purchase** shares the photo with vendors (optionally types it out as one list so every vendor quotes the same items) and records each vendor's total quote, brands, credit days and quote file. One quote needs a reason.
4. **BOQ** picks the best value within what is left of the budget. A dearer quote (better brand) is allowed with a reason; a quote above the remaining budget is refused.
5. **Audit** approves, returns to BOQ or rejects.
6. **Purchase** issues one lump-sum PO line (unit LS). Site GRN, bill check, Thursday payment and closure then work as for every other material.

Site roles see vendor names but not prices or quote files. Tests: `node scripts/test-quotes.mjs`.

## Approved activity BOQ quantity

Project managers no longer enter it. The BOQ Team enters it when reviewing a request (it is required before BOQ can release the request). Later requests for the same project, milestone, activity, item and unit pick it up automatically, and the PM form shows how much is approved, already requested and left. Requests above what is left go to the GM. Tests: `node scripts/test-boq-quantity.mjs`.

## Search everything (Ctrl+K)

A **Search** button in the header (or Ctrl+K / ⌘K, or `/` anywhere outside a text box) opens one search across purchase and ad hoc requests, plumbing & electrical quotes, purchase-order lines, payment schedules, vendors, projects and pages. Every word typed must match (for example `121 overdue` or `kerala steel`). It matches item, project number or name, PO number, vendor, owner, activity (`A014`), milestone (`M3`), quotation reference, bill, GRN and status. Enter opens the record's detail; a vendor opens Purchase orders filtered to that vendor over all weeks; a project filters every screen; plumbing & electrical items open their page. The last six records opened are shown before typing, stored only in this browser.

It searches only the records the server already returned for the signed-in role, and results never show amounts, so rate confidentiality is unchanged. Code: `app/global-search.tsx`.
