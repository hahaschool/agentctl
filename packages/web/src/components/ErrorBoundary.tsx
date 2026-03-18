'use client';

import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const errorMessage = this.state.error?.message?.trim() || 'An unexpected error occurred';

      return (
        <div className="flex min-h-[50vh] items-center justify-center p-6 animate-fade-in">
          <Card className="w-full max-w-2xl gap-4 border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-xl">
            <CardHeader className="border-b border-zinc-800/80 pb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15">
                  <AlertTriangle size={20} className="text-red-300" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-zinc-50">Something went wrong</CardTitle>
                  <CardDescription className="text-zinc-400">
                    A page component crashed during render.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-200">
                {errorMessage}
              </div>
              {this.state.error && (
                <details className="text-left">
                  <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 transition-colors">
                    Error details
                  </summary>
                  <pre className="mt-2 overflow-auto max-h-[220px] rounded-md border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-300 font-mono">
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
            </CardContent>
            <CardFooter className="flex flex-wrap gap-3 border-t border-zinc-800/80 pt-4">
              <Button
                type="button"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Try again
              </Button>
              <Button
                type="button"
                className="bg-blue-500 text-white hover:bg-blue-400"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Reload Page
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Link href="/">Go to Dashboard</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
