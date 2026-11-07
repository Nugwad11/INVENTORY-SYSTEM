import { useMemo, useState } from 'react';
import {
  Barcode,
  Boxes,
  Download,
  Pencil,
  Plus,
  Power,
  Search,
  Tag,
} from 'lucide-react';
import { useApp } from '../store/AppStore';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat } from '../components/ui';
import { can } from '../domain/permissions';
import { stockFor } from '../domain/inventory';
import { dateShort, downloadCsv, money, num } from '../lib/format';
import type { Product } from '../types';

type Filter = 'ALL' | 'ACTIVE' | 'LOW' | 'OUT' | 'INACTIVE';

interface ProductForm {
  name: string;
  sku: string;
  brand: string;
  categoryId: string;
  baseUnit: Product['baseUnit'];
  barcode: string;
  packSize: string;
  packLabel: string;
  costNaira: string;
  priceNaira: string;
  weighed: boolean;
  perishable: boolean;
  batchTracked: boolean;
  expiryWarningDays: string;
  reorderPoint: string;
  safetyStock: string;
  reorderMultiple: string;
  supplierId: string;
  defaultLocationId: string;
}

const BLANK: ProductForm = {
  name: '',
  sku: '',
  brand: '',
  categoryId: '',
  baseUnit: 'each',
  barcode: '',
  packSize: '1',
  packLabel: 'each',
  costNaira: '',
  priceNaira: '',
  weighed: false,
  perishable: false,
  batchTracked: true,
  expiryWarningDays: '30',
  reorderPoint: '10',
  safetyStock: '4',
  reorderMultiple: '1',
  supplierId: '',
  defaultLocationId: 'loc-shop',
};

function toForm(product: Product): ProductForm {
  return {
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    categoryId: product.categoryId,
    baseUnit: product.baseUnit,
    barcode: product.barcode,
    packSize: String(product.packSize),
    packLabel: product.packLabel,
    costNaira: String(product.cost / 100),
    priceNaira: String(product.price / 100),
    weighed: product.weighed,
    perishable: product.perishable,
    batchTracked: product.batchTracked,
    expiryWarningDays: String(product.expiryWarningDays),
    reorderPoint: String(product.reorderPoint),
    safetyStock: String(product.safetyStock),
    reorderMultiple: String(product.reorderMultiple),
    supplierId: product.supplierId,
    defaultLocationId: product.defaultLocationId,
  };
}

