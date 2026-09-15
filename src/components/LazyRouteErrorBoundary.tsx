import { Component, type ErrorInfo, type ReactNode } from "react";

/** `className` frames the retry screen where the failed content would have stood (a sheet above the phone bar, say); the default
 * is the full-page frame the route content uses. */
type LazyRouteErrorBoundaryProps = { children: ReactNode; className?: string };
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
      <section className={this.props.className ?? "empty-page"}>
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
