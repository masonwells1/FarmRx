import { Component, type ErrorInfo, type ReactNode } from "react";

type LazyRouteErrorBoundaryProps = { children: ReactNode };
type LazyRouteErrorBoundaryState = { failed: boolean };

export class LazyRouteErrorBoundary extends Component<LazyRouteErrorBoundaryProps, LazyRouteErrorBoundaryState> {
  state: LazyRouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyRouteErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Farm Rx could not open a lazy route.", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty-page">
        <div className="empty-state" role="alert" aria-labelledby="page-recovery-title">
          <h1 id="page-recovery-title">This page could not open.</h1>
          <p>Your saved work is still safe. Check your signal, then try again.</p>
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </section>
    );
  }
}
