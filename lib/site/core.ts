// Site operations runtime: the database layer, signed-in user, configuration, audit and
// numbering that the QC app took from Google Sheets, Script Properties and LockService.
//
// How it maps:
//  - Each former Sheets tab is a D1 table `site_<tab>` with the same column names, so
//    records keep the exact field names the QC app used (Project_ID, Work_Date, ...).
//  - Reads load a table once per request; writes are queued and applied together at the
//    end of the action in one D1 batch. The batch only applies if no other site action
//    committed in between (a version on site_lock), which replaces LockService. On a clash
//    the whole action is re-run from fresh data.
//  - Projects and Users_Roles are not tables here: they are built from bilara-ops'
//    project_configs and app_users, so there is one project list and one user list.
import {database} from '@/lib/database';
import {SITE_TABLES} from './schema';

export type Row = Record<string, any>;
export type SiteUser = {email: string; name: string; role: string; allowedProjects: string};

export const TIMEZONE = 'Asia/Kolkata';
const IST_MINUTES = 330;

/** An error whose message is meant for the person using the page. */
export class SiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BilaraUserError';
  }
}
export class SiteConflict extends Error {}

// ---------- dates (the QC app ran in Asia/Kolkata; Workers run in UTC) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Fields of a moment as seen on a clock in India. */
export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_MINUTES * 60000);
  return {y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(), H: t.getUTCHours(), m: t.getUTCMinutes(), s: t.getUTCSeconds(), ms: t.getUTCMilliseconds(), day: t.getUTCDay()};
}

/** Utilities.formatDate(date, 'Asia/Kolkata', pattern) for the patterns the QC app uses. */
export function formatDate(value: Date | string | number, pattern: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = istParts(d);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|EEEE|EEE|HH|hh|mm|ss|a|d|M|H/g, (tok) => {
    switch (tok) {
      case 'yyyy': return String(p.y);
      case 'MMMM': return MONTHS_LONG[p.M - 1];
      case 'MMM': return MONTHS[p.M - 1];
      case 'MM': return pad(p.M);
      case 'M': return String(p.M);
      case 'dd': return pad(p.d);
      case 'd': return String(p.d);
      case 'EEEE': return DAYS_LONG[p.day];
      case 'EEE': return DAYS[p.day];
      case 'HH': return pad(p.H);
      case 'H': return String(p.H);
      case 'hh': return pad(((p.H + 11) % 12) + 1);
      case 'mm': return pad(p.m);
      case 'ss': return pad(p.s);
      case 'a': return p.H < 12 ? 'AM' : 'PM';
    }
    return tok;
  });
}

