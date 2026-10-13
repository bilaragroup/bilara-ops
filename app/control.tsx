'use client';
import Users from './users';
import Projects from './projects';
import RequestAccess from './request-access';
import { has, confidential } from '@/lib/permissions';
import RecordSummary from './record-summary';
import SettingsPage from './settings';
import { defaultSettings } from '@/lib/settings';
import { RATE_CARD_ITEMS, RATE_CARD_ITEM_DEFAULTS } from '@/lib/rate-card';
import GMApproval from './gm-approval';
import ApprovalQueue from './approval-queue';
import PurchasePlan from './purchase-plan';
import CarryForward from './carry-forward';
import PeriodPicker from './period-picker';
import AuditReview from './audit-review';
import RescheduleRequest from './reschedule-request';
import { requestPolicy, plannedWindowRoute } from '@/lib/request-policy';
import WeekInput from './week-input';
import Weekly from './weekly';
import Closure from './closure';
import PlanOverview from './plan-overview';
import ForecastRequests from './forecast-requests';
import Documents from './documents';
import Accounts from './accounts';
import Dashboard from './dashboard';
import ThemeToggle from './theme-toggle';
import Orders from './orders';
import Bulk from './bulk';
import {
  planningWindow,
  validWindow,
  recordWindow,
  makePeriod,
  inPeriod,
  singleWeek,
  weekLabel,
  type Period,
  stageNames,
  addDays,
} from '@/lib/weekly';
import { useEffect, useState, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Search,
  Plus,
  ArrowUpRight,
  Download,
  ClipboardList,
  Wallet,
  ShieldCheck,
  TriangleAlert,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  Building2,
  UserCog,
} from 'lucide-react';
import {
  Entry,
  money,
  cents,
  purchaseCost,
  planMetrics,
} from '@/lib/calculations';
type Any = Record<string, any>;
function Choice({ value, onChange, options, label }: any) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue>
          {options.find((o: any) => o[0] === value)?.[1] || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o: any) => (
          <SelectItem key={o[0]} value={o[0]}>
            {o[1]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Tag({ children, tone = 'neutral' }: any) {
  return <span className={'tag ' + tone}>{children}</span>;
}
function Field({
  name,
  label,
  draft,
  set,
  type = 'text',
  required = false,
  readOnly = false,
  valueOverride,
}: any) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        readOnly={readOnly}
        step={type === 'number' ? 'any' : undefined}
        min={
          type === 'number'
            ? 0
            : name === 'due' && ['plan', 'request'].includes(draft.kind)
              ? draft.due < today() && draft.id
                ? undefined
                : draft.window > today()
                  ? draft.window
                  : today()
              : undefined
        }
        max={
          name === 'due' && draft.window ? addDays(draft.window, 6) : undefined
        }
        inputMode={name === 'project' ? 'numeric' : undefined}
        pattern={name === 'project' ? '[1-9][0-9]{2}' : undefined}
        maxLength={name === 'project' ? 3 : undefined}
        title={
          name === 'project'
            ? 'Enter a whole project number from 100 to 999'
            : undefined
        }
        value={
          valueOverride !== undefined ? valueOverride : (draft[name] ?? '')
        }
        onChange={(e) => set({ ...draft, [name]: e.target.value })}
      />
    </label>
  );
}
function ProjectField({ draft, set, projects, readOnly = false }: any) {
  const active = projects.filter(
    (p: any) => p.active || p.project === draft.project,
  );
  return active.length ? (
    <label className="field">
      <span>Project *</span>
      <select
        required
        disabled={readOnly}
        value={draft.project || ''}
        onChange={(e) => set({ ...draft, project: e.target.value })}
      >
        <option value="">Choose project</option>
        {active.map((p: any) => (
          <option key={p.project} value={p.project}>
            {p.project} · {p.name}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <Field
      name="project"
      label="Project number (100–999)"
      readOnly={readOnly}
      required
      draft={draft}
      set={set}
    />
  );
}
function ItemPicker({ item, itemChoice, onChange, readOnly = false }: any) {
  const standard = (RATE_CARD_ITEMS as readonly string[]).includes(item),
    choice = standard ? item : itemChoice || (item ? '__other' : '');
  return (
    <>
      <label className="field">
        <span>Item *</span>
        <select
          required
          disabled={readOnly}
          value={choice}
          onChange={(e) => {
            const value = e.target.value;
            onChange({
              itemChoice: value,
              item: value === '__other' ? '' : value,
            });
          }}
        >
          <option value="">Choose item</option>
          {RATE_CARD_ITEMS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
          <option value="__other">Other item</option>
        </select>
      </label>
      {choice === '__other' && (
        <label className="field">
          <span>Other item description *</span>
          <input
            required
            readOnly={readOnly}
            maxLength={200}
            value={item || ''}
            onChange={(e) =>
              onChange({ itemChoice: '__other', item: e.target.value })
            }
          />
        </label>
      )}
    </>
  );
}
function Metric({ label, value, note }: any) {
  return (
    <article className="metric">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
const titles: Any = {
  plan: 'Purchase requirement',
  purchase: 'Purchase order',
  request: 'Ad hoc request',
  payment: 'Payment schedule',
  settle: 'Record payment',
};
const display = (v: any) =>
  v === null || v === undefined || v === '' ? '—' : String(v);
const numeric = (v: any) => (typeof v === 'number' ? v : '');
const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function calculatedTargetRate(d: any) {
  const original = Number(d.boqOriginalRate),
    reduction = Number(d.targetDiscountPercent);
  if (Number.isFinite(original) && original > 0 && Number.isFinite(reduction))
    return Math.round(original * (1 - reduction / 100) * 100) / 100;
  return d.kind === 'plan' ? (d.boqRate ?? '') : (d.estimateRate ?? '');
}
function exportCSV(rows: Any[], name: string) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const safe = (v: any) => {
    let x = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    if (/^[=+@\-\t\r]/.test(x)) x = "'" + x;
    return '"' + x.replaceAll('"', '""') + '"';
  };
  const url = URL.createObjectURL(
    new Blob(
      [
        '\uFEFF' +
          [
            keys.map(safe).join(','),
            ...rows.map((r) => keys.map((k) => safe(r[k])).join(',')),
          ].join('\r\n'),
      ],
      { type: 'text/csv;charset=utf-8' },
    ),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
export default function Control({ user, testUserSwitch }: any) {
  const canGM = has(user, 'GM'),
    canPurchase = has(user, 'Purchase Manager', 'Purchase Team'),
    canPay = has(user, 'Accounts'),
    canPrivate = confidential(user),
    canSeeRates = canPrivate || canPurchase;
  const [referenceRates, setReferenceRates] = useState<any[]>([]);
  const canStart = (k: string, extra: any = {}) =>
    k === 'settle'
      ? canPay
      : k === 'payment' || k === 'purchase'
        ? canPurchase
        : k === 'plan'
          ? canGM ||
            has(user, 'Project Manager') ||
            (!!extra.id && (canPurchase || has(user, 'BOQ Team', 'Audit')))
          : k === 'request'
            ? canGM ||
              has(user, 'Project Manager', 'Purchase Manager') ||
              (!!extra.id && (canPurchase || has(user, 'Audit')))
            : false;

  const [tab, setTab] = useState('weekly'),
    [view, setView] = useState('live'),
    [records, setRecords] = useState<Entry[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [source, setSource] = useState<Any>({
      rows: [],
      sheets: [],
      projects: [],
      count: 0,
    }),
    [kind, setKind] = useState('purchase'),
    [sheet, setSheet] = useState('SEPT 07 - SEPT 14'),
    [project, setProject] = useState('all'),
    [milestoneFilter, setMilestoneFilter] = useState('all'),
    [activityFilter, setActivityFilter] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [sourceLoading, setSourceLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [draft, setDraft] = useState<Any | null>(null),
    [selected, setSelected] = useState<Any | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const [settings, setSettings] = useState({
      values: defaultSettings,
      version: 0,
    }),
    [projectConfigs, setProjectConfigs] = useState<any[]>([]);
  useEffect(() => {
    Promise.all([fetch('/api/settings'), fetch('/api/projects')])
      .then(async ([sr, pr]) => {
        const s: any = await sr.json(),
          p: any = await pr.json();
        if (!sr.ok) throw Error(s.error);
        if (!pr.ok) throw Error(p.error);
        setSettings(s);
        setProjectConfigs(p.projects || []);
      })
      .catch((e) => setError(String(e)));
  }, []);
  const [window, setWindow] = useState(planningWindow());
  // Requests, plans, audit and orders are viewed over a period of weeks;
  // payment forecast, documents and backups stay one week at a time.
  const [period, setPeriodState] = useState<Period>(() => makePeriod('next4'));
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    const w = singleWeek(p);
    if (w) setWindow(w);
    setOffset(0);
  };
  const showWeek = (w: string) => {
    setWindow(w);
    if (!inPeriod(w, period)) setPeriodState(makePeriod('week', undefined, w));
  };
  const weekTab = ['payment', 'backup', 'documents'].includes(tab);
  const multiWeek = !singleWeek(period);
  const [documents, setDocuments] = useState<any[]>([]);
  const baselineLocked = (d: any) =>
    !!d.id &&
    records.find((r) => r.id === d.id)?.stage &&
    records.find((r) => r.id === d.id)?.stage !== 'Submitted';
  const refresh = async (options: { skipDocuments?: boolean } = {}) => {
    try {
      const r = await fetch('/api/records', { signal: AbortSignal.timeout(20000) });
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRecords(data.records);
      setReferenceRates(data.referenceRates || []);
      setSelected((prev) =>
        prev ? data.records.find((r: any) => r.id === prev.id) || prev : null,
      );
      setHistory(data.history);
      if (!options.skipDocuments) {
        const docResponse = await fetch('/api/documents', {
          signal: AbortSignal.timeout(10000),
        });
        const docData: any = await docResponse.json();
        if (!docResponse.ok) throw Error(docData.error);
        setDocuments(docData.documents);
      }
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  function changeTab(v: string) {
    setTab(v);
    setQuery('');
    setOffset(0);
    if (v === 'payment') {
      setKind('payment');
      setSheet('SEPT 4-SEPT10');
    } else if (v === 'plan') {
      setKind('purchase');
      setSheet('SEPT 07 - SEPT 14');
    }
  }
  const plans = records.filter((r) => r.kind === 'plan'),
    buys = records.filter((r) => r.kind === 'purchase'),
    payments = records.filter((r) => r.kind === 'payment'),
    requests = records.filter((r) => r.kind === 'request');
  const matches = (r: any) =>
    (project === 'all' || r.project === project) &&
    (milestoneFilter === 'all' || String(r.milestone) === milestoneFilter) &&
    (!activityFilter || String(r.activity) === activityFilter.trim()) &&
    (tab === 'payment'
      ? recordWindow(r, records) === window
      : inPeriod(recordWindow(r, records), period)) &&
    [
      r.item,
      r.project,
      r.vendor,
      r.po,
      r.id,
      r.activityName,
      r.activityRequestCode,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase());
  const active = (
    tab === 'plan'
      ? plans
      : tab === 'payment'
        ? payments
        : tab === 'purchase'
          ? buys
          : requests
  )
    .filter(matches)
    .sort((a, b) =>
      multiWeek && tab !== 'payment'
        ? String(recordWindow(a, records)).localeCompare(
            String(recordWindow(b, records)),
          )
        : 0,
    );
  const metrics = useMemo(() => {
    const ps = plans.filter(matches),
      bs = buys.filter(matches),
      pays = payments.filter(matches);
    return {
      budget: ps.reduce(
        (n, p) =>
          n +
          (Number.isFinite(p.boqQty * p.boqRate)
            ? cents(p.boqQty * p.boqRate)
            : 0),
        0,
      ),
      cost: bs.reduce((n, p) => n + purchaseCost(p).cost, 0),
      due: pays.reduce((n, p) => n + p.total - p.paid, 0),
      paid: pays.reduce((n, p) => n + p.paid, 0),
      rate: ps.reduce(
        (n, p) => n + (planMetrics(p, buys).rateVariance || 0),
        0,
      ),
    };
  }, [records, project, query, window, period, tab]);
  const start = (k: string, extra: Any = {}) => {
    if (!canStart(k, extra)) {
      setNotice('Your role has view access here.');
      return;
    }
    setFormError('');
    const isNewPlan = k === 'plan' && !extra.id,
      planWindow =
        plannedWindowRoute(window) === 'adhoc'
          ? requestPolicy().normal
          : window;
    setDraft({
      accountsBy: user.name,
      auditOwner: user.name,
      kind: k,
      window: k === 'plan' ? planWindow : window,
      due:
        k === 'plan'
          ? planWindow
          : k === 'request' && window < today()
            ? today()
            : window,
      stage: 'Submitted',
      entity: 'GROUP',
      owner: '',
      status: k === 'purchase' ? 'Ordered' : 'Pending',
      priority: 'Normal',
      estimateRate: 0,
      category: 'Material',
      discount: 0,
      freight: 0,
      other: 0,
      nonRecoverableTax: 0,
      recoverableTax: 0,
      ...(isNewPlan
        ? {
            lines: [
              {
                item: '',
                itemChoice: '',
                itemCategory: '',
                unit: '',
                boqQty: '',
                activityBoqQty: '',
              },
            ],
          }
        : {}),
      ...extra,
    });
  };
  const activate = (r: Any) => {
    setSelected(null);
    start(r.kind === 'purchase' ? 'plan' : 'payment', {
      sourceId: r.id,
      source: r,
      demandQty: numeric(r.boqQty),
      project: r.project.replace(/\.0$/, ''),
      item: r.item,
      milestone: r.milestone,
      activity: r.activity,
      boqQty: numeric(r.boqQty),
      boqRate: numeric(r.boqRate),
      amount: numeric(r.amount),
      vendor: r.vendor,
      entity: r.entity || 'GROUP',
      bill: r.bill,
      notes: r.notes,
      due: '',
      unit: '',
    });
  };
  const addPurchase = (p: Any) =>
    start('purchase', {
      parent: p.id,
      project: p.project,
      item: p.item,
      unit: p.unit,
      window: p.window,
      buyerName: p.entity === 'BUILDERS' ? 'Bilara Builders' : 'Bilara Group',
      qty: Math.max(
        0,
        (p.boqQty || p.qty) -
          buys
            .filter((b) => b.parent === p.id && b.status !== 'Cancelled')
            .reduce((n, b) => n + b.qty, 0),
      ),
      rate: p.quoteRate,
      vendor: p.vendor,
      vendorContact: p.vendorPhone,
      creditDays: 7,
      paymentTerms: 'Payment after delivery',
    });
  const addSchedule = (p: Any) =>
    start('payment', {
      window: p.window || window,
      due: p.window || window,
      parent: p.id,
      project: p.project,
      entity: p.entity || 'GROUP',
      item: p.item,
      vendor: p.vendor,
      bill: p.bill,
      amount:
        (p.total -
          payments
            .filter((x) => x.parent === p.id)
            .reduce((a, x) => a + x.total, 0)) /
        100,
    });
  async function save(e: any) {
    e.preventDefault();
    if (!draft) return;
    if (
      ['plan', 'request'].includes(draft.kind) &&
      (!draft.owner ||
        !draft.itemCategory ||
        !draft.milestone ||
        !draft.activity ||
        !draft.activityName ||
        !draft.activityBoqQty)
    ) {
      setFormError(
        'Choose Owner, Item Category and Milestone, then enter the Activity, Activity Name and Activity BOQ Quantity.',
      );
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const r = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDraft(null);
      setSelected(null);
      setNotice(
        draft.kind === 'purchase'
          ? 'Purchase order saved. Open Purchase orders to view or print it.'
          : 'Saved successfully.',
      );
      if (draft.kind === 'purchase') setTab('orders');
      if (['plan', 'request'].includes(draft.kind)) {
        showWeek(draft.window);
        setTab(draft.kind);
      }
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveMulti(e: any) {
    e.preventDefault();
    if (!draft?.lines?.length) return;
    const missing =
      !draft.project ||
      !draft.milestone ||
      !draft.activity ||
      !draft.activityName ||
      !draft.owner ||
      !draft.window ||
      !draft.due ||
      draft.lines.some(
        (l: any) =>
          !l.item ||
          !l.itemCategory ||
          !l.unit ||
          !Number(l.boqQty) ||
          !Number(l.activityBoqQty),
      );
    if (missing) {
      setFormError('Complete the request details and every item line.');
      return;
    }
    setBusy(true);
    setFormError('');
    const requestBatchId = crypto.randomUUID();
    try {
      for (let i = 0; i < draft.lines.length; i++) {
        const { lines, ...header } = draft,
          line = draft.lines[i];
        const r = await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...header,
            ...line,
            demandQty: line.boqQty,
            requestBatchId,
            sourceId: `request:${requestBatchId}:${i + 1}`,
          }),
        });
        const data: any = await r.json();
        if (!r.ok) throw Error(`Item ${i + 1}: ${data.error}`);
      }
      setDraft(null);
      setNotice(`${draft.lines.length} items saved in one purchase request.`);
      showWeek(draft.window);
      setTab('plan');
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const sumSource = source.summary || { purchase: 7067, payment: 5061 };
  const isSource = ['plan', 'payment'].includes(tab) && view === 'source';
  const projectOptions = [
    ['all', 'All projects'],
    ...[
      ...new Set([
        ...projectConfigs.filter((p) => p.active).map((p) => p.project),
        ...records.map((r) => r.project),
      ]),
    ]
      .filter(Boolean)
      .sort()
      .map((p) => [
        p,
        projectConfigs.find((x) => x.project === p)?.name
          ? `${p} · ${projectConfigs.find((x) => x.project === p).name}`
          : p,
      ]),
  ];
  function sourceRows() {
    return (
      <>
        <div className="tablebar">
          <div>
            <h2>
              {kind === 'purchase'
                ? 'Purchase plan workbook'
                : 'Payment forecast workbook'}
            </h2>
            <p>
              {source.count.toLocaleString('en-IN')} item rows in this selection
              · original values preserved
            </p>
          </div>
          <Tag tone="amber">Review before activation</Tag>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'Project / item',
                kind === 'purchase' ? 'BOQ quantity / rate' : 'Payment amount',
                kind === 'purchase'
                  ? 'Purchased / actual rate'
                  : 'Remaining (source)',
                'Vendor / status',
                'Review',
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {source.rows.map((r: Any) => (
              <TableRow key={r.id}>
                <TableCell>
                  <button className="rowlink" onClick={() => setSelected(r)}>
                    <b>{r.item}</b>
                    <span>
                      {r.project || '?'} · {r.sheet.trim()} · row {r.row}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  {kind === 'purchase' ? (
                    <>
                      {display(r.boqQty)}
                      <small>{display(r.boqRate)} / source rate</small>
                    </>
                  ) : (
                    display(r.amount)
                  )}
                </TableCell>
                <TableCell>
                  {kind === 'purchase' ? (
                    <>
                      {display(r.actualQty)}
                      <small>{display(r.actualRate)} / source rate</small>
                    </>
                  ) : (
                    display(r.remaining)
                  )}
                </TableCell>
                <TableCell>
                  {r.vendor || 'Vendor not entered'}
                  <small>{r.status || 'Status not entered'}</small>
                </TableCell>
                <TableCell>
                  <button className="textbutton" onClick={() => setSelected(r)}>
                    {records.some((x) => x.sourceId === r.id)
                      ? 'Activated'
                      : 'Review row'}{' '}
                    <ArrowUpRight size={14} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {sourceLoading && <p className="empty">Loading workbook rows…</p>}
        {!sourceLoading && !source.rows.length && (
          <p className="empty">No source rows match these filters.</p>
        )}
        <div className="pager">
          <span>
            {source.count ? offset + 1 : 0}–
            {Math.min(offset + 50, source.count)} of {source.count}
          </span>
          <button
            aria-label="Previous page"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label="Next page"
            disabled={offset + 50 >= source.count}
            onClick={() => setOffset(offset + 50)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </>
    );
  }
  function liveRows() {
    return (
      <>
        <div className="tablebar">
          <div>
            <h2>
              {tab === 'plan'
                ? 'Active requirements'
                : tab === 'purchase'
                  ? 'Purchase register'
                  : tab === 'payment'
                    ? 'Payment schedule'
                    : 'Ad hoc requests'}
            </h2>
            <p>{active.length} records</p>
          </div>
          <button
            className="secondary"
            onClick={() => exportCSV(active, tab + '-register')}
            disabled={!active.length}
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'Project / item',
                tab === 'payment'
                  ? 'Due / vendor'
                  : tab === 'purchase'
                    ? 'Supplier / PO'
                    : 'Need by / owner',
                tab === 'plan'
                  ? 'Target budget'
                  : tab === 'payment'
                    ? 'Scheduled / paid'
                    : 'Amount',
                tab === 'plan'
                  ? 'Status'
                  : tab === 'payment'
                    ? 'Outstanding'
                    : tab === 'purchase'
                      ? 'Status'
                      : 'Decision',
                'Actions',
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((r) => {
              const m = planMetrics(r, buys);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <button className="rowlink" onClick={() => setSelected(r)}>
                      <b>{r.item}</b>
                      <span>
                        {r.project}
                        {r.activityRequestCode
                          ? ` · M${r.milestone} · A${r.activityRequestCode} ${r.activityName || ''}`
                          : ''}{' '}
                        · {r.unit || r.category}
                        {multiWeek && tab !== 'payment' && recordWindow(r, records)
                          ? ` · Week ${weekLabel(String(recordWindow(r, records)))}`
                          : ''}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {r.due || r.vendor}
                    <small>
                      {tab === 'purchase' ? r.po : r.vendor || r.owner}
                    </small>
                  </TableCell>
                  <TableCell>
                    {tab === 'payment' || tab === 'purchase' || canSeeRates
                      ? money(
                          tab === 'plan'
                            ? r.kind === 'request'
                              ? r.total
                              : m.budget
                            : r.total,
                        )
                      : 'Restricted'}
                    <small>
                      {r.quantityControl
                        ? `${r.quantityControl.cumulative} / ${r.quantityControl.baseline} ${r.unit} cumulative`
                        : tab === 'payment'
                          ? 'Paid ' + money(r.paid)
                          : tab === 'purchase'
                            ? 'Cost ' + money(purchaseCost(r).cost)
                            : tab === 'request' || r.kind === 'request'
                              ? 'Estimated request value'
                              : !canSeeRates
                                ? 'Rate restricted for this role'
                                : r.boqRate === '' || r.boqRate == null
                                ? 'Awaiting BOQ rate'
                                : `${r.boqQty} × ₹${r.boqRate}`}
                    </small>
                  </TableCell>
                  <TableCell>
                    {tab === 'plan' ? (
                      <>
                        {r.closure?.state === 'Closed'
                          ? 'Closed'
                          : r.gmApproval?.state === 'Pending'
                            ? 'Awaiting GM approval'
                            : r.stage === 'Audit approved'
                              ? 'Approved'
                              : r.stage === 'Vendors finalized'
                                ? 'Awaiting approval'
                                : r.stage === 'Rejected'
                                  ? 'Rejected'
                                  : 'Preparing'}
                        <small>
                          {r.quantityControl?.excess
                            ? `Variation +${r.quantityControl.excess} ${r.unit}`
                            : `${r.kind === 'request' ? 'Ad hoc' : 'Planned'} · ${r.unit}`}
                        </small>
                      </>
                    ) : tab === 'payment' ? (
                      <>
                        <b>{money(r.total - r.paid)}</b>
                        <small>
                          {r.status === 'Cancelled'
                            ? 'Cancelled'
                            : r.paid === r.total
                              ? 'Paid'
                              : r.paid
                                ? 'Part paid'
                                : r.due < today()
                                  ? 'Overdue'
                                  : 'Scheduled'}
                        </small>
                      </>
                    ) : (
                      <Tag
                        tone={
                          r.status === 'Approved' || r.status === 'Delivered'
                            ? 'green'
                            : r.status === 'Rejected'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {r.status}
                      </Tag>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="actions">
                      {tab === 'plan' ? (
                        <button
                          className="textbutton"
                          onClick={() =>
                            r.stage === 'Audit approved'
                              ? changeTab('orders')
                              : setSelected(r)
                          }
                        >
                          {r.stage === 'Audit approved'
                            ? 'View vendor orders'
                            : 'Open request'}
                        </button>
                      ) : tab === 'purchase' ? (
                        r.total -
                          payments
                            .filter((x) => x.parent === r.id)
                            .reduce((n, x) => n + x.total, 0) >
                        0 ? (
                          <button
                            className="textbutton"
                            onClick={() => addSchedule(r)}
                          >
                            Schedule balance <Plus size={14} />
                          </button>
                        ) : (
                          <span className="tag green">Forecast created</span>
                        )
                      ) : tab === 'payment' ? (
                        <button
                          className="textbutton"
                          disabled={!canPay || r.paid === r.total}
                          onClick={() =>
                            start('settle', {
                              id: r.id,
                              version: r.version,
                              action: 'settle',
                              amount: (r.total - r.paid) / 100,
                              date: today(),
                              item: r.item,
                              total: r.total,
                              paid: r.paid,
                            })
                          }
                        >
                          Record payment
                        </button>
                      ) : r.status === 'Pending' ? (
                        <button
                          className="textbutton"
                          onClick={() => start('request', r)}
                        >
                          Review
                        </button>
                      ) : r.status === 'Approved' ? (
                        <button
                          className="textbutton"
                          onClick={() => addPurchase(r)}
                        >
                          Record purchase
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!active.length && (
          <div className="empty">
            <ClipboardList size={30} />
            <h3>
              {loading
                ? 'Loading saved records…'
                : 'Start with a confirmed requirement'}
            </h3>
            <p>
              {tab === 'purchase'
                ? 'Open an active requirement or approved ad hoc request to record a purchase.'
                : tab === 'payment'
                  ? 'Create a schedule, or review a workbook row to confirm its amount and due date.'
                  : 'Add or upload a requirement to begin.'}
            </p>
          </div>
        )}
      </>
    );
  }
  return (
    <main className="workspace app-shell">
      <Tabs value={tab} onValueChange={(v) => changeTab(String(v))}>
        <aside className="app-sidebar">
          <div className="brand">
            <img
              className="logo-light"
              src="/bilara-logo-black.png"
              alt="Bilara Group"
            />
            <img
              className="logo-dark"
              src="/bilara-logo-white.png"
              alt="Bilara Group"
            />
          </div>
          <p className="nav-caption">WORKSPACE</p>
          <TabsList className="nav">
            {[
              ['weekly', 'Dashboard', Wallet],
              ['plan', 'Purchase requests', ClipboardList],
              ['request', 'Ad hoc requests', ClipboardList],
              ['purchase-plan', 'Purchase plan', Wallet],
              ['audit', 'Audit review', ShieldCheck],
              ['orders', 'Purchase orders', PackageCheck],
              ['payment', 'Payment forecast', Wallet],
              ['documents', 'Documents', ClipboardList],
              ['backup', 'Backups', Download],
              ['projects', 'Projects', Building2],
              ['users', 'Users & roles', UserCog],
              ['settings', 'Settings', ShieldCheck],
            ]
              .filter(
                ([v]) =>
                  (!['projects', 'users', 'settings'].includes(String(v)) ||
                    has(user)) &&
                  (v !== 'purchase-plan' || canPurchase || canPrivate) &&
                  (v !== 'audit' || has(user, 'Audit', 'GM')),
              )
              .map(([v, label, Icon]: any) => (
                <TabsTrigger key={v} value={v}>
                  <Icon size={16} />
                  {label}
                </TabsTrigger>
              ))}
          </TabsList>
          {testUserSwitch}
          <div className="sidebar-footer">
            <ShieldCheck size={15} /> {user.name} · {user.roles.join(', ')}
            <a href="/signout-with-chatgpt?return_to=%2F">Sign out</a>
          </div>
        </aside>
        <div className="app-main">
          <div className="heading app-header">
            <h1>
              {
                (
                  {
                    weekly: 'Dashboard',
                    plan: 'Purchase requests',
                    orders: 'Purchase orders',
                    payment: 'Payment forecast',
                    backup: 'Backups',
                    documents: 'Documents',
                    purchase: 'Purchase register',
                    request: 'Ad hoc requests',
                    'purchase-plan': 'Purchase plan',
                    audit: 'Audit review',
                    projects: 'Projects',
                    users: 'Users & roles',
                    settings: 'Settings',
                  } as Any
                )[tab]
              }
            </h1>
            <ThemeToggle />
            {['plan', 'request'].includes(tab) && canStart(tab) && (
              <button
                className="primary"
                onClick={() =>
                  start(tab, { project: project === 'all' ? '' : project })
                }
              >
                + {tab === 'plan' ? 'Purchase request' : 'Ad hoc request'}
              </button>
            )}
          </div>
          {error && (
            <div className="alert red" role="alert">
              {error} <button onClick={() => refresh()}>Retry</button>
            </div>
          )}
          {notice && (
            <div className="alert green" role="status">
              {notice}
              <button onClick={() => setNotice('')}>Dismiss</button>
            </div>
          )}
          {!['settings', 'projects', 'users'].includes(tab) && (
            <div className="context-bar">
              <label className="field">
                <span>Project</span>
                <Choice
                  label="Project"
                  value={project}
                  onChange={(v: string) => {
                    setProject(v);
                    setOffset(0);
                  }}
                  options={projectOptions}
                />
              </label>
              {['plan', 'request'].includes(tab) && (
                <>
                  <label className="field">
                    <span>Milestone</span>
                    <Choice
                      label="Milestone"
                      value={milestoneFilter}
                      onChange={setMilestoneFilter}
                      options={[
                        ['all', 'All milestones'],
                        ...settings.values.milestones.map((v) => [
                          v,
                          'Milestone ' + v,
                        ]),
                      ]}
                    />
                  </label>
                  <label className="field">
                    <span>Activity</span>
                    <input
                      inputMode="numeric"
                      placeholder="All"
                      value={activityFilter}
                      onChange={(e) =>
                        setActivityFilter(
                          e.target.value.replace(/\D/g, '').slice(0, 3),
                        )
                      }
                    />
                  </label>
                </>
              )}
              {weekTab ? (
                <>
                  <label className="field">
                    <span>
                      {tab === 'payment' ? 'Payment week' : 'Week'} · any day
                      picks its Thu–Wed week
                    </span>
                    <WeekInput value={window} onChange={setWindow} />
                  </label>
                  <span className="context-end">
                    Thu {window} – Wed {addDays(window, 6)}
                  </span>
                </>
              ) : (
                <PeriodPicker period={period} onChange={setPeriod} />
              )}
            </div>
          )}{' '}
          <TabsContent value="projects">
            <Projects onSaved={setProjectConfigs} />
          </TabsContent>
          <TabsContent value="users">
            <Users />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsPage settings={settings} onSaved={setSettings} />
          </TabsContent>
          <TabsContent value="orders">
            <Orders period={period}
              records={records}
              window={window}
              setWindow={setWindow}
              project={project}
              setProject={setProject}
              addPurchase={addPurchase}
              addSchedule={addSchedule}
              start={start}
              refresh={refresh}
            />
          </TabsContent>
          <TabsContent value="purchase-plan">
            <PurchasePlan period={period}
              records={records}
              project={project}
              window={window}
              refresh={refresh}
              openRecord={setSelected}
            />
          </TabsContent>
          <TabsContent value="audit">
            <AuditReview period={period}
              records={records}
              project={project}
              window={window}
              refresh={refresh}
              openRecord={setSelected}
            />
          </TabsContent>
          <TabsContent value="weekly">
            <Dashboard period={period}
              user={user}
              records={records}
              window={window}
              setWindow={setWindow}
              project={project}
              setProject={setProject}
              navigate={changeTab}
              openRecord={setSelected}
              start={start}
            />
          </TabsContent>
          <TabsContent value="documents">
            <Documents
              user={user}
              records={records}
              documents={documents}
              window={window}
              setWindow={setWindow}
              project={project}
              setProject={setProject}
              refresh={refresh}
            />
          </TabsContent>
          <TabsContent value="backup">
            <Weekly
              mode="backup"
              records={records}
              window={window}
              setWindow={setWindow}
              project={project}
              setProject={setProject}
            />
          </TabsContent>
          {['plan', 'purchase', 'payment', 'request'].map((t) => (
            <TabsContent value={t} key={t}>
              {t === 'plan' && !canPurchase && has(user, 'Project Manager', 'GM') && (
                <CarryForward period={period}
                  records={records}
                  project={project}
                  window={window}
                  refresh={refresh}
                />
              )}
              {t === 'plan' && (canGM || has(user, 'BOQ Team')) && (
                <ApprovalQueue period={period}
                  gm={canGM}
                  records={records}
                  project={project}
                  window={window}
                  refresh={refresh}
                />
              )}
              {tab === 'payment' && (
                <details className="panel finalize-section">
                  <summary>Finalize this week's forecast</summary>
                  <Weekly
                    records={records}
                    window={window}
                    setWindow={setWindow}
                    project={project}
                    setProject={setProject}
                  />
                </details>
              )}
              <div className="filters">
                {['plan', 'request', 'payment'].includes(tab) &&
                  (canStart(tab) ||
                    (tab === 'plan' &&
                      has(
                        user,
                        'BOQ Team',
                        'Purchase Manager',
                        'Purchase Team',
                      )) ||
                    (tab === 'request' && canPurchase)) && (
                    <Bulk
                      user={user}
                      recordType={tab}
                      settings={settings.values}
                      initialKind={
                        tab === 'request'
                          ? 'adhoc'
                          : tab === 'payment'
                            ? 'payment'
                            : 'request'
                      }
                      records={records}
                      project={project}
                      window={window}
                      refresh={refresh}
                    />
                  )}{' '}
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search records"
                    placeholder="Search item, activity or vendor…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
                {tab === 'payment' && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => start('payment')}
                    >
                      + Payment schedule
                    </button>
                    {canPay && (
                      <Accounts
                        records={records}
                        documents={documents}
                        project={project}
                        window={window}
                        refresh={refresh}
                      />
                    )}
                  </>
                )}
              </div>
              {tab === 'payment' && (
                <ForecastRequests
                  records={records}
                  project={project}
                  window={window}
                  query={query}
                  start={start}
                  addSchedule={addSchedule}
                  openOrders={() => changeTab('orders')}
                />
              )}{' '}
              {(tab === 'payment' || (tab === 'plan' && !multiWeek)) && (
                <PlanOverview
                  records={records}
                  documents={documents}
                  project={project}
                  window={tab === 'plan' ? singleWeek(period)! : window}
                  refresh={refresh}
                />
              )}
              <section className="panel tablepanel">{liveRows()}</section>
            </TabsContent>
          ))}
          <TabsContent value="review">
            <section className="panel">
              <p className="eyebrow">YOUR WORKBOOKS / ANALYSIS</p>
              <h2>The foundation is here. The controls need structure.</h2>
              <p className="muted">
                50 worksheets reviewed. Item rows include repeated plans and
                records awaiting clarification; these counts are not unique
                purchases or invoices.
              </p>
              <div className="metrics analysis-metrics">
                <Metric
                  label="Purchase source rows"
                  value="7,067"
                  note="26 sheets · 383 numeric BOQ qty/rate pairs"
                />
                <Metric
                  label="Payment source rows"
                  value="5,061"
                  note="24 sheets · 4,937 numeric payment amounts"
                />
                <Metric
                  label="Numeric actual pairs"
                  value="615"
                  note="Purchased quantity and actual price both numeric"
                />
                <Metric
                  label="Status / balance conflicts"
                  value="240"
                  note="Completed/paid rows with non-zero or text balance"
                />
              </div>
              <div className="findings">
                {[
                  [
                    '01',
                    'BOQ and actual price already exist',
                    'Purchase Plan contains BOQ Quantity, BOQ Price, Purchased Quantity, Actual Price and Overflow. Many values mix units or notes. Only 383 rows have purely numeric BOQ quantity and price; only 615 have both actual fields numeric.',
                    'Capture an explicit unit and numeric rate. Keep the BOQ baseline fixed and add purchase transactions.',
                  ],
                  [
                    '02',
                    'Weekly rows can repeat the same requirement',
                    '3,980 purchase rows share project, milestone, activity and item with another row. This is a duplicate warning, not proof of duplicate purchasing. Two extra April 19–25 tabs differ only by leading spaces.',
                    'Review carry-forwards against active requirements before activating. Keep source tab and row for traceability.',
                  ],
                  [
                    '03',
                    'Dates and price bases need confirmation',
                    'Mixed Excel dates and date text occur. September 7 plan rows contain stored July 9 dates. SEPT 07 - SEPT 14!G2 contains 1,850,022,500 for a combined doors item with quantity “8,1”.',
                    'Confirm dates against the intended week; split combined items and pack prices into a consistent unit. The app leaves imported due dates blank.',
                  ],
                  [
                    '04',
                    'Payment status does not prove settlement',
                    '240 completed/paid rows have a non-zero or text remaining value. Payment amounts can contain narratives, and one receipt can cover several rows. 320 payment rows share project, vendor, item, amount and bill with another row.',
                    'Confirm the schedule amount, then record dated payments with a reference. Historical Completed labels are preserved as source evidence.',
                  ],
                  [
                    '05',
                    'Purchasing cost is different from money paid',
                    'The source includes tax/transport remarks, labour, rentals and subcontract advances. Purchase and payment sheets have no reliable shared transaction key.',
                    'Use explicit purchase links where known. Keep standalone expenses supported. Record freight and recoverable/non-recoverable tax separately.',
                  ],
                  [
                    '06',
                    'Ad hoc work needs a visible decision',
                    'Mail-based and unplanned entries appear among the weekly rows without a separate request identity.',
                    'Raise a request with reason, owner, quantity, rate, priority and need-by date. Review it before a purchase can be entered.',
                  ],
                ].map(([n, h, e, a]) => (
                  <article key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{h}</h3>
                      <p>{e}</p>
                      <p className="resolution">{a}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2>How the calculations work</h2>
              <div className="definitions">
                <p>
                  <b>Target budget</b> = requested quantity × purchasing target
                  rate.
                </p>
                <p>
                  <b>Net purchase value</b> = purchased quantity × actual unit
                  rate − line discount.
                </p>
                <p>
                  <b>Landed cost</b> = net purchase value + freight + other
                  costs + non-recoverable tax.
                </p>
                <p>
                  <b>Cash commitment</b> = landed cost + recoverable tax.
                </p>
                <p>
                  <b>Rate variance</b> = net purchase value − purchased quantity
                  × target rate. Positive means higher cost.
                </p>
                <p>
                  <b>Quantity variance value</b> = (purchased quantity − BOQ
                  quantity) × target rate. This is quantity deviation, not
                  consumption wastage.
                </p>
                <p>
                  <b>Outstanding cash</b> = scheduled payments − actual
                  payments. Forecast buckets use confirmed due dates.
                </p>
                <p>
                  <b>Ad hoc estimate</b> stays separate from the original BOQ
                  budget. It becomes a purchase commitment only when a purchase
                  is recorded.
                </p>
              </div>
            </section>
            <section className="panel">
              <h2>Operating sequence</h2>
              <p className="muted">
                BOQ team prepares requirements → purchase team records supplier
                costs and delivery → owner reviews ad hoc requests → accounts
                schedules and records payments.
              </p>
              <p className="muted">
                This private workspace records review decisions and before/after
                history. Department-level sign-ins and independent maker/checker
                permissions are a rollout step; the current owner can perform
                each action. Source files and linked documents remain unchanged.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="history">
            <section className="panel">
              <div className="tablebar">
                <div>
                  <h2>Audit history</h2>
                  <p>
                    Latest 150 saved changes and payment events · owner
                    workspace
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => exportCSV(history, 'audit-history')}
                >
                  Export CSV
                </button>
              </div>
              {history.length ? (
                history.map((h) => (
                  <details className="history" key={h.id}>
                    <summary>
                      <b>{h.action}</b>
                      <span>
                        {new Date(h.at).toLocaleString('en-IN')} ·{' '}
                        {h.record_id.slice(0, 8)}
                      </span>
                    </summary>
                    <pre>{JSON.stringify(JSON.parse(h.data), null, 2)}</pre>
                  </details>
                ))
              ) : (
                <p className="empty">
                  History appears when you create or change a record.
                </p>
              )}
            </section>
          </TabsContent>
        </div>
      </Tabs>
      <Dialog
        open={!!selected && !draft}
        onOpenChange={(o) => !o && setSelected(null)}
      >
        <DialogContent className="wide-dialog">
          <DialogTitle>{selected?.item || 'Record details'}</DialogTitle>
          <DialogDescription>
            {selected?.project} ·{' '}
            {selected?.sheet
              ? `${selected.sheet} · row ${selected.row}`
              : titles[selected?.kind]}
          </DialogDescription>
          {selected?.raw ? (
            <>
              <div className="alert amber">
                <TriangleAlert size={18} />
                Source values are unverified. Check units, date, duplicates and
                rate basis before activation.
              </div>
              <div className="issues">
                {selected.issues.map((s: string) => (
                  <Tag key={s} tone="amber">
                    {s}
                  </Tag>
                ))}
              </div>
              <div className="source-grid">
                {Object.entries(selected.raw).map(([k, v]) => (
                  <div key={k}>
                    <small>
                      {source.sheets.find(
                        (s: Any) =>
                          s.kind === selected.kind && s.name === selected.sheet,
                      )?.headers[columnIndex(k)] || 'Unlabelled'}{' '}
                      · {k}
                      {selected.row}
                    </small>
                    <p>{display(v)}</p>
                  </div>
                ))}
              </div>
              {Object.keys(selected.links || {}).length > 0 && (
                <div className="source-grid">
                  {Object.entries(selected.links).map(([k, v]) => (
                    <div key={k}>
                      <small>
                        Original hyperlink {k}
                        {selected.row}
                      </small>
                      {/^https?:\/\//i.test(String(v)) ? (
                        <a target="_blank" rel="noreferrer" href={String(v)}>
                          Open linked document ↗
                        </a>
                      ) : (
                        display(v)
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="footnote">
                Source: {selected.file}. Hyperlinks are preserved; linked files
                have not been inspected.
              </p>
              <button
                className="primary"
                disabled={records.some((r) => r.sourceId === selected.id)}
                onClick={() => activate(selected)}
              >
                Review and activate{' '}
                {selected.kind === 'purchase'
                  ? 'requirement'
                  : 'payment schedule'}
              </button>
            </>
          ) : (
            selected && (
              <>
                <RecordSummary record={selected} canSeeRates={canSeeRates} />
                {selected.kind === 'plan' &&
                  buys.some((b) => b.parent === selected.id) && (
                    <div className="alert">
                      {(() => {
                        const m = planMetrics(selected, buys);
                        return `Purchased ${m.qty} ${selected.unit}. Landed cost ${money(m.cost)}. Quantity variance ${money(m.quantityVariance)}. Landed cost variance at purchased quantity ${money(m.landedVariance)}.`;
                      })()}
                    </div>
                  )}
                <div className="actions">
                  {canStart(selected.kind, selected) &&
                  (selected.kind !== 'request' ||
                    selected.status === 'Pending') ? (
                    <button
                      className="secondary"
                      onClick={() => start(selected.kind, selected)}
                    >
                      Edit record
                    </button>
                  ) : null}
                  {canPurchase &&
                    selected.kind === 'plan' &&
                    selected.stage === 'Audit approved' &&
                    selected.closure?.state !== 'Closed' && (
                      <button
                        className="primary"
                        onClick={() => addPurchase(selected)}
                      >
                        Record purchase
                      </button>
                    )}
                {canPurchase &&
                    selected.kind === 'purchase' &&
                    selected.status !== 'Cancelled' && (
                      <button
                        className="primary"
                        onClick={() => addSchedule(selected)}
                      >
                        Schedule payment
                      </button>
                    )}
                </div>
                {canPurchase &&
                  ['plan', 'request'].includes(selected.kind) &&
                  ['BOQ priced', 'Vendors finalized', 'Audit approved'].includes(selected.stage) &&
                  selected.closure?.state !== 'Closed' && (
                    <RescheduleRequest request={selected} refresh={refresh} />
                  )}
                {canPay &&
                  selected.kind === 'payment' &&
                  selected.total > selected.paid &&
                  selected.status !== 'Cancelled' && (
                    <button
                      className="primary"
                      onClick={() =>
                        start('settle', {
                          id: selected.id,
                          version: selected.version,
                          action: 'settle',
                          amount: (selected.total - selected.paid) / 100,
                          date: today(),
                          item: selected.item,
                          total: selected.total,
                          paid: selected.paid,
                        })
                      }
                    >
                      Record payment
                    </button>
                  )}
                {canGM && (selected.gmApproval || (selected.stage === 'Submitted' && Number(selected.kind === 'plan' ? selected.boqRate : selected.estimateRate) > 0 && !!selected.boqOwner)) && <GMApproval request={selected} refresh={refresh} user={user} />}{' '}
                {['plan', 'request'].includes(selected.kind) && (
                  <RequestAccess
                    user={user}
                    request={selected}
                    reference={referenceRates.find(
                      (r) => r.record_id === selected.id,
                    )}
                    refresh={refresh}
                  />
                )}
                {(canPurchase || canPay || canGM) &&
                  ['plan', 'request'].includes(selected.kind) && (
                    <details className="completion-details">
                      <summary>Completion & settlement</summary>
                      <Closure
                        request={selected}
                        records={records}
                        documents={documents}
                        refresh={refresh}
                      />
                    </details>
                  )}
                <Documents
                  focus={selected}
                  records={records}
                  documents={documents}
                />
                {records.some((r) => r.parent === selected.id) && (
                  <h3>Linked orders & payments</h3>
                )}
                {records
                  .filter((r) => r.parent === selected.id)
                  .map((r) => (
                    <button
                      className="related"
                      key={r.id}
                      onClick={() => setSelected(r)}
                    >
                      {r.kind} · {r.item} · {money(r.total)}{' '}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!draft}
        onOpenChange={(o) => {
          if (!o && !busy) setDraft(null);
        }}
      >
        <DialogContent className="wide-dialog">
          <DialogTitle>
            {draft?.id ? 'Update / review ' : 'New '}
            {titles[draft?.kind || 'plan']}
          </DialogTitle>
          <DialogDescription>
            {draft?.lines
              ? 'Add all items required for this project activity.'
              : draft?.source
                ? 'Confirm the source information before it enters live totals.'
                : 'Enter request details.'}
          </DialogDescription>
          {draft?.kind === 'plan' && (
            <p className="footnote">
              Normal execution: {requestPolicy().normal} onwards
              {requestPolicy().late < requestPolicy().normal
                ? ' · ' + requestPolicy().late + ' needs GM approval'
                : ''}
            </p>
          )}
          {draft?.lines ? (
            <MultiItemRequest
              draft={draft}
              setDraft={setDraft}
              settings={settings.values}
              projects={projectConfigs}
              busy={busy}
              error={formError}
              submit={saveMulti}
              cancel={() => setDraft(null)}
            />
          ) : (
            draft && (
              <form onSubmit={save}>
                <div className="formgrid">
                  {draft.source && (
                    <div className="full alert amber">
                      Original: {draft.source.sheet} · row {draft.source.row}.
                      Source date {display(draft.source.date)}.{' '}
                      {draft.source.status
                        ? `Source status: ${draft.source.status}.`
                        : ''}{' '}
                      Confirm dates, duplicates and unit rates.{' '}
                      {draft.kind === 'payment'
                        ? 'Activation creates an unpaid schedule; record verified historical payments separately.'
                        : ''}
                    </div>
                  )}
                  {['plan', 'request', 'payment'].includes(draft.kind) && (
                    <>
                      <ProjectField
                        projects={projectConfigs}
                        readOnly={
                          draft.kind === 'plan' && !!baselineLocked(draft)
                        }
                        draft={draft}
                        set={setDraft}
                      />
                      {draft.kind === 'payment' ? (
                        <Field
                          name="item"
                          label="Item / description"
                          required
                          draft={draft}
                          set={setDraft}
                        />
                      ) : (
                        <ItemPicker
                          item={draft.item}
                          itemChoice={draft.itemChoice}
                          readOnly={
                            draft.kind === 'plan' && !!baselineLocked(draft)
                          }
                          onChange={(values: any) =>
                            setDraft({ ...draft, ...values })
                          }
                        />
                      )}
                    </>
                  )}
                  {['plan', 'request'].includes(draft.kind) && (
                    <>
                      <Field
                        name="unit"
                        label="Unit (BAG, CFT, KG, NOS…)"
                        required
                        readOnly={!!baselineLocked(draft)}
                        draft={draft}
                        set={setDraft}
                      />
                      <label className="field">
                        <span>Owner *</span>
                        <Choice
                          label="Owner"
                          value={draft.owner || ''}
                          onChange={(v: string) =>
                            setDraft({ ...draft, owner: v })
                          }
                          options={[
                            ...new Set([
                              ...settings.values.owners,
                              ...(draft.id && draft.owner ? [draft.owner] : []),
                            ]),
                          ].map((v) => [v, v])}
                        />
                      </label>
                      <label className="field">
                        <span>Item Category *</span>
                        <Choice
                          label="Item Category"
                          value={draft.itemCategory || ''}
                          onChange={(v: string) =>
                            setDraft({ ...draft, itemCategory: v })
                          }
                          options={[
                            ...new Set([
                              ...settings.values.itemCategories,
                              ...(draft.id && draft.itemCategory
                                ? [draft.itemCategory]
                                : []),
                            ]),
                          ].map((v) => [v, v])}
                        />
                      </label>
                      <label className="field">
                        <span>Milestone *</span>
                        <Choice
                          label="Milestone"
                          value={String(draft.milestone || '')}
                          onChange={(v: string) =>
                            setDraft({ ...draft, milestone: v })
                          }
                          options={[
                            ...new Set([
                              ...settings.values.milestones,
                              ...(draft.id && draft.milestone
                                ? [String(draft.milestone)]
                                : []),
                            ]),
                          ].map((v) => [v, 'Milestone ' + v])}
                        />
                      </label>
                      <Field
                        name="activity"
                        label="Activity number"
                        required
                        readOnly={!!baselineLocked(draft)}
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="activityName"
                        label="Activity name"
                        required
                        readOnly={!!baselineLocked(draft)}
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="activityBoqQty"
                        label="BOQ quantity for this item"
                        type="number"
                        required
                        readOnly={!!baselineLocked(draft)}
                        draft={draft}
                        set={setDraft}
                      />
                      {draft.activityRequestCode && (
                        <div className="full alert">
                          Request sequence <b>{draft.activityRequestCode}</b>
                          {draft.quantityControl
                            ? ` · Cumulative ${draft.quantityControl.cumulative} / ${draft.quantityControl.baseline} ${draft.unit}`
                            : ''}
                        </div>
                      )}
                      {draft.kind === 'request' && (
                        <Field
                          name="qty"
                          label="Requested quantity"
                          type="number"
                          readOnly={!!baselineLocked(draft)}
                          required
                          draft={draft}
                          set={setDraft}
                        />
                      )}
                      <details
                        className="full form-section"
                        open={draft.stage !== 'Submitted' || undefined}
                      >
                        <summary>Rates & vendor</summary>
                        <div className="formgrid">
                          {canPrivate && (
                            <>
                              <Field
                                name="boqOriginalRate"
                                label="Original BOQ rate · BOQ Team entry"
                                type="number"
                                readOnly={!!baselineLocked(draft)}
                                draft={draft}
                                set={setDraft}
                              />
                              <Field
                                name="targetDiscountPercent"
                                label="Target reduction %"
                                type="number"
                                readOnly={!!baselineLocked(draft)}
                                draft={draft}
                                set={setDraft}
                              />
                            </>
                          )}
                          <Field
                            name={
                              draft.kind === 'plan' ? 'boqRate' : 'estimateRate'
                            }
                            label="Purchase target rate · calculated"
                            type="number"
                            readOnly
                            valueOverride={calculatedTargetRate(draft)}
                            draft={draft}
                            set={setDraft}
                          />
                          <label className="field">
                            <span>BOQ Preparer</span>
                            <Choice
                              label="BOQ Preparer"
                              value={draft.boqOwner || ''}
                              onChange={(v: string) =>
                                setDraft({ ...draft, boqOwner: v })
                              }
                              options={[
                                ...new Set([
                                  ...settings.values.boqPreparers,
                                  ...(draft.id && draft.boqOwner
                                    ? [draft.boqOwner]
                                    : []),
                                ]),
                              ].map((v) => [v, v])}
                            />
                          </label>
                          <Field
                            name="vendor"
                            label="Selected vendor"
                            draft={draft}
                            set={setDraft}
                          />
                          <Field
                            name="vendorPhone"
                            label="Vendor phone number"
                            draft={draft}
                            set={setDraft}
                          />
                          <Field
                            name="quoteRate"
                            label="Vendor unit rate"
                            type="number"
                            draft={draft}
                            set={setDraft}
                          />
                          <Field
                            name="quoteReference"
                            label="Quotation reference"
                            draft={draft}
                            set={setDraft}
                          />
                        </div>
                      </details>
                    </>
                  )}
                  {['plan', 'request', 'payment'].includes(draft.kind) && (
                    <label className="field">
                      <span>Execution / payment window starts Thursday *</span>
                      <WeekInput
                        name="window"
                        value={draft.window}
                        min={
                          !draft.id && draft.kind === 'plan'
                            ? requestPolicy().late
                            : undefined
                        }
                        required
                        readOnly={
                          ['plan', 'request'].includes(draft.kind) &&
                          !!baselineLocked(draft)
                        }
                        onChange={(next) =>
                          setDraft({
                            ...draft,
                            window: next,
                            due:
                              draft.due >= next && draft.due <= addDays(next, 6)
                                ? draft.due
                                : next,
                          })
                        }
                      />
                    </label>
                  )}
                  {['plan', 'request'].includes(draft.kind) && (
                    <>
                      {draft.kind === 'plan' && (
                        <Field
                          name="boqQty"
                          label="BOQ Quantity"
                          type="number"
                          required
                          readOnly={!!baselineLocked(draft)}
                          draft={draft}
                          set={setDraft}
                        />
                      )}
                      {draft.id && (
                        <label className="field">
                          <span>Next step</span>
                          <Choice
                            label="Next action"
                            value={draft.stage || 'Submitted'}
                            onChange={(v: string) =>
                              setDraft({ ...draft, stage: v })
                            }
                            options={(draft.id
                              ? [
                                  records.find((r) => r.id === draft.id)
                                    ?.stage || 'Submitted',
                                  records.find((r) => r.id === draft.id)
                                    ?.stage === 'Submitted'
                                    ? 'BOQ priced'
                                    : stageNames[
                                        stageNames.indexOf(
                                          records.find((r) => r.id === draft.id)
                                            ?.stage || 'Submitted',
                                        ) + 1
                                      ],
                                  'Rejected',
                                ].filter(
                                  (v, i, a) =>
                                    v &&
                                    a.indexOf(v) === i &&
                                    (user.roles.includes('Super Admin') ||
                                      v === draft.stage ||
                                      (canGM &&
                                        ['Submitted', 'BOQ priced'].includes(
                                          v,
                                        )) ||
                                      (canPurchase &&
                                        v === 'Vendors finalized') ||
                                      (has(user, 'Audit') &&
                                        ['Audit approved', 'Rejected'].includes(
                                          v,
                                        ))),
                                )
                              : ['Submitted']
                            ).map((v) => [
                              v,
                              v === 'Submitted'
                                ? 'Prepare'
                                : v === 'BOQ priced'
                                  ? 'Issue BOQ baseline'
                                  : v === 'Vendors finalized'
                                    ? 'Send for approval'
                                    : v === 'Audit approved'
                                      ? 'Approve'
                                      : v,
                            ])}
                          />
                        </label>
                      )}
                      {['Audit approved', 'Rejected'].includes(draft.stage) && (
                        <>
                          <Field
                            name="auditOwner"
                            label="Auditor name"
                            draft={draft}
                            set={setDraft}
                          />
                          <Field
                            name="reviewNote"
                            label="Audit decision note"
                            draft={draft}
                            set={setDraft}
                          />
                        </>
                      )}
                    </>
                  )}
                  {['plan', 'request', 'payment'].includes(draft.kind) && (
                    <Field
                      name="due"
                      label={
                        draft.kind === 'payment'
                          ? 'Payment due date'
                          : 'Required delivery date'
                      }
                      type="date"
                      required
                      draft={draft}
                      set={setDraft}
                    />
                  )}
                  {(draft.kind === 'payment' ||
                    (['plan', 'request'].includes(draft.kind) &&
                      draft.id &&
                      canPurchase)) && (
                    <label className="field">
                      <span>Purchasing entity</span>
                      <Choice
                        label="Entity"
                        value={draft.entity}
                        onChange={(v: string) =>
                          setDraft({
                            ...draft,
                            entity: v,
                            entityConfirmed: true,
                          })
                        }
                        options={['GROUP', 'BUILDERS'].map((v) => [
                          v,
                          v === 'GROUP' ? 'Group' : 'Builders',
                        ])}
                      />
                    </label>
                  )}
                  {draft.kind === 'request' && (
                    <>
                      <label className="field full">
                        <span>Reason for unplanned request (optional)</span>
                        <textarea
                          value={draft.reason || ''}
                          onChange={(e) =>
                            setDraft({ ...draft, reason: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Priority</span>
                        <Choice
                          label="Priority"
                          value={draft.priority}
                          onChange={(v: string) =>
                            setDraft({ ...draft, priority: v })
                          }
                          options={['Normal', 'Urgent', 'Critical'].map((v) => [
                            v,
                            v,
                          ])}
                        />
                      </label>
                    </>
                  )}
                  {draft.kind === 'purchase' && (
                    <>
                      <div className="full alert">
                        {draft.item} · Project {draft.project} · {draft.unit}.
                        Vendor and rate are filled from the approved request.
                      </div>
                      {[
                        ['vendor', 'Vendor'],
                        ['qty', 'Order quantity'],
                        ['rate', 'Unit rate'],
                      ].map(([k, l]) => (
                        <Field
                          key={k}
                          name={k}
                          label={l}
                          type={k === 'vendor' ? 'text' : 'number'}
                          required
                          draft={draft}
                          set={setDraft}
                        />
                      ))}
                      <Field
                        name="creditDays"
                        label="Credit days from delivery"
                        type="number"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="paymentTerms"
                        label="Payment terms"
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="shipTo"
                        label="Delivery address"
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="exceptionReason"
                        label="Reason if outside Wednesday or rate has changed"
                        draft={draft}
                        set={setDraft}
                      />
                      <details className="full form-section">
                        <summary>Taxes & additional charges</summary>
                        <div className="formgrid">
                          {[
                            ['discount', 'Discount amount'],
                            ['freight', 'Freight amount'],
                            ['other', 'Other charges'],
                            ['nonRecoverableTax', 'Non-recoverable tax amount'],
                            ['recoverableTax', 'Recoverable tax amount'],
                          ].map(([k, l]) => (
                            <Field
                              key={k}
                              name={k}
                              label={l}
                              type="number"
                              draft={draft}
                              set={setDraft}
                            />
                          ))}
                        </div>
                      </details>
                      <details className="full form-section">
                        <summary>PO details & company information</summary>
                        <div className="formgrid">
                          {[
                            ['po', 'PO number · leave blank to generate'],
                            ['buyerName', 'Buyer name'],
                            ['buyerAddress', 'Buyer address'],
                            ['buyerGstin', 'Buyer GSTIN'],
                            ['vendorAddress', 'Supplier address'],
                            ['vendorGstin', 'Supplier GSTIN'],
                            ['vendorContact', 'Supplier contact'],
                            ['orderTerms', 'Additional PO terms'],
                          ].map(([k, l]) => (
                            <Field
                              key={k}
                              name={k}
                              label={l}
                              draft={draft}
                              set={setDraft}
                            />
                          ))}
                        </div>
                      </details>
                      {draft.id && (
                        <details className="full form-section">
                          <summary>Record purchase & delivery</summary>
                          <div className="formgrid">
                            <label className="field">
                              <span>Delivery status</span>
                              <Choice
                                label="Status"
                                value={draft.status}
                                onChange={(v: string) =>
                                  setDraft({ ...draft, status: v })
                                }
                                options={[
                                  'Ordered',
                                  'In transit',
                                  'Part delivered',
                                  'Delivered',
                                  'Delayed',
                                  'Not delivered',
                                ].map((v) => [v, v])}
                              />
                            </label>
                            <Field
                              name="actualPurchaseDate"
                              label="Actual purchase date"
                              type="date"
                              draft={draft}
                              set={setDraft}
                            />
                            <Field
                              name="delivery"
                              label="Actual delivery date"
                              type="date"
                              draft={draft}
                              set={setDraft}
                            />
                            <Field
                              name="grn"
                              label="GRN reference"
                              draft={draft}
                              set={setDraft}
                            />
                          </div>
                        </details>
                      )}
                      <div className="full cost-preview">
                        Order total{' '}
                        <b>
                          {money(
                            purchaseCost({
                              ...draft,
                              qty: Number(draft.qty || 0),
                              rate: Number(draft.rate || 0),
                            }).cash,
                          )}
                        </b>
                      </div>
                    </>
                  )}
                  {draft.kind === 'payment' && (
                    <>
                      <Field
                        name="vendor"
                        label="Payee / vendor"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="amount"
                        label="Scheduled amount"
                        type="number"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <label className="field">
                        <span>Expense type</span>
                        <Choice
                          label="Category"
                          value={draft.category}
                          onChange={(v: string) =>
                            setDraft({ ...draft, category: v })
                          }
                          options={[
                            'Material',
                            'Labour',
                            'Subcontract',
                            'Rental',
                            'Advance',
                            'Other',
                          ].map((v) => [v, v])}
                        />
                      </label>
                      <label className="field full">
                        <span>
                          Linked purchase (optional for standalone expenses)
                        </span>
                        <Choice
                          label="Purchase"
                          value={draft.parent || 'none'}
                          onChange={(v: string) => {
                            const p = buys.find((p) => p.id === v);
                            setDraft({
                              ...draft,
                              parent: v === 'none' ? null : v,
                              ...(p
                                ? {
                                    project: p.project,
                                    item: p.item,
                                    vendor: p.vendor,
                                  }
                                : {}),
                            });
                          }}
                          options={[
                            ['none', 'Standalone expense'],
                            ...buys.map((p) => [
                              p.id,
                              `${p.po} · ${p.item} · ${p.vendor}`,
                            ]),
                          ]}
                        />
                      </label>
                    </>
                  )}
                  {['purchase', 'payment'].includes(draft.kind) && (
                    <Field
                      name="bill"
                      label="Invoice number / evidence link"
                      draft={draft}
                      set={setDraft}
                    />
                  )}
                  {['payment', 'settle'].includes(draft.kind) && (
                    <label className="field">
                      <span>
                        Payment mode{draft.kind === 'settle' ? ' *' : ''}
                      </span>
                      <Choice
                        label="Payment mode"
                        value={draft.paymentMode || ''}
                        onChange={(v: string) =>
                          setDraft({ ...draft, paymentMode: v })
                        }
                        options={['Cash', 'UPI', 'Account Transfer'].map(
                          (v) => [v, v],
                        )}
                      />
                    </label>
                  )}
                  {draft.kind === 'settle' && (
                    <>
                      <div className="full alert">
                        {draft.item} · Outstanding{' '}
                        {money(draft.total - draft.paid)}
                      </div>
                      <Field
                        name="accountsBy"
                        label="Accounts team member"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="amount"
                        label="Amount paid"
                        type="number"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="date"
                        label="Actual payment date"
                        type="date"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                      <Field
                        name="reference"
                        label="Receipt / bank transaction reference"
                        required
                        draft={draft}
                        set={setDraft}
                      />
                    </>
                  )}
                  {draft.kind !== 'settle' && draft.kind !== 'request' && (
                    <label className="field full">
                      <span>Notes / clarification</span>
                      <textarea
                        value={draft.notes || ''}
                        onChange={(e) =>
                          setDraft({ ...draft, notes: e.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
                {formError && (
                  <p className="alert red" role="alert">
                    {formError}
                  </p>
                )}
                <div className="formfooter">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                  <button className="primary" type="submit" disabled={busy}>
                    {busy
                      ? 'Saving…'
                      : draft.kind === 'settle'
                        ? 'Save payment'
                        : draft.kind === 'purchase'
                          ? draft.id
                            ? 'Save purchase order'
                            : 'Create purchase order'
                          : draft.kind === 'payment'
                            ? 'Save forecast'
                            : 'Save request'}
                  </button>
                </div>
              </form>
            )
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
function MultiItemRequest({
  draft,
  setDraft,
  settings,
  projects = [],
  busy,
  error,
  submit,
  cancel,
}: any) {
  const change = (key: string, value: any) =>
    setDraft({ ...draft, [key]: value });
  const setLine = (i: number, key: string, value: any) => {
    const lines = draft.lines.map((l: any, n: number) =>
      n === i ? { ...l, [key]: value } : l,
    );
    setDraft({ ...draft, lines });
  };
  const hasRate = (item: string) =>
    (settings.catalogItems || settings.projectRates || []).some(
      (r: any) =>
        String(r.project) === String(draft.project) &&
        String(r.item).trim().toLowerCase() ===
          String(item).trim().toLowerCase(),
    );
  const route = plannedWindowRoute(draft.window);
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <div className="formgrid">
          <ProjectField projects={projects} draft={draft} set={setDraft} />
          <label className="field">
            <span>Milestone *</span>
            <Choice
              label="Milestone"
              value={String(draft.milestone || '')}
              onChange={(v: string) => change('milestone', v)}
              options={settings.milestones.map((v: string) => [
                v,
                'Milestone ' + v,
              ])}
            />
          </label>
          <Field
            name="activity"
            label="Activity number"
            required
            draft={draft}
            set={setDraft}
          />
          <Field
            name="activityName"
            label="Activity name"
            required
            draft={draft}
            set={setDraft}
          />
          <label className="field">
            <span>Owner *</span>
            <Choice
              label="Owner"
              value={draft.owner || ''}
              onChange={(v: string) => change('owner', v)}
              options={settings.owners.map((v: string) => [v, v])}
            />
          </label>
          <label className="field">
            <span>Execution week starts Thursday *</span>
            <WeekInput
              name="window"
              value={draft.window}
              min={requestPolicy().late}
              required
              onChange={(next: string) =>
                setDraft({
                  ...draft,
                  window: next,
                  due:
                    draft.due >= next && draft.due <= addDays(next, 6)
                      ? draft.due
                      : next,
                })
              }
            />
          </label>
          <output
            className={'full alert ' + (route === 'gm' ? 'amber' : 'green')}
          >
            {route === 'gm'
              ? 'This is a late planned week. Submission will be marked Awaiting GM approval.'
              : 'Standard planned week. GM approval is not required.'}
          </output>
          <Field
            name="due"
            label="Required delivery date"
            type="date"
            required
            draft={draft}
            set={setDraft}
          />
        </div>
        <div className="request-lines">
          <div className="tablebar">
            <div>
              <h2>Items</h2>
              <p>
                One request · {draft.lines.length} item
                {draft.lines.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  lines: [
                    ...draft.lines,
                    {
                      item: '',
                      itemChoice: '',
                      itemCategory: '',
                      unit: '',
                      boqQty: '',
                      activityBoqQty: '',
                    },
                  ],
                })
              }
            >
              <Plus size={16} /> Add item
            </button>
          </div>
          {draft.lines.map((line: any, i: number) => (
            <section className="request-line" key={i}>
              <div className="request-line-title">
                <b>Item {i + 1}</b>
                {draft.lines.length > 1 && (
                  <button
                    type="button"
                    className="remove-entry"
                    aria-label={'Remove item ' + (i + 1)}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.filter(
                          (_: any, n: number) => n !== i,
                        ),
                      })
                    }
                  >
                    <XIcon />
                  </button>
                )}
              </div>
              <div className="formgrid">
                <ItemPicker
                  item={line.item}
                  itemChoice={line.itemChoice}
                  onChange={(values: any) => {
                    const defaults = RATE_CARD_ITEM_DEFAULTS[values.item] || {};
                    const lines = draft.lines.map((l: any, n: number) =>
                      n === i ? { ...l, ...values, ...defaults } : l,
                    );
                    setDraft({ ...draft, lines });
                  }}
                />
                <label className="field">
                  <span>Category *</span>
                  <select
                    required
                    value={line.itemCategory}
                    onChange={(e) => setLine(i, 'itemCategory', e.target.value)}
                  >
                    <option value="">Choose category</option>
                    {settings.itemCategories.map((v: string) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Unit *</span>
                  <input
                    required
                    placeholder="BAG, KG, NOS…"
                    value={line.unit}
                    onChange={(e) => setLine(i, 'unit', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Requested quantity *</span>
                  <input
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    value={line.boqQty}
                    onChange={(e) => setLine(i, 'boqQty', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Approved activity BOQ quantity *</span>
                  <input
                    required
                    type="number"
                    min="0.000001"
                    step="any"
                    value={line.activityBoqQty}
                    onChange={(e) =>
                      setLine(i, 'activityBoqQty', e.target.value)
                    }
                  />
                </label>
                {line.item && draft.project && (
                  <div
                    className={
                      'full alert ' + (hasRate(line.item) ? 'green' : 'amber')
                    }
                  >
                    {hasRate(line.item)
                      ? 'Project rate matched. BOQ and purchasing target rates will be applied automatically.'
                      : 'No project rate is saved for this item. It will go to BOQ review.'}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="alert red" role="alert">
          {error}
        </p>
      )}
      <div className="formfooter">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy
            ? 'Saving…'
            : `Submit ${draft.lines.length} item${draft.lines.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
function XIcon() {
  return <span aria-hidden="true">×</span>;
}
function columnIndex(s: string) {
  return [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
