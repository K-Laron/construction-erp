"use client";

import { useState } from 'react';
import { User, Lock, Loader2, AlertTriangle } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (user: { id: string; username: string; name: string; role: string }) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !pin) return;
    setError('');
    setLoading(true);
    try {
      const { authenticateUser } = await import('@/app/actions/auth');
      const result = await authenticateUser(username, pin);
      if (result.success && result.user) {
        onLoginSuccess(result.user);
      } else {
        setError(result.error || 'Login failed.');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-900">
      <div className="w-full max-w-sm glass-panel p-8 animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 rounded-2xl bg-surface-800 mb-4">
            <User className="w-10 h-10 text-interactive-500" />
          </div>
          <h1 className="text-2xl font-bold text-interactive-600 tracking-tight">Staff Login</h1>
          <p className="text-interactive-400 text-sm mt-2 font-medium">Enter your credentials to continue</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error-500/10 border border-error-500/20 rounded-xl text-error-600 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label htmlFor="login-username" className="block text-sm font-semibold text-interactive-500 mb-2 tracking-wide">Username</label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-interactive-400 group-focus-within:text-accent-500 transition-colors" />
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && document.getElementById('login-pin')?.focus()}
                placeholder="Enter username..."
                autoFocus
                className="w-full pl-12 pr-4 py-3.5 bg-surface-950 border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring focus:ring-accent-500/40 focus:border-accent-500 transition-smooth"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-pin" className="block text-sm font-semibold text-interactive-500 mb-2 tracking-wide">PIN</label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-interactive-400 group-focus-within:text-accent-500 transition-colors" />
              <input
                id="login-pin"
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="Enter PIN..."
                className="w-full pl-12 pr-4 py-3.5 bg-surface-950 border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring focus:ring-accent-500/40 focus:border-accent-500 transition-smooth"
              />
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading || !username || !pin}
            className="w-full py-3.5 bg-interactive-600 hover:bg-interactive-500 disabled:bg-surface-700 disabled:text-surface-900 text-white font-bold rounded-xl btn-hover-fx flex items-center justify-center gap-2 mt-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
