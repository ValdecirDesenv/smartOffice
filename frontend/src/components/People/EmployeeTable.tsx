import { useState } from 'react';
import { Employee, Team } from '../../types';
import EmployeeForm from './EmployeeForm';

interface EmployeeTableProps {
  employees: Employee[];
  teams: Team[];
  onUpdate: (id: string, data: { name: string; email: string; job_title: string; team_id: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateTeam: (name: string) => Promise<Team>;
}

export default function EmployeeTable({ employees, teams, onUpdate, onDelete, onCreateTeam }: EmployeeTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
        <tr>
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Email</th>
          <th className="px-4 py-2">Job title</th>
          <th className="px-4 py-2">Team</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {employees.map((emp) =>
          editingId === emp.id ? (
            <tr key={emp.id}>
              <td colSpan={5} className="p-2">
                <EmployeeForm
                  initial={emp}
                  teams={teams}
                  onCreateTeam={onCreateTeam}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (data) => {
                    await onUpdate(emp.id, data);
                    setEditingId(null);
                  }}
                />
              </td>
            </tr>
          ) : (
            <tr key={emp.id} className="border-t border-slate-100">
              <td className="px-4 py-2">{emp.name}</td>
              <td className="px-4 py-2 text-slate-500">{emp.email}</td>
              <td className="px-4 py-2 text-slate-500">{emp.job_title}</td>
              <td className="px-4 py-2 text-slate-500">{teams.find((t) => t.id === emp.team_id)?.name ?? '—'}</td>
              <td className="px-4 py-2 text-right">
                <button className="mr-3 text-xs text-blue-600" onClick={() => setEditingId(emp.id)}>
                  Edit
                </button>
                <button className="text-xs text-red-600" onClick={() => onDelete(emp.id)}>
                  Delete
                </button>
              </td>
            </tr>
          )
        )}
        {employees.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
              No employees yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
