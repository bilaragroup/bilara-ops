// The company's milestones and activities: one list for purchase requests, the BOQ, DPR targets
// and site reports. Five milestones, as in the QC app (decided 15 Oct 2026); handover is part of
// milestone 5. Activities 1-103 are the QC app's, 104-105 Bilara additions, 106 the handover.

export const MILESTONES: Array<{number: number; name: string}> = [
  {number: 1, name: 'Foundation & basement'},
  {number: 2, name: 'Ground floor structure'},
  {number: 3, name: 'First floor structure'},
  {number: 4, name: 'Finishing works'},
  {number: 5, name: 'Final finishes & handover'},
];
export const MILESTONE_NUMBERS = MILESTONES.map((m) => String(m.number));

export function milestoneLabel(value: any) {
  const m = MILESTONES.find((x) => String(x.number) === String(value).trim());
  return m ? `Milestone ${m.number} · ${m.name}` : `Milestone ${value}`;
}

export const ACTIVITY_CATALOGUE: Array<{milestone: number; number: number; name: string}> = [
  [1, 1, 'Setout & plot clearance'], [1, 2, 'Foundation excavation'], [1, 3, 'Pit PCC'], [1, 4, 'Footing & column rebar'], [1, 5, 'Footing setting out'],
  [1, 6, 'Mat shuttering work'], [1, 7, 'Mat & haunch concreting'], [1, 8, 'Column shuttering'], [1, 9, 'Column concrete'], [1, 10, 'Column deshuttering'],
  [1, 11, 'Column pit back filling'], [1, 12, 'Plinth PCC shuttering work'], [1, 13, 'Plinth PCC'], [1, 14, 'Plinth rebar work'], [1, 15, 'Plinth shuttering'],
  [1, 16, 'Plinth casting'], [1, 17, 'Plinth deshuttering'], [1, 18, 'Plinth curing'], [1, 19, 'DPC coating'], [1, 20, 'Basement filling & mixing'],
  [2, 21, 'Superstructure brick work up to G/F lintel'], [2, 22, 'GF lintel & sunshade shuttering work'], [2, 23, 'GF lintel & sunshade steel work'],
  [2, 24, 'Lintel & sunshade wiring'], [2, 25, 'Lintel & sunshade concrete - GF'], [2, 26, 'Lintel side deshuttering'], [2, 27, 'Above lintel brick work - GF'],
  [2, 28, 'GF roof slab shuttering work'], [2, 29, 'GF roof slab rebar work'], [2, 30, 'GF roof slab wiring'], [2, 31, 'GF slab concrete'],
  [3, 32, 'GF slab curing period'], [3, 33, 'GF slab bund work'], [3, 34, 'Window concrete filling & GF setting'], [3, 35, 'GF exterior elevation work'],
  [3, 36, 'G/F exterior step brick work'], [3, 37, 'GF slab deshuttering'], [3, 38, 'FF superstructure brick work up to lintel'], [3, 39, 'GF electrical conduit works'],
  [3, 40, 'FF lintel & sunshade shuttering work'], [3, 41, 'G/F exterior plastering'], [3, 42, 'FF lintel & shade rebar work'], [3, 43, 'GF floor levelling & cleaning'],
  [3, 44, 'FF lintel & sunshade electrical conduit work'], [3, 45, 'GF anti-termite treatment'], [3, 46, 'GF floor PCC'], [3, 47, 'FF lintel concrete'],
  [3, 48, 'G/F toilet plastering'], [3, 49, 'Lintel side deshuttering'], [3, 50, 'FF above lintel brick work'], [3, 51, 'GF plumbing work'],
  [3, 52, 'GF interior plastering'], [3, 53, 'FF roof slab shuttering work'], [3, 54, 'GF toilet floor concreting'], [3, 55, 'External plumbing & routing'],
  [3, 56, 'Septic tank & pits'], [3, 57, 'FF roof slab rebar work'], [3, 58, 'FF roof slab wiring'], [3, 59, 'FF slab concrete'],
  [4, 60, 'FF slab curing'], [4, 61, 'FF slab bund fixing'], [4, 62, 'FF elevation civil work / parapet brick work'], [4, 63, 'Interior steel staircase work'],
  [4, 64, 'F/F exterior plastering 1'], [4, 65, 'Exterior truss / steel work'], [4, 66, 'FF slab deshuttering'], [4, 67, 'FF electrical conduit work'],
  [4, 68, 'FF toilet plastering'], [4, 69, 'FF plumbing work'], [4, 70, 'FF interior plastering'], [4, 71, 'F/F toilet floor concreting'], [4, 72, 'Toilet waterproofing'],
  [4, 73, 'GF floor tile laying'], [4, 74, 'Interior production starting'], [4, 75, 'F/F exterior wall plastering 2'], [4, 76, 'Granite works'],
  [4, 77, 'G/F interior door fixing'], [4, 78, 'FF tile laying'], [4, 79, 'Front & back door fixing'], [4, 80, 'G/F & F/F wiring work'],
  [4, 81, 'Other ornamental work'], [4, 82, 'Interior damp stop coating'],
  [5, 83, 'F/F interior door fixing, SLGD, window glass etc.'], [5, 84, 'GF gypsum ceiling work'], [5, 85, 'FF interior putty work'], [5, 86, 'GF interior putty work'],
  [5, 87, 'Interior units setting'], [5, 88, 'Exterior damp stop coating'], [5, 89, 'Exterior putty works'], [5, 90, 'Sanitary fittings'],
  [5, 91, 'Installation of switch / socket'], [5, 92, 'Exterior primer application'], [5, 93, 'Electrical fan and other fixings'], [5, 94, 'Frontyard basic levelling & cleaning'],
  [5, 95, 'Exterior emulsion application'], [5, 96, 'Interior primer application'], [5, 97, 'Interior emulsion work'], [5, 98, 'Windows painting'],
  [5, 99, 'Interior door painting & polishing'], [5, 100, 'Interior final settings'], [5, 101, 'Final touchups - interior & exterior'], [5, 102, 'Floor pointing / epoxy works'],
  [5, 103, 'Floor cleaning'], [2, 104, 'Putting up scaffolding'], [2, 105, 'Loading bricks'], [5, 106, 'Handover to client'],
].map(([milestone, number, name]) => ({milestone: Number(milestone), number: Number(number), name: String(name)}));

export function activityOf(number: any) {
  return ACTIVITY_CATALOGUE.find((a) => String(a.number) === String(number).trim()) || null;
}
export function activitiesOfMilestone(milestone: any) {
  return ACTIVITY_CATALOGUE.filter((a) => String(a.milestone) === String(milestone).trim()).sort((a, b) => a.number - b.number);
}
