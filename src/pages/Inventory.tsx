import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Download,
  PackageMinus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat, StatusBadge, Tabs } from '../components/ui';
import { can } from '../domain/permissions';
import { MOVEMENT_LABELS, STATUS_LABELS, stockFor } from '../domain/inventory';
import { dateShort, dateTime, downloadCsv, money, num, relative } from '../lib/format';
import type { StockStatus, WriteOff } from '../types';

type Tab = 'stock' | 'ledger' | 'transfers' | 'writeoffs';

const TRANSFERABLE: StockStatus[] = ['SELLABLE', 'QUARANTINE', 'DAMAGED', 'EXPIRED', 'RECALL', 'RETURN_PENDING'];

export default function Inventory() {
  const { state, currentUser, stockMap, actions } = useApp();
  const [tab, setTab] = useState<Tab>('stock');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledgerType, setLedgerType] = useState('ALL');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerLimit, setLedgerLimit] = useState(120);
  const [movementModal, setMovementModal] = useState<'transfer' | 'status' | 'writeoff' | null>(null);
  const [form, setForm] = useState({
    productId: state.products[0]?.id ?? '',
    batchId: '',
    fromLocationId: 'loc-store',
    toLocationId: 'loc-shop',
    fromStatus: 'SELLABLE' as StockStatus,
    toStatus: 'QUARANTINE' as StockStatus,
    qty: '1',
    reason: '',
    note: '',
  });
  const [decision, setDecision] = useState<{ writeOff: WriteOff; action: 'approve' | 'reject' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const locationById = useMemo(() => new Map(state.locations.map((l) => [l.id, l])), [state.locations]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);

  const stockRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products
      .map((product) => ({ product, stock: stockFor(stockMap, product.id) }))
      .filter(({ product, stock }) => {
        if (!product.active && stock.onHand === 0) return false;
        if (term && !`${product.name} ${product.sku} ${product.brand}`.toLowerCase().includes(term)) return false;
        if (locationFilter !== 'ALL' && !stock.batches.some((b) => b.locationId === locationFilter && Math.abs(b.qty) > 0.0005)) return false;
        if (statusFilter !== 'ALL' && !stock.batches.some((b) => b.status === statusFilter && Math.abs(b.qty) > 0.0005)) return false;
        return true;
      })
      .sort((a, b) => b.stock.onHand - a.stock.onHand);
  }, [state.products, stockMap, search, locationFilter, statusFilter]);

  const selected = selectedId ? productById.get(selectedId) ?? null : null;
  const selectedStock = selected ? stockFor(stockMap, selected.id) : null;
  const selectedMovements = selected
    ? state.movements.filter((m) => m.productId === selected.id).slice(-14).reverse()
    : [];

  const ledger = useMemo(() => {
    const term = ledgerSearch.trim().toLowerCase();
    return state.movements
      .filter((m) => {
        if (ledgerType !== 'ALL' && m.type !== ledgerType) return false;
        if (!term) return true;
        const product = productById.get(m.productId);
        return `${product?.name ?? ''} ${product?.sku ?? ''} ${m.note ?? ''} ${m.reason ?? ''}`.toLowerCase().includes(term);
      })
      .slice()
      .reverse();
  }, [state.movements, ledgerType, ledgerSearch, productById]);

  const lowCount = state.products.filter((p) => {
    const s = stockFor(stockMap, p.id);
    return p.active && s.available > 0 && s.available <= p.reorderPoint;
  }).length;
  const outCount = state.products.filter((p) => p.active && stockFor(stockMap, p.id).available <= 0).length;
  const negative = [...stockMap.values()].filter((s) => s.onHand < -0.0005).length;

  const openMovement = (kind: 'transfer' | 'status' | 'writeoff', productId?: string) => {
    const target = productId ?? state.products[0]?.id ?? '';
    const stock = stockFor(stockMap, target);
    const first = stock.batches.find((b) => b.qty > 0.0005);
    setForm({
      productId: target,
      batchId: first?.batchId ?? '',
      fromLocationId: first?.locationId ?? 'loc-store',
      toLocationId: first?.locationId === 'loc-shop' ? 'loc-store' : 'loc-shop',
      fromStatus: first?.status ?? 'SELLABLE',
      toStatus: 'QUARANTINE',
      qty: '1',
      reason: '',
      note: '',
    });
    setMovementModal(kind);
  };

  const pickProduct = (productId: string) => {
    const stock = stockFor(stockMap, productId);
    const first = stock.batches.find((b) => b.qty > 0.0005);
    setForm((prev) => ({
      ...prev,
      productId,
      batchId: first?.batchId ?? '',
      fromLocationId: first?.locationId ?? prev.fromLocationId,
      fromStatus: first?.status ?? 'SELLABLE',
    }));
  };

  const pickBatch = (batchId: string) => {
    const balance = stockFor(stockMap, form.productId).batches.find((b) => b.batchId === batchId && b.qty > 0.0005);
    setForm((prev) => ({
      ...prev,
      batchId,
      fromLocationId: balance?.locationId ?? prev.fromLocationId,
      fromStatus: balance?.status ?? prev.fromStatus,
    }));
  };

  const submitMovement = () => {
    const qty = Number(form.qty);
    if (movementModal === 'transfer') {
      if (actions.createTransfer({ productId: form.productId, batchId: form.batchId, qty, fromLocationId: form.fromLocationId, toLocationId: form.toLocationId, reason: form.reason })) {
        setMovementModal(null);
      }
    } else if (movementModal === 'status') {
      if (actions.changeBatchStatus({ productId: form.productId, batchId: form.batchId, qty, locationId: form.fromLocationId, fromStatus: form.fromStatus, toStatus: form.toStatus, reason: form.reason })) {
        setMovementModal(null);
      }
    } else if (movementModal === 'writeoff') {
      if (actions.requestWriteOff({ productId: form.productId, batchId: form.batchId, qty, reason: form.reason, note: form.note })) {
        setMovementModal(null);
      }
    }
  };

  const exportLedger = () => {
    downloadCsv(`stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Seq', 'Business time', 'Posted at', 'Type', 'Product', 'SKU', 'Batch', 'From', 'To', 'Qty', 'Unit', 'Unit cost (NGN)', 'Value (NGN)', 'Reference', 'Actor', 'Sync'],
      ...ledger.map((m) => {
        const product = productById.get(m.productId);
        const batch = state.batches.find((b) => b.id === m.batchId);
        return [
          m.seq,
          m.occurredAt,
          m.postedAt,
          m.type,
          product?.name ?? '',
          product?.sku ?? '',
          batch?.batchNo ?? '',
          m.from ? `${locationById.get(m.from.locationId)?.name ?? ''} / ${m.from.status}` : '',
          m.to ? `${locationById.get(m.to.locationId)?.name ?? ''} / ${m.to.status}` : '',
          m.qty,
          product?.baseUnit ?? '',
          (m.unitCost / 100).toFixed(2),
          (m.value / 100).toFixed(2),
          m.note ?? m.refId,
          userById.get(m.actorId)?.name ?? m.actorId,
          m.sync,
        ];
      }),
    ]);
    actions.toast(`Exported ${ledger.length} ledger lines.`);
  };

  const submitDecision = () => {
    if (!decision) return;
    if (decision.action === 'approve') {
      if (actions.approveWriteOff(decision.writeOff.id, decisionNote)) setDecision(null);
    } else {
      actions.rejectWriteOff(decision.writeOff.id, decisionNote);
      setDecision(null);
    }
  };

  const batchOptions = form.productId
    ? stockFor(stockMap, form.productId).batches
        .filter((b) => b.qty > 0.0005 && (movementModal !== 'transfer' || b.status === 'SELLABLE'))
        .filter((b, index, list) => list.findIndex((x) => x.batchId === b.batchId) === index)
    : [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock control"
        title="Stock explorer"
        subtitle="Balances are projections of the append-only movement ledger. There is no direct quantity edit anywhere."
        actions={
          <>
            {can(currentUser, 'stock.transfer') && (
              <button className="btn" onClick={() => openMovement('transfer')}><ArrowLeftRight size={16} /> Transfer</button>
            )}
            {can(currentUser, 'writeoff.create') && (
              <button className="btn btn--primary" onClick={() => openMovement('writeoff')}><PackageMinus size={16} /> Request write-off</button>
            )}
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Stock on hand" value={num(state.products.reduce((sum, p) => sum + stockFor(stockMap, p.id).onHand, 0))} icon={<Warehouse size={15} />} meta="All locations and statuses" />
        <Stat label="Location balances" value={state.locations.length} icon={<SlidersHorizontal size={15} />} meta={`${state.locations.filter((l) => l.sellingAllowed).length} selling location(s)`} />
        <Stat label="Out / low" value={`${outCount} / ${lowCount}`} icon={<ShieldAlert size={15} />} tone={outCount ? 'danger' : lowCount ? 'warning' : undefined} meta="Active SKUs at or below reorder point" />
        <Stat label="Negative balances" value={negative} icon={<ShieldAlert size={15} />} tone={negative ? 'danger' : undefined} meta="Should always be zero" />
      </div>

      <Tabs
        tabs={[
          { id: 'stock', label: 'Stock position', count: state.products.length },
          { id: 'ledger', label: 'Movement ledger', count: state.movements.length },
          { id: 'transfers', label: 'Transfers', count: state.transfers.length },
          { id: 'writeoffs', label: 'Write-offs', count: state.writeOffs.filter((w) => w.status === 'PENDING_APPROVAL').length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'stock' && (
        <Card flush>
          <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="search" style={{ flex: '1 1 240px' }}>
              <Search />
              <input className="input" placeholder="Search product, SKU or brand" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stock" />
            </div>
            <select className="select" style={{ width: 190 }} value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} aria-label="Filter by location">
              <option value="ALL">All locations</option>
              {state.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="select" style={{ width: 170 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="ALL">All statuses</option>
              {TRANSFERABLE.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          {stockRows.length === 0 ? (
            <EmptyState title="No stock matches" description="Zero stock is different from no data: clear filters or receive stock." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="right">On hand</th>
                    <th className="right">Sellable</th>
                    <th className="right">Shop floor</th>
                    <th className="right">Back store</th>
                    <th className="right">Non-sellable</th>
                    <th className="right">Expired</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map(({ product, stock }) => {
                    const shop = stock.locations.find((l) => l.locationId === 'loc-shop')?.qty ?? 0;
                    const store = stock.locations.find((l) => l.locationId === 'loc-store')?.qty ?? 0;
                    return (
                      <tr key={product.id} className="is-clickable" onClick={() => setSelectedId(product.id)}>
                        <td>
                          <div className="flex gap-10">
                            <span className="thumb">{product.sku.slice(0, 3)}</span>
                            <div>
                              <div className="cell-primary">{product.name}</div>
                              <div className="cell-sub">{product.sku} · {product.baseUnit}</div>
                            </div>
                          </div>
                        </td>
                        <td className="right amount">{num(stock.onHand, product.baseUnit === 'each' ? 0 : 3)}</td>
                        <td className="right numeric">{num(stock.sellable)}</td>
                        <td className="right numeric">{num(shop)}</td>
                        <td className="right numeric">{num(store)}</td>
                        <td className="right numeric">{num(stock.nonSellable)}</td>
                        <td className="right numeric">{stock.expired > 0 ? <span className="text-red">{num(stock.expired)}</span> : '—'}</td>
                        <td>
                          {stock.onHand <= 0 ? (
                            <Badge tone="red">Out</Badge>
                          ) : stock.available <= product.reorderPoint ? (
                            <Badge tone="amber">Low</Badge>
                          ) : (
                            <Badge tone="green">Healthy</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'ledger' && (
        <Card
          title="Movement ledger"
          subtitle="Append-only. Transfers and status changes share one transaction with balanced legs."
          action={<button className="btn btn--sm" onClick={exportLedger}><Download size={14} /> Export CSV</button>}
          flush
        >
          <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="search" style={{ flex: '1 1 240px' }}>
              <Search />
              <input className="input" placeholder="Search product or reference" value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} aria-label="Search ledger" />
            </div>
            <select className="select" style={{ width: 190 }} value={ledgerType} onChange={(e) => setLedgerType(e.target.value)} aria-label="Filter movement type">
              <option value="ALL">All movement types</option>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span className="tag" style={{ alignSelf: 'center' }}>{ledger.length} lines</span>
          </div>
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Product / batch</th>
                  <th>Movement</th>
                  <th className="right">Qty</th>
                  <th className="right">Value</th>
                  <th>Reference</th>
                  <th>Sync</th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, ledgerLimit).map((m) => {
                  const product = productById.get(m.productId);
                  const batch = state.batches.find((b) => b.id === m.batchId);
                  return (
                    <tr key={m.id}>
                      <td className="mono tiny">{m.seq}</td>
                      <td className="nowrap">{dateShort(m.occurredAt)}<div className="cell-sub">{dateTime(m.occurredAt).split(',')[1]}</div></td>
                      <td>{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                      <td>
                        <div className="cell-primary">{product?.name ?? 'Unknown'}</div>
                        <div className="cell-sub mono">{batch?.batchNo}</div>
                      </td>
                      <td>
                        <div className="cell-sub">
                          {m.from ? `${locationById.get(m.from.locationId)?.name} · ${m.from.status.toLowerCase()}` : 'External'} <ArrowRight size={11} style={{ verticalAlign: -1 }} /> {m.to ? `${locationById.get(m.to.locationId)?.name} · ${m.to.status.toLowerCase()}` : 'External'}
                        </div>
                      </td>
                      <td className="right numeric">{num(m.qty)} {product?.baseUnit}</td>
                      <td className="right amount">{money(m.value)}</td>
                      <td>
                        <div className="cell-sub">{m.note ?? m.reason ?? '—'}</div>
                        <div className="cell-sub">{userById.get(m.actorId)?.name ?? m.actorId}</div>
                      </td>
                      <td><StatusBadge status={m.sync} kind="sync" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ledger.length > ledgerLimit && (
            <div style={{ padding: 14, textAlign: 'center' }}>
              <button className="btn" onClick={() => setLedgerLimit((n) => n + 120)}>Load more ({ledger.length - ledgerLimit} remaining)</button>
            </div>
          )}
        </Card>
      )}

      {tab === 'transfers' && (
        <Card title="Location transfers" subtitle="Every transfer posts one balanced movement between two locations." flush>
          {state.transfers.length === 0 ? (
            <EmptyState title="No transfers yet" description="Move stock from the back store to the shop floor when shelves are replenished." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Transfer</th>
                    <th>Product</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="right">Qty</th>
                    <th>Reason</th>
                    <th>Time</th>
                    <th>Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {state.transfers.map((transfer) => {
                    const product = productById.get(transfer.productId);
                    return (
                      <tr key={transfer.id}>
                        <td className="mono">{transfer.number}</td>
                        <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.sku}</div></td>
                        <td>{locationById.get(transfer.fromLocationId)?.name}</td>
                        <td>{locationById.get(transfer.toLocationId)?.name}</td>
                        <td className="right numeric">{num(transfer.qty)} {product?.baseUnit}</td>
                        <td className="cell-sub">{transfer.reason}</td>
                        <td className="nowrap">{relative(transfer.at)}</td>
                        <td><StatusBadge status={transfer.sync} kind="sync" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'writeoffs' && (
        <Card title="Write-offs" subtitle="Requests require an independent approver and a reason code." flush>
          {state.writeOffs.length === 0 ? (
            <EmptyState title="No write-offs" description="Expired or damaged stock is written off through an approved document." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Product / batch</th>
                    <th className="right">Qty</th>
                    <th className="right">Value</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Requested by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.writeOffs.map((writeOff) => {
                    const product = productById.get(writeOff.productId);
                    const batch = state.batches.find((b) => b.id === writeOff.batchId);
                    const own = writeOff.requestedBy === currentUser.id;
                    const canDecide = can(currentUser, 'writeoff.approve') && writeOff.status === 'PENDING_APPROVAL';
                    return (
                      <tr key={writeOff.id}>
                        <td className="mono">{writeOff.number}</td>
                        <td>
                          <div className="cell-primary">{product?.name}</div>
                          <div className="cell-sub mono">{batch?.batchNo}</div>
                        </td>
                        <td className="right numeric">{num(writeOff.qty)} {product?.baseUnit}</td>
                        <td className="right amount">{money(writeOff.value)}</td>
                        <td>{writeOff.reason}</td>
                        <td>
                          <Badge tone={writeOff.status === 'POSTED' ? 'green' : writeOff.status === 'REJECTED' ? 'red' : 'amber'} dot>
                            {writeOff.status === 'PENDING_APPROVAL' ? 'Pending approval' : writeOff.status === 'POSTED' ? 'Posted' : 'Rejected'}
                          </Badge>
                        </td>
                        <td>
                          <div>{userById.get(writeOff.requestedBy)?.name ?? '—'}</div>
                          <div className="cell-sub">{relative(writeOff.requestedAt)}</div>
                        </td>
                        <td className="right">
                          {canDecide && !own && (
                            <div className="flex gap-4">
                              <button className="btn btn--sm" onClick={() => { setDecision({ writeOff, action: 'approve' }); setDecisionNote(''); }}>Approve</button>
                              <button className="btn btn--sm btn--danger" onClick={() => { setDecision({ writeOff, action: 'reject' }); setDecisionNote(''); }}>Reject</button>
                            </div>
                          )}
                          {canDecide && own && <span className="tiny muted">Awaiting another approver</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? 'Product'}
        subtitle={selected ? `${selected.sku} · ${selected.brand}` : undefined}
        wide
        footer={
          selected ? (
            <>
              {can(currentUser, 'stock.transfer') && (
                <button className="btn" onClick={() => openMovement('transfer', selected.id)}><ArrowLeftRight size={15} /> Transfer</button>
              )}
              {can(currentUser, 'stock.status') && (
                <button className="btn" onClick={() => openMovement('status', selected.id)}><SlidersHorizontal size={15} /> Change status</button>
              )}
              {can(currentUser, 'writeoff.create') && (
                <button className="btn btn--danger" onClick={() => openMovement('writeoff', selected.id)}><PackageMinus size={15} /> Write off</button>
              )}
            </>
          ) : undefined
        }
      >
        {selected && selectedStock && (
          <div className="grid" style={{ gap: 18 }}>
            <div className="stat-strip">
              <div><div className="label">On hand</div><div className="value">{num(selectedStock.onHand)}</div></div>
              <div><div className="label">Sellable</div><div className="value">{num(selectedStock.sellable)}</div></div>
              <div><div className="label">Reserved</div><div className="value">0</div></div>
              <div><div className="label">Available</div><div className="value">{num(selectedStock.available)}</div></div>
            </div>

            <div>
              <div className="eyebrow mb-8">Batch and location balances</div>
              {selectedStock.batches.length === 0 ? (
                <div className="banner">No balances. Receive stock to create the first batch.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead>
                      <tr><th>Batch</th><th>Expiry</th><th>Location</th><th>Status</th><th className="right">Qty</th></tr>
                    </thead>
                    <tbody>
                      {selectedStock.batches.map((b) => (
                        <tr key={`${b.batchId}-${b.locationId}-${b.status}`}>
                          <td className="mono">{b.batch.batchNo}</td>
                          <td>{dateShort(b.batch.expiry)}</td>
                          <td>{locationById.get(b.locationId)?.name}</td>
                          <td><Badge tone={b.status === 'SELLABLE' ? 'green' : b.status === 'EXPIRED' ? 'red' : 'amber'}>{STATUS_LABELS[b.status]}</Badge></td>
                          <td className="right numeric">{num(b.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <div className="eyebrow mb-8">Movement timeline</div>
              {selectedMovements.length === 0 ? (
                <div className="banner">No movements yet.</div>
              ) : selectedMovements.map((m) => (
                <div className="list-row" key={m.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">{MOVEMENT_LABELS[m.type] ?? m.type} {m.note ? `· ${m.note}` : ''}</div>
                    <div className="list-row__meta">{dateTime(m.occurredAt)} · {m.reason ?? 'No reason'} · {m.sync.toLowerCase()}</div>
                  </div>
                  <div className={`amount ${m.from ? 'negative' : ''}`}>{m.from ? '−' : '+'}{num(m.qty)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!movementModal}
        onClose={() => setMovementModal(null)}
        title={movementModal === 'transfer' ? 'Transfer stock' : movementModal === 'status' ? 'Change stock status' : 'Request a write-off'}
        subtitle="The server validates quantity, location and separation of duties before posting."
        size="wide"
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setMovementModal(null)}>Cancel</button>
            <button className="btn btn--primary" onClick={submitMovement}>
              {movementModal === 'transfer' ? 'Post transfer' : movementModal === 'status' ? 'Post status change' : 'Submit for approval'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field span-2">
            <label>Product</label>
            <select className="select" value={form.productId} onChange={(e) => pickProduct(e.target.value)}>
              {state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
            </select>
          </div>
          <div className="field span-2">
            <label>Batch</label>
            <select className="select" value={form.batchId} onChange={(e) => pickBatch(e.target.value)}>
              <option value="">Select a batch</option>
              {batchOptions.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batch.batchNo} · {locationById.get(b.locationId)?.name} · {b.status} · {num(b.qty)} available
                </option>
              ))}
            </select>
          </div>
          {movementModal === 'transfer' && (
            <>
              <div className="field">
                <label>From location</label>
                <select className="select" value={form.fromLocationId} onChange={(e) => setForm({ ...form, fromLocationId: e.target.value })}>
                  {state.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>To location</label>
                <select className="select" value={form.toLocationId} onChange={(e) => setForm({ ...form, toLocationId: e.target.value })}>
                  {state.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </>
          )}
          {movementModal === 'status' && (
            <>
              <div className="field">
                <label>Location</label>
                <select className="select" value={form.fromLocationId} onChange={(e) => setForm({ ...form, fromLocationId: e.target.value })}>
                  {state.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>From status</label>
                <select className="select" value={form.fromStatus} onChange={(e) => setForm({ ...form, fromStatus: e.target.value as StockStatus })}>
                  {TRANSFERABLE.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>To status</label>
                <select className="select" value={form.toStatus} onChange={(e) => setForm({ ...form, toStatus: e.target.value as StockStatus })}>
                  {TRANSFERABLE.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="field">
            <label>Quantity</label>
            <input className="input" type="number" min={0} step="0.001" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </div>
          <div className="field">
            <label>Reason <span className="req">*</span></label>
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={movementModal === 'writeoff' ? 'Expired, damaged, recall…' : 'Replenishment, relocation…'} />
          </div>
          {movementModal === 'writeoff' && (
            <div className="field span-2">
              <label>Evidence / note</label>
              <textarea className="textarea" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Photo reference, inspector notes, disposal method…" />
            </div>
          )}
          {movementModal === 'writeoff' && (
            <div className="banner banner--warning span-2">
              <ShieldAlert />
              The request is held for a different approver. Stock is not reduced until approval posts a movement.
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.action === 'approve' ? 'Approve write-off' : 'Reject write-off'}
        subtitle={decision ? `${decision.writeOff.number} · ${money(decision.writeOff.value)}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setDecision(null)}>Cancel</button>
            <button className={`btn ${decision?.action === 'approve' ? 'btn--primary' : 'btn--danger'}`} onClick={submitDecision}>
              {decision?.action === 'approve' ? 'Approve and post' : 'Reject request'}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Decision note</label>
          <textarea className="textarea" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="What did you verify before deciding?" />
          <span className="field__hint">Requested by {decision ? userById.get(decision.writeOff.requestedBy)?.name : ''}. You cannot decide your own request.</span>
        </div>
      </Modal>
    </div>
  );
}
