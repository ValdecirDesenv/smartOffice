import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.auth.forgotPassword(email.trim());
    } finally {
      // Always show the same "check your email" state, whether or not the address is
      // registered - the backend deliberately doesn't reveal that either.
      setSubmitting(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm p-10">
        <h1 className="mb-2 text-lg font-extrabold">Check your email</h1>
        <p className="text-sm text-slate-600">
          If an account exists for {email.trim() || 'that address'}, a password reset link is on its way.
        </p>
        <Link to="/login" className="mt-4 block text-sm text-blue-600">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm p-10">
      <h1 className="mb-1 text-lg font-extrabold">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-500">Enter your account email and we'll send you a reset link.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          autoFocus
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <Link to="/login" className="mt-4 block text-sm text-blue-600">
        Back to sign in
      </Link>
    </div>
  );
}
