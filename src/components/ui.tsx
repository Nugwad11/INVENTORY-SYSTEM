import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Inbox, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initials, titleCase } from '../lib/format';

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'dark' | 'outline';

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const PO_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'amber',
  APPROVED: 'blue',
  SENT: 'purple',
  PART_RECEIVED: 'blue',
  RECEIVED: 'green',
  CLOSED: 'neutral',
  CANCELLED: 'red',
};

const RECEIPT_TONE: Record<string, Tone> = {
  DRAFT: 'amber',
  CONFIRMED: 'green',
  REVERSED: 'red',
};

const COUNT_TONE: Record<string, Tone> = {
  OPEN: 'blue',
  SUBMITTED: 'amber',
  RECOUNT_REQUIRED: 'red',
  PENDING_APPROVAL: 'amber',
  POSTED: 'green',
  CANCELLED: 'neutral',
};

const SALE_TONE: Record<string, Tone> = {
  COMPLETED: 'green',
  VOIDED: 'red',
  PARTIAL_RETURN: 'amber',
  RETURNED: 'purple',
};

const ALERT_STATE_TONE: Record<string, Tone> = {
  OPEN: 'red',
  ACKNOWLEDGED: 'amber',
  SNOOZED: 'blue',
  RESOLVED: 'green',
};

export const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: 'red',
  HIGH: 'amber',
  MEDIUM: 'blue',
  LOW: 'neutral',
};

export function StatusBadge({ status, kind }: { status: string; kind: 'po' | 'receipt' | 'count' | 'sale' | 'alert' | 'sync' | 'severity' | 'generic' }) {
  const maps: Record<string, Record<string, Tone>> = {
    po: PO_TONE,
    receipt: RECEIPT_TONE,
    count: COUNT_TONE,
    sale: SALE_TONE,
    alert: ALERT_STATE_TONE,
    severity: SEVERITY_TONE,
    sync: { SYNCED: 'green', PENDING: 'amber' },
    generic: {},
  };
  const tone = maps[kind][status] ?? 'neutral';
  return (
    <Badge tone={tone} dot>
      {titleCase(status)}
    </Badge>
  );
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  return <span className={`avatar ${size === 'lg' ? 'lg' : ''}`}>{initials(name)}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow mb-8">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-head__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  flush,
  footer,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="card__title-sub">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? 'card__body--flush' : 'card__body'}>{children}</div>
      {footer && <div className="card__foot">{footer}</div>}
    </section>
  );
}

export function Stat({
  label,
  value,
  meta,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className={`stat ${tone === 'warning' ? 'stat--warning' : tone === 'danger' ? 'stat--danger' : ''}`}>
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        {icon && <span className="stat__icon">{icon}</span>}
      </div>
      <div className="stat__value">{value}</div>
      {meta && <div className="stat__meta">{meta}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'wide' | 'xl';
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = original;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${size === 'wide' ? 'modal--wide' : size === 'xl' ? 'modal--xl' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="modal__sub">{subtitle}</div>}
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? 'drawer--wide' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="modal__sub">{subtitle}</div>}
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${tab.id === value ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
          role="tab"
          aria-selected={tab.id === value}
        >
          {tab.label}
          {tab.count !== undefined && <span className="count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <Inbox size={20} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex-between mb-12">
      <span className="eyebrow">{children}</span>
      {action}
    </div>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button className="btn btn--ghost btn--sm" onClick={() => navigate(to)}>
      <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> {label}
    </button>
  );
}

export function roleLabel(role: string): string {
  return titleCase(role);
}
