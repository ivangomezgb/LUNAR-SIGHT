import { t, sourceText } from '../i18n';
import type { ReactNode } from 'react';

export function Loading({ label = t("Loading data…") }: { label?: string }) {
  return (
    <div className="status status-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ title = t("Could not load data"), error, children }: { title?: string; error?: Error | null; children?: ReactNode }) {
  return (
    <div className="status status-error" role="alert">
      <div className="status-title">{title}</div>
      {error && <div className="mono status-detail">{sourceText(error.message)}</div>}
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="status status-empty">
      <div className="status-title">{title}</div>
      {children}
    </div>
  );
}
