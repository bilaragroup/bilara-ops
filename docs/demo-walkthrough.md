# Bilara demo walkthrough

A guided tour of the whole app on your own computer, using sample data. Nothing here touches the live site.

## 1. Start clean and load the sample data

In the `bilara-ops` folder:

1. Stop the app if it is running (Ctrl+C in its terminal).
2. `npm run demo:reset` and type `RESET`. This empties your **local** copy: every request, order, payment, file, user, project, setting, rate card, site and QC record you typed while testing. The tables stay; the local admin `seedy@sites.test` is put back.
3. `npm run dev`
4. In a second terminal: `npm run seed:demo`

Open http://localhost:3000. Use **Testing as** (bottom-left) to become each person below. The demo week is the next planned Thursday–Wednesday week; the Weeks filter (Next 4 weeks) shows it.

If you only want fresh sample data on top of what you have, skip step 2. The seed stops if projects 901/902 already have records.

## 2. Who is who

| Demo person | Role | Works on |
|---|---|---|
| Demo PM (Biju) | Project Manager, projects 901 and 902 | Purchase requests, Ad hoc requests, Daily targets, Quality checks, Site stock |
| Demo BOQ (Subha) | BOQ Team | Purchase requests (BOQ queue), Rate cards, Plumbing & electrical budgets |
| Demo GM (Sachin) | GM | Late or over-BOQ requests, labour approval, dashboards |
| Demo Purchase (Jithin) | Purchase Manager | Purchase plan, Purchase orders, Plumbing & electrical quotes, Payment forecast |
| Demo Audit (Rijila) | Audit | Audit review, Plumbing & electrical approval |
| Demo Accounts (Gokul) | Accounts | Payment forecast: bills to check, record payment |
| Demo SE (Sandeep) / Demo SE (Arun) | Site Engineer, 901 / 902 | Daily DPR, Receive goods (GRN), Site stock |
| Demo QC (Anu) / Demo QC (Meera) | QC engineers | My QC visits |
| Demo Labour manager (Jiby) | Labour Manager | Labour payables |

Projects: **901 Demo – Kakkanad Villa** (SE Sandeep) and **902 Demo – Aluva House** (SE Arun).

## 3. The weekly cycle (Thursday to Wednesday)

1. **PM raises a request** for a future week: project, milestone, activity (from the company list of 5 milestones), item, quantity. Cut-off is Saturday 9 am, 12 days before the execution Thursday.
2. **BOQ team** confirms the approved activity quantity; the BOQ rate comes from the **rate card** (project card, else its range card, else the default card). Late requests and requests above the BOQ quantity go to the **GM** first.
3. **Purchase** enters vendor, rate, quotation reference and entity on the **Purchase plan** (Review → Edit → Send to Audit).
4. **Audit** approves, sends back for a better rate, or rejects. No PO before approval.
5. **Purchase** creates one **PO** per vendor (Wednesday). A payment forecast is created from delivery and credit days.
6. **Site Engineer** records the **GRN** against the PO: received and accepted quantity. Only the accepted quantity is paid; site stock goes up.
7. **Accounts** checks the vendor's **bill** against the PO rate and accepted quantity, then **pays on Thursday** (Cash, UPI or account transfer) with the receipt.
8. **Purchase closes** the request once it is received, billed and paid.

Plumbing & electrical is bought differently: the site uploads a **photo of the list**, Purchase collects **quotes**, BOQ **chooses** one within the per-house budget, Audit approves, Purchase issues a lump-sum PO.

On site, every day: the **PM sets tomorrow's targets**, the **SE files the morning headcount** and the **end-of-day report** with photos and material used (stock goes down). The PM builds **QC checklists** and books a **QC visit**; the QC engineer inspects, signs, and a failed or partial check gets a **re-site visit** by a different QC engineer.

## 4. What the sample data shows, step by step

