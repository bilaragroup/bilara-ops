'use client';
// Search everything: one box (Ctrl+K / ⌘K or "/") across requests, plumbing &
// electrical quotes, purchase orders, payments, vendors, projects and pages.
// Results never show amounts, so rate confidentiality rules are unaffected:
// only records the server already returned for this user are searched.
import { useEffect, useMemo, useState } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Search,
  ClipboardList,
  PackageCheck,
  Wallet,
  Building2,
  Store,
  Zap,
  History,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { weekLabel } from '@/lib/weekly';

type Rec = Record<string, any>;
export type SearchPage = { value: string; label: string };
export type SearchAction = { id: string; label: string; run: () => void };

const RECENT_KEY = 'bilara.search.recent';
const PER_GROUP = 6;
const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
}

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** Plain-language status, matching the wording used in the registers. */
export function statusOf(r: Rec): string {
  if (r.kind === 'plan' || r.kind === 'request' || r.kind === 'quote') {
    if (r.closure?.state === 'Closed') return 'Closed';
    if (r.gmApproval?.state === 'Pending') return 'Awaiting GM approval';
    return r.stage || r.status || 'Submitted';
  }
  if (r.kind === 'payment') {
    if (r.status === 'Cancelled') return 'Cancelled';
    if (r.total && r.paid === r.total) return 'Paid';
    if (r.paid) return 'Part paid';
    return r.due && r.due < today() ? 'Overdue' : 'Unpaid';
  }
  return r.status || '';
}

function toneOf(status: string) {
  if (/overdue|rejected|delayed|cancelled/i.test(status)) return 'red';
  if (/awaiting|pending|with |submitted|part/i.test(status)) return 'amber';
  if (/paid|closed|delivered|approved/i.test(status)) return 'green';
  return '';
}

type Hit = { r: Rec; score: number };
const groups = [
  { key: 'request', title: 'Requests', icon: ClipboardList },
  { key: 'quote', title: 'Plumbing & electrical', icon: Zap },
  { key: 'purchase', title: 'Purchase orders', icon: PackageCheck },
  { key: 'payment', title: 'Payments', icon: Wallet },
] as const;
const groupOf = (r: Rec) => (r.kind === 'plan' ? 'request' : r.kind);

