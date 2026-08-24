import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import { User } from '../types';

export default function UsersPage() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [guest, setGuest] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    setUsers(await api.users.list());
  }

  useEffect(() => {
    reload();
  }, []);

  if (!currentUser?.is_admin) {
    return <div className="p-6 text-sm text-slate-500">Admin access required.</div>;
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setSubmitting(true);
    try {
      await api.users.invite(email.trim(), !guest);
      setStatus(`Invite sent to ${email.trim()}.`);
      setEmail('');
      setGuest(false);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function roleOf(u: User): 'admin' | 'member' | 'guest' {
    return u.is_admin ? 'admin' : u.can_edit ? 'member' : 'guest';
  }

  async function handleRoleChange(u: User, role: 'admin' | 'member' | 'guest') {
    setStatus(null);
    try {
      const updated = await api.users.updateRole(u.id, role);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-bold">Users</h1>
      <p className="mb-4 text-sm text-slate-500">Accounts with login access, and invites for new ones.</p>

      <form onSubmit={handleInvite} className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          placeholder="Email to invite"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
          Guest (view only)
        </label>
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </form>
      {status && <div className="mb-4 text-sm text-slate-600">{status}</div>}

      <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Username</th>
            <th className="px-4 py-2">Email</th>
            <th className="px-4 py-2">Access</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="px-4 py-2">{u.username}</td>
              <td className="px-4 py-2">{u.email}</td>
              <td className="px-4 py-2">
                <select
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                  value={roleOf(u)}
                  disabled={u.id === currentUser.id}
                  title={u.id === currentUser.id ? "You can't change your own admin access" : undefined}
                  onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'member' | 'guest')}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="guest">Guest (view only)</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