| # | What to look at | Sign in as | Where |
|---|---|---|---|
| 1 | Two new requests waiting for BOQ (Laterite Stone 901; Red Bricks 902 for the week after) | BOQ | Purchase requests → release queue at the top; sidebar counter |
| 1b | Hitachi request needing the GM (late, or 20 h against a BOQ of 16 h) | GM | Purchase requests → approval queue |
| 1c | **Urgent** ad hoc request: Binding wire for 902 — the sidebar counter is **red** | BOQ | Ad hoc requests |
| 2 | PSand approved by BOQ, waiting for vendor rates | Purchase | Purchase plan → Project 901 → Review → Edit |
| 3 | 20 mm Metal (below target) and 12 mm Steel (above BOQ, flagged) with Audit | Audit | Audit review |
| 3b | 16 mm Steel sent back by Audit: "Negotiate and resend" | Purchase | Purchase plan → Project 902 |
| 4 | Tile Gum approved, ready for a PO | Purchase | Purchase orders → Ready to order |
| 5 | Cement PO issued, waiting for delivery | SE Sandeep | Receive goods (GRN) |
| 6 | MSand: 500 CFT arrived, 480 accepted (measured from the lorry), GRN-902-000001; payment only for 480; the vendor's invoice bills 500 | Accounts | Payment forecast → Bills to check (open the attached invoice) |
| 7 | Cement blocks: GRN, bill matched, paid by UPI with receipt, request closed | Accounts / Purchase | Payment forecast (choose the demo week) → Payment archive; Purchase requests → Closed |
| 8 | Shuttering Items rejected by Audit; Red Bricks (901) cancelled by the PM | PM | Purchase requests → Closed |
| P&E | 902 electrical list waiting for quotes; 901 plumbing with three quotes for BOQ to choose (quotation PDF attached); 902 plumbing approved, ready for PO | Purchase / BOQ | Purchase requests → Plumbing & electrical → Plumbing / Electrical |
| Rates | Default card, projects 901–910 card (cement, M-sand), project 902 card (steel) | BOQ | Rate cards |
| Stock | Opening counts on both sites; GRNs added; daily reports used blocks | SE Arun / PM | Site stock |
| DPR | Three finished days on 902 with photos; the last one filed late (11:30 pm) | PM / GM | My sites, Site dashboard, DPR compliance, Site productivity |
| Target | Tomorrow's brickwork target on 901 | SE Sandeep | Daily DPR (tomorrow) |
| QC | 901 lintel checklist inspected by Anu: minor defect, signed report and locked evidence | PM | Quality checks → Checklists → Re-site visit needed → View |
| QC | Re-site visit for 901 booked with Meera for tomorrow | QC Meera | My QC visits → Accept → Open inspection |
| QC | 902 slab checklist booked with Anu in 3 days; Anu on leave in 5 days | QC Anu / PM | My QC visits; Quality checks → QC visit calendar |
| Labour | Weekly labour payables from the 902 daily reports | Labour manager / GM | Labour payables / Labour approval |

## 5. Things to try yourself

- As **Purchase**: price PSand on the purchase plan and press **Send to Audit**; then as **Audit** approve it; then create its PO.
- As **SE Sandeep**: receive the Cement PO (try accepting less than delivered).
- As **Accounts**: check the MSand invoice (500 billed, 480 accepted) — the mismatch blocks payment until a corrected bill or GM/Audit approval.
- As **Meera**: accept the re-site visit, open it (satisfactory items carry over), fix the defect item and submit — the checklist moves to Completed.
- As **PM**: raise a new request; note the activity list only shows activities of the chosen milestone.

## 6. Sample documents included

Vendor quotation (Kollamkudiyil B 2562), MSand tax invoice (Periyar Crushers PC-INV-5521), cement blocks bill (Kerala Traders KT-BILL-3301), UPI payment receipt, two site-list photos, and site/QC photos. All are marked as sample documents.
