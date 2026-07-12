"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error: " + error, errorInfo);
  }

  public reset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center h-full">
          <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
          </div>
          
          <h2 className="text-xl font-bold text-white mb-2">Component Error</h2>
          <p className="text-interactive-400 mb-6 text-sm max-w-md">
            Something went wrong while loading this view.
            {this.state.error?.message && (
              <span className="block mt-2 font-mono text-xs text-rose-400/80 bg-rose-950/30 p-2 rounded break-words">
                {this.state.error.message}
              </span>
            )}
          </p>

          <button
            onClick={this.reset}
            className="py-2 px-6 bg-interactive-600 hover:bg-interactive-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all btn-hover-fx"
          >
            <RefreshCw className="w-4 h-4" />
            Reload View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
