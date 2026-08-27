import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { api, ApiError } from '../api/client';
import { DeskRequest, Team } from '../types';

export default function DeskTicketsPage() {
  const { canEdit } = useAuth();
  const { refreshDirectory } = useApp();
  const [tickets, setTickets] = useState<DeskRequest[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    setTickets(await api.deskRequests.list());
  }

  useEffect(() => {
    reload();
  }, []);

  if (!canEdit) {
    return <div className="p-6 text-sm text-slate-500">Admin or member access required.</div>;
  }

  function personLabel(t: DeskRequest): string {
    return t.employee_name ?? [t.requested_first_name, t.requested_last_name].filter(Boolean).join(' ');
  }

  function expand(t: DeskRequest) {
    setStatus(null);
    setExpandedId(t.id);
    setFirstName(t.employee_name ? '' : t.requested_first_name ?? '');
    setLastName(t.employee_name ? '' : t.requested_last_name ?? '');
    setEmail(t.requested_email ?? '');
    setJobTitle('');
    setTeamId('');
    api.teams.list(t.site_id).then(setTeams);
  }

  async function handleApprove(t: DeskRequest) {
    if (!window.confirm(`Approve this request and assign ${personLabel(t)} to ${t.workspace_code}?`)) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await api.deskRequests.approve(t.id, {
        employee_id: t.employee_id ?? undefined,
        first_name: t.employee_id ? undefined : firstName.trim() || undefined,
        last_name: t.employee_id ? undefined : lastName.trim() || undefined,
        email: email.trim() || undefined,
        job_title: jobTitle.trim() || undefined,
        team_id: teamId || undefined,
      });
      setExpandedId(null);
      await Promise.all([reload(), refreshDirectory()]);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(t: DeskRequest) {
    if (!window.confirm(`Reject this request for ${personLabel(t)}?`)) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await api.deskRequests.reject(t.id);
      setExpandedId(null);
      await reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-bold">Desk Tickets</h1>
      <p className="mb-4 text-sm text-slate-500">Pending desk-assignment requests submitted via Ticket Desk.</p>
      {status && <div className="mb-4 text-sm text-red-600">{status}</div>}

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
          No pending requests.
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <button className="flex w-full items-center justify-between text-left" onClick={() => expand(t)}>
                <div>
                  <div className="font-medium">
                    {personLabel(t)} <span className="text-slate-400">·</span>{' '}
                    <span className="text-slate-500">{t.workspace_code}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {t.site_name} · {t.floor_name} · requested by {t.requested_by_username} on{' '}
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                  {t.note && <div className="mt-1 text-xs text-slate-500">Note: {t.note}</div>}
                </div>
                <span className="text-slate-400">{expandedId === t.id ? '▾' : '▸'}</span>
              </button>

              {expandedId === t.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {t.employee_id ? (
                    <p className="mb-3 text-sm text-slate-600">
                      Assigning existing employee <b>{t.employee_name}</b>. You can optionally fill in/update their
                      email, job title, or team below.
                    </p>
                  ) : (
                    <div className="mb-3 flex gap-2">
                      <input
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                        placeholder="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                      <input
                        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                        placeholder="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="mb-3 flex gap-2">
                    <input
                      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      placeholder="Email (optional)"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <input
                      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      placeholder="Job title (optional)"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                    />
                    <select
                      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                    >
                      <option value="">No team</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 rounded-md bg-blue-600 py-2 text-sm font-bold text-white disabled:opacity-50"
                      disabled={submitting || (!t.employee_id && (!firstName.trim() || !lastName.trim()))}
                      onClick={() => handleApprove(t)}
                    >
                      Approve & Assign
                    </button>
                    <button
                      className="flex-1 rounded-md border border-red-300 py-2 text-sm font-bold text-red-600 disabled:opacity-50"
                      disabled={submitting}
                      onClick={() => handleReject(t)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
