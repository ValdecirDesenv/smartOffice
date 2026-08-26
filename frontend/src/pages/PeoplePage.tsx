import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Employee, Team } from '../types';
import EmployeeForm from '../components/People/EmployeeForm';
import EmployeeTable from '../components/People/EmployeeTable';

export default function PeoplePage() {
  const { currentSite, sites } = useApp();
  const { canEdit } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scope, setScope] = useState<'site' | 'all'>('site');
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);

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

  // Fetched only once the "All Offices" view is actually opened, not eagerly on every page load.
  useEffect(() => {
    if (scope !== 'all') return;
    Promise.all([api.employees.list({}), api.teams.list()]).then(([emps, tms]) => {
      setAllEmployees(emps);
      setAllTeams(tms);
    });
  }, [scope]);

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
