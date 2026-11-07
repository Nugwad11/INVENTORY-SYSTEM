import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  PackageSearch,
  ShoppingCart,
  TrendingUp,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, EmptyState, PageHeader, SEVERITY_TONE, Stat, StatusBadge } from '../components/ui';
import { BarChart } from '../components/charts';
import { computeExpiryExposure, MOVEMENT_LABELS } from '../domain/inventory';
import { dateKey, dateMedium, money, num, relative, timeOnly } from '../lib/format';
import { can } from '../domain/permissions';

export default function Dashboard() {
  const {
    state,
    currentUser,
    stockMap,
    stockValue,
    activeAlerts,
    reorder,
    online,
    pendingSyncCount,
  } = useApp();
  const navigate = useNavigate();
  const today = dateKey(new Date());

  const completedSales = useMemo(
    () => state.sales.filter((sale) => sale.status !== 'VOIDED'),
    [state.sales],
  );

  const todaySales = completedSales.filter((sale) => dateKey(new Date(sale.occurredAt)) === today);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);

  const last14 = useMemo(() => {
    const days: { label: string; value: number; full: string }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const value = completedSales
        .filter((sale) => dateKey(new Date(sale.occurredAt)) === key)
        .reduce((sum, sale) => sum + sale.total, 0);
      days.push({
        label: d.toLocaleDateString('en-NG', { day: 'numeric' }),
        value,
        full: d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
      });
    }
    return days;
  }, [completedSales]);

  const monthRevenue = completedSales
    .filter((sale) => Date.now() - new Date(sale.occurredAt).getTime() < 30 * 86_400_000)
    .reduce((sum, sale) => sum + sale.total, 0);

  const outOfStock = reorder.filter((item) => item.status === 'OUT');
  const lowStock = reorder.filter((item) => item.status === 'LOW');
  const expiry = useMemo(() => computeExpiryExposure(state, stockMap), [state, stockMap]);
  const expiryValue = expiry.reduce((sum, item) => sum + item.value, 0);

  const openPOs = state.purchaseOrders.filter((po) =>
    ['APPROVED', 'SENT', 'PART_RECEIVED'].includes(po.status),
  );
  const openPoValue = openPOs.reduce(
    (sum, po) => sum + po.lines.reduce((s, l) => s + Math.max(0, l.qty - l.receivedQty) * l.unitCost, 0),
    0,
  );

  const pendingPOs = state.purchaseOrders.filter((po) => po.status === 'PENDING_APPROVAL');
  const pendingCounts = state.counts.filter((count) =>
    ['PENDING_APPROVAL', 'RECOUNT_REQUIRED'].includes(count.status),
  );
  const pendingWriteOffs = state.writeOffs.filter((w) => w.status === 'PENDING_APPROVAL');
  const pendingApprovals = pendingPOs.length + pendingCounts.length + pendingWriteOffs.length;

  const postedWriteOffValue = state.writeOffs
    .filter((w) => w.status === 'POSTED')
    .reduce((sum, w) => sum + w.value, 0);

  const reorderQueue = reorder.filter((item) => item.status !== 'OK').slice(0, 5);
  const recentMovements = [...state.movements].slice(-8).reverse();
  const topAlerts = [...activeAlerts]
    .sort((a, b) => {
      const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return rank[a.severity] - rank[b.severity] || b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 5);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = currentUser.name.split(' ')[0];
  const marginPct =
    stockValue.retailValue > 0 ? (stockValue.marginValue / stockValue.retailValue) * 100 : 0;

  const quickAction = (() => {
    if (can(currentUser, 'sale.create')) {
      return (
        <button className="btn btn--primary" onClick={() => navigate('/sales')}>
          <ShoppingCart size={16} /> Record a sale
        </button>
      );
    }
    if (can(currentUser, 'receipt.manage')) {
      return (
        <button className="btn btn--primary" onClick={() => navigate('/receiving')}>
          <PackageCheck size={16} /> Receive stock
        </button>
      );
    }
    if (can(currentUser, 'po.create')) {
      return (
        <button className="btn btn--primary" onClick={() => navigate('/purchasing')}>
          <ClipboardList size={16} /> Create a purchase order
        </button>
      );
    }
    return (
      <button className="btn btn--primary" onClick={() => navigate('/reports')}>
        <TrendingUp size={16} /> Open reports
      </button>
    );
  })();

  return (
    <div className="page">
      {!online && (
        <div className="banner banner--warning mb-16">
          <WifiOff />
          <div>
            <strong>Offline trading.</strong> Sales, receipts and counts keep working. {pendingSyncCount} document
            {pendingSyncCount === 1 ? '' : 's'} waiting to sync.
          </div>
          <button className="btn btn--sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/inventory')}>
            View stock
          </button>
        </div>
      )}

      <PageHeader
        eyebrow={`${state.store.name} · ${state.store.code}`}
        title={`${greeting}, ${firstName}`}
        subtitle="One reconciled answer for stock, cash exposure and the work that needs a decision today."
        actions={
          <>
            {quickAction}
            {can(currentUser, 'count.create') && (
              <button className="btn" onClick={() => navigate('/counts')}>
                <ClipboardCheck size={16} /> Start a count
              </button>
            )}
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat
          label="Stock value at cost"
          value={money(stockValue.totalCostValue)}
          icon={<Wallet size={15} />}
          meta={
            <>
              <span className="up">{money(stockValue.retailValue)}</span> retail · {marginPct.toFixed(0)}% margin
            </>
          }
        />
        <Stat
          label="Sellable units"
          value={num(stockValue.sellableUnits)}
          icon={<Boxes size={15} />}
          meta={`${stockValue.skuCount} SKUs holding stock · ${num(stockValue.onHandUnits)} units on hand`}
        />
        <Stat
          label="Out of stock / low"
          value={`${outOfStock.length} / ${lowStock.length}`}
          icon={<AlertTriangle size={15} />}
          tone={outOfStock.length > 0 ? 'danger' : lowStock.length > 0 ? 'warning' : undefined}
          meta={
            outOfStock.length > 0
              ? `${outOfStock[0].product.name} needs a purchase decision`
              : 'No stock-outs in the catalogue'
          }
        />
        <Stat
          label="Expiry exposure"
          value={money(expiryValue)}
          icon={<CalendarClock size={15} />}
          tone={expiryValue > 0 ? 'warning' : undefined}
          meta={`${expiry.length} batch${expiry.length === 1 ? '' : 'es'} at risk · ${num(stockValue.expiredUnits)} unit(s) expired`}
        />
      </div>

      <div className="grid grid--4 mb-16">
        <Stat
          label="Sales today"
          value={money(todayRevenue)}
          icon={<TrendingUp size={15} />}
          meta={`${todaySales.length} transaction${todaySales.length === 1 ? '' : 's'} · ${money(monthRevenue)} in 30 days`}
        />
        <Stat
          label="Open purchase orders"
          value={openPOs.length}
          icon={<ClipboardList size={15} />}
          meta={`${money(openPoValue)} outstanding · ${pendingPOs.length} awaiting approval`}
        />
        <Stat
          label="Pending approvals"
          value={pendingApprovals}
          icon={<ClipboardCheck size={15} />}
          tone={pendingApprovals > 0 ? 'warning' : undefined}
          meta={`${pendingPOs.length} PO · ${pendingCounts.length} count · ${pendingWriteOffs.length} write-off`}
        />
        <Stat
          label="Write-offs recorded"
          value={money(postedWriteOffValue)}
          icon={<PackageSearch size={15} />}
          meta={`${state.writeOffs.filter((w) => w.status === 'POSTED').length} posted document(s) · this dataset`}
        />
      </div>

      <div className="grid grid--sidebar mb-16">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card
            title="Sales rhythm"
            subtitle="Completed sales value by trading day. POS is the source; inventory movements follow."
            action={<Badge tone="green">30-day {money(monthRevenue)}</Badge>}
          >
            <BarChart data={last14.map((d) => ({ label: d.label, value: d.value }))} format={money} />
            <div className="flex-between mt-12 tiny muted">
              <span>{last14[0]?.full}</span>
              <span>{money(last14.reduce((s, d) => s + d.value, 0))} over 14 days</span>
              <span>Today</span>
            </div>
          </Card>

          <Card
            title="Replenishment queue"
            subtitle="Suggestions use last-28-day demand, supplier lead time, safety stock and stock on order."
            action={
              <button className="btn btn--sm btn--ghost" onClick={() => navigate('/purchasing')}>
                Open purchasing <ArrowRight size={14} />
              </button>
            }
            flush
          >
            {reorderQueue.length === 0 ? (
              <EmptyState title="Nothing needs reordering" description="Every sellable SKU is above its reorder point." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="right">Sellable</th>
                      <th className="right">On order</th>
                      <th className="right">Suggested</th>
                      <th className="right">Cover</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {reorderQueue.map((item) => (
                      <tr key={item.product.id}>
                        <td>
                          <div className="cell-primary">{item.product.name}</div>
                          <div className="cell-sub">
                            {item.product.sku} · reorder at {num(item.reorderPoint)}
                          </div>
                        </td>
                        <td className="right numeric">
                          {num(item.available)} {item.product.baseUnit}
                        </td>
                        <td className="right numeric">
                          {item.onOrder > 0 ? `${num(item.onOrder)} ${item.product.baseUnit}` : '—'}
                        </td>
                        <td className="right">
                          {item.suggestedQty > 0 ? (
                            <Badge tone={item.status === 'OUT' ? 'red' : 'amber'}>
                              {num(item.suggestedQty)} {item.product.baseUnit}
                            </Badge>
                          ) : (
                            <Badge tone="green">Covered</Badge>
                          )}
                        </td>
                        <td className="right numeric">
                          {item.daysCover === null ? '—' : `${item.daysCover.toFixed(1)}d`}
                        </td>
                        <td className="right">
                          <button className="btn btn--sm" onClick={() => navigate('/purchasing')}>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Card
            title="Needs attention"
            subtitle={`${activeAlerts.length} active alert${activeAlerts.length === 1 ? '' : 's'}, deduplicated by condition`}
            action={
              <button className="btn btn--sm btn--ghost" onClick={() => navigate('/alerts')}>
                Work queue <ArrowRight size={14} />
              </button>
            }
            flush
          >
            {topAlerts.length === 0 ? (
              <EmptyState
                title="Work queue is clear"
                description="No stock, expiry or sync exceptions need action right now."
                icon={<ClipboardCheck size={20} />}
              />
            ) : (
              <div>
                {topAlerts.map((alert) => (
                  <div key={alert.id} className={`alert-item ${alert.severity.toLowerCase()}`}>
                    <span className="alert-item__rail" />
                    <div className="alert-item__main">
                      <div className="alert-item__title">
                        <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge>
                        {alert.title}
                      </div>
                      <div className="alert-item__detail">
                        {alert.value > 0 && <strong style={{ color: 'var(--ink-2)' }}>{money(alert.value)} · </strong>}
                        {relative(alert.updatedAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Approvals waiting" subtitle="Requester and approver must be different people." flush>
            {pendingApprovals === 0 ? (
              <EmptyState title="No approvals waiting" description="Submitted documents have all been decided." />
            ) : (
              <div style={{ padding: '4px 16px' }}>
                {pendingPOs.map((po) => (
                  <div className="list-row" key={po.id}>
                    <div className="list-row__main">
                      <div className="list-row__title">Purchase order {po.number}</div>
                      <div className="list-row__meta">
                        {state.suppliers.find((s) => s.id === po.supplierId)?.name} ·{' '}
                        {money(po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0))}
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={() => navigate('/purchasing')}>
                      Decide
                    </button>
                  </div>
                ))}
                {pendingCounts.map((count) => (
                  <div className="list-row" key={count.id}>
                    <div className="list-row__main">
                      <div className="list-row__title">Count {count.number}</div>
                      <div className="list-row__meta">{count.scope}</div>
                    </div>
                    <button className="btn btn--sm" onClick={() => navigate('/counts')}>
                      Review
                    </button>
                  </div>
                ))}
                {pendingWriteOffs.map((writeOff) => (
                  <div className="list-row" key={writeOff.id}>
                    <div className="list-row__main">
                      <div className="list-row__title">Write-off {writeOff.number}</div>
                      <div className="list-row__meta">
                        {money(writeOff.value)} · {writeOff.reason}
                      </div>
                    </div>
                    <button className="btn btn--sm" onClick={() => navigate('/inventory')}>
                      Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid--2">
        <Card title="Expiring soon" subtitle="FEFO batches that need a sell-through or disposal decision." flush>
          {expiry.length === 0 ? (
            <EmptyState title="No expiry risk" description="No batches are inside their expiry warning window." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="right">Qty</th>
                    <th className="right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {expiry.slice(0, 5).map((item) => (
                    <tr key={`${item.batch.id}-${item.state}`}>
                      <td>
                        <div className="cell-primary">{item.product.name}</div>
                        <div className="cell-sub mono">{item.batch.batchNo}</div>
                      </td>
                      <td>
                        <Badge tone={item.state === 'EXPIRED' ? 'red' : item.state === 'CRITICAL' ? 'red' : 'amber'}>
                          {item.days < 0 ? `${Math.abs(item.days)}d overdue` : `${item.days}d left`}
                        </Badge>
                      </td>
                      <td className="right numeric">
                        {num(item.qty, item.product.baseUnit === 'each' ? 0 : 3)} {item.product.baseUnit}
                      </td>
                      <td className="right amount">{money(item.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Latest movements"
          subtitle="Every balance change is a posted ledger movement."
          action={
            <button className="btn btn--sm btn--ghost" onClick={() => navigate('/reports')}>
              Full ledger <ArrowRight size={14} />
            </button>
          }
          flush
        >
          <div style={{ padding: '4px 16px' }}>
            {recentMovements.map((movement) => {
              const product = state.products.find((p) => p.id === movement.productId);
              const batch = state.batches.find((b) => b.id === movement.batchId);
              return (
                <div className="list-row" key={movement.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">
                      {MOVEMENT_LABELS[movement.type] ?? movement.type} · {product?.name ?? 'Unknown product'}
                    </div>
                    <div className="list-row__meta">
                      {batch?.batchNo} · {timeOnly(movement.occurredAt)} · {movement.note ?? movement.reason ?? '—'}
                    </div>
                  </div>
                  <div className="right">
                    <div className={`amount ${movement.type === 'SALE' ? 'negative' : ''}`}>
                      {movement.from ? '−' : '+'}
                      {num(movement.qty, product?.baseUnit === 'each' ? 0 : 3)} {product?.baseUnit}
                    </div>
                    <div className="tiny muted">{money(movement.value)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-16 tiny muted" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>Last sync {relative(state.lastSyncAt)}</span>
        <span>·</span>
        <span>{state.movements.length.toLocaleString()} ledger movements</span>
        <span>·</span>
        <span>
          Data seeded {dateMedium(state.seededAt)} · alerts computed {relative(activeAlerts[0]?.updatedAt ?? state.lastSyncAt)}
        </span>
      </div>
    </div>
  );
}
