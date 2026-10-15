'use client';
import { useEffect, useState } from 'react';
import { UserPlus, ArrowLeft } from 'lucide-react';
import { roles } from '@/lib/permissions';

export default function Users() {
  const [users, setUsers] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [filterBy, setFilterBy] = useState<'name' | 'email' | 'role'>('email'),
    [searched, setSearched] = useState(''),
    [draft, setDraft] = useState<any>(null),
    [view, setView] = useState<'list' | 'form'>('list'),
    [viewOnly, setViewOnly] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const friendly = (e: unknown) =>
    e instanceof TypeError
      ? 'Cannot reach the application server. Reload and try again.'
      : e instanceof Error
        ? e.message
        : String(e);
  async function load() {
    const r = await fetch('/api/users'),
      d: any = await r.json();
    if (!r.ok) throw Error(d.error);
    setUsers(
      (d.users || []).map((u: any) => ({
        ...u,
        email: String(u.email || u.signInEmail || u.sign_in_email || ''),
      })),
    );
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(e: any) {
    e.preventDefault();
    if (viewOnly) return;
    setBusy(true);
    setError('');
    try {
      if (
        !draft.version &&
        users.some(
          (u) => u.email.toLowerCase() === draft.email.trim().toLowerCase(),
        )
      )
        throw Error('This email already has an account.');
      const r = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, projects: draft.projects || [] }),
        }),
        d: any = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setDraft(null);
      setView('list');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  const add = () => {
    setError('');
    setViewOnly(false);
    setDraft({
      email: '',
      name: '',
      roles: ['Project Manager'],
      projects: [],
      active: 1,
      version: 0,
    });
    setView('form');
  };
  const selected = (u: any) => ({
    ...u,
    email: String(u.email || u.signInEmail || u.sign_in_email || ''),
  });
  const inspect = (u: any) => {
    setError('');
    setViewOnly(true);
    setDraft(selected(u));
    setView('form');
  };
  const edit = (u: any) => {
    setError('');
    setViewOnly(false);
    setDraft(selected(u));
    setView('form');
  };
  const shown = users.filter((u) => {
    if (!searched) return true;
    const value =
      filterBy === 'name'
        ? u.name
        : filterBy === 'role'
          ? u.roles.join(' ')
          : u.email;
    return value.toLowerCase().includes(searched);
  });
  return (
    <section className="panel user-access-panel">
      {view === 'list' ? (
        <>
          <div className="tablebar">
            <div>
              <h2>
                Active users{' '}
                <span className="section-count">{shown.length}</span>
              </h2>
              <p>
                Filter users by email, name or role, then view or edit access.
              </p>
            </div>
            <form
              className="user-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearched(query.trim().toLowerCase());
              }}
            >
              <label className="filter-label">
                Filter by
                <select
                  aria-label="Filter users by"
                  value={filterBy}
                  onChange={(e) =>
                    setFilterBy(e.target.value as 'name' | 'email' | 'role')
                  }
                >
                  <option value="email">Email</option>
                  <option value="name">Name</option>
                  <option value="role">Role</option>
                </select>
              </label>
              <input
                type="text"
                inputMode="search"
                aria-label="Filter users"
                placeholder={`Search by ${filterBy}…`}
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  setSearched(value.trim().toLowerCase());
                }}
              />
              <button type="submit" className="secondary">
                Search
              </button>
            </form>
            <button className="primary" onClick={add}>
              <UserPlus size={16} /> Add new user
            </button>
          </div>
          <div className="user-access-list">
            {shown.map((u) => (
              <div className="user-access-row" key={u.email}>
                <span className="user-avatar" aria-hidden="true">
                  {u.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="user-identity">
                  <b>{u.name}</b>
                  <small>{u.email}</small>
                </span>
                <span className="user-scope">
                  <b>{u.roles.join(', ')}</b>
                  <small>
                    {u.projects.length
                      ? 'Projects ' + u.projects.join(', ')
                      : u.roles.some((r: string) =>
                            ['Project Manager', 'QC', 'Site Engineer'].includes(
                              r,
                            ),
                          )
                        ? 'No projects assigned'
                        : 'All projects'}
                  </small>
                </span>
                <span
                  className={
                    'user-status ' + (u.active ? 'enabled' : 'disabled')
                  }
                >
                  {u.active ? 'Active' : 'Disabled'}
                </span>
                <span className="user-actions">
                  <button
                    type="button"
                    className="textbutton"
                    onClick={() => inspect(u)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="textbutton"
                    onClick={() => edit(u)}
                  >
                    Edit
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="tablebar">
            <div>
              <h2>
                {viewOnly
                  ? 'View user'
                  : draft?.version
                    ? 'Edit user'
                    : 'Add new user'}
              </h2>
              <p>
                {viewOnly
                  ? 'Read-only user details. Choose Edit from the user list to make changes.'
                  : 'Enter the user details, role and account status.'}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setDraft(null);
                setView('list');
              }}
            >
              <ArrowLeft size={16} />
              {viewOnly ? 'Back to active users' : 'Cancel'}
            </button>
          </div>
          <form onSubmit={save} className="user-form">
            <div className="formgrid">
              <label className="field">
                <span>Name</span>
                <input
                  required
                  readOnly={viewOnly}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Sign-in email</span>
                <input
                  type="email"
                  required
                  readOnly={viewOnly || !!draft.version}
                  value={draft.email}
                  onChange={(e) =>
                    setDraft({ ...draft, email: e.target.value })
                  }
                />
              </label>
              {draft.roles.some((r: string) =>
                ['Project Manager', 'QC', 'Site Engineer'].includes(r),
              ) && (
                <div className="full alert">
                  Assigned projects:{' '}
                  <b>
                    {draft.projects?.length
                      ? draft.projects.join(', ')
                      : 'None'}
                  </b>
                  . Change assignments in Project configuration.
                </div>
              )}
            </div>
            <fieldset className="role-choices">
              <legend>Role (one per person)</legend>
              {roles.map((role) => (
                <label key={role}>
                  <input
                    type="radio"
                    name="user-role"
                    disabled={viewOnly}
                    checked={draft.roles.length === 1 && draft.roles[0] === role}
                    onChange={() => setDraft({ ...draft, roles: [role] })}
                  />
                  {role}
                </label>
              ))}
            </fieldset>
            <label className="account-enabled">
              <input
                type="checkbox"
                disabled={viewOnly}
                checked={!!draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked ? 1 : 0 })
                }
              />{' '}
              Account enabled
            </label>
            <div className="formfooter">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setView('list');
                }}
              >
                {viewOnly ? 'Back' : 'Cancel'}
              </button>
              {!viewOnly && (
                <button className="primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save user'}
                </button>
              )}
            </div>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="alert red">
          {error}
        </p>
      )}
    </section>
  );
}
