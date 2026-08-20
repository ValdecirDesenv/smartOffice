import { useState } from 'react';
import { Employee, Team } from '../../types';
import TeamPicker from './TeamPicker';

interface EmployeeFormProps {
  initial?: Employee;
  teams: Team[];
  onSubmit: (data: { name: string; email: string; job_title: string; team_id: string | null }) => Promise<void>;
  onCreateTeam: (name: string) => Promise<Team>;
  onCancel?: () => void;
}

export default function EmployeeForm({ initial, teams, onSubmit, onCreateTeam, onCancel }: EmployeeFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [jobTitle, setJobTitle] = useState(initial?.job_title ?? '');
  const [teamId, setTeamId] = useState<string | null>(initial?.team_id ?? null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), job_title: jobTitle.trim(), team_id: teamId });
      if (!initial) {
        setName('');
        setEmail('');
        setJobTitle('');
        setTeamId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-5 gap-2 rounded-xl border border-slate-200 bg-white p-4">
      <input
        className="rounded-md border border-slate-300 px-2.5 py-2 text-sm"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-300 px-2.5 py-2 text-sm"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded-md border border-slate-300 px-2.5 py-2 text-sm"
        placeholder="Job title"
        value={jobTitle}
        onChange={(e) => setJobTitle(e.target.value)}
      />
      <TeamPicker teams={teams} value={teamId} onChange={setTeamId} onCreateTeam={onCreateTeam} />
      <div className="flex gap-2">
        <button className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={saving}>
          {initial ? 'Save' : 'Add'}
        </button>
        {onCancel && (
          <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
