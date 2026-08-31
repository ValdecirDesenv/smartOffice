import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { OffboardedEmployee } from '../types';

export default function OffboardedPage() {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<OffboardedEmployee[]>([]);

  useEffect(() => {
    if (currentUser?.can_sync_hubspot) api.hubspot.offboarded().then(setRows);
  }, [currentUser]);

  if (!currentUser?.is_admin || !currentUser?.can_sync_hubspot) {
    return <div className="p-6 text-sm text-slate-500">Not authorized.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-bold">Offboarded</h1>
      <p className="mb-4 text-sm text-slate-500">
        Everyone HubSpot has ever reported as a former employee. Visible only to you.
      </p>

      <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2" />
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Email</th>
            <th className="px-4 py-2">Job title</th>
            <th className="px-4 py-2">Department</th>
            <th className="px-4 py-2">Termination date</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-4 py-2">
                {r.headshot_url ? (
                  <img
                    src={r.headshot_url}
                    alt={[r.first_name, r.last_name].filter(Boolean).join(' ')}
                    className="h-8 w-8 rounded-full border-2 border-slate-400 object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full border-2 border-slate-200 bg-slate-100" />
                )}
              </td>
              <td className="px-4 py-2">{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td className="px-4 py-2 text-slate-500">{r.email}</td>
              <td className="px-4 py-2 text-slate-500">{r.job_title}</td>
              <td className="px-4 py-2 text-slate-500">{r.department}</td>
              <td className="px-4 py-2 text-slate-500">{r.termination_date}</td>
              <td className="px-4 py-2">
                {r.matched_employee_id ? (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                    Still on People list (flagged)
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    Removed from People list
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                No offboarded records yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
