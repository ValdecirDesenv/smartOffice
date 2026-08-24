import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="mx-auto max-w-sm p-10">
        <h1 className="mb-2 text-lg font-extrabold">Invalid link</h1>
        <p className="text-sm text-slate-600">This reset link is missing its token. Please request a new one.</p>
        <Link to="/forgot-password" className="mt-4 block text-sm text-blue-600">
          Request a new link
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.auth.resetPassword(token, password);
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm p-10">
      <h1 className="mb-1 text-lg font-extrabold">Set a new password</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">New password</label>
          <input
            autoFocus
            type="password"
            minLength={8}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Confirm password</label>
          <input
            type="password"
            minLength={8}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
