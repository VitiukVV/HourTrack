import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorScreen } from './ErrorScreen';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * S29 Task 10 (UR-29-5) — top-level React error boundary. Catches render-time
 * exceptions anywhere below it and swaps in the localized `ErrorScreen` instead
 * of letting React unmount the whole tree to a blank page (fatal in the
 * installed PWA, which has no browser chrome to reload from).
 *
 * No telemetry — HourTrack has no backend; we only log to the console for
 * local debugging.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorScreen />;
    }
    return this.props.children;
  }
}
