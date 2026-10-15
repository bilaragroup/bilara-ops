// Input checks and small converters shared by the DPR and stock modules (from DPR.gs).
import {Row, SiteError} from './core';

export function dprInteger(value: any, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || Math.floor(number) !== number) throw new SiteError(label + ' must be a whole number of 0 or more.');
  return number;
}
export function dprNumber(value: any, label: string, allowBlank: true): number | '';
export function dprNumber(value: any, label: string, allowBlank?: false): number;
export function dprNumber(value: any, label: string, allowBlank?: boolean): number | '' {
  if ((value === '' || value === null || value === undefined) && allowBlank) return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new SiteError(label + ' must be 0 or more.');
  return Math.round(number * 100) / 100;
}
export function dprPercent(value: any, label: string): number {
  const number = dprNumber(value, label, false);
  if (number > 100) throw new SiteError(label + ' cannot be more than 100%.');
  return number;
}
export function dprHours(value: any, label: string, allowZero: boolean): number {
  if (value === '' || value === null || value === undefined) throw new SiteError(label + ' is required.');
  const hours = dprNumber(value, label, false);
  if ((!allowZero && hours <= 0) || hours > 24) throw new SiteError(label + ' must be ' + (allowZero ? 'between 0 and 24' : 'greater than 0 and not more than 24') + '.');
  return hours;
}
export function dprText(value: any, label: string, maxLength: number, required: boolean): string {
  let text = String(value || '').trim();
  if (required && !text) throw new SiteError(label + ' is required.');
  if (text.length > Number(maxLength || 500)) throw new SiteError(label + ' is too long.');
  // Kept from the sheet era: a leading "=" was stored as literal text.
  if (text.charAt(0) === '=') text = "'" + text;
  return text;
}
export function materialRound(value: any): number { return Math.round(Number(value || 0) * 1000) / 1000; }

export function dprClientProject(project: Row) {
  return {
    projectId: String(project.Project_ID || ''), projectNumber: String(project.Project_Number || ''),
    client: String(project.Client || ''), projectName: String(project.Project_Name || ''),
    location: String(project.Location || ''), pmName: String(project.PM_Name || ''),
    pmEmail: String(project.PM_Email || '').trim().toLowerCase(),
    siteEngineerName: String(project.Site_Engineer_Name || ''),
    siteEngineerEmail: String(project.Site_Engineer_Email || '').trim().toLowerCase(),
    siteQcName: String(project.Site_QC_Name || ''), siteQcEmail: String(project.Site_QC_Email || '').trim().toLowerCase(),
  };
}

/** Short random id with a prefix, like 'MTX-' + Utilities.getUuid().slice(0, 12).toUpperCase(). */
export function shortId(prefix: string): string {
  return prefix + crypto.randomUUID().slice(0, 12).toUpperCase();
}
