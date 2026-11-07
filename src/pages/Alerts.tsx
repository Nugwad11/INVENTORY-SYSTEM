import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  ArrowUpRight,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, PageHeader, SEVERITY_TONE, Stat, StatusBadge, Tabs } from '../components/ui';
import { can, ROLE_LABELS } from '../domain/permissions';
import { ALERT_TYPE_LABELS } from '../domain/inventory';
import { dateTime, money, relative } from '../lib/format';
import type { Alert, Role } from '../types';

type Tab = 'active' | 'resolved' | 'all';

export default function Alerts() {
  const { state, currentUser, alerts, activeAlerts, actions } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('active');
  const [severity, setSeverity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [snoozeHours, setSnoozeHours] = useState(24);
  const [assignRole, setAssignRole] = useState<Role>('manager');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return alerts
      .filter((alert) => {
        if (tab === 'active' && alert.state === 'RESOLVED') return false;
        if (tab === 'resolved' && alert.state !== 'RESOLVED') return false;
        if (severity !== 'ALL' && alert.severity !== severity) return false;
        if (type !== 'ALL' && alert.type !== type) return false;
        if (!term) return true;
        return `${alert.title} ${alert.detail}`.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return rank[a.severity] - rank[b.severity] || b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [alerts, tab, severity, type, search]);

  const selected = selectedId ? alerts.find((alert) => alert.id === selectedId) ?? null : null;
  const openCount = activeAlerts.filter((a) => a.state === 'OPEN').length;
  const criticalCount = activeAlerts.filter((a) => a.severity === 'CRITICAL').length;
  const resolvedCount = alerts.filter((a) => a.state === 'RESOLVED').length;

  const productName = (alert: Alert) => (alert.productId ? state.products.find((p) => p.id === alert.productId)?.name : null);

  const act = (action: 'acknowledge' | 'snooze' | 'resolve' | 'reopen' | 'assign') => {
    if (!selected) return;
    actions.markAlertAction(selected.id, action, action === 'assign' ? assignRole : note, snoozeHours);
    if (action !== 'assign') setNote('');
  };

  const openDeepLink = (alert: Alert) => {
    if (alert.type === 'LARGE_VARIANCE') navigate('/counts');
    else if (alert.type === 'SYNC_FAILURE') navigate('/admin');
    else if (alert.productId) navigate('/inventory');
    else navigate('/reports');
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Work management"
        title="Alerts and exceptions"
        subtitle="One active occurrence per condition. Repeated evaluation updates the same alert instead of notifying every cycle."
        actions={
          <div className="flex gap-8">
            <Badge tone={criticalCount ? 'red' : 'green'} dot>{criticalCount} critical</Badge>
            <Badge tone="amber" dot>{openCount} unacknowledged</Badge>
          </div>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Active alerts" value={activeAlerts.length} icon={<Bell size={15} />} tone={activeAlerts.length ? 'warning' : undefined} meta="Open, acknowledged or snoozed" />
        <Stat label="Critical" value={criticalCount} icon={<BellRing size={15} />} tone={criticalCount ? 'danger' : undefined} meta="Stock-out, negative, expired or sync critical" />
        <Stat label="Unacknowledged" value={openCount} icon={<Clock size={15} />} meta="No owner action yet" />
        <Stat label="Resolved" value={resolvedCount} icon={<CheckCircle2 size={15} />} meta="Condition cleared or dismissed" />
      </div>

      <Tabs
        tabs={[
          { id: 'active', label: 'Active queue', count: activeAlerts.length },
          { id: 'resolved', label: 'Resolved', count: resolvedCount },
          { id: 'all', label: 'All alerts', count: alerts.length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      <Card
        title="Alert queue"
        subtitle="Severity is never conveyed by colour alone; every row carries a text label and age."
        flush
      >
        <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ flex: '1 1 220px' }}>
            <Bell />
            <input className="input" placeholder="Search alert title or detail" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search alerts" />
          </div>
          <select className="select" style={{ width: 160 }} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter severity">
            <option value="ALL">All severities</option>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="select" style={{ width: 190 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter alert type">
            <option value="ALL">All alert types</option>
            {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={tab === 'resolved' ? 'No resolved alerts' : 'Work queue is clear'}
            description={tab === 'resolved' ? 'Alerts move here when their condition clears or someone resolves them.' : 'No stock, expiry, variance or sync exception needs action.'}
            icon={<CheckCircle2 size={20} />}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Alert</th>
                  <th>Type</th>
                  <th className="right">Value</th>
                  <th>Owner</th>
                  <th>Age</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((alert) => (
                  <tr key={alert.id} className="is-clickable" onClick={() => { setSelectedId(alert.id); setNote(''); }}>
                    <td><StatusBadge status={alert.severity} kind="severity" /></td>
                    <td>
                      <div className="cell-primary">{alert.title}</div>
                      <div className="cell-sub">{productName(alert) ?? alert.detail}</div>
                    </td>
                    <td>{ALERT_TYPE_LABELS[alert.type]}</td>
                    <td className="right amount">{alert.value > 0 ? money(alert.value) : '—'}</td>
                    <td>{ROLE_LABELS[alert.ownerRole]}</td>
                    <td className="nowrap">{relative(alert.detectedAt)}</td>
                    <td><StatusBadge status={alert.state} kind="alert" /></td>
                    <td className="right"><ArrowUpRight size={15} className="muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.title ?? 'Alert'}
        subtitle={selected ? `${ALERT_TYPE_LABELS[selected.type]} · detected ${relative(selected.detectedAt)}` : undefined}
        wide
        footer={
          selected ? (
            <>
              {selected.state === 'RESOLVED' ? (
                <button className="btn" onClick={() => act('reopen')}><RotateCcw size={15} /> Reopen occurrence</button>
              ) : (
                <>
                  {selected.state === 'OPEN' && <button className="btn" onClick={() => act('acknowledge')}>Acknowledge</button>}
                  <button className="btn" onClick={() => act('snooze')}><AlarmClock size={15} /> Snooze {snoozeHours}h</button>
                  <button className="btn btn--primary" onClick={() => act('resolve')}><CheckCircle2 size={15} /> Resolve with note</button>
                </>
              )}
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="flex gap-8 flex-wrap">
              <Badge tone={SEVERITY_TONE[selected.severity]} dot>{selected.severity}</Badge>
              <StatusBadge status={selected.state} kind="alert" />
              <Badge tone="outline">{ALERT_TYPE_LABELS[selected.type]}</Badge>
              {selected.snoozedUntil && <Badge tone="blue">Snoozed until {dateTime(selected.snoozedUntil)}</Badge>}
            </div>

            <div className="banner" style={{ alignItems: 'flex-start' }}>
              <BellRing />
              <div>{selected.detail}</div>
            </div>

            <div className="stat-strip">
              <div><div className="label">Exposure</div><div className="value">{selected.value > 0 ? money(selected.value) : '—'}</div></div>
              <div><div className="label">Owner role</div><div className="value" style={{ fontSize: '0.85rem' }}>{ROLE_LABELS[selected.ownerRole]}</div></div>
              <div><div className="label">Detected</div><div className="value" style={{ fontSize: '0.8rem' }}>{dateTime(selected.detectedAt)}</div></div>
              <div><div className="label">Updated</div><div className="value" style={{ fontSize: '0.8rem' }}>{relative(selected.updatedAt)}</div></div>
            </div>

            {can(currentUser, 'alert.manage') && (
              <div className="form-grid">
                <div className="field">
                  <label>Action note</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was checked or decided?" />
                </div>
                <div className="field">
                  <label>Snooze duration</label>
                  <select className="select" value={snoozeHours} onChange={(e) => setSnoozeHours(Number(e.target.value))}>
                    <option value={1}>1 hour</option>
                    <option value={8}>8 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                  </select>
                </div>
                <div className="field">
                  <label>Assign owner role</label>
                  <div className="input-group">
                    <select className="select" value={assignRole} onChange={(e) => setAssignRole(e.target.value as Role)}>
                      {(Object.keys(ROLE_LABELS) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                    </select>
                    <button className="btn" onClick={() => act('assign')}><ShieldCheck size={14} /> Assign</button>
                  </div>
                </div>
                <div className="field">
                  <label>Linked record</label>
                  <button className="btn" onClick={() => openDeepLink(selected)}>
                    <ArrowUpRight size={14} /> {selected.type === 'LARGE_VARIANCE' ? 'Open count workspace' : selected.type === 'SYNC_FAILURE' ? 'Open integration health' : 'Open stock record'}
                  </button>
                </div>
              </div>
            )}

            <div>
              <div className="eyebrow mb-8">Occurrence history</div>
              {[...selected.history].reverse().map((entry) => (
                <div className="list-row" key={entry.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">{entry.action} · {entry.actorName}</div>
                    <div className="list-row__meta">{dateTime(entry.at)}{entry.note ? ` · ${entry.note}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