export default function GlobalSearch({
  records,
  projects,
  pages,
  actions,
  onOpenRecord,
  onNavigate,
  onProject,
  onVendor,
}: {
  records: Rec[];
  projects: Rec[];
  pages: SearchPage[];
  actions: SearchAction[];
  onOpenRecord: (r: Rec) => void;
  onNavigate: (tab: string) => void;
  onProject: (project: string) => void;
  onVendor: (vendor: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mac, setMac] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setRecent(readRecent());
    else setQuery('');
  }, [open]);

  const projectName = useMemo(
    () => new Map(projects.map((p) => [String(p.project), String(p.name || '')])),
    [projects],
  );

  // One lowercase haystack per record, built once per data refresh.
  const index = useMemo(
    () =>
      records
        .filter((r) => ['plan', 'request', 'quote', 'purchase', 'payment'].includes(r.kind))
        .map((r) => ({
          r,
          text: norm(
            [
              r.item,
              r.project,
              projectName.get(String(r.project)),
              r.vendor,
              r.po,
              r.id,
              r.owner,
              r.activityName,
              r.activityRequestCode && 'A' + r.activityRequestCode,
              r.milestone && 'M' + r.milestone,
              r.quoteReference,
              r.bill,
              r.grn,
              r.itemCategory,
              r.trade,
              statusOf(r),
              r.kind === 'request' ? 'ad hoc' : '',
              r.window,
            ].join(' '),
          ),
        })),
    [records, projectName],
  );

  const q = norm(query.trim());
  const tokens = q.split(/\s+/).filter(Boolean);

  const results = useMemo(() => {
    const out: Record<string, { hits: Hit[]; total: number }> = {};
    for (const g of groups) out[g.key] = { hits: [], total: 0 };
    if (!tokens.length) return out;
    const all: Hit[] = [];
    for (const { r, text } of index) {
      if (!tokens.every((t) => text.includes(t))) continue;
      let score = 0;
      const item = norm(r.item),
        po = norm(r.po);
      if (po && po === q) score += 200;
      if (norm(r.id) === q) score += 200;
      if (item.startsWith(q)) score += 60;
      else if (item.includes(q)) score += 30;
      if (tokens.includes(norm(r.project))) score += 25;
      if (statusOf(r) !== 'Closed' && r.status !== 'Cancelled') score += 10;
      all.push({ r, score });
    }
    all.sort(
      (a, b) =>
        b.score - a.score ||
        String(b.r.updated || '').localeCompare(String(a.r.updated || '')),
    );
    for (const h of all) {
      const g = out[groupOf(h.r)];
      if (!g) continue;
      g.total++;
      if (g.hits.length < PER_GROUP) g.hits.push(h);
    }
    return out;
  }, [index, query]);

  const vendorHits = useMemo(() => {
    if (!tokens.length) return [];
    const seen = new Map<string, number>();
    for (const r of records) {
      const v = String(r.vendor || '').trim();
      if (v && tokens.every((t) => norm(v).includes(t)))
        seen.set(v, (seen.get(v) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [records, query]);

  const projectHits = useMemo(() => {
    const list = projects.filter((p) => p.active !== false);
    if (!tokens.length) return [];
    return list
      .filter((p) =>
        tokens.every((t) => norm(`${p.project} ${p.name || ''}`).includes(t)),
      )
      .slice(0, 4);
  }, [projects, query]);

  const match = (label: string) =>
    !tokens.length || tokens.every((t) => norm(label).includes(t));
  const pageHits = pages.filter((p) => match(p.label + ' go to open'));
  const actionHits = actions.filter((a) => match(a.label));
  const recentRecords = recent
    .map((id) => records.find((r) => r.id === id))
    .filter(Boolean) as Rec[];

  function choose(fn: () => void) {
    setOpen(false);
    // Let the search dialog close before another dialog opens.
    setTimeout(fn, 0);
  }
  const openRecord = (r: Rec) =>
    choose(() => {
      pushRecent(r.id);
      onOpenRecord(r);
    });

  const recordItem = (r: Rec, prefix = '') => {
    const status = statusOf(r);
    const name = projectName.get(String(r.project));
    const sub = [
      `Project ${r.project}${name ? ' · ' + name : ''}`,
      r.kind === 'purchase' ? r.po : r.kind === 'request' ? 'Ad hoc' : '',
      r.vendor,
      r.window ? 'Week ' + weekLabel(String(r.window)) : r.due,
    ]
      .filter(Boolean)
      .join(' · ');
    const Icon = groups.find((g) => g.key === groupOf(r))?.icon || ClipboardList;
    return (
      <CommandItem
        key={prefix + r.id}
        value={prefix + r.id}
        onSelect={() => openRecord(r)}
        className="search-hit"
      >
        <Icon />
        <span className="search-hit-text">
          <b>{r.item || r.po || 'Untitled record'}</b>
          <small>{sub}</small>
        </span>
        {status && <span className={'tag ' + toneOf(status)}>{status}</span>}
      </CommandItem>
    );
  };

  const anyRecordHits = groups.some((g) => results[g.key].total);
  const nothing =
    tokens.length > 0 &&
    !anyRecordHits &&
    !vendorHits.length &&
    !projectHits.length &&
    !pageHits.length &&
    !actionHits.length;

  return (
    <>
      <button
        type="button"
        className="secondary search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search everything"
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      >
        <Search size={16} />
        <span className="search-trigger-label">Search</span>
        <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="search-dialog p-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">Search everything</DialogTitle>
        <DialogDescription className="sr-only">
          Find requests, purchase orders, payments, vendors, projects and pages.
        </DialogDescription>
        <Command shouldFilter={false} loop label="Search everything">
          <div className="search-input">
            <Search size={18} />
            <CommandPrimitive.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search item, PO number, vendor, project, activity…"
            />
            <kbd>Esc</kbd>
          </div>
          <CommandList className="search-list">
            {nothing && (
              <CommandEmpty>
                No matches for “{query.trim()}”. Try a PO number, vendor or
                project number.
              </CommandEmpty>
            )}

            {!tokens.length && recentRecords.length > 0 && (
              <CommandGroup heading="Recently opened">
                {recentRecords.map((r) => recordItem(r, 'recent:'))}
              </CommandGroup>
            )}

            {groups.map(({ key, title }) =>
              results[key].total ? (
                <CommandGroup
                  key={key}
                  heading={
                    results[key].total > results[key].hits.length
                      ? `${title} · top ${results[key].hits.length} of ${results[key].total}`
                      : title
                  }
                >
                  {results[key].hits.map(({ r }) => recordItem(r))}
                </CommandGroup>
              ) : null,
            )}

            {vendorHits.length > 0 && (
              <CommandGroup heading="Vendors">
                {vendorHits.map(([v, n]) => (
                  <CommandItem
                    key={'vendor:' + v}
                    value={'vendor:' + v}
                    onSelect={() => choose(() => onVendor(v))}
                    className="search-hit"
                  >
                    <Store />
                    <span className="search-hit-text">
                      <b>{v}</b>
                      <small>
                        {n} record{n === 1 ? '' : 's'} · show their purchase orders
                      </small>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {projectHits.length > 0 && (
              <CommandGroup heading="Projects">
                {projectHits.map((p) => (
                  <CommandItem
                    key={'project:' + p.project}
                    value={'project:' + p.project}
                    onSelect={() => choose(() => onProject(String(p.project)))}
                    className="search-hit"
                  >
                    <Building2 />
                    <span className="search-hit-text">
                      <b>
                        {p.project}
                        {p.name ? ' · ' + p.name : ''}
                      </b>
                      <small>Filter every screen to this project</small>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(anyRecordHits || recentRecords.length > 0) &&
              (actionHits.length > 0 || pageHits.length > 0) && <CommandSeparator />}

            {actionHits.length > 0 && (
              <CommandGroup heading="Actions">
                {actionHits.map((a) => (
                  <CommandItem
                    key={'action:' + a.id}
                    value={'action:' + a.id}
                    onSelect={() => choose(a.run)}
                  >
                    <Plus />
                    {a.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {pageHits.length > 0 && (
              <CommandGroup heading="Go to">
                {pageHits.map((p) => (
                  <CommandItem
                    key={'page:' + p.value}
                    value={'page:' + p.value}
                    onSelect={() => choose(() => onNavigate(p.value))}
                  >
                    <ArrowRight />
                    {p.label}
                    <CommandShortcut>Page</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="search-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>Enter</kbd> open
            </span>
            <span>
              <History size={13} /> Searches only records your role can see
            </span>
          </div>
        </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
