'use client';

import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle size={24} className="text-destructive" aria-hidden="true" />
          </div>
          <div className="text-lg font-semibold text-foreground mb-1">Something went wrong</div>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred'}
          </p>
          <div className="flex items-center gap-3 mb-4">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Try again
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-muted text-foreground border border-border rounded-md hover:bg-accent transition-colors cursor-pointer"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Reload page
            </button>
          </div>
          {this.state.error && (
            <details className="mt-2 text-left w-full max-w-lg">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                Error details
              </summary>
              <pre className="mt-2 p-3 bg-muted rounded-md text-[11px] text-muted-foreground overflow-auto max-h-[200px] font-mono">
                {this.state.error.name}: {this.state.error.message}
                {this.state.errorInfo?.componentStack && (
                  <>
                    {'\n\nComponent Stack:'}
                    {this.state.errorInfo.componentStack}
                  </>
                )}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
