import { useState } from 'react';
import { Employee, Workspace } from '../types';
import { useAuth } from '../context/AuthContext';

interface PersonMatch {
  employee: Employee;
  workspace: Workspace | null;
}

interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  peopleMatches?: PersonMatch[];
  onSelectPerson?: (employeeId: string) => void;
}

export default function TopBar({ search, onSearchChange, peopleMatches = [], onSelectPerson }: TopBarProps) {
  const { currentUser, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = currentUser?.username.slice(0, 2).toUpperCase() ?? '?';

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
            {peopleMatches.map(({ employee, workspace }) => (
              <li key={employee.id}>
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectPerson?.(employee.id);
                  }}
                >
                  <span>{employee.name}</span>
                  <span className="text-xs text-slate-400">{workspace ? workspace.code : 'Unassigned'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600" disabled>
        Today ▾
      </button>
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