/** A moment written the way Sheets would show it in India, e.g. 2026-10-15T19:30:00.000+05:30. */
export function storedDate(d: Date): string {
  const p = istParts(d);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p.y}-${pad(p.M)}-${pad(p.d)}T${pad(p.H)}:${pad(p.m)}:${pad(p.s)}.${pad(p.ms, 3)}+05:30`;
}

export function dateKey(value: any): string {
  if (!value) return '';
  if (value instanceof Date) return formatDate(value, 'yyyy-MM-dd');
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return formatDate(d, 'yyyy-MM-dd');
}

/** Noon in India on the given day (the QC app stored work dates as noon). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0) - IST_MINUTES * 60000);
}

export function isValidDateKey(key: any): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return false;
  const [y, m, d] = String(key).split('-').map(Number);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return t.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a yyyy-MM-dd key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Bilara's week runs Thursday to Wednesday: the Thursday that starts the week holding `key`. */
export function weekStartKey(key: string): string {
  return addDaysKey(key, -((weekdayOfKey(key) - 4 + 7) % 7));
}
export function weekEndKey(key: string): string {
  return addDaysKey(weekStartKey(key), 6);
}

// ---------- small shared helpers the QC app used everywhere ----------

export function uuid(): string { return crypto.randomUUID(); }
export function unique(values: any[]): any[] { return Array.from(new Set(values.filter(Boolean))).sort(); }
export function clientSafe<T>(value: T): T { return JSON.parse(JSON.stringify(value ?? null)); }
export function normaliseEmail(value: any): string {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
export function stageCode(stage: any): string {
  return String(stage || 'GEN').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || 'GEN';
}
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- configuration (System_Config) ----------

/** Defaults the QC app created with ensureConfigValue_; a saved System_Config row wins. */
export const CONFIG_DEFAULTS: Record<string, string> = {
  TIMEZONE: 'Asia/Kolkata',
  SYSTEM_NAME: 'Bilara Site Operations',
  ENABLE_EMAIL_NOTIFICATIONS: 'Yes',
  ENABLE_PURCHASE_GRN_EMAILS: 'No',
  ENABLE_QC_OFFICE_DUTY_EMAILS: 'Yes',
  ENABLE_DAILY_GRN_DIGEST: 'Yes',
  ENABLE_DPR_COMPLIANCE_EMAILS: 'Yes',
  ENABLE_DAILY_LOW_STOCK_DIGEST: 'Yes',
  DAILY_EMAIL_QC_OFFICE_TIME: '19:00',
  DAILY_EMAIL_LOW_STOCK_TIME: '19:15',
  DAILY_EMAIL_DPR_REMINDER_TIME: '20:00',
  DAILY_EMAIL_DPR_FINAL_TIME: '08:30',
  DAILY_EMAIL_GRN_TIME: '19:30',
  DAILY_EMAIL_MATERIAL_TIME: '19:45',
  DPR_WORKING_DAYS: 'SUN,MON,TUE,WED,THU,FRI,SAT',
  QC_DAILY_CAPACITY: '1',
  QC_OFFICE_WORKING_DAYS: 'MON,TUE,WED,THU,FRI,SAT',
  INSPECTION_PREFIX: 'QCI',
  OPS_EMAIL: '',
};

// ---------- roles: one role per person (bilara role -> QC role) ----------

export const SITE_ROLE_OF: Record<string, string> = {
  'Super Admin': 'ADMIN',
  GM: 'GM',
  'Project Manager': 'PM',
  'Site Engineer': 'SITE_ENGINEER',
  QC: 'QC',
  'Purchase Manager': 'PURCHASE',
  'Purchase Team': 'PURCHASE',
  Audit: 'AUDITOR',
  'Labour Manager': 'LABOR_MANAGER',
  HR: 'HR',
  Contractor: 'CONTRACTOR',
};
export function siteRole(roles: string[]): string {
  for (const r of roles || []) if (SITE_ROLE_OF[r]) return SITE_ROLE_OF[r];
  return '';
}

// ---------- the per-request context ----------

type Op = {kind: 'insert'; table: string; row: Row} | {kind: 'update'; table: string; row: number; changes: Row} | {kind: 'delete'; table: string; row: number} | {kind: 'prop'; key: string; value: string};

function toStored(v: any): any {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : storedDate(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
function fromStored(v: any): any {
  if (v === null || v === undefined) return '';
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  return v;
}
const tableName = (t: string) => '"site_' + t.toLowerCase() + '"';
const col = (c: string) => '"' + c.replace(/"/g, '""') + '"';

export class Site {
  db: any;
  user: SiteUser | null;
  action: string;
  private tables = new Map<string, Row[]>();
  private maxRow = new Map<string, number>();
  private props = new Map<string, string | null>();
  private ops: Op[] = [];
  private lockVersion: number | null = null;
  /** Fixed clock for tests; otherwise real time. */
  clock: (() => Date) | null = null;
  /** Work queued to run after a successful commit (emails, mirrors). */
  after: Array<() => Promise<void>> = [];
  /**
   * Purchasing-record statements that must be saved together with this action (a PO-linked
   * GRN). They run first; `guard` must hold for the site writes to apply, and their own marker
   * already checks the site version, so both sides apply together or not at all.
   */
  external: {statements: any[]; guard: {sql: string; binds: any[]}} | null = null;
  /** Clean-up when the action fails (e.g. remove photos already stored). */
  onError: Array<() => Promise<void>> = [];
  /** Writes that must still be saved when the action fails (e.g. "upload needs a retry"). */
  failureWrites: Array<(f: Site) => Promise<void>> = [];

  constructor(user: SiteUser | null, action = 'system', db?: any) {
    this.db = db || database();
    this.user = user;
    this.action = action;
  }

  now(): Date { return this.clock ? this.clock() : new Date(); }
  todayKey(): string { return formatDate(this.now(), 'yyyy-MM-dd'); }

  currentUser(): SiteUser {
    if (!this.user) throw new SiteError('Authenticated application session required. Please sign in again.');
    return this.user;
  }
  requireRole(roles: string[]): SiteUser {
    const user = this.currentUser();
    if (roles.indexOf(user.role) < 0) throw new SiteError('You are not authorised for this action. Required role: ' + roles.join('/'));
    return user;
  }

  async begin() {
    if (this.lockVersion === null) {
      const r = await this.db.prepare('SELECT version FROM site_lock WHERE id=1').first();
      this.lockVersion = Number(r?.version || 0);
    }
  }

  // ----- reading -----

  async read(table: string): Promise<Row[]> {
    return (await this.rows(table)).map((r) => ({...r}));
  }
  async find(table: string, key: string, value: any): Promise<Row | null> {
    const rows = await this.rows(table);
    const hit = rows.find((r) => String(r[key]) === String(value));
    return hit ? {...hit} : null;
  }
  async filter(table: string, predicate: (r: Row) => boolean): Promise<Row[]> {
    return (await this.rows(table)).filter(predicate).map((r) => ({...r}));
  }
  /** Newest rows of one project from a long history table (recentProjectMaterialRecords_). */
  async recentProjectRows(table: string, projectId: any, limit: number): Promise<Row[]> {
    const rows = await this.rows(table);
    const out: Row[] = [];
    for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
      if (String(rows[i].Project_ID || '') === String(projectId || '')) out.push({...rows[i]});
    }
    return out;
  }
  async lastRow(table: string): Promise<number> {
    await this.rows(table);
    return this.maxRow.get(table) || 1;
  }

  private async rows(table: string): Promise<Row[]> {
    const cached = this.tables.get(table);
    if (cached) return cached;
    await this.begin();
    let rows: Row[];
    if (table === 'Projects') rows = await this.loadProjects();
    else if (table === 'Users_Roles') rows = await this.loadUsers();
    else {
      const cols = SITE_TABLES[table];
      if (!cols) throw new Error('Missing backend table: ' + table);
      const r = await this.db.prepare(`SELECT * FROM ${tableName(table)} ORDER BY _row`).all();
      rows = (r.results || []).map((x: any) => {
        const o: Row = {_row: Number(x._row)};
        for (const c of cols) o[c] = fromStored(x[c]);
        return o;
      });
    }
    this.tables.set(table, rows);
    // Row numbers start at 2 like a sheet under its heading row.
    this.maxRow.set(table, rows.reduce((m, r) => Math.max(m, Number(r._row || 0)), 1));
    return rows;
  }

  /** Projects as the QC app saw them, built from bilara-ops project configuration. */
  private async loadProjects(): Promise<Row[]> {
    const [p, u] = await Promise.all([
      this.db.prepare('SELECT * FROM project_configs ORDER BY project').all(),
      this.db.prepare('SELECT email,name FROM app_users').all(),
    ]);
    const names = new Map<string, string>((u.results || []).map((x: any) => [String(x.email).toLowerCase(), String(x.name)]));
    const nameOf = (emails: string[]) => emails.map((e) => names.get(e.toLowerCase()) || e).join(', ');
    return (p.results || []).map((x: any, i: number) => {
      const engineers: string[] = JSON.parse(x.engineer_emails || '[]');
      const qcs: string[] = JSON.parse(x.qc_emails || '[]');
      const status = String(x.status || (Number(x.active) ? 'ONGOING' : 'COMPLETED'));
      return {
        _row: i + 2,
        Project_ID: String(x.project), Project_Number: String(x.project),
        Client: String(x.name || ''), Project_Name: String(x.name || ''),
        Location: String(x.site || ''), State_UT: String(x.state || ''),
        Milestone: x.milestone ?? '', Status: Number(x.active) ? status : 'COMPLETED',
        PM_Name: names.get(String(x.manager_email || '').toLowerCase()) || '', PM_Email: String(x.manager_email || ''),
        Site_Engineer_Name: nameOf(engineers), Site_Engineer_Email: engineers.join(','),
        Site_QC_Name: nameOf(qcs), Site_QC_Email: qcs.join(','),
      };
    });
  }

  /** Users_Roles as the QC app saw it: one role per person. */
  private async loadUsers(): Promise<Row[]> {
    const r = await this.db.prepare('SELECT email,name,roles,projects,active FROM app_users ORDER BY email').all();
    return (r.results || []).map((x: any, i: number) => {
      const projects: string[] = JSON.parse(x.projects || '[]');
      return {
        _row: i + 2, Email: String(x.email), Name: String(x.name), Role: siteRole(JSON.parse(x.roles || '[]')),
        Active: Number(x.active) ? 'Yes' : 'No', Allowed_Project_IDs: projects.length ? projects.join(',') : 'ALL',
      };
    });
  }

  // ----- writing (queued until commit) -----

  private clean(table: string, record: Row): Row {
    const cols = SITE_TABLES[table];
    if (!cols) throw new Error('Cannot write to ' + table);
    const out: Row = {};
    for (const c of cols) out[c] = toStored(record[c]);
    return out;
  }

  async append(table: string, record: Row): Promise<number> {
    const rows = await this.rows(table);
    const n = (this.maxRow.get(table) || 1) + 1;
    this.maxRow.set(table, n);
    const stored = this.clean(table, record);
    const cached: Row = {_row: n};
    for (const c of SITE_TABLES[table]) cached[c] = fromStored(stored[c]);
    rows.push(cached);
    this.ops.push({kind: 'insert', table, row: {_row: n, ...stored}});
    return n;
  }
  async appendMany(table: string, records: Row[]): Promise<number> {
    for (const r of records || []) await this.append(table, r);
    return (records || []).length;
  }

  private async updateByRow(table: string, rowNumber: number, changes: Row) {
    const rows = await this.rows(table);
    const target = rows.find((r) => Number(r._row) === Number(rowNumber));
    if (!target) throw new Error('Record row not found: ' + table + ' / ' + rowNumber);
    const cols = SITE_TABLES[table];
    const stored: Row = {};
    for (const k of Object.keys(changes || {})) {
      if (!cols.includes(k)) continue;
      stored[k] = toStored(changes[k]);
      target[k] = fromStored(stored[k]);
    }
    if (Object.keys(stored).length) this.ops.push({kind: 'update', table, row: Number(rowNumber), changes: stored});
  }

  /** updateRecord_: change the first row whose `key` equals `value`. */
  async update(table: string, key: string, value: any, changes: Row): Promise<Row> {
    const record = await this.find(table, key, value);
    if (!record) throw new Error('Record not found: ' + table + ' / ' + value);
    await this.updateByRow(table, record._row, changes);
    return {...record, ...changes};
  }
  /** updateRecordsBatch_: entries carry the record (with _row) and its changes. */
  async updateBatch(table: string, entries: Array<{record: Row; changes: Row}>): Promise<number> {
    const list = (entries || []).filter((e) => e && e.record && Number(e.record._row) >= 2 && e.changes);
    for (const e of list) await this.updateByRow(table, Number(e.record._row), e.changes);
    return list.length;
  }
  /** updateRowsWhere_: same change on every matching row. */
  async updateWhere(table: string, predicate: (r: Row) => boolean, changes: Row): Promise<number> {
    const rows = (await this.rows(table)).filter(predicate);
    for (const r of rows) await this.updateByRow(table, r._row, changes);
    return rows.length;
  }

  /** Remove matching rows (sh.deleteRow in the QC app, used for draft checklist items). */
  async deleteWhere(table: string, predicate: (r: Row) => boolean): Promise<number> {
    const rows = await this.rows(table);
    const doomed = rows.filter(predicate);
    for (const r of doomed) {
      rows.splice(rows.indexOf(r), 1);
      this.ops.push({kind: 'delete', table, row: Number(r._row)});
    }
    return doomed.length;
  }

  // ----- script properties -----

  async property(key: string): Promise<string | null> {
    if (this.props.has(key)) return this.props.get(key) ?? null;
    await this.begin();
    const r = await this.db.prepare('SELECT value FROM site_properties WHERE key=?').bind(key).first();
    const v = r ? String(r.value) : null;
    this.props.set(key, v);
    return v;
  }
  setProperty(key: string, value: any) {
    this.props.set(key, String(value));
    this.ops.push({kind: 'prop', key, value: String(value)});
  }

  async config(key: string): Promise<any> {
    const row = await this.find('System_Config', 'Key', key);
    if (row && row.Value !== '') return row.Value;
    return CONFIG_DEFAULTS[key] ?? '';
  }

  async audit(action: string, entityType: string, entityId: any, previousState: any, newState: any, metadata: any) {
    const actor = this.user || {email: 'SYSTEM', role: 'SYSTEM'};
    const data: Row = {
      Audit_ID: 'AUD-' + uuid(), Timestamp: storedDate(this.now()), Actor_Email: actor.email,
      Actor_Role: actor.role, Action: action, Entity_Type: entityType, Entity_ID: String(entityId ?? ''),
      Previous_State: previousState || '', New_State: newState || '', Metadata_JSON: JSON.stringify(metadata || {}),
    };
    data.Integrity_Hash = await sha256Hex(JSON.stringify(data));
    await this.append('Audit_Log', data);
  }

  /** nextId_: PREFIX-yyyyMMdd-001 from a per-day counter. */
  async nextId(prefix: string, width = 3): Promise<string> {
    const date = formatDate(this.now(), 'yyyyMMdd');
    const key = 'COUNTER_' + prefix + '_' + date;
    const next = Number((await this.property(key)) || 0) + 1;
    this.setProperty(key, next);
    return prefix + '-' + date + '-' + String(next).padStart(width, '0');
  }

  hasWrites() { return this.ops.length > 0; }
  /** The site_lock version read at the start (for guards on statements saved alongside). */
  async version(): Promise<number> { await this.begin(); return Number(this.lockVersion); }

  /** Apply every queued write at once, only if no other site action committed meanwhile. */
  async commit(): Promise<boolean> {
    if (!this.ops.length) return true;
    await this.begin();
    const db = this.db, marker = uuid(), guard = ' AND EXISTS (SELECT 1 FROM site_commits WHERE id=?)';
    const ext = this.external;
    const st: any[] = [
      ...(ext ? ext.statements : []),
      db.prepare('INSERT INTO site_commits (id,action,by_email,at) SELECT ?,?,?,? WHERE (SELECT version FROM site_lock WHERE id=1)=?' + (ext ? ' AND ' + ext.guard.sql : ''))
        .bind(marker, this.action, this.user?.email || 'SYSTEM', storedDate(this.now()), this.lockVersion, ...(ext ? ext.guard.binds : [])),
      db.prepare('UPDATE site_lock SET version=version+1 WHERE id=1' + guard).bind(marker),
    ];
    for (const op of this.ops) {
      if (op.kind === 'insert') {
        const keys = Object.keys(op.row);
        st.push(db.prepare(`INSERT INTO ${tableName(op.table)} (${keys.map(col).join(',')}) SELECT ${keys.map(() => '?').join(',')} WHERE EXISTS (SELECT 1 FROM site_commits WHERE id=?)`)
          .bind(...keys.map((k) => op.row[k]), marker));
      } else if (op.kind === 'update') {
        const keys = Object.keys(op.changes);
        st.push(db.prepare(`UPDATE ${tableName(op.table)} SET ${keys.map((k) => col(k) + '=?').join(',')} WHERE _row=?` + guard)
          .bind(...keys.map((k) => op.changes[k]), op.row, marker));
      } else if (op.kind === 'delete') {
        st.push(db.prepare(`DELETE FROM ${tableName(op.table)} WHERE _row=?` + guard).bind(op.row, marker));
      } else {
        st.push(db.prepare('INSERT INTO site_properties (key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM site_commits WHERE id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .bind(op.key, op.value, marker));
      }
    }
    await db.batch(st);
    const ok = await db.prepare('SELECT 1 AS ok FROM site_commits WHERE id=?').bind(marker).first();
    if (!ok) {
      if (ext) throw new SiteError('A PO line, payment or site record changed while saving. Refresh and try again.');
      throw new SiteConflict('Another site update was saved at the same time.');
    }
    this.ops = [];
    return true;
  }
}

/**
 * Run one site action the way apiCall did: fresh data, all writes applied together,
 * re-run automatically if another update landed first, then the follow-up work.
 */
export async function runSiteAction<T>(user: SiteUser | null, action: string, fn: (s: Site) => Promise<T>, opts: {clock?: () => Date; db?: any} = {}): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = new Site(user, action, opts.db);
    if (opts.clock) s.clock = opts.clock;
    try {
      const value = await fn(s);
      await s.commit();
      for (const job of s.after) {
        try { await job(); } catch (e) { console.error(JSON.stringify({event: 'site_after_commit_failed', action, message: e instanceof Error ? e.message : String(e)})); }
      }
      return value;
    } catch (e) {
      for (const undo of s.onError) { try { await undo(); } catch { /* best effort */ } }
      if (e instanceof SiteConflict) { lastError = e; continue; }
      if (s.failureWrites.length) {
        try {
          const f = new Site(user, action + ':failure', opts.db);
          if (opts.clock) f.clock = opts.clock;
          for (const w of s.failureWrites) await w(f);
          await f.commit();
        } catch { /* the original error is what the person needs to see */ }
      }
      throw e;
    }
  }
  throw new SiteError('The site records were busy. Please try again. ' + (lastError?.message || ''));
}