export default function Catalogue() {
  const { state, currentUser, stockMap, actions } = useApp();
  const canManage = can(currentUser, 'catalog.manage');
  const canSeeCost = can(currentUser, 'catalog.cost.view');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ productId?: string; form: ProductForm } | null>(null);
  const [priceTarget, setPriceTarget] = useState<Product | null>(null);
  const [priceValue, setPriceValue] = useState('');
  const [priceReason, setPriceReason] = useState('');

  const categories = state.categories;
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const supplierById = new Map(state.suppliers.map((s) => [s.id, s]));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products
      .map((product) => {
        const stock = stockFor(stockMap, product.id);
        return { product, stock };
      })
      .filter(({ product, stock }) => {
        if (category !== 'ALL' && product.categoryId !== category) return false;
        if (filter === 'ACTIVE' && !product.active) return false;
        if (filter === 'INACTIVE' && product.active) return false;
        if (filter === 'OUT' && stock.available > 0) return false;
        if (filter === 'LOW' && !(stock.available > 0 && stock.available <= product.reorderPoint)) return false;
        if (!term) return true;
        return `${product.name} ${product.sku} ${product.brand} ${product.barcode}`.toLowerCase().includes(term);
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [state.products, stockMap, search, category, filter]);

  const selected = selectedId ? state.products.find((p) => p.id === selectedId) ?? null : null;
  const selectedStock = selected ? stockFor(stockMap, selected.id) : null;
  const selectedMovements = selected
    ? state.movements.filter((m) => m.productId === selected.id).slice(-8).reverse()
    : [];
  const priceHistory = selected
    ? state.audit.filter((event) => event.action === 'PRICE_CHANGED' && event.entityId === selected.id).slice(0, 6)
    : [];

  const openCreate = () => {
    setEditor({
      form: {
        ...BLANK,
        categoryId: categories[0]?.id ?? '',
        supplierId: state.suppliers[0]?.id ?? '',
      },
    });
  };

  const openEdit = (product: Product) => setEditor({ productId: product.id, form: toForm(product) });

  const submitEditor = () => {
    if (!editor) return;
    const { form } = editor;
    const ok = actions.saveProduct(
      {
        name: form.name,
        sku: form.sku,
        brand: form.brand,
        categoryId: form.categoryId,
        baseUnit: form.baseUnit,
        barcode: form.barcode,
        packSize: Math.max(1, Number(form.packSize) || 1),
        packLabel: form.packLabel || form.baseUnit,
        cost: Math.round((Number(form.costNaira) || 0) * 100),
        price: Math.round((Number(form.priceNaira) || 0) * 100),
        weighed: form.weighed,
        perishable: form.perishable,
        batchTracked: form.batchTracked,
        expiryWarningDays: Math.max(1, Number(form.expiryWarningDays) || 30),
        reorderPoint: Math.max(0, Number(form.reorderPoint) || 0),
        safetyStock: Math.max(0, Number(form.safetyStock) || 0),
        reorderMultiple: Math.max(1, Number(form.reorderMultiple) || 1),
        supplierId: form.supplierId,
        defaultLocationId: form.defaultLocationId,
      },
      editor.productId,
    );
    if (ok) setEditor(null);
  };

  const exportCatalogue = () => {
    downloadCsv(`catalogue-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['SKU', 'Product', 'Brand', 'Category', 'Base unit', 'Barcode', 'Reorder point', 'On hand', 'Sellable', 'Cost (NGN)', 'Price (NGN)', 'Active'],
      ...rows.map(({ product, stock }) => [
        product.sku,
        product.name,
        product.brand,
        categoryById.get(product.categoryId)?.name ?? '',
        product.baseUnit,
        product.barcode,
        product.reorderPoint,
        stock.onHand,
        stock.sellable,
        canSeeCost ? (product.cost / 100).toFixed(2) : 'restricted',
        (product.price / 100).toFixed(2),
        product.active ? 'yes' : 'no',
      ]),
    ]);
    actions.toast(`Exported ${rows.length} catalogue lines.`);
  };

  const openPrice = (product: Product) => {
    setPriceTarget(product);
    setPriceValue(String(product.price / 100));
    setPriceReason('');
  };

  const savePrice = () => {
    if (!priceTarget) return;
    const ok = actions.updateProductPrice(
      priceTarget.id,
      Math.round((Number(priceValue) || 0) * 100),
      priceReason,
    );
    if (ok) setPriceTarget(null);
  };

  const activeCount = state.products.filter((p) => p.active).length;
  const lowCount = state.products.filter((p) => {
    const stock = stockFor(stockMap, p.id);
    return p.active && stock.available > 0 && stock.available <= p.reorderPoint;
  }).length;
  const outCount = state.products.filter((p) => p.active && stockFor(stockMap, p.id).available <= 0).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Catalogue"
        title="Products, units and pricing"
        subtitle="One record per sellable unit. Prices are effective-dated in the audit trail; costs are hidden from roles without cost access."
        actions={
          <>
            <button className="btn" onClick={exportCatalogue}>
              <Download size={16} /> Export
            </button>
            {canManage && (
              <button className="btn btn--primary" onClick={openCreate}>
                <Plus size={16} /> New product
              </button>
            )}
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Active SKUs" value={activeCount} icon={<Boxes size={15} />} meta={`${state.products.length} products on file`} />
        <Stat label="Low stock" value={lowCount} icon={<Tag size={15} />} tone={lowCount ? 'warning' : undefined} meta="At or below reorder point" />
        <Stat label="Out of stock" value={outCount} icon={<Barcode size={15} />} tone={outCount ? 'danger' : undefined} meta="Sellable quantity is zero" />
        <Stat label="Categories" value={categories.length} icon={<Tag size={15} />} meta={`${state.suppliers.length} approved suppliers`} />
      </div>

      <Card
        title="Catalogue"
        subtitle={`${rows.length} line${rows.length === 1 ? '' : 's'} match the current filters`}
        flush
      >
        <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search" style={{ flex: '1 1 220px' }}>
            <Search />
            <input
              className="input"
              placeholder="Search name, SKU or barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search catalogue"
            />
          </div>
          <select className="select" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="ALL">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Stock filter">
            {(['ALL', 'ACTIVE', 'LOW', 'OUT', 'INACTIVE'] as Filter[]).map((value) => (
              <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {value === 'ALL' ? 'All' : value === 'ACTIVE' ? 'Active' : value === 'LOW' ? 'Low' : value === 'OUT' ? 'Out' : 'Inactive'}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No products match"
            description="Clear the filters or add a product. Duplicate barcodes are blocked at save time."
            action={canManage ? <button className="btn btn--primary" onClick={openCreate}><Plus size={15} /> Add product</button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th className="right">On hand</th>
                  <th className="right">Sellable</th>
                  {canSeeCost && <th className="right">Cost</th>}
                  <th className="right">Price</th>
                  {canSeeCost && <th className="right">Margin</th>}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, stock }) => {
                  const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;
                  return (
                    <tr key={product.id} className="is-clickable" onClick={() => setSelectedId(product.id)}>
                      <td>
                        <div className="flex gap-10">
                          <span className="thumb">{product.sku.slice(0, 3)}</span>
                          <div>
                            <div className="cell-primary">{product.name}</div>
                            <div className="cell-sub">{product.sku} · {product.brand}</div>
                          </div>
                        </div>
                      </td>
                      <td>{categoryById.get(product.categoryId)?.name ?? '—'}</td>
                      <td>
                        <div>{product.baseUnit}</div>
                        <div className="cell-sub">{product.packSize} × {product.packLabel}</div>
                      </td>
                      <td className="right numeric">{num(stock.onHand, product.baseUnit === 'each' ? 0 : 3)}</td>
                      <td className="right">
                        {stock.available <= 0 ? (
                          <Badge tone="red">Out</Badge>
                        ) : stock.available <= product.reorderPoint ? (
                          <Badge tone="amber">{num(stock.available)}</Badge>
                        ) : (
                          <span className="numeric">{num(stock.available)}</span>
                        )}
                      </td>
                      {canSeeCost && <td className="right amount">{money(product.cost)}</td>}
                      <td className="right amount">{money(product.price)}</td>
                      {canSeeCost && <td className="right numeric">{margin.toFixed(0)}%</td>}
                      <td>{product.active ? <Badge tone="green" dot>Active</Badge> : <Badge dot>Inactive</Badge>}</td>
                      <td className="right">
                        <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <>
                              <button className="btn btn--sm btn--ghost" onClick={() => openEdit(product)} aria-label={`Edit ${product.name}`}>
                                <Pencil size={14} />
                              </button>
                              <button className="btn btn--sm btn--ghost" onClick={() => openPrice(product)} aria-label={`Change price for ${product.name}`}>
                                <Tag size={14} />
                              </button>
                              <button className="btn btn--sm btn--ghost" onClick={() => actions.toggleProduct(product.id)} aria-label={product.active ? `Deactivate ${product.name}` : `Reactivate ${product.name}`}>
                                <Power size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
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
        title={selected?.name ?? 'Product'}
        subtitle={selected ? `${selected.sku} · ${selected.brand}` : undefined}
        wide
        footer={
          selected && canManage ? (
            <>
              <button className="btn btn--ghost" onClick={() => actions.toggleProduct(selected.id)}>
                <Power size={15} /> {selected.active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button className="btn" onClick={() => openPrice(selected)}><Tag size={15} /> Change price</button>
              <button className="btn btn--primary" onClick={() => openEdit(selected)}><Pencil size={15} /> Edit product</button>
            </>
          ) : undefined
        }
      >
        {selected && selectedStock && (
          <div className="grid" style={{ gap: 18 }}>
            <div className="flex gap-8 flex-wrap">
              <Badge tone={selected.active ? 'green' : 'neutral'} dot>{selected.active ? 'Active' : 'Inactive'}</Badge>
              <Badge tone="outline">{categoryById.get(selected.categoryId)?.name ?? 'Uncategorised'}</Badge>
              {selected.perishable && <Badge tone="amber">Perishable · FEFO</Badge>}
              {selected.weighed && <Badge tone="blue">Weighed</Badge>}
              {selected.isNew && <Badge tone="purple">New line</Badge>}
            </div>

            <div className="stat-strip">
              <div>
                <div className="label">On hand</div>
                <div className="value">{num(selectedStock.onHand)} <span className="tiny muted">{selected.baseUnit}</span></div>
              </div>
              <div>
                <div className="label">Sellable</div>
                <div className="value">{num(selectedStock.available)}</div>
              </div>
              <div>
                <div className="label">Reserved</div>
                <div className="value">0</div>
              </div>
              <div>
                <div className="label">Reorder point</div>
                <div className="value">{num(selected.reorderPoint)}</div>
              </div>
            </div>

            <div>
              <div className="eyebrow mb-8">Commercial</div>
              <dl className="kv">
                <dt>Selling price</dt>
                <dd>{money(selected.price)} per {selected.baseUnit}</dd>
                {canSeeCost && <><dt>Average cost</dt><dd>{money(selected.cost, true)}</dd></>}
                {canSeeCost && <><dt>Margin</dt><dd>{selected.price > 0 ? (((selected.price - selected.cost) / selected.price) * 100).toFixed(1) : '0'}%</dd></>}
                <dt>Pack</dt>
                <dd>{selected.packSize} × {selected.packLabel} ({selected.baseUnit})</dd>
                <dt>Barcode</dt>
                <dd className="mono">{selected.barcode || '—'}</dd>
                <dt>Supplier</dt>
                <dd>{supplierById.get(selected.supplierId)?.name ?? '—'}</dd>
                <dt>Safety stock</dt>
                <dd>{selected.safetyStock} · order multiple {selected.reorderMultiple}</dd>
                <dt>Expiry warning</dt>
                <dd>{selected.expiryWarningDays} days</dd>
              </dl>
            </div>

            <div>
              <div className="eyebrow mb-8">Batch positions</div>
              {selectedStock.batches.length === 0 ? (
                <div className="banner">No stock positions yet. Receiving posts the first batch.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Expiry</th>
                        <th>Location / status</th>
                        <th className="right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStock.batches.map((balance) => (
                        <tr key={`${balance.batchId}-${balance.locationId}-${balance.status}`}>
                          <td className="mono">{balance.batch.batchNo}</td>
                          <td>{dateShort(balance.batch.expiry)}</td>
                          <td>
                            {state.locations.find((l) => l.id === balance.locationId)?.name} · {balance.status.toLowerCase()}
                          </td>
                          <td className="right numeric">{num(balance.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <div className="eyebrow mb-8">Recent ledger movements</div>
              {selectedMovements.length === 0 ? (
                <div className="banner">No movements recorded for this product.</div>
              ) : (
                <div>
                  {selectedMovements.map((movement) => (
                    <div className="list-row" key={movement.id}>
                      <div className="list-row__main">
                        <div className="list-row__title">{movement.note ?? movement.reason ?? movement.type}</div>
                        <div className="list-row__meta">
                          {dateShort(movement.occurredAt)} · {movement.type.toLowerCase().replace('_', ' ')} · seq {movement.seq}
                        </div>
                      </div>
                      <div className={`amount ${movement.from ? 'negative' : ''}`}>
                        {movement.from ? '−' : '+'}{num(movement.qty)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {priceHistory.length > 0 && (
              <div>
                <div className="eyebrow mb-8">Price history</div>
                {priceHistory.map((event) => (
                  <div className="list-row" key={event.id}>
                    <div className="list-row__main">
                      <div className="list-row__title">{event.summary}</div>
                      <div className="list-row__meta">{dateShort(event.at)} · {event.actorName} · {event.reason ?? 'No reason captured'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.productId ? 'Edit product' : 'New product'}
        subtitle="Base units cannot change once stock history exists. Costs update through weighted-average receiving."
        size="wide"
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setEditor(null)}>Cancel</button>
            <button className="btn btn--primary" onClick={submitEditor}>
              {editor?.productId ? 'Save changes' : 'Create product'}
            </button>
          </>
        }
      >
        {editor && (
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="p-name">Product name <span className="req">*</span></label>
              <input id="p-name" className="input" value={editor.form.name} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, name: e.target.value } })} placeholder="e.g. Peak Full Cream Milk 400g" />
            </div>
            <div className="field">
              <label htmlFor="p-sku">SKU <span className="req">*</span></label>
              <input id="p-sku" className="input mono" value={editor.form.sku} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, sku: e.target.value.toUpperCase() } })} placeholder="BEV-012" />
            </div>
            <div className="field">
              <label htmlFor="p-barcode">Barcode</label>
              <input id="p-barcode" className="input mono" value={editor.form.barcode} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, barcode: e.target.value } })} placeholder="EAN-13" />
              <span className="field__hint">Duplicate barcodes are rejected at save.</span>
            </div>
            <div className="field">
              <label htmlFor="p-brand">Brand</label>
              <input id="p-brand" className="input" value={editor.form.brand} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, brand: e.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="p-category">Category</label>
              <select id="p-category" className="select" value={editor.form.categoryId} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, categoryId: e.target.value } })}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-unit">Base unit</label>
              <select id="p-unit" className="select" value={editor.form.baseUnit} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, baseUnit: e.target.value as Product['baseUnit'] } })}>
                <option value="each">each</option>
                <option value="kg">kg</option>
                <option value="litre">litre</option>
                <option value="metre">metre</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-pack">Pack size</label>
              <input id="p-pack" className="input" type="number" min={1} value={editor.form.packSize} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, packSize: e.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="p-packlabel">Pack label</label>
              <input id="p-packlabel" className="input" value={editor.form.packLabel} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, packLabel: e.target.value } })} placeholder="carton, sachet, bag" />
            </div>
            <div className="field">
              <label htmlFor="p-cost">Unit cost (₦)</label>
              <input id="p-cost" className="input" type="number" min={0} step="0.01" value={editor.form.costNaira} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, costNaira: e.target.value } })} placeholder="0.00" />
            </div>
            <div className="field">
              <label htmlFor="p-price">Selling price (₦)</label>
              <input id="p-price" className="input" type="number" min={0} step="0.01" value={editor.form.priceNaira} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, priceNaira: e.target.value } })} placeholder="0.00" />
            </div>
            <div className="field">
              <label htmlFor="p-supplier">Supplier</label>
              <select id="p-supplier" className="select" value={editor.form.supplierId} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, supplierId: e.target.value } })}>
                {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-location">Default location</label>
              <select id="p-location" className="select" value={editor.form.defaultLocationId} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, defaultLocationId: e.target.value } })}>
                {state.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-reorder">Reorder point</label>
              <input id="p-reorder" className="input" type="number" min={0} value={editor.form.reorderPoint} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, reorderPoint: e.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="p-safety">Safety stock</label>
              <input id="p-safety" className="input" type="number" min={0} value={editor.form.safetyStock} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, safetyStock: e.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="p-multiple">Order multiple</label>
              <input id="p-multiple" className="input" type="number" min={1} value={editor.form.reorderMultiple} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, reorderMultiple: e.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="p-expiry">Expiry warning (days)</label>
              <input id="p-expiry" className="input" type="number" min={1} value={editor.form.expiryWarningDays} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, expiryWarningDays: e.target.value } })} />
            </div>
            <div className="span-2 divider" />
            <label className="check"><input type="checkbox" checked={editor.form.perishable} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, perishable: e.target.checked } })} /> Perishable — receiving requires an expiry date</label>
            <label className="check"><input type="checkbox" checked={editor.form.weighed} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, weighed: e.target.checked } })} /> Weighed item — quantities allow decimals</label>
            <label className="check"><input type="checkbox" checked={editor.form.batchTracked} onChange={(e) => setEditor({ ...editor, form: { ...editor.form, batchTracked: e.target.checked } })} /> Track stock by batch / lot</label>
          </div>
        )}
      </Modal>

      <Modal
        open={!!priceTarget}
        onClose={() => setPriceTarget(null)}
        title="Change selling price"
        subtitle={priceTarget ? `${priceTarget.name} · current ${money(priceTarget.price)}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setPriceTarget(null)}>Cancel</button>
            <button className="btn btn--primary" onClick={savePrice}>Save price</button>
          </>
        }
      >
        <div className="grid">
          <div className="field">
            <label htmlFor="np">New price (₦)</label>
            <input id="np" className="input" type="number" min={0} step="0.01" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} />
            <span className="field__hint">The change is audited with your name, time and reason.</span>
          </div>
          <div className="field">
            <label htmlFor="nr">Reason <span className="req">*</span></label>
            <textarea id="nr" className="textarea" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder="Supplier cost change, promotion, competitor match…" />
          </div>
          {priceTarget && (
            <div className="banner banner--info">
              New margin: {priceTarget.price > 0 || Number(priceValue) > 0
                ? (((Number(priceValue) * 100 - priceTarget.cost) / (Number(priceValue) * 100 || 1)) * 100).toFixed(1)
                : '0'}% · no future-dated price is created in this demo.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
