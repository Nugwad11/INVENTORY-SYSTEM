import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Download,
  PackageMinus,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, EmptyState, PageHeader, Stat, Tabs } from '../components/ui';
import { can } from '../domain/permissions';
import { computeExpiryExposure, stockFor } from '../domain/inventory';
import { dateShort, dateTime, downloadCsv, money, num, pct } from '../lib/format';

type Tab = 'valuation' | 'sales' | 'expiry' | 'shrinkage' | 'reorder';

export default function Reports() {
  const { state, currentUser, stockMap, stockValue, reorder, actions } = useApp();
  const [tab, setTab] = useState<Tab>('valuation');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [windowDays, setWindowDays] = useState(30);

  const canSeeCost = can(currentUser, 'catalog.cost.view') || can(currentUser, 'stock.cost.view');
  const canExport = can(currentUser, 'report.export');
  const asOf = new Date();
  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const categoryById = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);

  const valuationRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products
      .map((product) => ({ product, stock: stockFor(stockMap, product.id) }))
      .filter(({ product, stock }) => {
        if (category !== 'ALL' && product.categoryId !== category) return false;
        if (term && !`${product.name} ${product.sku} ${product.brand}`.toLowerCase().includes(term)) return false;
        return Math.abs(stock.onHand) > 0.0005;
      })
      .sort((a, b) => b.stock.onHand * b.product.cost - a.stock.onHand * a.product.cost);
  }, [state.products, stockMap, search, category]);

  const salesWindow = useMemo(() => {
    const from = asOf.getTime() - windowDays * 86_400_000;
    const sales = state.sales.filter(
      (sale) => sale.status !== 'VOIDED' && new Date(sale.occurredAt).getTime() >= from,
    );
    const byProduct = new Map<string, { qty: number; revenue: number; cost: number }>();
    let revenue = 0;
    let cost = 0;
    let units = 0;
    sales.forEach((sale) => {
      sale.lines.forEach((line) => {
        const qty = Math.max(0, line.qty - line.returnedQty);
        const lineRevenue = Math.round(qty * line.unitPrice);
        const lineCost = Math.round(qty * line.unitCost);
        revenue += lineRevenue;
        cost += lineCost;
        units += qty;
        const current = byProduct.get(line.productId) ?? { qty: 0, revenue: 0, cost: 0 };
        current.qty += qty;
        current.revenue += lineRevenue;
        current.cost += lineCost;
        byProduct.set(line.productId, current);
      });
    });
    return {
      sales,
      revenue,
      cost,
      units,
      margin: revenue - cost,
      byProduct: [...byProduct.entries()]
        .map(([productId, value]) => ({ product: productById.get(productId), ...value }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }, [state.sales, windowDays, productById]);

  const expiry = useMemo(() => computeExpiryExposure(state, stockMap), [state, stockMap]);

  const shrinkage = useMemo(() => {
    const posted = state.writeOffs.filter((writeOff) => writeOff.status === 'POSTED');
    const writeOffValue = posted.reduce((sum, writeOff) => sum + writeOff.value, 0);
    const countValue = state.counts
      .filter((count) => count.status === 'POSTED')
      .reduce((sum, count) => {
        return (
          sum +
          count.entries.reduce((lineSum, entry) => {
            const product = productById.get(entry.productId);
            const counted = entry.recountQty ?? entry.countedQty ?? entry.systemQty;
            return lineSum + Math.abs(counted - entry.systemQty) * (product?.cost ?? 0);
          }, 0)
        );
      }, 0);
    return { posted, writeOffValue, countValue };
  }, [state.writeOffs, state.counts, productById]);

  const exportCurrent = () => {
    if (!canExport) {
      actions.toast('Your role cannot export reports.', 'error');
      return;
    }
    const generatedAt = new Date().toISOString();
    const meta = [
      ['Report', tab],
      ['Generated at', generatedAt],
      ['Store', state.store.name],
      ['Timezone', state.store.timezone],
      ['Filters', tab === 'sales' ? `last ${windowDays} days` : category],
    ];
    let rows: (string | number)[][] = [];
    if (tab === 'valuation') {
      rows = [
        ['SKU', 'Product', 'Category', 'On hand', 'Unit', 'Cost (NGN)', 'Stock value (NGN)', 'Retail value (NGN)'],
        ...valuationRows.map(({ product, stock }) => [
          product.sku,
          product.name,
          categoryById.get(product.categoryId)?.name ?? '',
          stock.onHand,
          product.baseUnit,
          canSeeCost ? (product.cost / 100).toFixed(2) : 'restricted',
          canSeeCost ? ((stock.onHand * product.cost) / 100).toFixed(2) : 'restricted',
          (stock.sellable * product.price) > 0 ? ((stock.sellable * product.price) / 100).toFixed(2) : '0.00',
        ]),
      ];
    } else if (tab === 'sales') {
      rows = [
        ['SKU', 'Product', 'Units', 'Revenue (NGN)', 'Cost of goods (NGN)', 'Gross margin (NGN)', 'Margin %'],
        ...salesWindow.byProduct.map((row) => [
          row.product?.sku ?? '',
          row.product?.name ?? 'Unknown',
          row.qty,
          (row.revenue / 100).toFixed(2),
          canSeeCost ? (row.cost / 100).toFixed(2) : 'restricted',
          canSeeCost ? ((row.revenue - row.cost) / 100).toFixed(2) : 'restricted',
          canSeeCost && row.revenue > 0 ? (((row.revenue - row.cost) / row.revenue) * 100).toFixed(1) : 'restricted',
        ]),
      ];
    } else if (tab === 'expiry') {
      rows = [
        ['Product', 'SKU', 'Batch', 'Expiry', 'Days', 'Qty', 'Value (NGN)', 'State'],
        ...expiry.map((item) => [
          item.product.name,
          item.product.sku,
          item.batch.batchNo,
          item.batch.expiry ?? '',
          item.days,
          item.qty,
          canSeeCost ? (item.value / 100).toFixed(2) : 'restricted',
          item.state,
        ]),
      ];
    } else if (tab === 'shrinkage') {
      rows = [
        ['Document', 'Type', 'Product', 'Reason', 'Qty', 'Value (NGN)', 'Requested by', 'Decided by', 'Status'],
        ...shrinkage.posted.map((writeOff) => [
          writeOff.number,
          'Write-off',
          productById.get(writeOff.productId)?.name ?? '',
          writeOff.reason,
          writeOff.qty,
          canSeeCost ? (writeOff.value / 100).toFixed(2) : 'restricted',
          state.users.find((u) => u.id === writeOff.requestedBy)?.name ?? '',
          state.users.find((u) => u.id === writeOff.decidedBy)?.name ?? '',
          writeOff.status,
        ]),
      ];
    } else {
      rows = [
        ['SKU', 'Product', 'Available', 'On order', 'Reorder point', 'Suggested qty', 'Days cover', 'Basis'],
        ...reorder.map((item) => [
          item.product.sku,
          item.product.name,
          item.available,
          item.onOrder,
          item.reorderPoint,
          item.suggestedQty,
          item.daysCover === null ? '' : item.daysCover.toFixed(1),
          item.reason,
        ]),
      ];
    }
    downloadCsv(`${tab}-report-${generatedAt.slice(0, 10)}.csv`, [...meta, [], ...rows]);
    actions.toast('Report exported with filter and timestamp metadata.');
  };

  const salesMarginPct = salesWindow.revenue > 0 ? (salesWindow.margin / salesWindow.revenue) * 100 : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Oversight"
        title="Reports and dashboards"
        subtitle={`As of ${dateTime(asOf.toISOString())} · ${state.store.timezone}. Sellable and non-sellable value are labelled separately.`}
        actions={<button className="btn btn--primary" onClick={exportCurrent} disabled={!canExport}><Download size={16} /> Export CSV</button>}
      />

      <Tabs
        tabs={[
          { id: 'valuation', label: 'Stock valuation' },
          { id: 'sales', label: 'Sales & margin' },
          { id: 'expiry', label: 'Expiry exposure', count: expiry.length },
          { id: 'shrinkage', label: 'Shrinkage', count: shrinkage.posted.length },
          { id: 'reorder', label: 'Replenishment', count: reorder.filter((r) => r.suggestedQty > 0).length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === 'valuation' && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Stock value at cost" value={money(stockValue.totalCostValue)} icon={<Wallet size={15} />} meta={canSeeCost ? `${num(stockValue.onHandUnits)} units across ${stockValue.skuCount} SKUs` : 'Cost restricted for your role'} />
            <Stat label="Sellable value" value={money(stockValue.sellableCostValue)} icon={<Wallet size={15} />} meta="Shop-floor sellable stock" />
            <Stat label="Non-sellable value" value={money(stockValue.nonSellableCostValue)} icon={<PackageMinus size={15} />} tone={stockValue.nonSellableCostValue > 0 ? 'warning' : undefined} meta="Store room, quarantine, damaged, expired" />
            <Stat label="Retail value" value={money(stockValue.retailValue)} icon={<TrendingUp size={15} />} meta={`${money(stockValue.marginValue)} embedded margin`} />
          </div>
          <Card title="Stock on hand and valuation" subtitle="Totals reconcile to the movement ledger at the latest posted sequence." flush>
            <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="search" style={{ flex: '1 1 220px' }}>
                <Search />
                <input className="input" placeholder="Search product, SKU or brand" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search valuation" />
              </div>
              <select className="select" style={{ width: 190 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter valuation category">
                <option value="ALL">All categories</option>
                {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th className="right">On hand</th>
                    <th className="right">Sellable</th>
                    <th className="right">Non-sellable</th>
                    {canSeeCost && <th className="right">Unit cost</th>}
                    {canSeeCost && <th className="right">Stock value</th>}
                    <th className="right">Retail value</th>
                  </tr>
                </thead>
                <tbody>
                  {valuationRows.map(({ product, stock }) => (
                    <tr key={product.id}>
                      <td><div className="cell-primary">{product.name}</div><div className="cell-sub">{product.sku}</div></td>
                      <td>{categoryById.get(product.categoryId)?.name}</td>
                      <td className="right numeric">{num(stock.onHand)}</td>
                      <td className="right numeric">{num(stock.sellable)}</td>
                      <td className="right numeric">{num(stock.nonSellable + stock.storageSellable)}</td>
                      {canSeeCost && <td className="right amount">{money(product.cost)}</td>}
                      {canSeeCost && <td className="right amount">{money(stock.onHand * product.cost)}</td>}
                      <td className="right amount">{money(stock.sellable * product.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {valuationRows.length === 0 && <EmptyState title="No stock in this view" description="Clear the search or category filter." />}
          </Card>
        </>
      )}

      {tab === 'sales' && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label={`Revenue · ${windowDays} days`} value={money(salesWindow.revenue)} icon={<TrendingUp size={15} />} meta={`${salesWindow.sales.length} transactions`} />
            <Stat label="Units sold" value={num(salesWindow.units)} icon={<Wallet size={15} />} meta="Net of returns" />
            <Stat label="Gross margin" value={canSeeCost ? money(salesWindow.margin) : 'Restricted'} icon={<TrendingUp size={15} />} meta={canSeeCost ? pct(salesMarginPct, 1) : 'Cost permission required'} />
            <Stat label="Cost of goods" value={canSeeCost ? money(salesWindow.cost) : 'Restricted'} icon={<Wallet size={15} />} meta="Weighted average product cost" />
          </div>
          <Card
            title="Sales and margin by product"
            subtitle="Revenue and cost use the line values captured at sale time. Returns reduce quantity, revenue and cost."
            flush
            action={
              <select className="select" style={{ width: 130 }} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            }
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="right">Units</th>
                    <th className="right">Revenue</th>
                    {canSeeCost && <th className="right">Cost</th>}
                    {canSeeCost && <th className="right">Margin</th>}
                    {canSeeCost && <th className="right">Margin %</th>}
                    <th className="right">Share of revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {salesWindow.byProduct.map((row) => (
                    <tr key={row.product?.id ?? 'unknown'}>
                      <td><div className="cell-primary">{row.product?.name ?? 'Unknown product'}</div><div className="cell-sub">{row.product?.sku}</div></td>
                      <td className="right numeric">{num(row.qty)}</td>
                      <td className="right amount">{money(row.revenue)}</td>
                      {canSeeCost && <td className="right amount">{money(row.cost)}</td>}
                      {canSeeCost && <td className="right amount">{money(row.revenue - row.cost)}</td>}
                      {canSeeCost && <td className="right numeric">{row.revenue > 0 ? pct(((row.revenue - row.cost) / row.revenue) * 100, 1) : '—'}</td>}
                      <td className="right numeric">{salesWindow.revenue > 0 ? pct((row.revenue / salesWindow.revenue) * 100, 1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {salesWindow.byProduct.length === 0 && <EmptyState title="No sales in this window" description="Choose a longer range or record a sale." />}
          </Card>
        </>
      )}

      {tab === 'expiry' && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Batches at risk" value={expiry.length} icon={<CalendarClock size={15} />} tone={expiry.length ? 'warning' : undefined} meta="Inside each product's warning window" />
            <Stat label="Exposure value" value={money(expiry.reduce((sum, item) => sum + item.value, 0))} icon={<AlertTriangle size={15} />} tone={expiry.length ? 'warning' : undefined} meta="At weighted average cost" />
            <Stat label="Expired units" value={num(stockValue.expiredUnits)} icon={<PackageMinus size={15} />} tone={stockValue.expiredUnits ? 'danger' : undefined} meta={canSeeCost ? `${money(stockValue.expiredValue)} at cost` : 'Units in expired batches'} />
            <Stat label="Warning window" value={`${state.settings.expiryWarningDays} days`} icon={<CalendarClock size={15} />} meta="Product-level overrides apply" />
          </div>
          <Card title="Expiry exposure by batch" subtitle="FEFO order. Expired stock is non-sellable and must be written off before disposal." flush>
            {expiry.length === 0 ? (
              <EmptyState title="No expiry risk" description="No batches are inside their warning window." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="right">Days</th><th className="right">Qty</th><th className="right">Value</th><th>State</th></tr></thead>
                  <tbody>
                    {expiry.map((item) => (
                      <tr key={`${item.batch.id}-${item.state}`}>
                        <td><div className="cell-primary">{item.product.name}</div><div className="cell-sub">{item.product.sku}</div></td>
                        <td className="mono">{item.batch.batchNo}</td>
                        <td>{dateShort(item.batch.expiry)}</td>
                        <td className="right numeric">
                          {item.days < 0 ? <span className="text-red">{Math.abs(item.days)} overdue</span> : `${item.days}`}
                        </td>
                        <td className="right numeric">{num(item.qty)} {item.product.baseUnit}</td>
                        <td className="right amount">{money(item.value)}</td>
                        <td><Badge tone={item.state === 'EXPIRED' || item.state === 'CRITICAL' ? 'red' : 'amber'}>{item.state.toLowerCase()}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'shrinkage' && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Posted write-offs" value={money(shrinkage.writeOffValue)} icon={<PackageMinus size={15} />} meta={`${shrinkage.posted.length} approved document(s)`} />
            <Stat label="Count variance value" value={canSeeCost ? money(shrinkage.countValue) : 'Restricted'} icon={<AlertTriangle size={15} />} meta="Absolute value of posted count adjustments" />
            <Stat label="Expired stock value" value={canSeeCost ? money(stockValue.expiredValue) : 'Restricted'} icon={<CalendarClock size={15} />} meta={`${num(stockValue.expiredUnits)} unit(s) past expiry on hand`} />
            <Stat label="Write-off documents" value={state.writeOffs.length} icon={<PackageMinus size={15} />} meta={`${state.writeOffs.filter((w) => w.status === 'PENDING_APPROVAL').length} awaiting approval`} />
          </div>
          <Card title="Approved write-offs" subtitle="Reasons are mandatory. Posted documents cannot be edited; corrections require a new document." flush>
            {shrinkage.posted.length === 0 ? (
              <EmptyState title="No posted write-offs" description="Expired, damaged or recalled stock is disposed of through an approved write-off." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Document</th><th>Product</th><th>Reason</th><th className="right">Qty</th><th className="right">Value</th><th>Requested by</th><th>Approved by</th><th>Date</th></tr></thead>
                  <tbody>
                    {shrinkage.posted.map((writeOff) => {
                      const product = productById.get(writeOff.productId);
                      return (
                        <tr key={writeOff.id}>
                          <td className="mono">{writeOff.number}</td>
                          <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.sku}</div></td>
                          <td>{writeOff.reason}</td>
                          <td className="right numeric">{num(writeOff.qty)} {product?.baseUnit}</td>
                          <td className="right amount">{money(writeOff.value)}</td>
                          <td>{state.users.find((u) => u.id === writeOff.requestedBy)?.name}</td>
                          <td>{state.users.find((u) => u.id === writeOff.decidedBy)?.name ?? '—'}</td>
                          <td>{dateShort(writeOff.decidedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'reorder' && (
        <>
          <div className="grid grid--4 mb-16">
            <Stat label="Below reorder point" value={reorder.filter((r) => r.status !== 'OK').length} icon={<AlertTriangle size={15} />} tone={reorder.some((r) => r.status === 'OUT') ? 'danger' : 'warning'} meta={`${reorder.filter((r) => r.status === 'OUT').length} out of stock`} />
            <Stat label="Suggested spend" value={money(reorder.reduce((sum, item) => sum + item.suggestedQty * item.product.cost, 0))} icon={<Wallet size={15} />} meta="At current average cost" />
            <Stat label="Need after on-order" value={num(reorder.reduce((sum, item) => sum + item.need, 0))} icon={<TrendingUp size={15} />} meta="Units across all SKUs" />
            <Stat label="Manual rules" value={reorder.filter((r) => r.manualRule).length} icon={<PackageMinus size={15} />} meta="Insufficient sales history for a forecast" />
          </div>
          <Card title="Replenishment report" subtitle="Reorder point = average daily demand × (lead + review days) + safety stock, floored by the manual rule." flush>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Supplier</th><th className="right">Sold in 28d</th><th className="right">Daily demand</th><th className="right">Available</th><th className="right">On order</th><th className="right">Point</th><th className="right">Suggested</th><th className="right">Cover</th></tr></thead>
                <tbody>
                  {reorder.map((item) => (
                    <tr key={item.product.id}>
                      <td><div className="cell-primary">{item.product.name}</div><div className="cell-sub">{item.product.sku}</div></td>
                      <td>{state.suppliers.find((s) => s.id === item.product.supplierId)?.name}</td>
                      <td className="right numeric">{num(item.soldInWindow)}</td>
                      <td className="right numeric">{item.avgDailyDemand.toFixed(2)}</td>
                      <td className="right numeric">{num(item.available)}</td>
                      <td className="right numeric">{num(item.onOrder)}</td>
                      <td className="right numeric">{num(item.reorderPoint)}</td>
                      <td className="right">
                        {item.suggestedQty > 0 ? <Badge tone={item.status === 'OUT' ? 'red' : 'amber'}>{num(item.suggestedQty)}</Badge> : <Badge tone="green">Covered</Badge>}
                      </td>
                      <td className="right numeric">{item.daysCover === null ? '—' : `${item.daysCover.toFixed(1)}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
