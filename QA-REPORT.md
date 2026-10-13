# End-to-end regression review — 10 September 2026

Passed local API suites: weekly planning, Excel import/export, grouped purchase orders, forecast derivation, documents, accounts/payment options, closure and deep regression cases. TypeScript checking and production build passed.

Fixed: decimal order quantity rounding; fully cancelled plan finalization; incomplete PO payment coverage at forecast finalization; future actual delivery dates; changes to audited entity/ad hoc BOQ baseline; changes to paid payment identity; unsafe monetary totals; import preview bypass of order limits; grouped PO payment import linking/entity; Thursday field commit/recovery; undefined ad hoc BOQ display.

Closure tests include delivery, final bills, complete settlement across later weeks, cancellation approval, planned/ad hoc requests, reopening and concurrent close/update protection. Browser checks verified execution-week propagation, upload dialog and mobile dark/desktop light layout.

Tests used synthetic local records, subsequently removed. No production business records were changed. This is functional regression testing, not a load test or an independent security audit. External Drive links remain dependent on Drive access and are backed up as links.

PO delivery controls: added item selection and whole-order updates for one-day delay, revised dates, delivered and not-delivered states, and cancellation. Cancellation zeros unpaid linked schedules, preserves history, frees quantities for replacement, and blocks paid/received items. Cancelled quantities do not count toward receipt or closure. Original and revised delivery dates appear in printed POs and Excel backup. Payment dates are unchanged by delivery rescheduling.

Passed test-delivery.mjs plus orders, closure, weekly/backup, imports, forecast derivation and TypeScript checks. Browser verified whole-order delay and mobile dialog.

Saturday cutoff update: planned request cutoff is Saturday 09:00 IST, 12 calendar days before the execution Thursday. Friday 11 September and Saturday 12 September 08:59:59 accept 24 September; at 09:00 normal execution rolls to 1 October. During the remainder of that planning week, the late 24 September request requires an explicit GM decision. Earlier requests use the separate Ad hoc screen and template. New or revised required delivery dates cannot be backdated. Existing historical dates remain preserved. Thursday selection and required delivery stay synchronized.

Validated deterministic cutoff boundaries, ordinary-update approval bypass rejection, explicit GM approval progression, planned/ad hoc templates, browser invalid date recovery and date synchronization. GM decisions are recorded in the owner workspace; separate authenticated department permissions are not implemented.

Simplification and request fields: removed repeated header wording and shortened routine instructions. Accounts payment entry opens from All projects with an in-dialog project chooser; request timeout retains the same payment attempt for safe retry. Verified a local partial payment of 5.00 against 12.34, leaving 7.34. Planned/ad hoc templates and forms expose one BOQ Quantity, Item Category and owner selection. Excel owner/category lists are editable on Lists; existing owners supplement Jithin. Starter categories: Materials, Tools & Equipment, Services. Old internal quantities remain for compatibility.

Configuration: added Settings under More, with separately editable Owners, BOQ Preparers and Item Categories. Default people: Jithin, Jiby, Rosmi, Sneha, Stevo; preparers initially share these names. Server validates changed names against configured lists while preserving historical assignments. New templates obtain configured lists, including BOQ Preparer validation. Configuration is included in full JSON backups. Tests passed for persistence, invalid/duplicate values, concurrent-version conflict, server validation and backup inclusion; browser verified exact owner choices.

## Application usability redesign — 12 September 2026

- Replaced the wrapping top navigation with a desktop sidebar and compact, horizontally scrollable phone navigation. Added Settings as a primary destination and moved registers/history into secondary navigation.
- Added one shared project / execution-week selector; removed duplicate selectors in request, order, document and backup workspaces.
- Rebuilt dashboard with scheduled cash outstanding, approval count, open delivery items, paid amounts, actionable approval/delivery/payment exceptions and project forecast drilldowns. Values are scoped to the selected week; paid totals refer to that week's schedules, not payment transaction dates.
- Replaced raw database field dumps with labelled request/order/payment summaries. Completion checks are expandable; overdue payment details have a direct Record payment action.
- Replaced multiline configuration textareas with individual add/remove list entries, duplicate checks, save/discard controls and unchanged server-side validation/version checks.
- Document creation now opens from All projects and asks for the project inside the dialog, instead of presenting a disabled action.
- Corrected blank BOQ rate presentation and cancelled payment labelling in linked project plans.

Validation completed locally:
- TypeScript check and production build passed.
- Configuration persistence / duplicate / empty / stale-write / backup tests passed.
- Modern request and ad hoc Excel template round trips passed: one BOQ quantity, category, configured owner and BOQ preparer dropdowns.
- Delivery regression passed: individual and whole-order delays, rescheduling, original dates, stale writes, future actual dates, partial delivery, cancellation, zeroed unpaid schedules, replacement orders and paid-order cancellation protection.
- Planned/ad hoc closure tests passed: quantity, final bill, delivery, full settlement, later-week payment, attestation, locked closed records and reasoned reopening.
- Cutoff boundaries and explicit GM approval tests passed, including bypass rejection.
- Deep commercial regressions and calculation tests passed.
- Browser testing at 390px phone and 1440px desktop: navigation, light/dark themes, Settings add/discard, mobile request creation, automatic request appearance in forecast, readable record detail, Accounts launcher from All projects, and document project picker. Phone document width stayed within viewport. No browser errors were reported in the inspected session.
- Business fixtures were local only and cleanup SQL was run; no production business records were edited during QA.

Scope: this improves the existing private application; independent department sign-ins and maker/checker authorization remain a separate rollout requirement. Drive-link backups preserve links rather than offline copies of those files.
