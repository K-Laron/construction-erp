"use client";

import { useState } from 'react';
import { Lock, KeyRound, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';

interface UnlockScreenProps {
  isFirstBoot: boolean;
  onUnlockSuccess: () => void;
}

export default function UnlockScreen({ isFirstBoot, onUnlockSuccess }: UnlockScreenProps) {
  const [mode, setMode] = useState<'unlock' | 'setup' | 'recover'>(isFirstBoot ? 'setup' : 'unlock');
  const [dop, setDop] = useState('');
  const [newDop, setNewDop] = useState('');
  const [mnemonicWords, setMnemonicWords] = useState<string[]>(Array(12).fill(''));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState(false);
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string[]>([]);

  const handleUnlock = async () => {
    setError('');
    setLoading(true);
    try {
      const { unlockStore } = await import('@/app/actions/unlock');
      const result = await unlockStore(dop);
      if (result.success) {
        onUnlockSuccess();
      } else {
        setError(result.error || 'Unlock failed.');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleSetup = async () => {
    setError('');
    setLoading(true);
    try {
      // Generate 12 random mnemonic words
      const wordList = [
        'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
        'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
        'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo',
        'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
        'yankee', 'zulu', 'anchor', 'barrel', 'canyon', 'dagger',
        'falcon', 'gravel', 'harbor', 'iron', 'jasper', 'knight',
        'lantern', 'marble', 'nexus', 'opal', 'prism', 'quarry',
        'rivet', 'saber', 'timber', 'umbra', 'vertex', 'wrench'
      ];

      const words: string[] = [];
      for (let i = 0; i < 12; i++) {
        words.push(wordList[Math.floor(Math.random() * wordList.length)]);
      }

      const { bootstrapStore } = await import('@/app/actions/unlock');
      const result = await bootstrapStore(dop, words);

      if (result.success) {
        setGeneratedMnemonic(words);
        setSetupSuccess(true);
      } else {
        setError(result.error || 'Setup failed.');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleRecover = async () => {
    setError('');
    setLoading(true);
    try {
      const { recoverStore } = await import('@/app/actions/unlock');
      const result = await recoverStore(mnemonicWords, newDop);

      if (result.success) {
        onUnlockSuccess();
      } else {
        setError(result.error || 'Recovery failed.');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  if (setupSuccess) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
        <div className="w-full max-w-lg glass-panel p-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-surface-800">
              <ShieldCheck className="w-8 h-8 text-accent-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-interactive-600">Store Initialized!</h1>
              <p className="text-slate-500 text-sm">Save your recovery mnemonic now.</p>
            </div>
          </div>

          <div className="bg-warning-500/10 border border-warning-500/20 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-warning-600" />
              <span className="font-semibold text-warning-600 text-sm">CRITICAL: Write these 12 words down</span>
            </div>
            <p className="text-warning-600/80 text-xs mb-4">
              This is your Master Mnemonic Passphrase (MMP). It is the ONLY way to recover access if the Daily Operational Passphrase is lost. Store it in a secure physical location.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {generatedMnemonic.map((word, i) => (
                <div key={i} className="bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-center">
                  <span className="text-slate-400 text-xs mr-1">{i + 1}.</span>
                  <span className="text-interactive-600 font-mono font-semibold">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-slate-500 text-xs mb-4">
            Default admin account: <span className="text-interactive-600 font-mono">admin</span> / PIN: <span className="text-interactive-600 font-mono">123456</span>
          </p>

          <button
            onClick={onUnlockSuccess}
            className="w-full py-3.5 bg-interactive-600 hover:bg-interactive-500 text-white font-bold rounded-xl btn-hover-fx"
          >
            I&apos;ve Saved My Mnemonic — Enter Store
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-900">
      <div className="w-full max-w-md glass-panel p-8 animate-slide-up">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-4 rounded-2xl bg-surface-800 mb-4">
            <Lock className="w-10 h-10 text-interactive-500" />
          </div>
          <h1 className="text-2xl font-bold text-interactive-600 tracking-tight">Construction Supply ERP</h1>
          <p className="text-slate-500 text-sm mt-1">
            {mode === 'setup' ? 'First-Time Store Setup' : mode === 'recover' ? 'Disaster Recovery' : 'Daily Operational Unlock'}
          </p>
        </div>

        {/* Mode Tabs */}
        {!isFirstBoot && (
          <div className="flex gap-1 mb-6 p-1 glass-panel-dense bg-surface-950 rounded-xl border border-surface-800">
            <button
              onClick={() => { setMode('unlock'); setError(''); }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-smooth ${mode === 'unlock' ? 'bg-interactive-600 text-white shadow-md' : 'text-slate-500 hover:text-interactive-600 hover:bg-surface-800'}`}
            >
              Unlock
            </button>
            <button
              onClick={() => { setMode('recover'); setError(''); }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-smooth ${mode === 'recover' ? 'bg-warning-500 text-white shadow-md' : 'text-slate-500 hover:text-interactive-600 hover:bg-surface-800'}`}
            >
              Recovery
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-error-500/10 border border-error-500/20 rounded-xl text-error-600 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Unlock Form */}
        {mode === 'unlock' && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-interactive-500 mb-2">Daily Operational Passphrase</label>
              <div className="relative group">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-interactive-600 transition-colors" />
                <input
                  type="password"
                  value={dop}
                  onChange={e => setDop(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                  placeholder="Enter your DOP..."
                  className="w-full pl-12 pr-4 py-3.5 bg-surface-950 border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring focus:ring-interactive-500/40 focus:border-interactive-500 transition-smooth"
                />
              </div>
            </div>
            <button
              onClick={handleUnlock}
              disabled={loading || !dop}
              className="w-full py-3.5 bg-interactive-600 hover:bg-interactive-500 disabled:bg-surface-700 disabled:text-surface-900 text-white font-bold rounded-xl btn-hover-fx flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
              {loading ? 'Unlocking...' : 'Unlock Store'}
            </button>
          </div>
        )}

        {/* Setup Form */}
        {mode === 'setup' && (
          <div className="space-y-5">
            <div className="p-4 bg-accent-500/10 border border-accent-500/20 rounded-xl text-accent-700 text-sm font-medium leading-relaxed">
              Create a strong passphrase (14+ chars, mix of upper/lower/digits/symbols) to protect your store data daily.
            </div>
            <div>
              <label className="block text-sm font-semibold text-interactive-500 mb-2">Daily Operational Passphrase</label>
              <input
                type="password"
                value={dop}
                onChange={e => setDop(e.target.value)}
                placeholder="Min. 14 characters, mixed types..."
                className="w-full px-4 py-3.5 bg-surface-950 border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring transition-smooth"
              />
              <div className="mt-2.5 flex gap-1.5">
                {[/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].map((rx, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-smooth ${rx.test(dop) ? 'bg-accent-500' : 'bg-surface-800'}`} />
                ))}
              </div>
              <p className="text-slate-500 text-xs mt-2 font-medium">{dop.length}/14 characters minimum</p>
            </div>
            <button
              onClick={handleSetup}
              disabled={loading || dop.length < 14}
              className="w-full py-3.5 bg-interactive-600 hover:bg-interactive-500 disabled:bg-surface-700 disabled:text-surface-900 text-white font-bold rounded-xl btn-hover-fx flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
              {loading ? 'Initializing...' : 'Initialize Store'}
            </button>
          </div>
        )}

        {/* Recovery Form */}
        {mode === 'recover' && (
          <div className="space-y-5">
            <div className="p-4 bg-warning-500/10 border border-warning-500/20 rounded-xl text-warning-600 text-sm font-medium leading-relaxed">
              Enter your 12-word Master Mnemonic Passphrase and set a new DOP.
            </div>
            <div>
              <label className="block text-sm font-semibold text-interactive-500 mb-2">12-Word Recovery Mnemonic</label>
              <div className="grid grid-cols-3 gap-2.5">
                {mnemonicWords.map((word, i) => (
                  <input
                    key={i}
                    type="text"
                    value={word}
                    onChange={e => {
                      const updated = [...mnemonicWords];
                      updated[i] = e.target.value.toLowerCase().trim();
                      setMnemonicWords(updated);
                    }}
                    placeholder={`${i + 1}.`}
                    className="px-2 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-interactive-600 text-sm text-center placeholder-slate-400 focus-ring transition-smooth"
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-interactive-500 mb-2">New Daily Operational Passphrase</label>
              <input
                type="password"
                value={newDop}
                onChange={e => setNewDop(e.target.value)}
                placeholder="Min. 14 characters..."
                className="w-full px-4 py-3.5 bg-surface-950 border border-surface-800 rounded-xl text-interactive-600 placeholder-slate-400 focus-ring transition-smooth"
              />
            </div>
            <button
              onClick={handleRecover}
              disabled={loading || newDop.length < 14 || mnemonicWords.some(w => !w)}
              className="w-full py-3.5 bg-warning-500 hover:bg-warning-400 disabled:bg-surface-700 disabled:text-surface-900 text-white font-bold rounded-xl btn-hover-fx flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
              {loading ? 'Recovering...' : 'Recover & Reset DOP'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
