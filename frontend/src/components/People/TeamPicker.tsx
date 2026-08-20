import { useState } from 'react';
import { Team } from '../../types';

interface TeamPickerProps {
  teams: Team[];
  value: string | null;
  onChange: (teamId: string | null) => void;
  onCreateTeam: (name: string) => Promise<Team>;
}

export default function TeamPicker({ teams, value, onChange, onCreateTeam }: TeamPickerProps) {
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex gap-2">
      <select
        className="flex-1 rounded-md border border-slate-300 px-2.5 py-2 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {creating ? (
        <>
          <input
            autoFocus
            className="w-32 rounded-md border border-slate-300 px-2 py-2 text-sm"
            placeholder="Team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          <button
            className="rounded-md bg-blue-600 px-2 text-sm text-white"
            onClick={async () => {
              if (!newTeamName.trim()) return;
              const team = await onCreateTeam(newTeamName.trim());
              onChange(team.id);
              setNewTeamName('');
              setCreating(false);
            }}
          >
            Add
          </button>
        </>
      ) : (
        <button className="rounded-md border border-slate-300 px-2 text-sm" onClick={() => setCreating(true)}>
          + Team
        </button>
      )}
    </div>
  );
}
