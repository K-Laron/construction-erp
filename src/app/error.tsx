"use client";
import { logger } from "@/lib/logger";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    logger.error("Unhandled Global Error: " + error.message, error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-surface-900 border border-rose-500/30 rounded-3xl p-8 text-center shadow-2xl shadow-rose-900/20">
        <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-rose-500" />
        </div>
        
        <h2 className="text-2xl font-bold text-interactive-500 mb-2">Something went wrong!</h2>
        <p className="text-interactive-400 mb-6 text-sm">
          A critical error occurred while rendering the application. 
          {error.message && (
            <span className="block mt-2 font-mono text-xs text-rose-400/80 bg-rose-950/30 p-2 rounded">
              {error.message}
            </span>
          )}
        </p>

        <button
          onClick={() => reset()}
          className="w-full py-3 bg-interactive-600 hover:bg-interactive-500 text-interactive-500 font-bold rounded-xl flex items-center justify-center gap-2 transition-all btn-hover-fx"
        >
          <RefreshCw className="w-5 h-5" />
          Try Again
        </button>
      </div>
    </div>
  );
}
