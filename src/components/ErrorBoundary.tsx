import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary so a single thrown error in any page doesn't
 * blank the entire app. Renders a recoverable fallback with the original
 * stack in development.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Log full info so it shows up in the runtime logs.
    console.error('[error-boundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen grid place-items-center bg-background text-foreground p-6">
        <div className="max-w-lg w-full panel p-6 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Something went wrong</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. You can try recovering, or
            refresh the browser if the problem persists.
          </p>
          {import.meta.env.DEV && this.state.error.message && (
            <pre className="text-xs font-mono bg-surface-2 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-48">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          )}
          <div className="flex gap-2">
            <Button onClick={this.reset} variant="default">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Try again
            </Button>
            <Button onClick={() => window.location.reload()} variant="outline">
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
