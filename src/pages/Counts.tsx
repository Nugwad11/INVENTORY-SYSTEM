import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  ListChecks,
  Plus,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat, StatusBadge, Tabs } from '../components/ui';
import { can, approvalLimitFor } from '../domain/permissions';
import { dateShort, dateTime, money, num, relative } from '../lib/format';
import type { StockCount } from '../types';

type Tab = 'active' | 'all';

export default function Counts() {
  const { state, currentUser, actions } = useApp();
  const [tab, setTab] = useState<Tab>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [scope, setScope] = useState('Full store count');
  const [locationId, setLocationId] = useState('loc-shop');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [chosenProducts, setChosenProducts] = useState<string[]>([]);
  const [countedDraft, setCountedDraft] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [recountDraft, setRecountDraft] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');

  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);
  const locationById = useMemo(() => new Map(state.locations.map((l) => [l.id, l])), [state.locations]);

  const counts = useMemo(() => {
    const list = [...state.counts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return tab === 'active' ? list.filter((count) => !['POSTED', 'CANCELLED'].includes(count.status)) : list;
  }, [state.counts, tab]);

  const selected = selectedId ? state.counts.find((count) => count.id === selectedId) ?? null : null;

  useEffect(() => {
    if (!pendingId) return;
    const count = state.counts.find((c) => c.id === pendingId);
    if (count) {
      setSelectedId(count.id);
      setPendingId(null);
    }
  }, [pendingId, state.counts]);

  useEffect(() => {
    if (!selected) return;
    const counted: Record<string, string> = {};
    const recounted: Record<string, string> = {};
    const notes: Record<string, string> = {};
    selected.entries.forEach((entry) => {
      counted[entry.id] = entry.countedQty === null ? '' : String(entry.countedQty);
      recounted[entry.id] = entry.recountQty === null ? '' : String(entry.recountQty);
      notes[entry.id] = entry.note;
    });
    setCountedDraft(counted);
    setRecountDraft(recounted);
    setNoteDraft(notes);
    setComment('');
  }, [selectedId, selected?.status]);

  const varianceValue = (count: StockCount) =>
    count.entries.reduce((sum, entry) => {
      const product = productById.get(entry.productId);
      const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
      return sum + Math.abs(counted - entry.systemQty) * (product?.cost ?? 0);
    }, 0);

  const countedProgress = (count: StockCount) =>
    count.entries.filter((entry) => entry.countedQty !== null).length;

  const limit = approvalLimitFor(currentUser.role, state.settings.approvalLimitManager, state.settings.approvalLimitOwner);
  const canBlind = can(currentUser, 'count.count');
  const canApprove = can(currentUser, 'count.approve');
  const canCreate = can(currentUser, 'count.create');

  const openNew = () => {
    setScope('Full store count');
    setLocationId('loc-shop');
    setCategoryFilter('ALL');
    setProductSearch('');
    setChosenProducts(state.products.filter((p) => p.active).map((p) => p.id));
    setNewOpen(true);
  };

  const filteredSelectable = state.products
    .filter((p) => p.active)
    .filter((p) => categoryFilter === 'ALL' || p.categoryId === categoryFilter)
    .filter((p) => !productSearch.trim() || `${p.name} ${p.sku}`.toLowerCase().includes(productSearch.trim().toLowerCase()));

  const create = () => {
    const id = actions.createCount(scope.trim() || 'Stock count', locationId, chosenProducts);
    if (id) {
      setNewOpen(false);
      setPendingId(id);
      setTab('active');
    }
  };

  const saveEntries = () => {
    if (!selected) return;
    const payload = selected.entries.map((entry) => {
      const raw = countedDraft[entry.id] ?? '';
      return { id: entry.id, countedQty: raw.trim() === '' ? null : Number(raw), note: noteDraft[entry.id] ?? '' };
    });
    actions.saveCountEntries(selected.id, payload);
  };

  const submit = () => {
    if (!selected) return;
    const payload = selected.entries.map((entry) => {
      const raw = countedDraft[entry.id] ?? '';
      return { id: entry.id, countedQty: raw.trim() === '' ? null : Number(raw), note: noteDraft[entry.id] ?? '' };
    });
    actions.submitCount(selected.id, payload);
  };

  const saveRecount = () => {
    if (!selected) return;
    const payload = selected.entries.map((entry) => {
      const raw = recountDraft[entry.id] ?? '';
      return { id: entry.id, recountQty: raw.trim() === '' ? null : Number(raw) };
    });
    actions.saveRecount(selected.id, payload);
  };

  const openCount = state.counts.filter((c) => ['OPEN', 'RECOUNT_REQUIRED'].includes(c.status));
  const awaiting = state.counts.filter((c) => c.status === 'PENDING_APPROVAL');
  const posted = state.counts.filter((c) => c.status === 'POSTED');
  const own = selected ? selected.counterId === currentUser.id || selected.submittedBy === currentUser.id : false;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock control"
        title="Stock counts and adjustments"
        subtitle="Counts are blind. Every posted quantity is an adjustment movement derived from a counted value, never a manual edit."
        actions={
          canCreate ? (
            <button className="btn btn--primary" onClick={openNew}><Plus size={16} /> New count</button>
          ) : undefined
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Open counts" value={openCount.length} icon={<ListChecks size={15} />} tone={openCount.length ? 'warning' : undefined} meta="Resume from any device" />
        <Stat label="Awaiting approval" value={awaiting.length} icon={<ShieldCheck size={15} />} meta={`Your approval limit is ${money(limit)}`} />
        <Stat label="Posted counts" value={posted.length} icon={<CheckCircle2 size={15} />} meta="Adjustments linked to the count document" />
        <Stat label="Recount threshold" value={money(state.settings.countVarianceThreshold)} icon={<AlertTriangle size={15} />} meta="Variance above this forces a recount" />
      </div>

      <Tabs
        tabs={[
          { id: 'active', label: 'Active work', count: state.counts.filter((c) => !['POSTED', 'CANCELLED'].includes(c.status)).length },
          { id: 'all', label: 'All counts', count: state.counts.length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      <Card title="Count documents" subtitle="The system quantity is snapshotted when a count opens; intervening movements remain visible to the approver." flush>
        {counts.length === 0 ? (
          <EmptyState title="No counts in this view" description="Start a blind count for the shop floor or the back store." action={canCreate ? <button className="btn btn--primary" onClick={openNew}><Plus size={15} /> New count</button> : undefined} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Count</th>
                  <th>Scope</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="right">Lines</th>
                  <th className="right">Counted</th>
                  <th className="right">Variance</th>
                  <th>Counter</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((count) => {
                  const complete = ['POSTED', 'PENDING_APPROVAL', 'RECOUNT_REQUIRED'].includes(count.status);
                  return (
                    <tr key={count.id} className="is-clickable" onClick={() => setSelectedId(count.id)}>
                      <td className="mono">{count.number}</td>
                      <td>{count.scope}</td>
                      <td>{locationById.get(count.locationId)?.name ?? '—'}</td>
                      <td><StatusBadge status={count.status} kind="count" /></td>
                      <td className="right numeric">{count.entries.length}</td>
                      <td className="right numeric">{countedProgress(count)} / {count.entries.length}</td>
                      <td className="right amount">{complete ? money(varianceValue(count)) : '—'}</td>
                      <td>{userById.get(count.counterId)?.name ?? '—'}</td>
                      <td className="nowrap">{relative(count.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? `Count ${selected.number}` : 'Stock count'}
        subtitle={selected ? `${selected.scope} · ${locationById.get(selected.locationId)?.name}` : undefined}
        wide
        footer={
          selected ? (
            <>
              {(selected.status === 'OPEN' || selected.status === 'RECOUNT_REQUIRED') && canBlind && selected.status === 'OPEN' && (
                <>
                  <button className="btn btn--ghost" onClick={saveEntries}>Save progress</button>
                  <button className="btn btn--primary" onClick={submit}>Submit for approval</button>
                </>
              )}
              {selected.status === 'RECOUNT_REQUIRED' && canBlind && (
                <button className="btn btn--primary" onClick={saveRecount}>Save recount</button>
              )}
              {selected.status === 'PENDING_APPROVAL' && canApprove && !own && (
                <>
                  <button className="btn btn--danger" onClick={() => actions.rejectCount(selected.id, comment || 'Returned for correction')}>Reject</button>
                  <button className="btn btn--primary" onClick={() => actions.approveCount(selected.id, comment)}>Approve and post</button>
                </>
              )}
              {(selected.status === 'OPEN' || selected.status === 'RECOUNT_REQUIRED') && canCreate && (
                <button className="btn btn--ghost" onClick={() => actions.cancelCount(selected.id)}>Cancel count</button>
              )}
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="flex gap-8 flex-wrap">
              <StatusBadge status={selected.status} kind="count" />
              <Badge tone="outline">{selected.entries.length} blind lines</Badge>
              <Badge tone="outline">Snapshot seq {selected.snapshotSeq}</Badge>
              <Badge tone="outline">Counter {userById.get(selected.counterId)?.name}</Badge>
              {selected.status === 'RECOUNT_REQUIRED' && <Badge tone="red">Recount required</Badge>}
            </div>

            {selected.rejectionComment && (
              <div className="banner banner--danger"><XCircle /> Rejected: {selected.rejectionComment}</div>
            )}

            {['POSTED', 'PENDING_APPROVAL'].includes(selected.status) && (
              <div className="stat-strip">
                <div><div className="label">Variance value</div><div className="value">{money(varianceValue(selected))}</div></div>
                <div><div className="label">Lines with variance</div><div className="value">{selected.entries.filter((e) => Math.abs((e.recountQty ?? e.countedQty ?? e.systemQty) - e.systemQty) > 0.0005).length}</div></div>
                <div><div className="label">Threshold</div><div className="value">{money(state.settings.countVarianceThreshold)}</div></div>
                <div><div className="label">Submitted</div><div className="value" style={{ fontSize: '0.8rem' }}>{dateShort(selected.submittedAt)}</div></div>
              </div>
            )}

            {selected.status === 'PENDING_APPROVAL' && varianceValue(selected) > limit && (
              <div className="banner banner--warning">
                <AlertTriangle />
                This variance is {money(varianceValue(selected))}, above your approval limit of {money(limit)}. The owner must approve.
              </div>
            )}

            {selected.status === 'PENDING_APPROVAL' && own && (
              <div className="banner banner--warning">
                <AlertTriangle />
                You counted or submitted this document. A different approver must post it.
              </div>
            )}

            {selected.status === 'PENDING_APPROVAL' && canApprove && !own && (
              <div className="field">
                <label>Approval comment</label>
                <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you review? Intervening movements, reason codes, variance pattern…" />
              </div>
            )}

            {selected.status === 'OPEN' && canBlind && (
              <>
                <div className="banner banner--info">
                  <EyeOff />
                  Blind count: system quantities are hidden while you enter physical counts. Enter 0 where the shelf is empty. Save progress at any time; the count resumes on another device.
                </div>
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead><tr><th>Product</th><th>SKU</th><th style={{ width: 130 }}>Counted qty</th><th>Note</th></tr></thead>
                    <tbody>
                      {selected.entries.map((entry) => {
                        const product = productById.get(entry.productId);
                        return (
                          <tr key={entry.id}>
                            <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.baseUnit}</div></td>
                            <td className="mono">{product?.sku}</td>
                            <td>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                step="0.001"
                                value={countedDraft[entry.id] ?? ''}
                                onChange={(e) => setCountedDraft({ ...countedDraft, [entry.id]: e.target.value })}
                                aria-label={`Counted quantity ${product?.name}`}
                              />
                            </td>
                            <td><input className="input" value={noteDraft[entry.id] ?? ''} onChange={(e) => setNoteDraft({ ...noteDraft, [entry.id]: e.target.value })} placeholder="Shelf note (optional)" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selected.status === 'RECOUNT_REQUIRED' && canBlind && (
              <>
                <div className="banner banner--warning">
                  <AlertTriangle />
                  The first count variance is above {money(state.settings.countVarianceThreshold)}. Recount the flagged lines independently. System quantities stay hidden until submission.
                </div>
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead><tr><th>Product</th><th>SKU</th><th style={{ width: 150 }}>Recount qty</th></tr></thead>
                    <tbody>
                      {selected.entries.map((entry) => {
                        const product = productById.get(entry.productId);
                        return (
                          <tr key={entry.id}>
                            <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.baseUnit}</div></td>
                            <td className="mono">{product?.sku}</td>
                            <td>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                step="0.001"
                                value={recountDraft[entry.id] ?? ''}
                                onChange={(e) => setRecountDraft({ ...recountDraft, [entry.id]: e.target.value })}
                                aria-label={`Recount quantity ${product?.name}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {['PENDING_APPROVAL', 'POSTED'].includes(selected.status) && (
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr><th>Product</th><th className="right">System</th><th className="right">Counted</th><th className="right">Recount</th><th className="right">Variance</th><th className="right">Value</th></tr>
                  </thead>
                  <tbody>
                    {selected.entries.map((entry) => {
                      const product = productById.get(entry.productId);
                      const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
                      const variance = counted - entry.systemQty;
                      return (
                        <tr key={entry.id}>
                          <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.sku} · {product?.baseUnit}</div></td>
                          <td className="right numeric">{num(entry.systemQty)}</td>
                          <td className="right numeric">{entry.countedQty === null ? '—' : num(entry.countedQty)}</td>
                          <td className="right numeric">{entry.recountQty === null ? '—' : num(entry.recountQty)}</td>
                          <td className={`right numeric ${Math.abs(variance) > 0.0005 ? variance > 0 ? 'text-green' : 'text-red' : ''}`}>
                            {Math.abs(variance) > 0.0005 ? `${variance > 0 ? '+' : ''}${num(variance)}` : '—'}
                          </td>
                          <td className="right amount">{money(Math.abs(variance) * (product?.cost ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected.status === 'POSTED' && (
              <div className="banner banner--success">
                <CheckCircle2 />
                Posted {dateTime(selected.postedAt)} by {userById.get(selected.approvedBy ?? '')?.name}. {selected.entries.filter((e) => Math.abs((e.recountQty ?? e.countedQty ?? e.systemQty) - e.systemQty) > 0.0005).length} adjustment movement(s) were created.
              </div>
            )}

            {selected.status === 'CANCELLED' && (
              <div className="banner">This count was cancelled. No adjustments were posted.</div>
            )}

            <div>
              <div className="eyebrow mb-8">Document history</div>
              {state.audit.filter((event) => event.entityId === selected.id).map((event) => (
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
        title="Open a blind count"
        subtitle="The system snapshots current sellable quantities. Counters never see them while entering."
        size="wide"
        footer={
          <>
            <span className="tiny muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{chosenProducts.length} product(s) selected</span>
            <button className="btn btn--ghost" onClick={() => setNewOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={create} disabled={chosenProducts.length === 0}>Open count</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <label>Scope label</label>
            <input className="input" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Aisle 3 beverages" />
          </div>
          <div className="field">
            <label>Location</label>
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {state.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Category filter</label>
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All categories</option>
              {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Product search</label>
            <div className="search">
              <Search />
              <input className="input" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Filter the selectable list" />
            </div>
          </div>
        </div>

        <div className="flex-between mt-12 mb-8">
          <span className="eyebrow">Products in scope</span>
          <div className="flex gap-4">
            <button className="btn btn--sm" onClick={() => setChosenProducts([...new Set([...chosenProducts, ...filteredSelectable.map((p) => p.id)])])}>Select filtered</button>
            <button className="btn btn--sm btn--ghost" onClick={() => setChosenProducts(chosenProducts.filter((id) => !filteredSelectable.some((p) => p.id === id)))}>Clear filtered</button>
          </div>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
          {filteredSelectable.map((product) => (
            <label key={product.id} className="list-row" style={{ padding: '8px 12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={chosenProducts.includes(product.id)}
                onChange={(e) => setChosenProducts(e.target.checked ? [...chosenProducts, product.id] : chosenProducts.filter((id) => id !== product.id))}
                style={{ accentColor: 'var(--brand)' }}
              />
              <div className="list-row__main">
                <div className="list-row__title">{product.name}</div>
                <div className="list-row__meta">{product.sku} · {product.brand}</div>
              </div>
            </label>
          ))}
          {filteredSelectable.length === 0 && <div className="empty"><p>No products match this filter.</p></div>}
        </div>
      </Modal>
    </div>
  );
}
