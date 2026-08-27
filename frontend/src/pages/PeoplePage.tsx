import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { Employee, HubspotSyncResult, Team } from '../types';
import EmployeeForm from '../components/People/EmployeeForm';
import EmployeeTable from '../components/People/EmployeeTable';

export default function PeoplePage() {
  const { currentSite, sites } = useApp();
  const { canEdit, currentUser } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scope, setScope] = useState<'site' | 'all'>('site');
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<HubspotSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function reload() {
    if (!currentSite) return;
    const [emps, tms] = await Promise.all([
      api.employees.list({ siteId: currentSite.id }),
      api.teams.list(currentSite.id),
    ]);
    setEmployees(emps);
    setTeams(tms);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite]);

  async function reloadAll() {
    const [emps, tms] = await Promise.all([api.employees.list({}), api.teams.list()]);
    setAllEmployees(emps);
    setAllTeams(tms);
  }

  // Fetched only once the "All Offices" view is actually opened, not eagerly on every page load.
  useEffect(() => {
    if (scope !== 'all') return;
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function handleHubspotSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await api.hubspot.sync();
      setSyncResult(result);
      await Promise.all([reload(), scope === 'all' ? reloadAll() : Promise.resolve()]);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateTeam(name: string): Promise<Team> {
    if (!currentSite) throw new Error('No site selected');
    const team = await api.teams.create({ site_id: currentSite.id, name });
    setTeams((prev) => [...prev, team]);
    return team;
  }

  if (!currentSite) {
    return <div className="p-6 text-sm text-slate-500">Create a site on the Floor Map page first.</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-bold">People</h1>
          <p className="text-sm text-slate-500">
            {scope === 'site' ? `Employee directory for ${currentSite.name}` : 'Employee directory for all offices'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm">
          <button
            className={`rounded-md px-3 py-1.5 ${scope === 'site' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
            onClick={() => setScope('site')}
          >
            This Office
          </button>
          <button
            className={`rounded-md px-3 py-1.5 ${scope === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
            onClick={() => setScope('all')}
          >
            All Offices
          </button>
        </div>
      </div>

      {currentUser?.can_sync_hubspot && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">HubSpot sync</div>
              <div className="text-xs text-slate-500">
                Fetches employee data from HubSpot and updates the local directory. Visible only to you.
              </div>
            </div>
            <button
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={syncing}
              onClick={handleHubspotSync}
            >
              {syncing ? 'Syncing…' : 'Sync HubSpot'}
            </button>
          </div>
          {syncError && (
            <div className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">⚠ {syncError}</div>
          )}
          {syncResult && (
            <div className="mt-2 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
              ✓ Fetched and updated — {syncResult.updated} updated, {syncResult.created} created,{' '}
              {syncResult.removedFormerEmployees} removed, {syncResult.flaggedFormerEmployees} flagged,{' '}
              {syncResult.skippedNoIdentifier + syncResult.skippedNoName + syncResult.skippedFormerNoMatch} skipped,{' '}
              {syncResult.offboardedRecorded} offboarded on file
            </div>
          )}
          {syncResult && syncResult.errors.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              ⚠ {syncResult.errors.length} row{syncResult.errors.length === 1 ? '' : 's'} had issues and were skipped:
              <ul className="mt-1 list-disc pl-4">
                {syncResult.errors.map((e, i) => (
                  <li key={i}>
                    {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {scope === 'site' ? (
        <>
          {canEdit && (
            <div className="mb-4">
              <EmployeeForm
                teams={teams}
                onCreateTeam={handleCreateTeam}
                onSubmit={async (data) => {
                  await api.employees.create({ site_id: currentSite.id, ...data });
                  await reload();
                }}
              />
            </div>
          )}

          <EmployeeTable
            employees={employees}
            teams={teams}
            readOnly={!canEdit}
            onCreateTeam={handleCreateTeam}
            onUpdate={async (id, data) => {
              const emp = employees.find((e) => e.id === id);
              if (!emp) return;
              await api.employees.update(id, { site_id: emp.site_id, ...data });
              await reload();
            }}
            onDelete={async (id) => {
              await api.employees.remove(id);
              await reload();
            }}
          />
        </>
      ) : (
        // Read-only: editing here would need a per-row site-scoped team list (teams don't cross
        // offices), which isn't worth the complexity when switching to "This Office" already
        // gives full edit access scoped correctly.
        <EmployeeTable
          employees={allEmployees}
          teams={allTeams}
          sites={sites}
          readOnly
          onCreateTeam={handleCreateTeam}
          onUpdate={async () => {}}
          onDelete={async () => {}}
        />
      )}
    </div>
  );
}
