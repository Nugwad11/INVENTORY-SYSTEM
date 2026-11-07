import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  Download,
  Lock,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  Smartphone,
  Upload,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import {
  Avatar,
  Badge,
  Card,
  Drawer,
  EmptyState,
  Modal,
  PageHeader,
  Stat,
  Tabs,
  type Tone,
} from '../components/ui';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  can,
  permissionsFor,
  type Permission,
} from '../domain/permissions';
import { verifyAuditChain } from '../domain/audit';
import type { AuditEvent, Movement, Role, Settings } from '../types';
import { dateTime, downloadCsv, money, relative, titleCase, todayKey } from '../lib/format';

type Tab = 'people' | 'policies' | 'audit' | 'devices' | 'data';

const ROLES: Role[] = ['owner', 'manager', 'purchasing', 'receiving', 'stock', 'cashier', 'auditor'];

const ROLE_SHORT: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  purchasing: 'Purchasing',
  receiving: 'Receiving',
  stock: 'Stock',
  cashier: 'Cashier',
  auditor: 'Auditor',
};

const ROLE_TONE: Record<Role, Tone> = {
  owner: 'dark',
  manager: 'green',
  purchasing: 'blue',
  receiving: 'purple',
  stock: 'amber',
  cashier: 'neutral',
  auditor: 'outline',
};

const PERMISSION_LABELS: Record<Permission, string> = {
  'catalog.view': 'View catalogue',
  'catalog.manage': 'Manage catalogue',
  'catalog.cost.view': 'See product cost',
  'supplier.manage': 'Manage suppliers',
  'po.create': 'Create purchase orders',
  'po.submit': 'Submit purchase orders',
  'po.approve': 'Approve purchase orders',
  'po.send': 'Send purchase orders',
  'receipt.view': 'View receipts',
  'receipt.manage': 'Receive goods',
  'stock.view': 'View stock',
  'stock.adjust': 'Adjust stock',
  'stock.transfer': 'Transfer stock',
  'stock.status': 'Change stock status',
  'stock.cost.view': 'See stock value',
  'count.view': 'View counts',
  'count.create': 'Create counts',
  'count.count': 'Perform counts',
  'count.approve': 'Approve counts',
  'sale.view': 'View sales',
  'sale.create': 'Record sales',
  'sale.void': 'Void sales',
  'sale.return': 'Record returns',
  'writeoff.create': 'Request write-offs',
  'writeoff.approve': 'Approve write-offs',
  'alert.view': 'View alerts',
  'alert.manage': 'Manage alerts',
  'report.view': 'View reports',
  'report.export': 'Export reports',
  'admin.users': 'Manage people',
  'admin.settings': 'Change policies',
  'admin.audit': 'Read audit trail',
  'admin.data': 'Backup and reset data',
};

const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  {
    title: 'Catalogue and suppliers',
    permissions: ['catalog.view', 'catalog.manage', 'catalog.cost.view', 'supplier.manage'],
  },
  {
    title: 'Purchasing',
    permissions: ['po.create', 'po.submit', 'po.approve', 'po.send'],
  },
  {
    title: 'Receiving',
    permissions: ['receipt.view', 'receipt.manage'],
  },
  {
    title: 'Stock',
    permissions: ['stock.view', 'stock.adjust', 'stock.transfer', 'stock.status', 'stock.cost.view'],
  },
  {
    title: 'Counts',
    permissions: ['count.view', 'count.create', 'count.count', 'count.approve'],
  },
  {
    title: 'Sales',
    permissions: ['sale.view', 'sale.create', 'sale.void', 'sale.return'],
  },
  {
    title: 'Write-offs',
    permissions: ['writeoff.create', 'writeoff.approve'],
  },
  {
    title: 'Alerts and reports',
    permissions: ['alert.view', 'alert.manage', 'report.view', 'report.export'],
  },
  {
    title: 'Administration',
    permissions: ['admin.users', 'admin.settings', 'admin.audit', 'admin.data'],
  },
];

interface PolicyForm {
  approvalLimitManager: string;
  approvalLimitOwner: string;
  countVarianceThreshold: string;
  receiptTolerancePct: string;
  lowStockWindowDays: string;
  expiryWarningDays: string;
  autoLockDays: string;
  negativeStockAllowed: boolean;
  largeText: boolean;
  compactMode: boolean;
}

function policyFormFrom(settings: Settings): PolicyForm {
  return {
    approvalLimitManager: String(settings.approvalLimitManager / 100),
    approvalLimitOwner: String(settings.approvalLimitOwner / 100),
    countVarianceThreshold: String(settings.countVarianceThreshold / 100),
    receiptTolerancePct: String(settings.receiptTolerancePct),
    lowStockWindowDays: String(settings.lowStockWindowDays),
    expiryWarningDays: String(settings.expiryWarningDays),
    autoLockDays: String(settings.autoLockDays),
    negativeStockAllowed: settings.negativeStockAllowed,
    largeText: settings.largeText,
    compactMode: settings.compactMode,
  };
}

