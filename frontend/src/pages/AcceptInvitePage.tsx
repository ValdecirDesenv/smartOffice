import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      return;
    }
    api.auth
      .getInvite(token)
      .then((res) => setEmail(res.email))
      .catch(() => setInvalid(true));
  }, [token]);

  if (invalid) {
    return (
      <div className="mx-auto max-w-sm p-10">
        <h1 className="mb-2 text-lg font-extrabold">Invalid invite</h1>
        <p className="text-sm text-slate-600">This invite link is invalid or has expired. Ask an admin to send a new one.</p>
        <Link to="/login" className="mt-4 block text-sm text-blue-600">
          Back to sign in
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.auth.acceptInvite(token, username.trim(), password);
      // Cookie is already set by accept-invite; login() here just syncs AuthContext's state.
      await login(username.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm p-10">
      <h1 className="mb-1 text-lg font-extrabold">▦ Welcome to SmartOffice</h1>
      {email && <p className="mb-6 text-sm text-slate-500">Setting up an account for {email}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Choose a username</label>
          <input
            autoFocus
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Choose a password</label>
          <input
            type="password"
            minLength={8}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
