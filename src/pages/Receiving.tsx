import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  PackageCheck,
  Plus,
  RotateCcw,
  Save,
  Truck,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat, StatusBadge, Tabs } from '../components/ui';
import { can } from '../domain/permissions';
import { dateShort, dateTime, downloadCsv, money, num, relative } from '../lib/format';
import type { Receipt } from '../types';

type Tab = 'drafts' | 'all';

export default function Receiving() {
  const { state, currentUser, actions } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('drafts');
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPoId, setNewPoId] = useState('');
  const [reverseTarget, setReverseTarget] = useState<Receipt | null>(null);

  const supplierById = useMemo(() => new Map(state.suppliers.map((s) => [s.id, s])), [state.suppliers]);
  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);

  useEffect(() => {
    const receiptId = searchParams.get('receipt');
    if (receiptId) {
      setPendingId(receiptId);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!pendingId) return;
    const receipt = state.receipts.find((r) => r.id === pendingId);
    if (!receipt) return;
    if (receipt.status === 'DRAFT') setEditing(structuredClone(receipt));
    else setViewingId(receipt.id);
    setPendingId(null);
  }, [pendingId, state.receipts]);

  const receiptValue = (receipt: Receipt) =>
    receipt.lines.reduce((sum, line) => sum + line.acceptedQty * line.unitCost, 0);

  const receipts = useMemo(() => {
    const list = [...state.receipts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return tab === 'drafts' ? list.filter((r) => r.status === 'DRAFT') : list;
  }, [state.receipts, tab]);

  const viewing = viewingId ? state.receipts.find((r) => r.id === viewingId) ?? null : null;
  const eligiblePos = state.purchaseOrders.filter((po) => {
    if (!['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status)) return false;
    return po.lines.some((line) => line.qty - line.receivedQty > 0.0005);
  });

  const openNew = () => {
    setNewPoId(eligiblePos[0]?.id ?? '');
    setNewOpen(true);
  };

  const createDraft = () => {
    if (!newPoId) {
      actions.toast('Choose an approved purchase order first.', 'error');
      return;
    }
    const id = actions.createReceiptDraft(newPoId);
    if (id) {
      setNewOpen(false);
      setPendingId(id);
      setTab('drafts');
    }
  };

  const updateLine = (lineId: string, patch: Partial<Receipt['lines'][number]>) => {
    setEditing((prev) =>
      prev ? { ...prev, lines: prev.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) } : prev,
    );
  };

  const setAllExpected = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      lines: editing.lines.map((line) => ({
        ...line,
        acceptedQty: line.expectedQty,
        damagedQty: 0,
        rejectedQty: 0,
        shortQty: 0,
      })),
    });
  };

  const editingStats = editing
    ? {
        accepted: editing.lines.reduce((sum, line) => sum + line.acceptedQty, 0),
        damaged: editing.lines.reduce((sum, line) => sum + line.damagedQty, 0),
        rejected: editing.lines.reduce((sum, line) => sum + line.rejectedQty, 0),
        value: editing.lines.reduce((sum, line) => sum + line.acceptedQty * line.unitCost, 0),
        missingExpiry: editing.lines.filter((line) => productById.get(line.productId)?.perishable && line.acceptedQty > 0 && !line.expiry).length,
        overTolerance: editing.lines.filter((line) => {
          const received = line.acceptedQty + line.damagedQty;
          return line.expectedQty > 0 && received > line.expectedQty * (1 + state.settings.receiptTolerancePct / 100);
        }).length,
      }
    : null;

  const saveDraft = () => {
    if (!editing) return;
    actions.saveReceiptDraft(editing);
  };

  const confirm = () => {
    if (!editing) return;
    if (actions.confirmReceipt(editing.id, editing)) {
      const id = editing.id;
      setEditing(null);
      setViewingId(id);
    }
  };

  const exportReceipts = () => {
    downloadCsv(`goods-receipts-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['GRN', 'Supplier', 'PO', 'Status', 'Delivery note', 'Lines', 'Accepted value (NGN)', 'Created', 'Confirmed by', 'Sync'],
      ...receipts.map((receipt) => [
        receipt.number,
        supplierById.get(receipt.supplierId)?.name ?? '',
        state.purchaseOrders.find((po) => po.id === receipt.poId)?.number ?? '',
        receipt.status,
        receipt.deliveryNote,
        receipt.lines.length,
        (receiptValue(receipt) / 100).toFixed(2),
        receipt.createdAt,
        receipt.confirmedBy ? userById.get(receipt.confirmedBy)?.name ?? '' : '',
        receipt.sync,
      ]),
    ]);
    actions.toast(`Exported ${receipts.length} receipts.`);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Supply"
        title="Receiving workspace"
        subtitle="Confirm what physically arrived, batch by batch. Accepted stock posts to the shop floor; damaged stock posts to the damaged bay."
        actions={
          <>
            <button className="btn" onClick={exportReceipts}><Download size={16} /> Export</button>
            {can(currentUser, 'receipt.manage') && (
              <button className="btn btn--primary" onClick={openNew}><Plus size={16} /> New receipt</button>
            )}
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Open drafts" value={state.receipts.filter((r) => r.status === 'DRAFT').length} icon={<Save size={15} />} tone={state.receipts.some((r) => r.status === 'DRAFT') ? 'warning' : undefined} meta="Drafts survive refresh and device loss" />
        <Stat label="Confirmed" value={state.receipts.filter((r) => r.status === 'CONFIRMED').length} icon={<CheckCircle2 size={15} />} meta="Posted to the movement ledger" />
        <Stat label="Orders receiving" value={eligiblePos.length} icon={<Truck size={15} />} meta="Approved or sent with outstanding quantity" />
        <Stat label="Receipt tolerance" value={`${state.settings.receiptTolerancePct}%`} icon={<AlertTriangle size={15} />} meta="Above tolerance requires manager confirmation" />
      </div>

      <Tabs
        tabs={[
          { id: 'drafts', label: 'Open drafts', count: state.receipts.filter((r) => r.status === 'DRAFT').length },
          { id: 'all', label: 'All receipts', count: state.receipts.length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      <Card
        title={tab === 'drafts' ? 'Draft receipts' : 'Receipt history'}
        subtitle="A draft never changes stock. Confirmation checks expiry, tolerance and cost, then posts movements."
        flush
      >
        {receipts.length === 0 ? (
          <EmptyState
            title={tab === 'drafts' ? 'No drafts waiting' : 'No receipts yet'}
            description="Start a receipt from an approved or sent purchase order."
            action={can(currentUser, 'receipt.manage') && eligiblePos.length > 0 ? <button className="btn btn--primary" onClick={openNew}><Plus size={15} /> New receipt</button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>GRN</th>
                  <th>Supplier / PO</th>
                  <th>Status</th>
                  <th className="right">Lines</th>
                  <th className="right">Accepted value</th>
                  <th>Delivery note</th>
                  <th>Created</th>
                  <th>Confirmed</th>
                  <th>Sync</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => {
                  const po = state.purchaseOrders.find((p) => p.id === receipt.poId);
                  return (
                    <tr
                      key={receipt.id}
                      className="is-clickable"
                      onClick={() => (receipt.status === 'DRAFT' ? setEditing(structuredClone(receipt)) : setViewingId(receipt.id))}
                    >
                      <td className="mono">{receipt.number}</td>
                      <td>
                        <div className="cell-primary">{supplierById.get(receipt.supplierId)?.name}</div>
                        <div className="cell-sub">{po?.number ?? 'No PO'}</div>
                      </td>
                      <td><StatusBadge status={receipt.status} kind="receipt" /></td>
                      <td className="right numeric">{receipt.lines.length}</td>
                      <td className="right amount">{money(receiptValue(receipt))}</td>
                      <td className="cell-sub">{receipt.deliveryNote || '—'}</td>
                      <td className="nowrap">{relative(receipt.createdAt)}</td>
                      <td className="nowrap">
                        {receipt.confirmedAt ? (
                          <>{userById.get(receipt.confirmedBy ?? '')?.name ?? '—'}<div className="cell-sub">{dateShort(receipt.confirmedAt)}</div></>
                        ) : '—'}
                      </td>
                      <td><StatusBadge status={receipt.sync} kind="sync" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Receipt ${editing.number}` : 'Receipt'}
        subtitle={editing ? `${supplierById.get(editing.supplierId)?.name} · ${state.purchaseOrders.find((p) => p.id === editing.poId)?.number ?? 'no PO'}` : undefined}
        wide
        footer={
          editing ? (
            <>
              <button className="btn btn--ghost" onClick={saveDraft}><Save size={15} /> Save draft</button>
              <button className="btn" onClick={setAllExpected}>Accept expected quantities</button>
              <button
                className="btn btn--primary"
                onClick={confirm}
                disabled={!can(currentUser, 'receipt.manage') || (editingStats?.missingExpiry ?? 0) > 0}
              >
                <PackageCheck size={15} /> Confirm and post
              </button>
            </>
          ) : undefined
        }
      >
        {editing && editingStats && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="stat-strip">
              <div><div className="label">Accepted</div><div className="value">{num(editingStats.accepted)}</div></div>
              <div><div className="label">Damaged</div><div className="value">{num(editingStats.damaged)}</div></div>
              <div><div className="label">Rejected</div><div className="value">{num(editingStats.rejected)}</div></div>
              <div><div className="label">Accepted value</div><div className="value">{money(editingStats.value)}</div></div>
            </div>

            {editingStats.missingExpiry > 0 && (
              <div className="banner banner--danger">
                <AlertTriangle />
                {editingStats.missingExpiry} perishable line(s) need an expiry date before this receipt can be confirmed.
              </div>
            )}
            {editingStats.overTolerance > 0 && (
              <div className={`banner ${can(currentUser, 'po.approve') ? 'banner--warning' : 'banner--danger'}`}>
                <AlertTriangle />
                {editingStats.overTolerance} line(s) exceed the {state.settings.receiptTolerancePct}% tolerance.
                {can(currentUser, 'po.approve') ? ' Your role may confirm with a note.' : ' A manager must confirm this receipt.'}
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label>Delivery note / invoice number</label>
                <input className="input" value={editing.deliveryNote} onChange={(e) => setEditing({ ...editing, deliveryNote: e.target.value })} placeholder="Supplier DN number" />
              </div>
              <div className="field">
                <label>Receiving note</label>
                <input className="input" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="Vehicle, temperature check, inspector…" />
              </div>
            </div>

            <div className="table-wrap">
              <table className="table--compact">
                <thead>
                  <tr>
                    <th style={{ minWidth: 190 }}>Product</th>
                    <th className="right">Expected</th>
                    <th className="right" style={{ width: 80 }}>Accepted</th>
                    <th className="right" style={{ width: 80 }}>Damaged</th>
                    <th className="right" style={{ width: 80 }}>Rejected</th>
                    <th className="right" style={{ width: 80 }}>Short</th>
                    <th style={{ minWidth: 130 }}>Batch no</th>
                    <th style={{ minWidth: 130 }}>Expiry</th>
                    <th className="right" style={{ width: 110 }}>Unit cost ₦</th>
                  </tr>
                </thead>
                <tbody>
                  {editing.lines.map((line) => {
                    const product = productById.get(line.productId);
                    const total = line.acceptedQty + line.damagedQty + line.rejectedQty + line.shortQty;
                    const mismatch = Math.abs(total - line.expectedQty) > 0.0005;
                    return (
                      <tr key={line.id}>
                        <td>
                          <div className="cell-primary">{product?.name ?? 'Unknown product'}</div>
                          <div className="cell-sub">
                            {product?.sku} · {product?.baseUnit}
                            {product?.perishable && <span className="text-amber"> · perishable</span>}
                            {mismatch && <span className="text-red"> · totals do not match expected</span>}
                          </div>
                        </td>
                        <td className="right numeric">{num(line.expectedQty)}</td>
                        <td><input className="input" type="number" min={0} step="0.001" value={line.acceptedQty} onChange={(e) => updateLine(line.id, { acceptedQty: Number(e.target.value) || 0 })} aria-label={`Accepted ${product?.name}`} /></td>
                        <td><input className="input" type="number" min={0} step="0.001" value={line.damagedQty} onChange={(e) => updateLine(line.id, { damagedQty: Number(e.target.value) || 0 })} aria-label={`Damaged ${product?.name}`} /></td>
                        <td><input className="input" type="number" min={0} step="0.001" value={line.rejectedQty} onChange={(e) => updateLine(line.id, { rejectedQty: Number(e.target.value) || 0 })} aria-label={`Rejected ${product?.name}`} /></td>
                        <td><input className="input" type="number" min={0} step="0.001" value={line.shortQty} onChange={(e) => updateLine(line.id, { shortQty: Number(e.target.value) || 0 })} aria-label={`Short ${product?.name}`} /></td>
                        <td><input className="input mono" value={line.batchNo} onChange={(e) => updateLine(line.id, { batchNo: e.target.value })} aria-label={`Batch number ${product?.name}`} /></td>
                        <td><input className="input" type="date" value={line.expiry ? line.expiry.slice(0, 10) : ''} onChange={(e) => updateLine(line.id, { expiry: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })} aria-label={`Expiry ${product?.name}`} /></td>
                        <td><input className="input" type="number" min={0} step="0.01" value={line.unitCost / 100} onChange={(e) => updateLine(line.id, { unitCost: Math.round((Number(e.target.value) || 0) * 100) })} aria-label={`Unit cost ${product?.name}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="banner">
              <Truck />
              Accepted quantities post to the shop floor as sellable stock and update the product's weighted-average cost. Damaged quantities post to the damaged bay. Nothing posts until confirmation.
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!viewing}
        onClose={() => setViewingId(null)}
        title={viewing ? `Receipt ${viewing.number}` : 'Receipt'}
        subtitle={viewing ? `${supplierById.get(viewing.supplierId)?.name} · confirmed ${dateShort(viewing.confirmedAt)}` : undefined}
        wide
        footer={
          viewing && viewing.status === 'CONFIRMED' && can(currentUser, 'po.approve') ? (
            <button className="btn btn--danger" onClick={() => setReverseTarget(viewing)}><RotateCcw size={15} /> Reverse receipt</button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="flex gap-8 flex-wrap">
              <StatusBadge status={viewing.status} kind="receipt" />
              <Badge tone="outline">{viewing.deliveryNote || 'No delivery note'}</Badge>
              <Badge tone="outline">{viewing.lines.length} lines</Badge>
              <StatusBadge status={viewing.sync} kind="sync" />
            </div>
            <div className="stat-strip">
              <div><div className="label">Accepted value</div><div className="value">{money(receiptValue(viewing))}</div></div>
              <div><div className="label">Accepted units</div><div className="value">{num(viewing.lines.reduce((s, l) => s + l.acceptedQty, 0))}</div></div>
              <div><div className="label">Damaged</div><div className="value">{num(viewing.lines.reduce((s, l) => s + l.damagedQty, 0))}</div></div>
              <div><div className="label">Confirmed by</div><div className="value" style={{ fontSize: '0.85rem' }}>{userById.get(viewing.confirmedBy ?? '')?.name ?? '—'}</div></div>
            </div>

            <div className="table-wrap">
              <table className="table--compact">
                <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="right">Expected</th><th className="right">Accepted</th><th className="right">Damaged</th><th className="right">Rejected</th><th className="right">Unit cost</th></tr></thead>
                <tbody>
                  {viewing.lines.map((line) => {
                    const product = productById.get(line.productId);
                    return (
                      <tr key={line.id}>
                        <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.sku}</div></td>
                        <td className="mono">{line.batchNo}</td>
                        <td>{dateShort(line.expiry)}</td>
                        <td className="right numeric">{num(line.expectedQty)}</td>
                        <td className="right numeric">{num(line.acceptedQty)}</td>
                        <td className="right numeric">{num(line.damagedQty)}</td>
                        <td className="right numeric">{num(line.rejectedQty)}</td>
                        <td className="right amount">{money(line.unitCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {viewing.note && <div className="banner">{viewing.note}</div>}

            <div>
              <div className="eyebrow mb-8">Document history</div>
              {state.audit.filter((event) => event.entityId === viewing.id).map((event) => (
                <div className="list-row" key={event.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">{event.summary}</div>
                    <div className="list-row__meta">{dateTime(event.at)} · {event.actorName}{event.reason ? ` · ${event.reason}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Start a goods receipt"
        subtitle="Choose an approved or sent order with outstanding quantity."
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setNewOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={createDraft}>Create draft</button>
          </>
        }
      >
        {eligiblePos.length === 0 ? (
          <EmptyState title="Nothing to receive" description="Approve or send a purchase order first. Fully received orders are excluded." />
        ) : (
          <div className="grid">
            {eligiblePos.map((po) => {
              const outstanding = po.lines.reduce((sum, line) => sum + Math.max(0, line.qty - line.receivedQty), 0);
              return (
                <label key={po.id} className={`card`} style={{ padding: 12, cursor: 'pointer', borderColor: newPoId === po.id ? 'var(--brand)' : undefined }}>
                  <div className="flex gap-10">
                    <input type="radio" name="po" checked={newPoId === po.id} onChange={() => setNewPoId(po.id)} style={{ accentColor: 'var(--brand)' }} />
                    <div className="grow">
                      <div className="cell-primary">{po.number} · {supplierById.get(po.supplierId)?.name}</div>
                      <div className="cell-sub">{outstanding} units outstanding · {po.lines.length} line(s) · expected {dateShort(po.expectedDate)}</div>
                    </div>
                    <StatusBadge status={po.status} kind="po" />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={!!reverseTarget}
        onClose={() => setReverseTarget(null)}
        title="Reverse confirmed receipt"
        subtitle={reverseTarget ? `${reverseTarget.number} · ${money(receiptValue(reverseTarget))}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setReverseTarget(null)}>Keep receipt</button>
            <button
              className="btn btn--danger"
              onClick={() => {
                if (reverseTarget) {
                  const ok = actions.reverseReceipt(reverseTarget.id);
                  if (ok) {
                    setReverseTarget(null);
                    setViewingId(null);
                  }
                }
              }}
            >
              Reverse and return stock
            </button>
          </>
        }
      >
        <div className="banner banner--warning">
          <AlertTriangle />
          Reversal posts opposite movements and preserves both documents. The original receipt remains in history, and purchase order received quantities are reduced.
        </div>
      </Modal>
    </div>
  );
}
