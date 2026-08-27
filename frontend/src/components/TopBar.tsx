import { useMemo, useState } from 'react';
import { Employee, Workspace } from '../types';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

interface PersonMatch {
  employee: Employee;
  workspace: Workspace | null;
  siteName?: string | null;
}

interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  peopleMatches?: PersonMatch[];
  onSelectPerson?: (employeeId: string) => void;
  onOpenTicketDesk?: () => void;
}

export default function TopBar({
  search,
  onSearchChange,
  peopleMatches = [],
  onSelectPerson,
  onOpenTicketDesk,
}: TopBarProps) {
  const { currentUser, canEdit, logout } = useAuth();
  const { directoryEmployees, directoryWorkspaces, directoryAssignments, sites } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [flaggedOpen, setFlaggedOpen] = useState(false);
  const initials = currentUser?.username.slice(0, 2).toUpperCase() ?? '?';

  // Employees marked inactive (e.g. a former employee per the HubSpot sync) who still occupy a
  // desk - these were deliberately not auto-unassigned, so this is the one place to find and
  // jump to them for review, rather than having to spot the orange border on every floor.
  const flagged = useMemo(() => {
    const employeesById = new Map(directoryEmployees.map((e) => [e.id, e]));
    const workspacesById = new Map(directoryWorkspaces.map((w) => [w.id, w]));
    const result: PersonMatch[] = [];
    for (const a of directoryAssignments) {
      if (a.unassigned_at) continue;
      const employee = employeesById.get(a.employee_id);
      if (!employee || employee.status !== 'inactive') continue;
      const workspace = workspacesById.get(a.workspace_id) ?? null;
      const siteName = workspace ? sites.find((s) => s.id === workspace.site_id)?.name : null;
      result.push({ employee, workspace, siteName });
    }
    return result;
  }, [directoryEmployees, directoryWorkspaces, directoryAssignments, sites]);

  return (
    <header className="flex h-[70px] items-center gap-3 border-b border-slate-200 bg-white px-6">
      <div className="relative max-w-[520px] flex-1">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          placeholder="Search people, desks, rooms or teams..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onSearchChange('')}
        />
        {peopleMatches.length > 0 && (
          <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
            {peopleMatches.map(({ employee, workspace, siteName }) => (
              <li key={employee.id}>
                <button
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectPerson?.(employee.id);
                  }}
                >
                  <span>{employee.name}</span>
                  <span className="whitespace-nowrap text-xs text-slate-400">
                    {workspace ? `${workspace.code}${siteName ? ` · ${siteName}` : ''}` : 'Unassigned'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600" disabled>
        Today ▾
      </button>
      {onOpenTicketDesk && (
        <button
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={onOpenTicketDesk}
        >
          🎫 Ticket Desk
        </button>
      )}
      {canEdit && flagged.length > 0 && (
        <div className="relative">
          <button
            className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
            onClick={() => setFlaggedOpen((v) => !v)}
          >
            ⚠ Flagged ({flagged.length})
          </button>
          {flaggedOpen && (
            <ul className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
              <li className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                Should be unassigned — no longer active but still seated
              </li>
              {flagged.map(({ employee, workspace, siteName }) => (
                <li key={employee.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setFlaggedOpen(false);
                      onSelectPerson?.(employee.id);
                    }}
                  >
                    <span>{employee.name}</span>
                    <span className="whitespace-nowrap text-xs text-slate-400">
                      {workspace ? `${workspace.code}${siteName ? ` · ${siteName}` : ''}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="relative">
        <button
          className="grid h-[42px] w-[42px] place-items-center rounded-full bg-blue-100 font-bold text-blue-600"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {initials}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2 text-slate-500">{currentUser?.username}</div>
            <button
              className="block w-full px-3 py-2 text-left text-red-600 hover:bg-slate-50"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
