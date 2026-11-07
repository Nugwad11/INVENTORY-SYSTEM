import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page">
        <div className="no-access card">
          <div className="empty">
            <div className="empty__icon">
              <AlertTriangle size={24} />
            </div>
            <h2>Something went wrong</h2>
            <p className="mt-8">
              This screen could not be rendered. Data already saved in this browser has not been changed.
            </p>
            <button
              className="btn btn--primary mt-16"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
