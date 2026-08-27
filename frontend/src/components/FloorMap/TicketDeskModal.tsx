import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, ApiError } from '../../api/client';
import { Employee, Floor } from '../../types';

interface TicketDeskModalProps {
  onClose: () => void;
}

export default function TicketDeskModal({ onClose }: TicketDeskModalProps) {
  const { sites, directoryWorkspaces, directoryAssignments, directoryEmployees } = useApp();

  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [floors, setFloors] = useState<Floor[]>([]);
  const [floorId, setFloorId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  const [siteEmployees, setSiteEmployees] = useState<Employee[]>([]);
  const [personQuery, setPersonQuery] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Re-derive floors and the site's employee list whenever the requester picks a different site -
  // deliberately independent of AppContext's "currently viewed" site, so any office/floor can be
  // browsed here regardless of what's open on the map behind this modal.
  useEffect(() => {
    setFloorId('');
    setWorkspaceId('');
    if (!siteId) {
      setFloors([]);
      setSiteEmployees([]);
      return;
    }
    api.floors.list(siteId).then(setFloors);
    api.employees.list({ siteId }).then(setSiteEmployees);
  }, [siteId]);

  const floorWorkspaces = useMemo(
    () => directoryWorkspaces.filter((w) => w.floor_id === floorId),
    [directoryWorkspaces, floorId]
  );

  const occupantByWorkspace = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of directoryAssignments) {
      if (a.unassigned_at) continue;
      const employee = directoryEmployees.find((e) => e.id === a.employee_id);
      if (employee) map.set(a.workspace_id, employee.name);
    }
    return map;
  }, [directoryAssignments, directoryEmployees]);

  const personMatches = personQuery.trim()
    ? siteEmployees.filter((e) => e.name.toLowerCase().includes(personQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  const selectedEmployee = siteEmployees.find((e) => e.id === employeeId) ?? null;

  const canSubmit =
    Boolean(workspaceId) && (Boolean(employeeId) || (firstName.trim() && lastName.trim())) && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.deskRequests.create({
        workspace_id: workspaceId,
        employee_id: employeeId || undefined,
        requested_first_name: employeeId ? undefined : firstName.trim(),
        requested_last_name: employeeId ? undefined : lastName.trim(),
        requested_email: employeeId ? undefined : email.trim() || undefined,
        note: note.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">🎫 Ticket Desk</h2>
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <p className="mb-4 text-sm text-slate-600">Request sent — an admin will review it.</p>
            <button className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Office</label>
              <select
                className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">Select an office…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Floor</label>
              <select
                className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm disabled:opacity-50"
                value={floorId}
                disabled={!siteId}
                onChange={(e) => {
                  setFloorId(e.target.value);
                  setWorkspaceId('');
                }}
              >
                <option value="">Select a floor…</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {floorId && (
              <div className="mb-3">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Desk</label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-slate-300">
                  {floorWorkspaces.length === 0 && (
                    <div className="px-2.5 py-2 text-sm text-slate-400">No desks on this floor.</div>
                  )}
                  {floorWorkspaces.map((w) => {
                    const occupant = occupantByWorkspace.get(w.id);
                    return (
                      <label
                        key={w.id}
                        className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="ticket-desk-workspace"
                            checked={workspaceId === w.id}
                            onChange={() => setWorkspaceId(w.id)}
                          />
                          {w.code}
                        </span>
                        <span className={occupant ? 'text-red-600' : 'text-emerald-600'}>
                          {occupant ? `Occupied by ${occupant}` : 'Available'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Who needs the desk?</label>
              {employeeId && selectedEmployee ? (
                <div className="flex items-center justify-between rounded-md border border-slate-300 px-2.5 py-2 text-sm">
                  <span>{selectedEmployee.name}</span>
                  <button
                    className="text-xs text-slate-500"
                    onClick={() => {
                      setEmployeeId('');
                      setPersonQuery('');
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : addingNew ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
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
                  <input
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                    placeholder="Email (optional)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    className="text-xs text-slate-500"
                    onClick={() => {
                      setAddingNew(false);
                      setFirstName('');
                      setLastName('');
                      setEmail('');
                    }}
                  >
                    ← Search existing people instead
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm disabled:opacity-50"
                    placeholder="Search people…"
                    value={personQuery}
                    disabled={!siteId}
                    onChange={(e) => setPersonQuery(e.target.value)}
                  />
                  {personQuery.trim() && (
                    <ul className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                      {personMatches.map((e) => (
                        <li key={e.id}>
                          <button
                            className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              setEmployeeId(e.id);
                              setPersonQuery('');
                            }}
                          >
                            {e.name}
                          </button>
                        </li>
                      ))}
                      <li>
                        <button
                          className="block w-full px-3 py-1.5 text-left text-blue-600 hover:bg-slate-50"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            setAddingNew(true);
                            setPersonQuery('');
                          }}
                        >
                          + Not in the list — add a new person
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Note (optional)</label>
              <textarea
                className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

            <button
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitting ? 'Sending…' : 'Submit request'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
