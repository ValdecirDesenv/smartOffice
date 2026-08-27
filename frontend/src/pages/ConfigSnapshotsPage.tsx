import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { ConfigSnapshot } from '../types';

const SNAPSHOT_LIMIT = 3;

export default function ConfigSnapshotsPage() {
  const { currentUser } = useAuth();
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    setSnapshots(await api.configSnapshots.list());
  }

  useEffect(() => {
    reload();
  }, []);

  if (!currentUser?.is_admin) {
    return <div className="p-6 text-sm text-slate-500">Admin access required.</div>;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setSubmitting(true);
    try {
      await api.configSnapshots.create(name.trim());
      setName('');
      await reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOverwrite(snapshot: ConfigSnapshot) {
    if (!window.confirm(`Overwrite "${snapshot.name}" with the current configuration? This cannot be undone.`)) {
      return;
    }
    setStatus(null);
    try {
      await api.configSnapshots.overwrite(snapshot.id, snapshot.name);
      await reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  async function handleLoad(snapshot: ConfigSnapshot) {
    if (
      !window.confirm(
        `Load "${snapshot.name}"? This replaces all current sites, floors, desks, employees, and assignments with this snapshot's data.`
      )
    ) {
      return;
    }
    setStatus(null);
    try {
      await api.configSnapshots.restore(snapshot.id);
      // A full reload is the simplest reliable way to flush every page/context's cached state
      // now that the entire dataset underneath them has changed.
      window.location.reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  async function handleDelete(snapshot: ConfigSnapshot) {
    if (!window.confirm(`Delete the "${snapshot.name}" snapshot? This cannot be undone.`)) return;
    setStatus(null);
    try {
      await api.configSnapshots.remove(snapshot.id);
      await reload();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-bold">Config Snapshots</h1>
      <p className="mb-4 text-sm text-slate-500">
        Save the current sites, floors, desks, employees, and assignments so you can revert to them later.
      </p>

      <form onSubmit={handleSave} className="mb-1 flex flex-wrap items-center gap-2">
        <input
          required
          placeholder="Snapshot name"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save snapshot'}
        </button>
      </form>
      <p className="mb-4 text-xs text-slate-400">
        Up to {SNAPSHOT_LIMIT} snapshots are kept — saving a {SNAPSHOT_LIMIT + 1}th replaces the oldest.
      </p>
      {status && <div className="mb-4 text-sm text-slate-600">{status}</div>}

      <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Saved by</th>
            <th className="px-4 py-2">Last saved</th>
            <th className="px-4 py-2">Contents</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="px-4 py-2 font-medium">{s.name}</td>
              <td className="px-4 py-2 text-slate-500">{s.created_by_username}</td>
              <td className="px-4 py-2 text-slate-500">{new Date(s.updated_at).toLocaleString()}</td>
              <td className="px-4 py-2 text-slate-500">
                {s.sites_count} offices · {s.floors_count} floors · {s.workspaces_count} desks · {s.employees_count}{' '}
                people
              </td>
              <td className="px-4 py-2 text-right">
                <button className="mr-3 text-xs text-blue-600" onClick={() => handleLoad(s)}>
                  Load
                </button>
                <button className="mr-3 text-xs text-blue-600" onClick={() => handleOverwrite(s)}>
                  Overwrite
                </button>
                <button className="text-xs text-red-600" onClick={() => handleDelete(s)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {snapshots.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                No snapshots yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
