import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Download,
  PackageCheck,
  Plus,
  Send,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat, StatusBadge, Tabs } from '../components/ui';
import { can } from '../domain/permissions';
import { approvalLimitFor } from '../domain/permissions';
import { dateShort, dateTime, downloadCsv, money, num, relative } from '../lib/format';
import type { PurchaseOrder } from '../types';

type Tab = 'orders' | 'reorder' | 'suppliers';
type DraftLine = { productId: string; qty: string; costNaira: string };

interface DecisionState {
  po: PurchaseOrder;
  action: 'approve' | 'reject' | 'cancel' | 'close';
}

export default function Purchasing() {
  const { state, currentUser, reorder, stockMap, actions } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('orders');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftSupplier, setDraftSupplier] = useState(state.suppliers[0]?.id ?? '');
  const [draftExpected, setDraftExpected] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([{ productId: '', qty: '1', costNaira: '' }]);
  const [decision, setDecision] = useState<DecisionState | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const supplierById = useMemo(() => new Map(state.suppliers.map((s) => [s.id, s])), [state.suppliers]);
  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);

  const poTotal = (po: PurchaseOrder) => po.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
  const poOutstanding = (po: PurchaseOrder) =>
    po.lines.reduce((sum, line) => sum + Math.max(0, line.qty - line.receivedQty) * line.unitCost, 0);

  const orders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.purchaseOrders
      .filter((po) => {
        if (status !== 'ALL' && po.status !== status) return false;
        if (!term) return true;
        const supplier = supplierById.get(po.supplierId);
        return `${po.number} ${supplier?.name ?? ''} ${po.notes}`.toLowerCase().includes(term);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state.purchaseOrders, search, status, supplierById]);

  const selected = selectedId ? state.purchaseOrders.find((p) => p.id === selectedId) ?? null : null;
  const limit = approvalLimitFor(currentUser.role, state.settings.approvalLimitManager, state.settings.approvalLimitOwner);

  const openCreate = (seed?: { productId: string; qty: number; unitCost: number }) => {
    const product = seed ? productById.get(seed.productId) : undefined;
    setDraftSupplier(product?.supplierId ?? state.suppliers[0]?.id ?? '');
    setDraftExpected(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    setDraftNotes('');
    setDraftLines([
      seed
        ? { productId: seed.productId, qty: String(seed.qty), costNaira: String(seed.unitCost / 100) }
        : { productId: '', qty: '1', costNaira: '' },
    ]);
    setDraftOpen(true);
  };

  const draftTotal = draftLines.reduce(
    (sum, line) => sum + (Number(line.qty) || 0) * Math.round((Number(line.costNaira) || 0) * 100),
    0,
  );

  const createPo = () => {
    const payload = draftLines
      .filter((line) => line.productId)
      .map((line) => ({
        productId: line.productId,
        qty: Number(line.qty) || 0,
        unitCost: Math.round((Number(line.costNaira) || 0) * 100),
      }));
    const id = actions.createPurchaseOrder({
      supplierId: draftSupplier,
      expectedDate: draftExpected || new Date().toISOString().slice(0, 10),
      notes: draftNotes,
      lines: payload,
    });
    if (id) {
      setDraftOpen(false);
      setSelectedId(id);
      setTab('orders');
    }
  };

  const exportOrders = () => {
    downloadCsv(`purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['PO number', 'Supplier', 'Status', 'Created', 'Expected', 'Lines', 'Order value (NGN)', 'Outstanding (NGN)', 'Version', 'Created by'],
      ...orders.map((po) => [
        po.number,
        supplierById.get(po.supplierId)?.name ?? '',
        po.status,
        po.createdAt,
        po.expectedDate,
        po.lines.length,
        (poTotal(po) / 100).toFixed(2),
        (poOutstanding(po) / 100).toFixed(2),
        po.version,
        userById.get(po.createdBy)?.name ?? po.createdBy,
      ]),
    ]);
    actions.toast(`Exported ${orders.length} purchase orders.`);
  };

  const submitDecision = () => {
    if (!decision) return;
    const { po, action } = decision;
    let ok = true;
    if (action === 'approve') ok = actions.approvePurchaseOrder(po.id, decisionNote);
    else if (action === 'reject') ok = actions.rejectPurchaseOrder(po.id, decisionNote);
    else if (action === 'cancel') {
      actions.cancelPurchaseOrder(po.id, decisionNote);
      ok = !!decisionNote.trim();
    } else {
      actions.closeShort(po.id, decisionNote);
      ok = !!decisionNote.trim();
    }
    if (ok) setDecision(null);
  };

  const startReceipt = (po: PurchaseOrder) => {
    const id = actions.createReceiptDraft(po.id);
    if (id) navigate(`/receiving?receipt=${id}`);
  };

  const approvedCount = state.purchaseOrders.filter((po) => ['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status)).length;
  const awaiting = state.purchaseOrders.filter((po) => po.status === 'PENDING_APPROVAL').length;
  const openValue = state.purchaseOrders
    .filter((po) => ['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status))
    .reduce((sum, po) => sum + poOutstanding(po), 0);
  const reorderNeed = reorder.filter((item) => item.suggestedQty > 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Supply"
        title="Purchasing and suppliers"
        subtitle="Approved orders create the on-order commitment. Approval limits and creator separation are enforced in the store."
        actions={
          <>
            <button className="btn" onClick={exportOrders}><Download size={16} /> Export</button>
            {can(currentUser, 'po.create') && (
              <button className="btn btn--primary" onClick={() => openCreate()}><Plus size={16} /> New purchase order</button>
            )}
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Open orders" value={approvedCount} icon={<Truck size={15} />} meta={`${money(openValue)} still outstanding`} />
        <Stat label="Awaiting approval" value={awaiting} icon={<ClipboardList size={15} />} tone={awaiting ? 'warning' : undefined} meta={`Your limit is ${money(limit)}`} />
        <Stat label="Replenishment need" value={reorderNeed.length} icon={<PackageCheck size={15} />} tone={reorderNeed.length ? 'warning' : undefined} meta="SKUs below target after on-order" />
        <Stat label="Suppliers" value={state.suppliers.filter((s) => s.active).length} icon={<Truck size={15} />} meta={`${state.suppliers.length} records on file`} />
      </div>

      <Tabs
        tabs={[
          { id: 'orders', label: 'Purchase orders', count: state.purchaseOrders.length },
          { id: 'reorder', label: 'Reorder suggestions', count: reorderNeed.length },
          { id: 'suppliers', label: 'Suppliers', count: state.suppliers.length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'orders' && (
        <Card
          title="Purchase orders"
          subtitle="Draft → approval → sent → received. Received quantity is driven by confirmed goods receipts."
          flush
          action={
            <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter PO status">
              <option value="ALL">All statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PART_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((value) => (
                <option key={value} value={value}>{value.replace('_', ' ')}</option>
              ))}
            </select>
          }
        >
          <div style={{ padding: '0 14px 12px' }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Search PO number, supplier or notes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search purchase orders" />
          </div>
          {orders.length === 0 ? (
            <EmptyState title="No purchase orders match" description="Clear filters or create an order from a reorder suggestion." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Expected</th>
                    <th className="right">Lines</th>
                    <th className="right">Value</th>
                    <th className="right">Outstanding</th>
                    <th>Raised</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po) => {
                    const receivedPct = po.lines.length
                      ? (po.lines.reduce((sum, line) => sum + Math.min(line.receivedQty, line.qty), 0) /
                          Math.max(1, po.lines.reduce((sum, line) => sum + line.qty, 0))) * 100
                      : 0;
                    return (
                      <tr key={po.id} className="is-clickable" onClick={() => setSelectedId(po.id)}>
                        <td>
                          <div className="cell-primary mono">{po.number}</div>
                          <div className="cell-sub">v{po.version} · {po.lines.length} line(s)</div>
                        </td>
                        <td>
                          <div>{supplierById.get(po.supplierId)?.name ?? '—'}</div>
                          <div className="cell-sub">{supplierById.get(po.supplierId)?.contactName}</div>
                        </td>
                        <td><StatusBadge status={po.status} kind="po" /></td>
                        <td>{dateShort(po.expectedDate)}</td>
                        <td className="right numeric">{po.lines.length}</td>
                        <td className="right amount">{money(poTotal(po))}</td>
                        <td className="right numeric">
                          {money(poOutstanding(po))}
                          {receivedPct > 0 && <div className="cell-sub">{receivedPct.toFixed(0)}% received</div>}
                        </td>
                        <td className="nowrap">{relative(po.createdAt)}</td>
                        <td className="right"><ArrowRight size={15} className="muted" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'reorder' && (
        <Card
          title="Reorder suggestions"
          subtitle="Need = reorder point − available − on order, rounded to the order multiple. Manual rules apply where sales history is thin."
          flush
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="right">Available</th>
                  <th className="right">On order</th>
                  <th className="right">Point</th>
                  <th className="right">Need</th>
                  <th className="right">Suggested</th>
                  <th className="right">Cover</th>
                  <th>Basis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reorder.map((item) => (
                  <tr key={item.product.id}>
                    <td>
                      <div className="cell-primary">{item.product.name}</div>
                      <div className="cell-sub">{item.product.sku} · {supplierById.get(item.product.supplierId)?.name}</div>
                    </td>
                    <td className="right numeric">{num(item.available)}</td>
                    <td className="right numeric">{item.onOrder > 0 ? num(item.onOrder) : '—'}</td>
                    <td className="right numeric">{num(item.reorderPoint)}</td>
                    <td className="right numeric">{num(item.need)}</td>
                    <td className="right">
                      {item.suggestedQty > 0 ? <Badge tone={item.status === 'OUT' ? 'red' : 'amber'}>{num(item.suggestedQty)} {item.product.baseUnit}</Badge> : <Badge tone="green">Covered</Badge>}
                    </td>
                    <td className="right numeric">{item.daysCover === null ? '—' : `${item.daysCover.toFixed(1)}d`}</td>
                    <td className="cell-sub" style={{ maxWidth: 260 }}>{item.reason}</td>
                    <td className="right">
                      {can(currentUser, 'po.create') && item.suggestedQty > 0 && (
                        <button className="btn btn--sm" onClick={() => openCreate({ productId: item.product.id, qty: item.suggestedQty, unitCost: item.product.cost })}>
                          <Plus size={13} /> Draft PO
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reorder.every((item) => item.status === 'OK') && (
            <div className="banner banner--success" style={{ margin: 14 }}>Every active SKU is above its reorder point and covered by on-order stock.</div>
          )}
        </Card>
      )}

      {tab === 'suppliers' && (
        <Card title="Suppliers" subtitle="Lead time and review period feed the reorder calculation. Costs are maintained on the product record." flush>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Terms</th>
                  <th className="right">Lead time</th>
                  <th className="right">Review</th>
                  <th className="right">Min order</th>
                  <th className="right">Products</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.suppliers.map((supplier) => {
                  const productCount = state.products.filter((p) => p.supplierId === supplier.id).length;
                  return (
                    <tr key={supplier.id}>
                      <td>
                        <div className="cell-primary">{supplier.name}</div>
                        <div className="cell-sub">{supplier.phone}</div>
                      </td>
                      <td>
                        <div>{supplier.contactName}</div>
                        <div className="cell-sub">{supplier.email}</div>
                      </td>
                      <td>{supplier.paymentTerms}</td>
                      <td className="right numeric">{supplier.leadTimeDays}d</td>
                      <td className="right numeric">{supplier.reviewDays}d</td>
                      <td className="right amount">{money(supplier.minOrder)}</td>
                      <td className="right numeric">{productCount}</td>
                      <td>{supplier.active ? <Badge tone="green" dot>Active</Badge> : <Badge dot>Inactive</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? `Purchase order ${selected.number}` : 'Purchase order'}
        subtitle={selected ? `${supplierById.get(selected.supplierId)?.name} · version ${selected.version}` : undefined}
        wide
        footer={
          selected ? (
            <>
              {selected.status === 'DRAFT' && can(currentUser, 'po.submit') && (
                <button className="btn btn--primary" onClick={() => { actions.submitPurchaseOrder(selected.id); }}>Submit for approval</button>
              )}
              {selected.status === 'PENDING_APPROVAL' && can(currentUser, 'po.approve') && selected.createdBy !== currentUser.id && (
                <>
                  <button className="btn btn--danger" onClick={() => { setDecision({ po: selected, action: 'reject' }); setDecisionNote(''); }}>Reject</button>
                  <button className="btn btn--primary" onClick={() => { setDecision({ po: selected, action: 'approve' }); setDecisionNote(''); }}>Approve</button>
                </>
              )}
              {selected.status === 'PENDING_APPROVAL' && selected.createdBy === currentUser.id && (
                <span className="tiny muted" style={{ alignSelf: 'center' }}>You created this order. Another approver must decide.</span>
              )}
              {selected.status === 'APPROVED' && can(currentUser, 'po.send') && (
                <button className="btn btn--primary" onClick={() => actions.sendPurchaseOrder(selected.id)}><Send size={15} /> Issue to supplier</button>
              )}
              {['APPROVED', 'SENT', 'PART_RECEIVED'].includes(selected.status) && can(currentUser, 'receipt.manage') && (
                <button className="btn" onClick={() => startReceipt(selected)}><PackageCheck size={15} /> Receive goods</button>
              )}
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(selected.status) && can(currentUser, 'po.create') && (
                <button className="btn btn--ghost" onClick={() => { setDecision({ po: selected, action: 'cancel' }); setDecisionNote(''); }}>Cancel order</button>
              )}
              {['SENT', 'PART_RECEIVED'].includes(selected.status) && can(currentUser, 'po.approve') && (
                <button className="btn btn--ghost" onClick={() => { setDecision({ po: selected, action: 'close' }); setDecisionNote(''); }}>Close short</button>
              )}
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="grid" style={{ gap: 18 }}>
            <div className="flex gap-8 flex-wrap">
              <StatusBadge status={selected.status} kind="po" />
              <Badge tone="outline">{selected.lines.length} line(s)</Badge>
              <Badge tone="outline">Expected {dateShort(selected.expectedDate)}</Badge>
              {selected.status === 'PENDING_APPROVAL' && poTotal(selected) > limit && <Badge tone="red">Above your approval limit</Badge>}
            </div>

            <div className="stat-strip">
              <div><div className="label">Order value</div><div className="value">{money(poTotal(selected))}</div></div>
              <div><div className="label">Outstanding</div><div className="value">{money(poOutstanding(selected))}</div></div>
              <div><div className="label">Expected</div><div className="value">{dateShort(selected.expectedDate)}</div></div>
              <div><div className="label">Raised by</div><div className="value" style={{ fontSize: '0.85rem' }}>{userById.get(selected.createdBy)?.name}</div></div>
            </div>

            <div className="table-wrap">
              <table className="table--compact">
                <thead>
                  <tr><th>Product</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Unit cost</th><th className="right">Line value</th></tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => {
                    const product = productById.get(line.productId);
                    return (
                      <tr key={line.id}>
                        <td><div className="cell-primary">{product?.name ?? 'Unknown'}</div><div className="cell-sub">{product?.sku}</div></td>
                        <td className="right numeric">{num(line.qty)} {product?.baseUnit}</td>
                        <td className="right numeric">{num(line.receivedQty)}</td>
                        <td className="right amount">{money(line.unitCost)}</td>
                        <td className="right amount">{money(line.qty * line.unitCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected.notes && <div className="banner">{selected.notes}</div>}
            {selected.closeReason && <div className="banner banner--warning">Close reason: {selected.closeReason}</div>}

            <div>
              <div className="eyebrow mb-8">Approval trail</div>
              {selected.approvals.length === 0 ? (
                <div className="banner">No decisions recorded. Submitted orders need a different approver.</div>
              ) : (
                selected.approvals.map((approval) => (
                  <div className="list-row" key={approval.id}>
                    <div className="list-row__main">
                      <div className="list-row__title">
                        {approval.decision === 'APPROVED' ? <CheckCircle2 size={13} style={{ verticalAlign: -2, color: 'var(--brand)' }} /> : <XCircle size={13} style={{ verticalAlign: -2, color: 'var(--red)' }} />}{' '}
                        {approval.actorName} {approval.decision.toLowerCase()}
                      </div>
                      <div className="list-row__meta">{dateTime(approval.at)} · limit snapshot {money(approval.limitSnapshot)} · {approval.comment || 'No comment'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="eyebrow mb-8">Document history</div>
              {state.audit.filter((event) => event.entityId === selected.id).slice(0, 8).map((event) => (
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
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="New purchase order"
        subtitle="Saved as a draft first. Requesting approval is a separate, audited action."
        size="xl"
        footer={
          <>
            <span className="tiny muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{draftLines.length} line(s) · {money(draftTotal)}</span>
            <button className="btn btn--ghost" onClick={() => setDraftOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={createPo}>Save draft</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Supplier</label>
            <select className="select" value={draftSupplier} onChange={(e) => setDraftSupplier(e.target.value)}>
              {state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.leadTimeDays}d lead</option>)}
            </select>
          </div>
          <div className="field">
            <label>Expected delivery</label>
            <input className="input" type="date" value={draftExpected} onChange={(e) => setDraftExpected(e.target.value)} />
          </div>
          <div className="field span-2">
            <label>Notes</label>
            <input className="input" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Delivery instructions, agreed price list, promotion…" />
          </div>
        </div>

        <div className="divider" />
        <div className="flex-between mb-8">
          <span className="eyebrow">Order lines</span>
          <button className="btn btn--sm" onClick={() => setDraftLines([...draftLines, { productId: '', qty: '1', costNaira: '' }])}><Plus size={13} /> Add line</button>
        </div>

        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr><th style={{ minWidth: 220 }}>Product</th><th className="right" style={{ width: 100 }}>Qty</th><th className="right" style={{ width: 130 }}>Unit cost (₦)</th><th className="right" style={{ width: 110 }}>Line total</th><th /></tr>
            </thead>
            <tbody>
              {draftLines.map((line, index) => {
                const product = productById.get(line.productId);
                const lineTotal = (Number(line.qty) || 0) * Math.round((Number(line.costNaira) || 0) * 100);
                return (
                  <tr key={index}>
                    <td>
                      <select
                        className="select"
                        value={line.productId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          const next = [...draftLines];
                          const chosen = productById.get(pid);
                          next[index] = { ...line, productId: pid, costNaira: line.costNaira || (chosen ? String(chosen.cost / 100) : '') };
                          setDraftLines(next);
                          if (chosen) setDraftSupplier(chosen.supplierId);
                        }}
                      >
                        <option value="">Select product</option>
                        {state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td><input className="input" type="number" min={0} step="0.001" value={line.qty} onChange={(e) => { const next = [...draftLines]; next[index] = { ...line, qty: e.target.value }; setDraftLines(next); }} /></td>
                    <td><input className="input" type="number" min={0} step="0.01" value={line.costNaira} onChange={(e) => { const next = [...draftLines]; next[index] = { ...line, costNaira: e.target.value }; setDraftLines(next); }} /></td>
                    <td className="right amount">{money(lineTotal)}</td>
                    <td className="right">
                      <button className="btn btn--sm btn--ghost" onClick={() => setDraftLines(draftLines.filter((_, i) => i !== index))} aria-label="Remove line" disabled={draftLines.length === 1}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {productById.size > 0 && draftLines.some((line) => line.productId) && (
          <div className="banner banner--info mt-12">
            Stock on hand for this draft: {num(draftLines.reduce((sum, line) => sum + (line.productId ? (stockMap.get(line.productId)?.onHand ?? 0) : 0), 0))} units. On-order commits only after approval.
          </div>
        )}
      </Modal>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.action === 'approve' ? 'Approve purchase order' : decision?.action === 'reject' ? 'Reject purchase order' : decision?.action === 'cancel' ? 'Cancel purchase order' : 'Close order short'}
        subtitle={decision ? `${decision.po.number} · ${money(poTotal(decision.po))}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setDecision(null)}>Back</button>
            <button className={`btn ${decision?.action === 'reject' || decision?.action === 'cancel' ? 'btn--danger' : 'btn--primary'}`} onClick={submitDecision}>
              {decision?.action === 'approve' ? 'Approve' : decision?.action === 'reject' ? 'Reject to draft' : decision?.action === 'cancel' ? 'Cancel order' : 'Close short'}
            </button>
          </>
        }
      >
        {decision && (
          <div className="grid">
            {decision.action === 'approve' && (
              <div className={`banner ${poTotal(decision.po) > limit ? 'banner--warning' : 'banner--info'}`}>
                Order value {money(poTotal(decision.po))} · your approval limit {money(limit)}.
                {poTotal(decision.po) > limit ? ' The owner must approve this order.' : ' Approval records the limit snapshot.'}
              </div>
            )}
            <div className="field">
              <label>Comment {decision.action === 'approve' ? '(optional)' : <span className="req">*</span>}</label>
              <textarea className="textarea" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Terms checked, supplier confirmed, reason for the decision…" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
