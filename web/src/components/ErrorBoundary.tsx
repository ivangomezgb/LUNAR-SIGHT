import { t, sourceText } from '../i18n';
import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error)
      return (
        <div className="status status-error" role="alert">
          <div className="status-title">{t("Something went wrong while rendering this view")}</div>
          <div className="mono status-detail">{sourceText(this.state.error.message)}</div>
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}> {t("Try again")} </button>
        </div>
      );
    return this.props.children;
  }
}