const REF_TYPE_LABEL: Record<Movement['refType'], string> = {
  SALE: 'Sale',
  RECEIPT: 'Receipt',
  TRANSFER: 'Transfer',
  COUNT: 'Count',
  WRITE_OFF: 'Write-off',
  ADJUSTMENT: 'Adjustment',
  OPENING: 'Opening balance',
  SYSTEM: 'System',
};

function prettyJson(value: string | null): string {
  if (!value) return '—';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

export default function Admin() {
  const { state, currentUser, pendingSyncCount, online, simulateOffline, setSimulateOffline, actions } = useApp();

  const canUsers = can(currentUser, 'admin.users');
  const canSettings = can(currentUser, 'admin.settings');
  const canAudit = can(currentUser, 'admin.audit');
  const canData = can(currentUser, 'admin.data');
  const canDevices = canSettings || canData;

  const [tab, setTab] = useState<Tab>('people');

  const availableTabs = useMemo(() => {
    const tabs: { id: Tab; label: string; allowed: boolean; count?: number }[] = [
      { id: 'people', label: 'People', allowed: canUsers, count: state.users.length },
      { id: 'policies', label: 'Policies', allowed: canSettings },
      { id: 'audit', label: 'Audit trail', allowed: canAudit, count: state.audit.length },
      { id: 'devices', label: 'Devices & sync', allowed: canDevices, count: pendingSyncCount },
      { id: 'data', label: 'Data', allowed: canData },
    ];
    return tabs.filter((item) => item.allowed);
  }, [canUsers, canSettings, canAudit, canDevices, canData, state.users.length, state.audit.length, pendingSyncCount]);

  const activeTab = availableTabs.some((item) => item.id === tab) ? tab : availableTabs[0]?.id ?? 'people';

  // ---------- People ----------
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', role: 'cashier' as Role, phone: '' });

  const peopleStats = useMemo(() => {
    const active = state.users.filter((user) => user.active);
    return {
      total: state.users.length,
      active: active.length,
      disabled: state.users.length - active.length,
      roles: new Set(active.map((user) => user.role)).size,
    };
  }, [state.users]);

  const submitInvite = () => {
    if (actions.addUser(invite)) {
      setInviteOpen(false);
      setInvite({ name: '', role: 'cashier', phone: '' });
    }
  };

  // ---------- Policies ----------
  const [policyForm, setPolicyForm] = useState<PolicyForm>(() => policyFormFrom(state.settings));
  const settingsKey = JSON.stringify(state.settings);
  useEffect(() => {
    setPolicyForm(policyFormFrom(state.settings));
    // Reset the draft only when the persisted settings actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const patchPolicy = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setPolicyForm((prev) => ({ ...prev, [key]: value }));

  const savePolicies = () => {
    const numeric = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));
    const managerLimit = numeric(policyForm.approvalLimitManager);
    const ownerLimit = numeric(policyForm.approvalLimitOwner);
    const variance = numeric(policyForm.countVarianceThreshold);
    const tolerance = numeric(policyForm.receiptTolerancePct);
    const lowStock = numeric(policyForm.lowStockWindowDays);
    const expiry = numeric(policyForm.expiryWarningDays);
    const autoLock = numeric(policyForm.autoLockDays);

    if ([managerLimit, ownerLimit, variance, tolerance, lowStock, expiry, autoLock].some((n) => !Number.isFinite(n) || n < 0)) {
      actions.toast('Every policy value must be a number of zero or more.', 'error');
      return;
    }
    if (ownerLimit < managerLimit) {
      actions.toast('The owner limit must be at least the manager limit.', 'error');
      return;
    }
    if (tolerance > 100) {
      actions.toast('Receiving tolerance cannot exceed 100%.', 'error');
      return;
    }
    if (lowStock < 1 || autoLock < 1) {
      actions.toast('The demand window and auto-lock period must be at least one day.', 'error');
      return;
    }

    actions.updateSettings({
      approvalLimitManager: Math.round(managerLimit * 100),
      approvalLimitOwner: Math.round(ownerLimit * 100),
      countVarianceThreshold: Math.round(variance * 100),
      receiptTolerancePct: tolerance,
      lowStockWindowDays: Math.round(lowStock),
      expiryWarningDays: Math.round(expiry),
      autoLockDays: Math.round(autoLock),
      negativeStockAllowed: policyForm.negativeStockAllowed,
      largeText: policyForm.largeText,
      compactMode: policyForm.compactMode,
    });
  };

  const approvalPreview = useMemo(() => {
    const manager = Number(policyForm.approvalLimitManager);
    const owner = Number(policyForm.approvalLimitOwner);
    return {
      manager: Number.isFinite(manager) ? Math.max(0, manager) * 100 : 0,
      owner: Number.isFinite(owner) ? Math.max(0, owner) * 100 : 0,
    };
  }, [policyForm.approvalLimitManager, policyForm.approvalLimitOwner]);

  // ---------- Audit ----------
  const [auditSearch, setAuditSearch] = useState('');
  const [auditEntity, setAuditEntity] = useState('ALL');
  const [auditLimit, setAuditLimit] = useState(80);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  const verification = useMemo(() => verifyAuditChain(state.audit), [state.audit]);
  const auditEntities = useMemo(
    () => [...new Set(state.audit.map((event) => event.entityType))].sort(),
    [state.audit],
  );
  const filteredAudit = useMemo(() => {
    const term = auditSearch.trim().toLowerCase();
    return [...state.audit]
      .reverse()
      .filter((event) => {
        if (auditEntity !== 'ALL' && event.entityType !== auditEntity) return false;
        if (!term) return true;
        return `${event.actorName} ${event.action} ${event.entityId} ${event.summary}`
          .toLowerCase()
          .includes(term);
      });
  }, [state.audit, auditSearch, auditEntity]);

  const verifyNow = () => {
    setVerifiedAt(new Date().toISOString());
    actions.toast(
      verification.valid
        ? `Chain intact across ${verification.checked} event(s).`
        : `Chain break detected at ${verification.firstBrokenId ?? 'an unknown event'}.`,
      verification.valid ? 'success' : 'error',
    );
  };

  const exportAudit = () => {
    downloadCsv(`storehouse-audit-${todayKey()}.csv`, [
      ['Event ID', 'Recorded at', 'Actor', 'Action', 'Entity type', 'Entity ID', 'Summary', 'Reason', 'Previous hash', 'Hash'],
      ...filteredAudit.map((event) => [
        event.id,
        event.at,
        event.actorName,
        event.action,
        event.entityType,
        event.entityId,
        event.summary,
        event.reason ?? '',
        event.prevHash,
        event.hash,
      ]),
    ]);
    actions.toast(`Exported ${filteredAudit.length} audit event(s).`);
  };

  // ---------- Devices ----------
  const queuedDocs = useMemo(() => {
    const rows: { key: string; number: string; type: string; at: string; detail: string }[] = [];
    const seen = new Set<string>();

    state.sales.forEach((sale) => {
      if (sale.sync !== 'PENDING') return;
      seen.add(sale.id);
      rows.push({
        key: sale.id,
        number: sale.number,
        type: 'Sale',
        at: sale.occurredAt,
        detail: `${sale.lines.length} line(s) · ${money(sale.total)}`,
      });
    });

    state.receipts.forEach((receipt) => {
      if (receipt.sync !== 'PENDING') return;
      seen.add(receipt.id);
      rows.push({
        key: receipt.id,
        number: receipt.number,
        type: 'Receipt',
        at: receipt.confirmedAt ?? receipt.createdAt,
        detail: receipt.status,
      });
    });

    const groups = new Map<string, Movement[]>();
    state.movements.forEach((movement) => {
      if (movement.sync !== 'PENDING') return;
      const list = groups.get(movement.transactionId) ?? [];
      list.push(movement);
      groups.set(movement.transactionId, list);
    });

    groups.forEach((movements, transactionId) => {
      if (seen.has(transactionId)) return;
      const first = movements[0];
      let number = REF_TYPE_LABEL[first.refType];
      if (first.refType === 'SALE') {
        number = state.sales.find((sale) => sale.id === first.refId)?.number ?? number;
      } else if (first.refType === 'RECEIPT') {
        number = state.receipts.find((receipt) => receipt.id === first.refId)?.number ?? number;
      } else if (first.refType === 'TRANSFER') {
        number = state.transfers.find((transfer) => transfer.id === first.refId)?.number ?? number;
      } else if (first.refType === 'COUNT') {
        number = state.counts.find((count) => count.id === first.refId)?.number ?? number;
      } else if (first.refType === 'WRITE_OFF') {
        number = state.writeOffs.find((writeOff) => writeOff.id === first.refId)?.number ?? number;
      }
      rows.push({
        key: transactionId,
        number,
        type: REF_TYPE_LABEL[first.refType],
        at: first.occurredAt,
        detail: `${movements.length} movement(s)`,
      });
    });

    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [state.sales, state.receipts, state.movements, state.transfers, state.counts, state.writeOffs]);

  // ---------- Data ----------
  const fileInput = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');

  const datasetBytes = useMemo(() => new Blob([JSON.stringify(state)]).size, [state]);

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `storehouse-backup-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    actions.toast('Backup downloaded.');
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    actions.importState(text);
    if (fileInput.current) fileInput.current.value = '';
  };

  const pageActions = (() => {
    if (activeTab === 'people' && canUsers) {
      return (
        <button className="btn btn--primary" onClick={() => setInviteOpen(true)}>
          <UserPlus size={16} /> Invite a user
        </button>
      );
    }
    if (activeTab === 'audit') {
      return (
        <>
          <button className="btn" onClick={verifyNow}>
            <ShieldCheck size={16} /> Verify chain
          </button>
          <button className="btn" onClick={exportAudit}>
            <Download size={16} /> Export
          </button>
        </>
      );
    }
    if (activeTab === 'devices' && online && pendingSyncCount > 0) {
      return (
        <button className="btn btn--primary" onClick={actions.syncNow}>
          <RefreshCw size={16} /> Sync now
        </button>
      );
    }
    return undefined;
  })();

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${state.store.name} · ${state.store.code}`}
        title="Administration"
        subtitle="People, policies, evidence and device data. Every administrative change is written to the audit chain."
        actions={pageActions}
      />

      <Tabs
        tabs={availableTabs.map((item) => ({ id: item.id, label: item.label, count: item.count }))}
        value={activeTab}
        onChange={(id) => setTab(id as Tab)}
      />

      {activeTab === 'people' && canUsers && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="People" value={peopleStats.total} icon={<Users size={15} />} meta={`${peopleStats.active} active account(s)`} />
            <Stat label="Roles in use" value={`${peopleStats.roles} / ${ROLES.length}`} icon={<ShieldCheck size={15} />} meta="Least privilege by role" />
            <Stat
              label="Deactivated"
              value={peopleStats.disabled}
              icon={<Lock size={15} />}
              tone={peopleStats.disabled > 0 ? 'warning' : undefined}
              meta="Cannot sign in or approve"
            />
            <Stat
              label="Separation of duties"
              value="Enforced"
              icon={<CheckCircle2 size={15} />}
              meta="Requester never approves their own document"
            />
          </div>

          <Card
            title="Team"
            subtitle="Accounts are invitation-only. Role determines every allowed action; menus are not the control."
            flush
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th className="right">Permissions</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
                          <Avatar name={user.name} />
                          <div>
                            <div className="cell-primary">
                              {user.name}
                              {user.id === currentUser.id && <span className="tiny muted"> · you</span>}
                            </div>
                            <div className="cell-sub mono">{user.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                        <div className="cell-sub" style={{ maxWidth: 240 }}>{ROLE_DESCRIPTIONS[user.role]}</div>
                      </td>
                      <td className="right numeric">{permissionsFor(user.role).length}</td>
                      <td>
                        <StatusPill active={user.active} />
                      </td>
                      <td className="right">
                        <div className="flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {user.active && user.id !== currentUser.id && (
                            <button className="btn btn--sm btn--ghost" onClick={() => actions.switchUser(user.id)}>
                              Act as
                            </button>
                          )}
                          <button
                            className={`switch ${user.active ? 'on' : ''}`}
                            onClick={() => actions.toggleUser(user.id)}
                            disabled={user.id === currentUser.id}
                            aria-label={`${user.active ? 'Deactivate' : 'Reactivate'} ${user.name}`}
                            aria-pressed={user.active}
                            title={user.id === currentUser.id ? 'You cannot deactivate your own account' : undefined}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Role permissions"
            subtitle="The full access matrix. A dash means the action is blocked, even if a document is opened directly."
            flush
          >
            <div className="table-wrap">
              <table className="table--compact">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {ROLES.map((role) => (
                      <th key={role} className="right" style={{ whiteSpace: 'nowrap' }}>{ROLE_SHORT[role]}</th>
                    ))}
                  </tr>
                </thead>
                {PERMISSION_GROUPS.map((group) => (
                  <tbody key={group.title}>
                    <tr>
                      <td colSpan={ROLES.length + 1} className="tiny" style={{ background: '#f8f9f6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
                        {group.title}
                      </td>
                    </tr>
                    {group.permissions.map((permission) => (
                      <tr key={permission}>
                        <td>{PERMISSION_LABELS[permission]}</td>
                        {ROLES.map((role) => (
                          <td key={role} className="right">
                            {permissionsFor(role).includes(permission) ? (
                              <Check size={14} style={{ color: 'var(--brand)' }} aria-label="Allowed" />
                            ) : (
                              <X size={13} style={{ color: '#c8d0ca' }} aria-label="Blocked" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'policies' && canSettings && (
        <div className="grid grid--sidebar">
          <Card
            title="Store policies"
            subtitle="Limits are enforced by the workflow, not by reminding people to behave."
            footer={
              <div className="flex-between w-full">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPolicyForm(policyFormFrom(state.settings))}
                >
                  Discard changes
                </button>
                <button className="btn btn--primary" onClick={savePolicies}>
                  <CheckCircle2 size={16} /> Save policies
                </button>
              </div>
            }
          >
            <div className="form-section">
              <div className="form-section__title">Approval limits</div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="limit-manager">Manager approval limit</label>
                  <div className="input-affix">
                    <input
                      id="limit-manager"
                      className="input"
                      inputMode="decimal"
                      value={policyForm.approvalLimitManager}
                      onChange={(e) => patchPolicy('approvalLimitManager', e.target.value)}
                    />
                    <span>NGN</span>
                  </div>
                  <span className="field__hint">Purchase orders, write-offs and count variances above this need the owner.</span>
                </div>
                <div className="field">
                  <label htmlFor="limit-owner">Owner approval limit</label>
                  <div className="input-affix">
                    <input
                      id="limit-owner"
                      className="input"
                      inputMode="decimal"
                      value={policyForm.approvalLimitOwner}
                      onChange={(e) => patchPolicy('approvalLimitOwner', e.target.value)}
                    />
                    <span>NGN</span>
                  </div>
                  <span className="field__hint">The ceiling for the owner. Must be at least the manager limit.</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Counts and receiving</div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="variance-threshold">Count variance threshold</label>
                  <div className="input-affix">
                    <input
                      id="variance-threshold"
                      className="input"
                      inputMode="decimal"
                      value={policyForm.countVarianceThreshold}
                      onChange={(e) => patchPolicy('countVarianceThreshold', e.target.value)}
                    />
                    <span>NGN</span>
                  </div>
                  <span className="field__hint">A submitted count above this value is sent to recount before approval.</span>
                </div>
                <div className="field">
                  <label htmlFor="receipt-tolerance">Receiving tolerance</label>
                  <div className="input-affix">
                    <input
                      id="receipt-tolerance"
                      className="input"
                      inputMode="decimal"
                      value={policyForm.receiptTolerancePct}
                      onChange={(e) => patchPolicy('receiptTolerancePct', e.target.value)}
                    />
                    <span>%</span>
                  </div>
                  <span className="field__hint">Quantity over the expected delivery that a receiving clerk may accept.</span>
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Demand, expiry and sessions</div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="low-stock-window">Demand window</label>
                  <div className="input-affix">
                    <input
                      id="low-stock-window"
                      className="input"
                      inputMode="numeric"
                      value={policyForm.lowStockWindowDays}
                      onChange={(e) => patchPolicy('lowStockWindowDays', e.target.value)}
                    />
                    <span>days</span>
                  </div>
                  <span className="field__hint">Sales history used by reorder suggestions.</span>
                </div>
                <div className="field">
                  <label htmlFor="expiry-warning">Expiry warning</label>
                  <div className="input-affix">
                    <input
                      id="expiry-warning"
                      className="input"
                      inputMode="numeric"
                      value={policyForm.expiryWarningDays}
                      onChange={(e) => patchPolicy('expiryWarningDays', e.target.value)}
                    />
                    <span>days</span>
                  </div>
                  <span className="field__hint">Default window when a product has no override.</span>
                </div>
                <div className="field">
                  <label htmlFor="auto-lock">Device auto-lock</label>
                  <div className="input-affix">
                    <input
                      id="auto-lock"
                      className="input"
                      inputMode="numeric"
                      value={policyForm.autoLockDays}
                      onChange={(e) => patchPolicy('autoLockDays', e.target.value)}
                    />
                    <span>days</span>
                  </div>
                  <span className="field__hint">How long a till keeps a local session before requiring sign-in.</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid" style={{ alignContent: 'start' }}>
            <Card title="Behaviour" subtitle="Operational switches applied immediately on this device.">
              <div className="switch-row">
                <div>
                  <div className="switch-row__text">Allow negative stock</div>
                  <div className="switch-row__hint">Off blocks sales below zero and raises a critical alert if a ledger gap appears.</div>
                </div>
                <button
                  type="button"
                  className={`switch ${policyForm.negativeStockAllowed ? 'on' : ''}`}
                  aria-pressed={policyForm.negativeStockAllowed}
                  onClick={() => patchPolicy('negativeStockAllowed', !policyForm.negativeStockAllowed)}
                />
              </div>
              <div className="switch-row">
                <div>
                  <div className="switch-row__text">Large text</div>
                  <div className="switch-row__hint">Increases type size across the whole interface.</div>
                </div>
                <button
                  type="button"
                  className={`switch ${policyForm.largeText ? 'on' : ''}`}
                  aria-pressed={policyForm.largeText}
                  onClick={() => patchPolicy('largeText', !policyForm.largeText)}
                />
              </div>
              <div className="switch-row">
                <div>
                  <div className="switch-row__text">Compact tables</div>
                  <div className="switch-row__hint">Fits more rows on a busy packing bench or till.</div>
                </div>
                <button
                  type="button"
                  className={`switch ${policyForm.compactMode ? 'on' : ''}`}
                  aria-pressed={policyForm.compactMode}
                  onClick={() => patchPolicy('compactMode', !policyForm.compactMode)}
                />
              </div>
            </Card>

            <Card title="Approval ladder" subtitle="Preview of the limits being edited.">
              <dl className="kv">
                <dt>Store manager</dt>
                <dd>{money(approvalPreview.manager)}</dd>
                <dt>Owner</dt>
                <dd>{money(approvalPreview.owner)}</dd>
                <dt>Other roles</dt>
                <dd>No approval authority</dd>
              </dl>
              <div className="banner banner--info mt-16">
                <ShieldCheck />
                <span>
                  A manager cannot approve an order they created, even inside their limit. The same rule applies to counts
                  and write-offs.
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'audit' && canAudit && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Audit events" value={state.audit.length} icon={<ScrollText size={15} />} meta="Append-only, newest first in the table" />
            <Stat
              label="Chain integrity"
              value={verification.valid ? 'Intact' : 'Broken'}
              icon={verification.valid ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
              tone={verification.valid ? undefined : 'danger'}
              meta={`${verification.checked} event(s) recomputed`}
            />
            <Stat label="First event" value={dateTime(state.audit[0]?.at)} icon={<ScrollText size={15} />} meta={`Seeded ${dateTime(state.seededAt)}`} />
            <Stat
              label="Last verification"
              value={verifiedAt ? relative(verifiedAt) : 'Not run'}
              icon={<CheckCircle2 size={15} />}
              tone={verifiedAt && !verification.valid ? 'danger' : undefined}
              meta={verification.firstBrokenId ? `Break at ${shortId(verification.firstBrokenId)}` : 'Hashes link each event to the one before it'}
            />
          </div>

          {!verification.valid && (
            <div className="banner banner--danger mb-16">
              <AlertTriangle />
              <span>
                The audit chain is broken at event <strong className="mono">{verification.firstBrokenId}</strong>. Treat the
                affected document as unverified and preserve the current database before restoring a known-good backup.
              </span>
            </div>
          )}

          <Card
            title="Audit trail"
            subtitle="Every privileged change records actor, before and after values, a reason where required, and a chained hash."
            flush
          >
            <div className="flex flex-wrap" style={{ gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div className="search" style={{ flex: '1 1 240px' }}>
                <Search />
                <input
                  className="input"
                  placeholder="Search actor, action or summary"
                  value={auditSearch}
                  onChange={(e) => {
                    setAuditSearch(e.target.value);
                    setAuditLimit(80);
                  }}
                  aria-label="Search audit events"
                />
              </div>
              <select
                className="select"
                style={{ width: 190 }}
                value={auditEntity}
                onChange={(e) => {
                  setAuditEntity(e.target.value);
                  setAuditLimit(80);
                }}
                aria-label="Filter by entity type"
              >
                <option value="ALL">All entity types</option>
                {auditEntities.map((entity) => (
                  <option key={entity} value={entity}>{titleCase(entity)}</option>
                ))}
              </select>
              <span className="tiny muted" style={{ alignSelf: 'center', marginLeft: 'auto' }}>
                {filteredAudit.length} event(s)
              </span>
            </div>

            {filteredAudit.length === 0 ? (
              <EmptyState title="No events match" description="Clear the search or choose another entity type." />
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Entity</th>
                        <th>Summary</th>
                        <th className="right">Hash</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAudit.slice(0, auditLimit).map((event) => (
                        <tr key={event.id}>
                          <td className="nowrap">{dateTime(event.at)}</td>
                          <td>{event.actorName}</td>
                          <td>
                            <Badge tone="outline">{titleCase(event.action)}</Badge>
                          </td>
                          <td>
                            <div className="cell-primary">{titleCase(event.entityType)}</div>
                            <div className="cell-sub mono">{shortId(event.entityId)}</div>
                          </td>
                          <td style={{ maxWidth: 380 }}>{event.summary}</td>
                          <td className="right mono tiny">{event.hash.slice(0, 10)}</td>
                          <td className="right">
                            <button className="btn btn--sm btn--ghost" onClick={() => setSelectedEvent(event)}>
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredAudit.length > auditLimit && (
                  <div className="flex" style={{ justifyContent: 'center', padding: 14 }}>
                    <button className="btn btn--sm" onClick={() => setAuditLimit((limit) => limit + 80)}>
                      Show 80 more
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {activeTab === 'devices' && canDevices && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat
              label="Connectivity"
              value={online ? 'Online' : 'Offline'}
              icon={online ? <Wifi size={15} /> : <WifiOff size={15} />}
              tone={online ? undefined : 'warning'}
              meta={simulateOffline ? 'Offline simulation is on' : 'Follows the browser connection'}
            />
            <Stat
              label="Queued documents"
              value={pendingSyncCount}
              icon={<RefreshCw size={15} />}
              tone={pendingSyncCount > 0 ? 'warning' : undefined}
              meta={pendingSyncCount > 0 ? 'Saved locally, awaiting acknowledgement' : 'Nothing waiting to sync'}
            />
            <Stat label="Last sync" value={relative(state.lastSyncAt)} icon={<CheckCircle2 size={15} />} meta={dateTime(state.lastSyncAt)} />
            <Stat label="This device" value={state.deviceId} icon={<Smartphone size={15} />} meta={`${state.store.code} · ${state.store.timezone}`} />
          </div>

          {(pendingSyncCount > 0 || !online) && (
            <div className={`banner ${online ? 'banner--warning' : 'banner--info'} mb-16`}>
              {online ? <RefreshCw /> : <WifiOff />}
              <span>
                {online
                  ? `${pendingSyncCount} document(s) are queued on this device. Syncing acknowledges them with the central service.`
                  : 'Offline trading is active. Sales, receipts and counts keep working and are queued locally.'}
              </span>
            </div>
          )}

          <div className="grid grid--sidebar">
            <Card
              title="Queued work"
              subtitle="Documents are grouped by the transaction that created them. Confirming a sync clears the queue for this device."
              flush
            >
              {queuedDocs.length === 0 ? (
                <EmptyState
                  title="Everything is synced"
                  description="New sales, receipts, transfers and counts will appear here while offline."
                  icon={<CheckCircle2 size={20} />}
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Type</th>
                        <th>Queued</th>
                        <th>Detail</th>
                        <th className="right">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queuedDocs.map((doc) => (
                        <tr key={doc.key}>
                          <td className="mono">{doc.number}</td>
                          <td>{doc.type}</td>
                          <td className="nowrap">{dateTime(doc.at)}</td>
                          <td className="tiny muted">{doc.detail}</td>
                          <td className="right"><Badge tone="amber" dot>Pending</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }} className="flex-between">
                <span className="tiny muted">Queue is scoped to {state.deviceId}</span>
                <button className="btn btn--primary btn--sm" onClick={actions.syncNow} disabled={!online}>
                  <RefreshCw size={14} /> Sync now
                </button>
              </div>
            </Card>

            <div className="grid" style={{ alignContent: 'start' }}>
              <Card title="Device health" subtitle="Peripheral status is a demo probe for this pilot till.">
                <div className="list-row">
                  <div className="list-row__main">
                    <div className="list-row__title">POS terminal · {state.deviceId}</div>
                    <div className="list-row__meta">Sales, returns and cash drawer</div>
                  </div>
                  <Badge tone={online ? 'green' : 'amber'} dot>{online ? 'Ready' : 'Queued'}</Badge>
                </div>
                <div className="list-row">
                  <div className="list-row__main">
                    <div className="list-row__title">Barcode scanner</div>
                    <div className="list-row__meta">USB HID keyboard wedge</div>
                  </div>
                  <Badge tone="green" dot>Ready</Badge>
                </div>
                <div className="list-row">
                  <div className="list-row__main">
                    <div className="list-row__title">Receipt printer</div>
                    <div className="list-row__meta">Thermal, 80 mm</div>
                  </div>
                  <Badge tone={online ? 'green' : 'amber'} dot>{online ? 'Ready' : 'Local queue'}</Badge>
                </div>
                <div className="list-row">
                  <div className="list-row__main">
                    <div className="list-row__title">Central service</div>
                    <div className="list-row__meta">Acknowledges queued documents</div>
                  </div>
                  <Badge tone={online ? 'green' : 'red'} dot>{online ? 'Reachable' : 'Unreachable'}</Badge>
                </div>
              </Card>

              <Card title="Sync controls" subtitle="Simulate a trading day without connectivity.">
                <div className="switch-row">
                  <div>
                    <div className="switch-row__text">Offline simulation</div>
                    <div className="switch-row__hint">
                      {simulateOffline
                        ? 'On — new work is saved locally and queued.'
                        : 'Off — the app follows the browser connection.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`switch ${simulateOffline ? 'on' : ''}`}
                    aria-pressed={simulateOffline}
                    aria-label="Toggle offline simulation"
                    onClick={() => setSimulateOffline(!simulateOffline)}
                  />
                </div>
                <div className="banner banner--info mt-12">
                  <Lock />
                  <span>
                    Writes are idempotent by document ID. A queued sale or receipt is acknowledged once, even if the sync is
                    retried.
                  </span>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {activeTab === 'data' && canData && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Dataset records" value={(state.products.length + state.movements.length + state.sales.length).toLocaleString()} icon={<Database size={15} />} meta={`${state.counters ? Object.keys(state.counters).length : 0} document counters`} />
            <Stat label="Ledger movements" value={state.movements.length.toLocaleString()} icon={<ScrollText size={15} />} meta="Append-only, never edited" />
            <Stat label="Audit events" value={state.audit.length} icon={<ShieldCheck size={15} />} meta="Hash chained" />
            <Stat label="Storage size" value={`${(datasetBytes / 1024).toFixed(0)} KB`} icon={<Database size={15} />} meta="In this browser profile" />
          </div>

          <div className="grid grid--sidebar">
            <div className="grid" style={{ alignContent: 'start' }}>
              <Card
                title="Backup"
                subtitle="Download a complete JSON snapshot of this store. Keep it outside the browser."
              >
                <p className="tiny muted" style={{ lineHeight: 1.6 }}>
                  The backup includes products, batches, ledger movements, documents, alerts, users and the audit chain. Restore
                  it on the same version of Storehouse to continue from the exact same state.
                </p>
                <button className="btn btn--primary mt-16" onClick={downloadBackup}>
                  <Download size={16} /> Download JSON backup
                </button>
              </Card>

              <Card
                title="Restore"
                subtitle="Import a Storehouse backup. The current state is replaced only when the file is valid."
              >
                <div className="banner banner--warning">
                  <AlertTriangle />
                  <span>Restoring replaces all current data in this browser. Download a backup first if you need to keep it.</span>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => void importBackup(e.target.files?.[0])}
                />
                <button className="btn mt-16" onClick={() => fileInput.current?.click()}>
                  <Upload size={16} /> Choose backup file
                </button>
              </Card>
            </div>

            <div className="grid" style={{ alignContent: 'start' }}>
              <Card title="Dataset details" subtitle="What this browser profile holds.">
                <dl className="kv">
                  <dt>Schema version</dt>
                  <dd>{state.version}</dd>
                  <dt>Store</dt>
                  <dd>{state.store.name}</dd>
                  <dt>Timezone</dt>
                  <dd>{state.store.timezone}</dd>
                  <dt>Seeded</dt>
                  <dd>{dateTime(state.seededAt)}</dd>
                  <dt>Device</dt>
                  <dd className="mono">{state.deviceId}</dd>
                  <dt>Ledger sequence</dt>
                  <dd>{state.seq}</dd>
                  <dt>Counters</dt>
                  <dd>{Object.entries(state.counters).map(([key, value]) => `${key} ${value}`).join(' · ')}</dd>
                </dl>
              </Card>

              <Card title="Reset the demonstration" subtitle="Restores the seeded Greenfield dataset.">
                <p className="tiny muted" style={{ lineHeight: 1.6 }}>
                  Resetting discards every sale, receipt, count, approval and audit event created in this browser. Use it to
                  return the pilot to a known baseline.
                </p>
                <button className="btn btn--danger mt-16" onClick={() => setResetOpen(true)}>
                  <RefreshCw size={16} /> Reset demo data
                </button>
              </Card>

              <Card title="Data protection" subtitle="Pilot guardrails.">
                <div className="banner banner--success">
                  <ShieldCheck />
                  <span>
                    Data stays in this browser profile. Nothing is sent to a third party. Do not load real customer or staff
                    personal data into the pilot.
                  </span>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a user"
        subtitle="The role sets the access boundary immediately. The invitation is demo-only and does not send a message."
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={submitInvite} disabled={!invite.name.trim() || !invite.phone.trim()}>
              <UserPlus size={16} /> Add user
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="invite-name">Full name <span className="req">*</span></label>
            <input
              id="invite-name"
              className="input"
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              placeholder="e.g. Ada Nwosu"
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role <span className="req">*</span></label>
            <select
              id="invite-role"
              className="select"
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <span className="field__hint">{ROLE_DESCRIPTIONS[invite.role]}</span>
          </div>
          <div className="field">
            <label htmlFor="invite-phone">Phone <span className="req">*</span></label>
            <input
              id="invite-phone"
              className="input"
              value={invite.phone}
              onChange={(e) => setInvite({ ...invite, phone: e.target.value })}
              placeholder="+234 800 000 0000"
            />
            <span className="field__hint">Used to identify the person on documents and audit events.</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setResetConfirm('');
        }}
        title="Reset demo data?"
        subtitle="This cannot be undone from inside the app."
        footer={
          <>
            <button
              className="btn btn--ghost"
              onClick={() => {
                setResetOpen(false);
                setResetConfirm('');
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn--danger"
              disabled={resetConfirm !== 'RESET'}
              onClick={() => {
                actions.resetDemo();
                setResetOpen(false);
                setResetConfirm('');
              }}
            >
              Reset everything
            </button>
          </>
        }
      >
        <div className="banner banner--danger">
          <AlertTriangle />
          <span>
            Every document and audit event created in this browser will be replaced by the seeded baseline. Download a backup
            first if the work matters.
          </span>
        </div>
        <div className="field mt-16">
          <label htmlFor="reset-confirm">Type RESET to confirm</label>
          <input
            id="reset-confirm"
            className="input"
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
          />
        </div>
      </Modal>

      <Drawer
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        title="Audit event"
        subtitle={selectedEvent ? selectedEvent.summary : undefined}
        wide
      >
        {selectedEvent && (
          <>
            <div className="flex flex-wrap mb-16" style={{ gap: 6 }}>
              <Badge tone="outline">{titleCase(selectedEvent.action)}</Badge>
              <Badge tone="neutral">{titleCase(selectedEvent.entityType)}</Badge>
              <Badge tone={verification.valid ? 'green' : 'red'} dot>
                {verification.valid ? 'Chain intact' : 'Chain broken'}
              </Badge>
            </div>

            <dl className="kv">
              <dt>Event ID</dt>
              <dd className="mono">{selectedEvent.id}</dd>
              <dt>Recorded</dt>
              <dd>{dateTime(selectedEvent.at)}</dd>
              <dt>Actor</dt>
              <dd>{selectedEvent.actorName} <span className="muted mono">({selectedEvent.actorId})</span></dd>
              <dt>Entity</dt>
              <dd>{titleCase(selectedEvent.entityType)} · <span className="mono">{selectedEvent.entityId}</span></dd>
              <dt>Reason</dt>
              <dd>{selectedEvent.reason || '—'}</dd>
            </dl>

            <div className="grid grid--2 mt-16">
              <div>
                <div className="eyebrow mb-8">Before</div>
                <div
                  className="mono tiny"
                  style={{ background: '#f7f8f5', border: '1px solid var(--line)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}
                >
                  {prettyJson(selectedEvent.before)}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-8">After</div>
                <div
                  className="mono tiny"
                  style={{ background: '#f7f8f5', border: '1px solid var(--line)', borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}
                >
                  {prettyJson(selectedEvent.after)}
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__title">Hash chain</div>
              <dl className="kv">
                <dt>Previous hash</dt>
                <dd className="mono tiny">{selectedEvent.prevHash}</dd>
                <dt>This hash</dt>
                <dd className="mono tiny">{selectedEvent.hash}</dd>
              </dl>
              <p className="tiny muted mt-8" style={{ lineHeight: 1.6 }}>
                Verification recomputes this hash from the event fields and compares it with the stored value and the previous
                event. Editing any earlier event breaks every later link.
              </p>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="green" dot>Active</Badge>
  ) : (
    <Badge tone="neutral" dot>Deactivated</Badge>
  );
}
