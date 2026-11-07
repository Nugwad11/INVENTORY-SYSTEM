import { useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Download,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat, StatusBadge, Tabs } from '../components/ui';
import { SaleReceipt } from '../components/SaleReceipt';
import { can } from '../domain/permissions';
import { stockFor } from '../domain/inventory';
import { dateKey, dateTime, downloadCsv, money, num, timeOnly } from '../lib/format';
import type { Sale, SalePayment } from '../types';

interface CartLine {
  productId: string;
  qty: number;
}

interface ReturnLine {
  lineId: string;
  qty: number;
  disposition: 'SELLABLE' | 'DAMAGED' | 'QUARANTINE';
}

export default function Sales() {
  const { state, currentUser, stockMap, actions } = useApp();
  const [tab, setTab] = useState<'pos' | 'history'>('pos');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<SalePayment>('CASH');
  const [discountNaira, setDiscountNaira] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [voidSale, setVoidSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [returnReason, setReturnReason] = useState('');

  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const categoryById = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);
  const today = dateKey(new Date());
  const canSell = can(currentUser, 'sale.create');

  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products
      .filter((product) => product.active)
      .filter((product) => category === 'ALL' || product.categoryId === category)
      .filter((product) => !term || `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.products, category, search]);

  const cartDetail = cart.map((line) => {
    const product = productById.get(line.productId);
    return { ...line, product, subtotal: product ? Math.round(line.qty * product.price) : 0 };
  });
  const subtotal = cartDetail.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round((Number(discountNaira) || 0) * 100)));
  const total = subtotal - discount;

  const addToCart = (productId: string) => {
    const product = productById.get(productId);
    const stock = stockFor(stockMap, productId);
    const existing = cart.find((line) => line.productId === productId);
    const nextQty = (existing?.qty ?? 0) + 1;
    if (nextQty > stock.available + 0.0005) {
      actions.toast(`${product?.name ?? 'Product'} has only ${num(stock.available)} sellable at the shop floor.`, 'error');
      return;
    }
    if (existing) {
      setCart(cart.map((line) => (line.productId === productId ? { ...line, qty: nextQty } : line)));
    } else {
      setCart([...cart, { productId, qty: 1 }]);
    }
  };

  const setQty = (productId: string, qty: number) => {
    const stock = stockFor(stockMap, productId);
    if (qty <= 0) {
      setCart(cart.filter((line) => line.productId !== productId));
      return;
    }
    if (qty > stock.available + 0.0005) {
      actions.toast(`Only ${num(stock.available)} sellable on the shop floor.`, 'error');
      return;
    }
    setCart(cart.map((line) => (line.productId === productId ? { ...line, qty } : line)));
  };

  const completeSale = () => {
    if (payment === 'CREDIT' && !customerName.trim()) {
      actions.toast('Attach a customer name to a credit sale.', 'error');
      return;
    }
    const sale = actions.createSale({
      lines: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
      payment,
      discount,
      customerName,
    });
    if (sale) {
      setCart([]);
      setDiscountNaira('');
      setCustomerName('');
      setPayment('CASH');
      setReceiptSale(sale);
    }
  };

  const completed = state.sales.filter((sale) => sale.status !== 'VOIDED');
  const todaySales = completed.filter((sale) => dateKey(new Date(sale.occurredAt)) === today);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const averageBasket = todaySales.length ? Math.round(todayRevenue / todaySales.length) : 0;
  const paymentMix = (kind: SalePayment) => todaySales.filter((sale) => sale.payment === kind).reduce((sum, sale) => sum + sale.total, 0);

  const selectedSale = selectedSaleId ? state.sales.find((s) => s.id === selectedSaleId) ?? null : null;

  const openReturn = (sale: Sale) => {
    setReturnSale(sale);
    setReturnLines(
      sale.lines.map((line) => ({
        lineId: line.id,
        qty: 0,
        disposition: 'SELLABLE' as const,
      })),
    );
    setReturnReason('');
  };

  const saveReturn = () => {
    if (!returnSale) return;
    if (actions.returnSale(returnSale.id, returnLines, returnReason)) {
      setReturnSale(null);
    }
  };

  const exportSales = () => {
    downloadCsv(`sales-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Sale', 'Business time', 'Status', 'Payment', 'Lines', 'Subtotal (NGN)', 'Discount (NGN)', 'Total (NGN)', 'Customer', 'Cashier', 'Sync'],
      ...state.sales.map((sale) => [
        sale.number,
        sale.occurredAt,
        sale.status,
        sale.payment,
        sale.lines.length,
        (sale.subtotal / 100).toFixed(2),
        (sale.discount / 100).toFixed(2),
        (sale.total / 100).toFixed(2),
        sale.customerName ?? '',
        userById.get(sale.cashierId)?.name ?? '',
        sale.sync,
      ]),
    ]);
    actions.toast(`Exported ${state.sales.length} sales.`);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operate"
        title="Sales & POS"
        subtitle="A sale is confirmed only when every line can be allocated FEFO from the shop floor. Stock movements post with the sale."
        actions={
          <button className="btn" onClick={exportSales}><Download size={16} /> Export sales</button>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Sales today" value={money(todayRevenue)} icon={<Wallet size={15} />} meta={`${todaySales.length} completed transaction(s)`} />
        <Stat label="Average basket" value={money(averageBasket)} icon={<ShoppingCart size={15} />} meta={`${state.sales.filter((s) => s.status === 'VOIDED').length} voided in dataset`} />
        <Stat label="Cash today" value={money(paymentMix('CASH'))} icon={<Banknote size={15} />} meta={`Transfer ${money(paymentMix('TRANSFER'))}`} />
        <Stat label="Credit today" value={money(paymentMix('CREDIT'))} icon={<CreditCard size={15} />} tone={paymentMix('CREDIT') > 0 ? 'warning' : undefined} meta={`Customer credit ${money(paymentMix('CREDIT'))}`} />
      </div>

      <Tabs
        tabs={[
          { id: 'pos', label: 'Point of sale' },
          { id: 'history', label: 'Sales history', count: state.sales.length },
        ]}
        value={tab}
        onChange={(id) => setTab(id as 'pos' | 'history')}
      />

      {tab === 'pos' && (
        <div className="pos-grid">
          <Card
            title="Products"
            subtitle={`${products.length} active product(s) · FEFO picks the earliest expiry first`}
            action={
              <select className="select" style={{ width: 160 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
                <option value="ALL">All categories</option>
                {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            }
          >
            <div className="search mb-12">
              <Search />
              <input className="input" placeholder="Search or scan product name, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products for sale" autoFocus />
            </div>
            {products.length === 0 ? (
              <EmptyState title="No products match" description="A no-result scan is not an error. Ask a manager to add the product to the catalogue." />
            ) : (
              <div className="pos-products">
                {products.map((product) => {
                  const stock = stockFor(stockMap, product.id);
                  const out = stock.available <= 0;
                  return (
                    <button key={product.id} className="pos-product" disabled={out || !canSell} onClick={() => addToCart(product.id)}>
                      <span className="pos-product__name">{product.name}</span>
                      <span className="pos-product__stock">
                        {out ? <span className="text-red">Out of stock</span> : `${num(stock.available)} ${product.baseUnit} · ${categoryById.get(product.categoryId)?.name}`}
                      </span>
                      <span className="pos-product__price">{money(product.price)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            title="Current sale"
            subtitle={canSell ? `${currentUser.name} · ${state.deviceId}` : 'Your role cannot record sales'}
            action={<Badge tone="outline">{cart.length} line(s)</Badge>}
          >
            {cart.length === 0 ? (
              <EmptyState title="Cart is empty" description="Tap a product to start. Nothing is committed until you complete the sale." icon={<ReceiptText size={20} />} />
            ) : (
              <div>
                {cartDetail.map((line) => (
                  <div className="cart-line" key={line.productId}>
                    <div className="grow">
                      <div className="cell-primary">{line.product?.name}</div>
                      <div className="cell-sub">{money(line.product?.price ?? 0)} each</div>
                    </div>
                    <div className="qty-stepper">
                      <button onClick={() => setQty(line.productId, line.qty - 1)} aria-label="Decrease quantity"><Minus size={13} /></button>
                      <input
                        value={line.qty}
                        onChange={(e) => setQty(line.productId, Number(e.target.value) || 0)}
                        aria-label={`Quantity ${line.product?.name}`}
                      />
                      <button onClick={() => setQty(line.productId, line.qty + 1)} aria-label="Increase quantity"><Plus size={13} /></button>
                    </div>
                    <div className="amount" style={{ minWidth: 70, textAlign: 'right' }}>{money(line.subtotal)}</div>
                    <button className="btn btn--sm btn--ghost" onClick={() => setQty(line.productId, 0)} aria-label="Remove line"><Trash2 size={13} /></button>
                  </div>
                ))}

                <div className="divider" />
                <div className="total-row"><span>Subtotal</span><span className="amount">{money(subtotal)}</span></div>
                <div className="total-row">
                  <span>Discount (₦)</span>
                  <input className="input" style={{ width: 110, height: 30 }} type="number" min={0} value={discountNaira} onChange={(e) => setDiscountNaira(e.target.value)} placeholder="0" aria-label="Discount in naira" />
                </div>
                <div className="total-row grand"><span>Total</span><span className="amount">{money(total)}</span></div>

                <div className="form-section">
                  <div className="form-section__title">Payment method</div>
                  <div className="btn-group">
                    {(['CASH', 'TRANSFER', 'CREDIT'] as SalePayment[]).map((kind) => (
                      <button key={kind} className={`btn btn--sm ${payment === kind ? 'btn--primary' : ''}`} onClick={() => setPayment(kind)}>
                        {kind === 'CASH' ? <Banknote size={13} /> : kind === 'TRANSFER' ? <Smartphone size={13} /> : <CreditCard size={13} />}
                        {kind.charAt(0) + kind.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                  <div className="field mt-12">
                    <label>{payment === 'CREDIT' ? 'Customer name (required for credit)' : 'Customer name (optional)'}</label>
                    <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" />
                  </div>
                </div>

                <button className="btn btn--primary btn--lg btn--block mt-16" onClick={completeSale} disabled={!canSell}>
                  <ShoppingCart size={17} /> Complete sale · {money(total)}
                </button>
                <button className="btn btn--ghost btn--block mt-8" onClick={() => { setCart([]); setDiscountNaira(''); setCustomerName(''); }}>Clear cart</button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'history' && (
        <Card title="Sales history" subtitle="Voids restore stock and post reversing movements. Returns update the original sale and line quantities." flush>
          {state.sales.length === 0 ? (
            <EmptyState title="No sales yet" description="Completed sales appear here with their payment status and ledger reference." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Time</th>
                    <th>Cashier</th>
                    <th>Payment</th>
                    <th className="right">Lines</th>
                    <th className="right">Total</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {state.sales.slice(0, 120).map((sale) => (
                    <tr key={sale.id} className="is-clickable" onClick={() => setSelectedSaleId(sale.id)}>
                      <td className="mono">{sale.number}</td>
                      <td className="nowrap">{dateTime(sale.occurredAt)}</td>
                      <td>{userById.get(sale.cashierId)?.name ?? '—'}</td>
                      <td><Badge tone={sale.payment === 'CREDIT' ? 'amber' : sale.payment === 'TRANSFER' ? 'blue' : 'neutral'}>{sale.payment}</Badge></td>
                      <td className="right numeric">{sale.lines.length}</td>
                      <td className="right amount">{money(sale.total)}</td>
                      <td>{sale.customerName ?? 'Walk-in'}</td>
                      <td><StatusBadge status={sale.status} kind="sale" /></td>
                      <td><StatusBadge status={sale.sync} kind="sync" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Drawer
        open={!!selectedSale}
        onClose={() => setSelectedSaleId(null)}
        title={selectedSale ? `Sale ${selectedSale.number}` : 'Sale'}
        subtitle={selectedSale ? `${dateTime(selectedSale.occurredAt)} · ${userById.get(selectedSale.cashierId)?.name}` : undefined}
        wide
        footer={
          selectedSale ? (
            <>
              <button className="btn" onClick={() => setReceiptSale(selectedSale)}><Printer size={15} /> Receipt</button>
              {selectedSale.status !== 'VOIDED' && can(currentUser, 'sale.return') && (
                <button className="btn" onClick={() => openReturn(selectedSale)}><RotateCcw size={15} /> Record return</button>
              )}
              {selectedSale.status !== 'VOIDED' && can(currentUser, 'sale.void') && (
                <button className="btn btn--danger" onClick={() => { setVoidSale(selectedSale); setVoidReason(''); }}><XCircle size={15} /> Void sale</button>
              )}
            </>
          ) : undefined
        }
      >
        {selectedSale && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="flex gap-8 flex-wrap">
              <StatusBadge status={selectedSale.status} kind="sale" />
              <Badge tone="outline">{selectedSale.payment}</Badge>
              <Badge tone="outline">{selectedSale.deviceId}</Badge>
              <StatusBadge status={selectedSale.sync} kind="sync" />
            </div>
            <div className="stat-strip">
              <div><div className="label">Subtotal</div><div className="value">{money(selectedSale.subtotal)}</div></div>
              <div><div className="label">Discount</div><div className="value">{money(selectedSale.discount)}</div></div>
              <div><div className="label">Total</div><div className="value">{money(selectedSale.total)}</div></div>
              <div><div className="label">Customer</div><div className="value" style={{ fontSize: '0.85rem' }}>{selectedSale.customerName ?? 'Walk-in'}</div></div>
            </div>

            <div className="table-wrap">
              <table className="table--compact">
                <thead><tr><th>Product</th><th>Batch</th><th className="right">Qty</th><th className="right">Returned</th><th className="right">Unit price</th><th className="right">Line total</th></tr></thead>
                <tbody>
                  {selectedSale.lines.map((line) => {
                    const product = productById.get(line.productId);
                    return (
                      <tr key={line.id}>
                        <td><div className="cell-primary">{product?.name}</div><div className="cell-sub">{product?.sku}</div></td>
                        <td className="mono">{state.batches.find((b) => b.id === line.batchId)?.batchNo ?? '—'}</td>
                        <td className="right numeric">{num(line.qty)}</td>
                        <td className="right numeric">{line.returnedQty > 0 ? num(line.returnedQty) : '—'}</td>
                        <td className="right amount">{money(line.unitPrice)}</td>
                        <td className="right amount">{money(Math.round(line.qty * line.unitPrice))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedSale.status === 'VOIDED' && (
              <div className="banner banner--danger">
                Voided {dateTime(selectedSale.voidedAt)} by {userById.get(selectedSale.voidedBy ?? '')?.name}. Reason: {selectedSale.voidReason}
              </div>
            )}

            <div>
              <div className="eyebrow mb-8">Linked stock movements</div>
              {state.movements.filter((m) => m.refId === selectedSale.id).map((m) => (
                <div className="list-row" key={m.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">{m.type} · {productById.get(m.productId)?.name}</div>
                    <div className="list-row__meta">{dateTime(m.occurredAt)} · seq {m.seq} · {m.from ? 'stock out' : 'stock in'}</div>
                  </div>
                  <div className={`amount ${m.from ? 'negative' : ''}`}>{m.from ? '−' : '+'}{num(m.qty)}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="eyebrow mb-8">Document history</div>
              {state.audit.filter((event) => event.entityId === selectedSale.id).map((event) => (
                <div className="list-row" key={event.id}>
                  <div className="list-row__main">
                    <div className="list-row__title">{event.summary}</div>
                    <div className="list-row__meta">{timeOnly(event.at)} · {event.actorName}{event.reason ? ` · ${event.reason}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!voidSale}
        onClose={() => setVoidSale(null)}
        title="Void sale"
        subtitle={voidSale ? `${voidSale.number} · ${money(voidSale.total)}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setVoidSale(null)}>Keep sale</button>
            <button
              className="btn btn--danger"
              onClick={() => {
                if (voidSale && actions.voidSale(voidSale.id, voidReason)) setVoidSale(null);
              }}
            >
              Void and restore stock
            </button>
          </>
        }
      >
        <div className="grid">
          <div className="banner banner--warning">
            <XCircle />
            Voiding restores every remaining unit to the shop floor and posts reversing movements. The sale stays in history with an audit entry.
          </div>
          <div className="field">
            <label>Void reason <span className="req">*</span></label>
            <textarea className="textarea" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong product, duplicate tender, customer cancelled…" />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!returnSale}
        onClose={() => setReturnSale(null)}
        title="Record a customer return"
        subtitle={returnSale ? `${returnSale.number} · ${money(returnSale.total)}` : undefined}
        size="wide"
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setReturnSale(null)}>Cancel</button>
            <button className="btn btn--primary" onClick={saveReturn}>Post return</button>
          </>
        }
      >
        {returnSale && (
          <div className="grid" style={{ gap: 14 }}>
            <div className="banner banner--info">
              Returned stock goes back to sellable only when it is resaleable. Damaged or suspected stock goes to quarantine or the damaged bay.
            </div>
            {returnSale.lines.map((line) => {
              const product = productById.get(line.productId);
              const remaining = line.qty - line.returnedQty;
              const selection = returnLines.find((r) => r.lineId === line.id);
              return (
                <div className="cart-line" key={line.id}>
                  <div className="grow">
                    <div className="cell-primary">{product?.name}</div>
                    <div className="cell-sub">Sold {num(line.qty)} · already returned {num(line.returnedQty)} · remaining {num(remaining)}</div>
                  </div>
                  <input
                    className="input"
                    style={{ width: 80, height: 32 }}
                    type="number"
                    min={0}
                    max={remaining}
                    value={selection?.qty ?? 0}
                    onChange={(e) => {
                      const qty = Math.max(0, Math.min(remaining, Number(e.target.value) || 0));
                      setReturnLines(returnLines.map((r) => (r.lineId === line.id ? { ...r, qty } : r)));
                    }}
                    aria-label={`Return quantity ${product?.name}`}
                  />
                  <select
                    className="select"
                    style={{ width: 150, height: 32 }}
                    value={selection?.disposition ?? 'SELLABLE'}
                    onChange={(e) => setReturnLines(returnLines.map((r) => (r.lineId === line.id ? { ...r, disposition: e.target.value as ReturnLine['disposition'] } : r)))}
                    aria-label={`Return disposition ${product?.name}`}
                  >
                    <option value="SELLABLE">Back to shelf</option>
                    <option value="DAMAGED">Damaged bay</option>
                    <option value="QUARANTINE">Quarantine</option>
                  </select>
                </div>
              );
            })}
            <div className="field">
              <label>Return reason <span className="req">*</span></label>
              <textarea className="textarea" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Changed mind, damaged pack, wrong item…" />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!receiptSale}
        onClose={() => setReceiptSale(null)}
        title="Receipt"
        subtitle={receiptSale ? `${receiptSale.number} · ${dateTime(receiptSale.occurredAt)}` : undefined}
        className="receipt-modal"
        footer={
          <>
            <button className="btn" onClick={() => setReceiptSale(null)}>Close</button>
            <button className="btn btn--primary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>
          </>
        }
      >
        {receiptSale && <SaleReceipt sale={receiptSale} />}
      </Modal>
    </div>
  );
}
