import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { initials } from '../lib/format';

/* --------------------------------- Card -------------------------------- */

export function Card({
  children,
  className = '',
  onClick,
  glass = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  glass?: boolean;
  style?: React.CSSProperties;
}) {
  const base = glass ? 'glass' : 'card';
  return (
    <div
      className={`${base} ${onClick ? 'tappable' : ''} ${className}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="row-between section-title" style={{ marginBottom: 10 }}>
      <span>{children}</span>
      {action}
    </div>
  );
}

/* -------------------------------- Pill --------------------------------- */

export function Pill({
  children,
  tone = '',
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`pill ${tone}`}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'completed' || status === 'ready' || status === 'available' || status === 'verified'
      ? 'green'
      : status === 'in_progress' || status === 'running' || status === 'ready'
        ? 'blue'
        : status === 'waiting_approval' || status === 'needs_review' || status === 'pending_verification'
          ? 'amber'
          : status === 'failed' || status === 'error' || status === 'missing' || status === 'expired'
            ? 'red'
            : status === 'disconnected' || status === 'stopped' || status === 'cancelled'
              ? ''
              : '';
  return (
    <Pill tone={tone} dot>
      {status.replace(/_/g, ' ')}
    </Pill>
  );
}

/* ------------------------------- Avatar -------------------------------- */

export function Avatar({
  name,
  color = '#0a84ff',
  size = 42,
}: {
  name?: string | null;
  color?: string;
  size?: number;
}) {
  return (
    <div
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.38, borderRadius: size * 0.31 }}
    >
      {initials(name)}
    </div>
  );
}

/* -------------------------------- Field -------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="switch"
      data-on={checked}
      aria-label={label ?? 'toggle'}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

/* -------------------------------- Sheet -------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="row-between mb">
          <h3 style={{ fontSize: 18 }}>{title}</h3>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ EmptyState ----------------------------- */

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ maxWidth: 420, margin: '0 auto' }}>{hint}</div>}
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 26, color: 'var(--ink-3)' }}>
      <span className="spinner" />
      <span className="small">{label}</span>
    </div>
  );
}

/* -------------------------------- Toast -------------------------------- */

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

const ToastContext = createContext<{ push: (message: string, tone?: 'info' | 'error') => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
