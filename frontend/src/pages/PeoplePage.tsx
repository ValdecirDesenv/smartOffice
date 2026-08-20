import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { Employee, Team } from '../types';
import EmployeeForm from '../components/People/EmployeeForm';
import EmployeeTable from '../components/People/EmployeeTable';

export default function PeoplePage() {
  const { currentSite } = useApp();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

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
      <h1 className="mb-1 text-2xl font-bold">People</h1>
      <p className="mb-4 text-sm text-slate-500">Employee directory for {currentSite.name}</p>

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

      <EmployeeTable
        employees={employees}
        teams={teams}
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
    </div>
  );
}
