// Who may see which project in the site pages (converted from the QC app's Database.gs).
// Admin, GM, Auditor, Purchase and Labour manager see every ongoing project. A PM sees the
// projects they manage, a Site Engineer the projects they are assigned to, and a QC only the
// projects they are booked on (inspections) or assigned to as a site engineer / site QC
// (DPR and stock). Anyone else uses their allowed project list.
import {Site, SiteError, SiteUser, Row} from './core';

export const ALL_PROJECT_ROLES = ['ADMIN', 'GM', 'AUDITOR', 'PURCHASE', 'LABOR_MANAGER'];

export function normaliseProjectStatus(value: any): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
export function isSelectableProject(project: Row): boolean {
  return Boolean(String(project.Project_ID || '').trim()) && Boolean(String(project.Project_Number || '').trim()) &&
    normaliseProjectStatus(project.Status) === 'ONGOING';
}
export function normaliseAllowedProjects(value: any): string {
  const raw = String(value || '').trim();
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, '');
  if (compact === 'ALL' || compact === 'ALLPROJECTS') return 'ALL';
  return raw.split(',').map((item) => String(item).trim()).filter(Boolean).join(',');
}
export function projectEmailMatches(storedEmails: any, userEmail: any): boolean {
  const wanted = String(userEmail || '').trim().toLowerCase();
  if (!wanted) return false;
  return String(storedEmails || '').split(/[;,]/).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean).indexOf(wanted) >= 0;
}
/** A QC inspection booking never grants DPR or stock access; only the project assignment does. */
export function projectSiteOperationsMatches(project: Row | null, user: SiteUser | null): boolean {
  if (!project || !user) return false;
  if (user.role === 'SITE_ENGINEER') return projectEmailMatches(project.Site_Engineer_Email, user.email);
  if (user.role === 'QC') return projectEmailMatches(project.Site_Engineer_Email, user.email) || projectEmailMatches(project.Site_QC_Email, user.email);
  return false;
}

async function qcBookedOn(s: Site, user: SiteUser, projectId?: any): Promise<boolean | Record<string, boolean>> {
  const bookings = await s.read('QC_Booking_Header').catch(() => [] as Row[]);
  const mine = bookings.filter((b) => String(b.QC_Email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase() &&
    ['CANCELLED', 'REJECTED'].indexOf(String(b.Status || '').toUpperCase()) < 0);
  if (projectId !== undefined) return mine.some((b) => String(b.Project_ID || '') === String(projectId));
  const ids: Record<string, boolean> = {};
  mine.forEach((b) => { ids[String(b.Project_ID || '')] = true; });
  return ids;
}

export async function assertProjectAccess(s: Site, user: SiteUser, projectId: any): Promise<true> {
  const access = normaliseAllowedProjects(user.allowedProjects);
  if (ALL_PROJECT_ROLES.indexOf(user.role) >= 0) return true;
  const project = await s.find('Projects', 'Project_ID', projectId);
  if (!project || !isSelectableProject(project)) throw new SiteError('This project is not an ONGOING project in Projects.');
  if (user.role === 'PM' && String(project.PM_Email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()) return true;
  if (user.role === 'PM') throw new SiteError('You are not the assigned Project Manager for project ' + projectId);
  if (user.role === 'SITE_ENGINEER' && projectEmailMatches(project.Site_Engineer_Email, user.email)) return true;
  if (user.role === 'SITE_ENGINEER') throw new SiteError('You are not the assigned Site Engineer for project ' + projectId);
  if (user.role === 'QC') {
    if (await qcBookedOn(s, user, projectId)) return true;
    throw new SiteError('This project is not assigned to you through a QC booking.');
  }
  const allowed = access.split(',').map((x) => x.trim()).filter(Boolean);
  if (access !== 'ALL' && allowed.indexOf(String(projectId)) < 0 && allowed.indexOf(String(project.Project_Number || '')) < 0) {
    throw new SiteError('You are not assigned to project ' + projectId);
  }
  return true;
}

export async function assertSiteOperationsProjectAccess(s: Site, user: SiteUser, projectId: any): Promise<true> {
  if (user.role !== 'QC') return assertProjectAccess(s, user, projectId);
  const project = await s.find('Projects', 'Project_ID', projectId);
  if (!project || !isSelectableProject(project)) throw new SiteError('This project is not an ONGOING project in Projects.');
  if (projectSiteOperationsMatches(project, user)) return true;
  throw new SiteError('You are not assigned to this site for DPR or Site Materials. Ask Admin to add you as a site engineer or site QC for this project in Project configuration.');
}

export async function getProjectsForUser(s: Site, user: SiteUser): Promise<Row[]> {
  const access = normaliseAllowedProjects(user.allowedProjects);
  const qcProjectIds = user.role === 'QC' ? (await qcBookedOn(s, user)) as Record<string, boolean> : {};
  return (await s.read('Projects')).filter((p) => {
    if (!isSelectableProject(p)) return false;
    if (ALL_PROJECT_ROLES.indexOf(user.role) >= 0) return true;
    if (user.role === 'PM') return String(p.PM_Email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase();
    if (user.role === 'SITE_ENGINEER') return projectEmailMatches(p.Site_Engineer_Email, user.email);
    // QC engineers are floating resources: only projects in their own booking history.
    if (user.role === 'QC') return Boolean(qcProjectIds[String(p.Project_ID)]);
    if (access === 'ALL') return true;
    return access.split(',').map((x) => x.trim()).indexOf(String(p.Project_ID)) >= 0;
  });
}

export async function getSiteOperationsProjectsForUser(s: Site, user: SiteUser): Promise<Row[]> {
  if (user.role !== 'QC') return getProjectsForUser(s, user);
  return (await s.read('Projects')).filter((p) => isSelectableProject(p) && projectSiteOperationsMatches(p, user));
}

export async function assertProjectArchiveAccess(s: Site, user: SiteUser, projectId: any): Promise<true> {
  if (user.role === 'ADMIN' || user.role === 'GM') return true;
  const project = (await s.find('Projects', 'Project_ID', projectId)) || {};
  if (user.role === 'PM' && String(project.PM_Email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()) return true;
  if (user.role === 'SITE_ENGINEER' && projectEmailMatches(project.Site_Engineer_Email, user.email)) return true;
  if (user.role === 'QC' && projectSiteOperationsMatches(project, user)) return true;
  throw new SiteError('You are not authorised to view this project history.');
}

/** Active people holding one site role (activeRoleUsers_). */
export async function activeRoleUsers(s: Site, roles: string[]): Promise<Row[]> {
  return (await s.read('Users_Roles')).filter((r) => String(r.Active).toLowerCase() === 'yes' && roles.indexOf(String(r.Role)) >= 0);
}
