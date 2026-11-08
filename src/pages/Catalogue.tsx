import { useCallback, useEffect, useMemo, useState } from 'react';
import { Barcode, Boxes, Download, Pencil, Plus, Power, RefreshCw, Search, Tag } from 'lucide-react';
import { Badge, Card, Drawer, EmptyState, Modal, PageHeader, Stat } from '../components/ui';
import { can } from '../domain/permissions';
import {
  ApiError,
  api,
  type CreateProductInput,
  type ServerProduct,
  type ServerStockRow,
  type UpdateProductInput,
} from '../lib/api';
import { useAuth } from '../store/AuthContext';
import { useApp } from '../store/AppStore';
import { dateShort, downloadCsv, money, num } from '../lib/format';

type Filter = 'ALL' | 'ACTIVE' | 'LOW' | 'OUT' | 'INACTIVE';

const FILTER_LABELS: Record<Filter, string> = {
  ALL: 'All',
  ACTIVE: 'Active',
  LOW: 'Low',
  OUT: 'Out',
  INACTIVE: 'Inactive',
};

interface ProductForm {
  name: string;
  sku: string;
  brand: string;
  category: string;
  barcode: string;
  baseUnit: ServerProduct['baseUnit'];
  packSize: string;
  packLabel: string;
  costNaira: string;
  priceNaira: string;
  expiryWarningDays: string;
  reorderPoint: string;
  safetyStock: string;
  reorderMultiple: string;
  active: boolean;
  perishable: boolean;
  batchTracked: boolean;
}

function toForm(product: ServerProduct): ProductForm {
  return {
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    category: product.category,
    barcode: product.barcode ?? '',
    baseUnit: product.baseUnit,
    packSize: String(product.packSize),
    packLabel: product.packLabel,
    costNaira: String(product.costKobo / 100),
    priceNaira: String(product.priceKobo / 100),
    expiryWarningDays: String(product.expiryWarningDays),
    reorderPoint: String(product.reorderPoint),
    safetyStock: String(product.safetyStock),
    reorderMultiple: String(product.reorderMultiple),
    active: product.active,
    perishable: product.perishable,
    batchTracked: product.batchTracked,
  };
}

function emptyForm(): ProductForm {
  return {
    name: '',
    sku: '',
    brand: '',
    category: '',
    barcode: '',
    baseUnit: 'each',
    packSize: '1',
    packLabel: '',
    costNaira: '',
    priceNaira: '',
    expiryWarningDays: '14',
    reorderPoint: '0',
    safetyStock: '0',
    reorderMultiple: '1',
    active: true,
    perishable: false,
    batchTracked: true,
  };
}

function statusTone(status: string): 'green' | 'amber' | 'red' | 'neutral' {
  if (status === 'SELLABLE') return 'green';
  if (status === 'QUARANTINE') return 'amber';
  if (status === 'DAMAGED' || status === 'EXPIRED') return 'red';
  return 'neutral';
}

function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not load the catalogue.';
  if (error.status === 401) return 'The server rejected the session. Sign out and sign in again.';
  return error.message;
}

export default function Catalogue() {
  const { currentUser, actions } = useApp();
  const { token } = useAuth();
  const canSeeCost = can(currentUser, 'catalog.cost.view');
  const canManage = can(currentUser, 'catalog.manage');

  const [products, setProducts] = useState<ServerProduct[]>([]);
  const [stock, setStock] = useState<ServerStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editor, setEditor] = useState<{ productId: string | null; form: ProductForm } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [priceTarget, setPriceTarget] = useState<ServerProduct | null>(null);
  const [priceValue, setPriceValue] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [nextProducts, nextStock] = await Promise.all([api.products(token), api.stock(token)]);
        setProducts(nextProducts);
        setStock(nextStock);
        setLastLoadedAt(new Date());
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [products],
  );

  const stockByProduct = useMemo(() => {
    const map = new Map<string, ServerStockRow[]>();
    for (const row of stock) {
      const list = map.get(row.productId);
      if (list) list.push(row);
      else map.set(row.productId, [row]);
    }
    return map;
  }, [stock]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => {
        if (category !== 'ALL' && product.category !== category) return false;
        if (filter === 'ACTIVE' && !product.active) return false;
        if (filter === 'INACTIVE' && product.active) return false;
        if (filter === 'OUT' && product.sellingQty > 0) return false;
        if (filter === 'LOW' && !(product.sellingQty > 0 && product.sellingQty <= product.reorderPoint)) return false;
        if (!term) return true;
        return `${product.name} ${product.sku} ${product.brand} ${product.barcode ?? ''}`.toLowerCase().includes(term);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search, category, filter]);

  const selected = selectedId ? products.find((p) => p.id === selectedId) ?? null : null;
  const selectedStock = selected ? stockByProduct.get(selected.id) ?? [] : [];

  const resetFilters = () => {
    setSearch('');
    setCategory('ALL');
    setFilter('ALL');
  };

  const openEdit = (product: ServerProduct) => {
    setFormError(null);
    setEditor({ productId: product.id, form: toForm(product) });
  };

  const openCreate = () => {
    setFormError(null);
    setEditor({ productId: null, form: emptyForm() });
  };

  const setField = <K extends keyof ProductForm,>(field: K, value: ProductForm[K]) => {
    setEditor((current) => (current ? { ...current, form: { ...current.form, [field]: value } } : current));
  };

  const submitEditor = async () => {
    if (!editor || !token) return;
    const { form } = editor;
    if (!form.name.trim() || !form.sku.trim()) {
      setFormError('Name and SKU are required.');
      return;
    }
    const fields: Required<Omit<UpdateProductInput, 'active'>> = {
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      brand: form.brand.trim(),
      category: form.category.trim(),
      barcode: form.barcode.trim() || null,
      baseUnit: form.baseUnit,
      packSize: Math.max(0.001, Number(form.packSize) || 1),
      packLabel: form.packLabel.trim() || form.baseUnit,
      costKobo: Math.round((Number(form.costNaira) || 0) * 100),
      expiryWarningDays: Math.max(0, Math.floor(Number(form.expiryWarningDays) || 0)),
      reorderPoint: Math.max(0, Number(form.reorderPoint) || 0),
      safetyStock: Math.max(0, Number(form.safetyStock) || 0),
      reorderMultiple: Math.max(0.001, Number(form.reorderMultiple) || 1),
      perishable: form.perishable,
      batchTracked: form.batchTracked,
    };

    setSaving(true);
    setFormError(null);
    try {
      if (editor.productId === null) {
        const priceNaira = Number(form.priceNaira);
        if (!Number.isFinite(priceNaira) || priceNaira < 0) {
          setFormError('Enter a valid selling price.');
          return;
        }
        const input: CreateProductInput = { ...fields, priceKobo: Math.round(priceNaira * 100) };
        const created = await api.createProduct(token, input);
        actions.toast(`Created ${created.sku}.`);
      } else {
        const updated = await api.updateProduct(token, editor.productId, { ...fields, active: form.active });
        actions.toast(`Saved ${updated.sku}.`);
      }
      setEditor(null);
      await load('refresh');
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: ServerProduct) => {
    if (!token) return;
    setSaving(true);
    try {
      await api.updateProduct(token, product.id, { active: !product.active });
      actions.toast(`${product.sku} ${product.active ? 'deactivated' : 'reactivated'}.`);
      await load('refresh');
    } catch (err) {
      actions.toast(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openPrice = (product: ServerProduct) => {
    setPriceTarget(product);
    setPriceValue(String(product.priceKobo / 100));
    setPriceReason('');
    setPriceError(null);
  };

  const submitPrice = async () => {
    if (!priceTarget || !token) return;
    const naira = Number(priceValue);
    if (!Number.isFinite(naira) || naira < 0) {
      setPriceError('Enter a valid price.');
      return;
    }
    if (priceReason.trim().length < 3) {
      setPriceError('Add a short reason for the price change.');
      return;
    }

    setSaving(true);
    setPriceError(null);
    try {
      const updated = await api.changePrice(
        token,
        priceTarget.id,
        Math.round(naira * 100),
        priceReason.trim(),
      );
      actions.toast(`Price updated for ${updated.sku}.`);
      setPriceTarget(null);
      await load('refresh');
    } catch (err) {
      setPriceError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const exportCatalogue = () => {
    downloadCsv(`catalogue-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['SKU', 'Product', 'Brand', 'Category', 'Base unit', 'Barcode', 'Reorder point', 'On hand', 'Sellable', 'Cost (NGN)', 'Price (NGN)', 'Active'],
      ...rows.map((product) => [
        product.sku,
        product.name,
        product.brand,
        product.category,
        product.baseUnit,
        product.barcode ?? '',
        product.reorderPoint,
        product.totalQty,
        product.sellingQty,
        canSeeCost ? (product.costKobo / 100).toFixed(2) : 'restricted',
        (product.priceKobo / 100).toFixed(2),
        product.active ? 'yes' : 'no',
      ]),
    ]);
  };

  const activeCount = products.filter((p) => p.active).length;
  const lowCount = products.filter(
    (p) => p.active && p.sellingQty > 0 && p.sellingQty <= p.reorderPoint,
  ).length;
  const outCount = products.filter((p) => p.active && p.sellingQty <= 0).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Catalogue · live"
        title="Products and selling prices"
        subtitle="Read from the Storehouse API. Edits, price changes and deactivation are written to the server and audited."
        actions={
          <>
            {canManage && (
              <button className="btn btn--primary" onClick={openCreate} disabled={saving}>
                <Plus size={16} /> New product
              </button>
            )}
            <button className="btn" onClick={() => void load('refresh')} disabled={refreshing || loading}>
              <RefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn" onClick={exportCatalogue} disabled={rows.length === 0}>
              <Download size={16} /> Export
            </button>
          </>
        }
      />

      <div className="grid grid--4 mb-16">
        <Stat label="Active SKUs" value={activeCount} icon={<Boxes size={15} />} meta={`${products.length} products on the server`} />
        <Stat label="Low stock" value={lowCount} icon={<Tag size={15} />} tone={lowCount ? 'warning' : undefined} meta="At or below reorder point" />
        <Stat label="Out of stock" value={outCount} icon={<Barcode size={15} />} tone={outCount ? 'danger' : undefined} meta="Sellable quantity is zero" />
        <Stat
          label="Categories"
          value={categories.length}
          icon={<Tag size={15} />}
          meta={lastLoadedAt ? `Updated ${lastLoadedAt.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}` : 'Not loaded yet'}
        />
      </div>

      {error && (
        <div className="banner banner--danger mb-16" role="alert">
          <span>{error}</span>
          <button className="btn btn--sm" onClick={() => void load('initial')}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}

      <Card
        title="Catalogue"
        subtitle={loading ? 'Loading products and stock…' : `${rows.length} ${rows.length === 1 ? 'line matches' : 'lines match'} the current filters`}
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
          <select
            className="select"
            style={{ width: 180 }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="ALL">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Stock filter">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((value) => (
              <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                {FILTER_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="card__body" role="status" style={{ display: 'grid', placeItems: 'center', minHeight: 220, gap: 10 }}>
            <span className="auth-spinner" style={{ borderTopColor: 'var(--brand)' }} />
            <span className="muted small">Loading catalogue from the server…</span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={products.length === 0 ? 'No products on the server' : 'No products match'}
            description={
              products.length === 0
                ? 'Run the backend seed to load the demo catalogue, then refresh this page.'
                : 'Clear the filters to see the full catalogue.'
            }
            action={
              products.length > 0 ? (
                <button className="btn" onClick={resetFilters}>Clear filters</button>
              ) : (
                <button className="btn" onClick={() => void load('initial')}><RefreshCw size={15} /> Retry</button>
              )
            }
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
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => (
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
                    <td>{product.category || '—'}</td>
                    <td>
                      <div>{product.baseUnit}</div>
                      <div className="cell-sub">{product.packSize} × {product.packLabel}</div>
                    </td>
                    <td className="right numeric">{num(product.totalQty, product.baseUnit === 'each' ? 0 : 3)}</td>
                    <td className="right">
                      {product.sellingQty <= 0 ? (
                        <Badge tone="red">Out</Badge>
                      ) : product.sellingQty <= product.reorderPoint ? (
                        <Badge tone="amber">{num(product.sellingQty)}</Badge>
                      ) : (
                        <span className="numeric">{num(product.sellingQty)}</span>
                      )}
                    </td>
                    {canSeeCost && <td className="right amount">{money(product.costKobo)}</td>}
                    <td className="right amount">{money(product.priceKobo)}</td>
                    <td>{product.active ? <Badge tone="green" dot>Active</Badge> : <Badge dot>Inactive</Badge>}</td>
                    <td className="right">
                      {canManage && (
                        <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => openEdit(product)}
                            aria-label={`Edit ${product.name}`}
                            disabled={saving}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => openPrice(product)}
                            aria-label={`Change price for ${product.name}`}
                            disabled={saving}
                          >
                            <Tag size={14} />
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => void toggleActive(product)}
                            aria-label={product.active ? `Deactivate ${product.name}` : `Reactivate ${product.name}`}
                            disabled={saving}
                          >
                            <Power size={14} />
                          </button>
                        </div>
                      )}
                    </td>
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
        title={selected?.name ?? 'Product'}
        subtitle={selected ? `${selected.sku}${selected.brand ? ` · ${selected.brand}` : ''}` : undefined}
        wide
        footer={
          selected && canManage ? (
            <>
              <button className="btn btn--ghost" onClick={() => void toggleActive(selected)} disabled={saving}>
                <Power size={15} /> {selected.active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button className="btn" onClick={() => openPrice(selected)} disabled={saving}>
                <Tag size={15} /> Change price
              </button>
              <button className="btn btn--primary" onClick={() => openEdit(selected)} disabled={saving}>
                <Pencil size={15} /> Edit product
              </button>
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="grid" style={{ gap: 18 }}>
            <div className="flex gap-8 flex-wrap">
              <Badge tone={selected.active ? 'green' : 'neutral'} dot>{selected.active ? 'Active' : 'Inactive'}</Badge>
              <Badge tone="outline">{selected.category || 'Uncategorised'}</Badge>
              {selected.perishable && <Badge tone="amber">Perishable · FEFO</Badge>}
              <Badge tone="blue">{selected.baseUnit}</Badge>
            </div>

            <div className="stat-strip">
              <div>
                <div className="label">On hand</div>
                <div className="value">{num(selected.totalQty)} <span className="tiny muted">{selected.baseUnit}</span></div>
              </div>
              <div>
                <div className="label">Sellable</div>
                <div className="value">{num(selected.sellingQty)}</div>
              </div>
              <div>
                <div className="label">Reorder point</div>
                <div className="value">{num(selected.reorderPoint)}</div>
              </div>
              <div>
                <div className="label">Batch positions</div>
                <div className="value">{selectedStock.length}</div>
              </div>
            </div>

            <div>
              <div className="eyebrow mb-8">Commercial</div>
              <dl className="kv">
                <dt>Selling price</dt>
                <dd>{money(selected.priceKobo)} per {selected.baseUnit}</dd>
                {canSeeCost && (
                  <>
                    <dt>Server cost</dt>
                    <dd>{money(selected.costKobo, true)}</dd>
                    <dt>Margin</dt>
                    <dd>
                      {selected.priceKobo > 0
                        ? (((selected.priceKobo - selected.costKobo) / selected.priceKobo) * 100).toFixed(1)
                        : '0'}%
                    </dd>
                  </>
                )}
                <dt>Pack</dt>
                <dd>{selected.packSize} × {selected.packLabel} ({selected.baseUnit})</dd>
                <dt>Barcode</dt>
                <dd className="mono">{selected.barcode || '—'}</dd>
                <dt>Safety stock</dt>
                <dd>{num(selected.safetyStock)} · order multiple {num(selected.reorderMultiple)}</dd>
                <dt>Expiry warning</dt>
                <dd>{selected.expiryWarningDays} days</dd>
                <dt>Batch tracked</dt>
                <dd>{selected.batchTracked ? 'Yes' : 'No'}</dd>
              </dl>
            </div>

            <div>
              <div className="eyebrow mb-8">Batch positions</div>
              {selectedStock.length === 0 ? (
                <div className="banner">No stock positions on the server yet. Receiving creates the first batch.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Expiry</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th className="right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStock.map((row) => (
                        <tr key={`${row.batchId}-${row.locationId}-${row.status}`}>
                          <td className="mono">{row.batchNo}</td>
                          <td>{dateShort(row.expiry)}</td>
                          <td>{row.locationName}</td>
                          <td>
                            <Badge tone={statusTone(row.status)}>{row.status.toLowerCase()}</Badge>
                          </td>
                          <td className="right numeric">{num(row.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <datalist id="catalogue-category-options">
        {categories.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.productId ? 'Edit product' : 'New product'}
        subtitle={
          editor?.productId
            ? 'Changes are written to the server and audited. Selling price uses the dedicated price action.'
            : 'Adds a product to the server catalogue. Stock arrives later through receiving.'
        }
        size="wide"
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={() => void submitEditor()} disabled={saving}>
              {saving ? 'Saving…' : editor?.productId ? 'Save changes' : 'Create product'}
            </button>
          </>
        }
      >
        {editor && (
          <div className="form-grid">
            {formError && (
              <div className="banner banner--danger span-2" role="alert">
                <span>{formError}</span>
              </div>
            )}
            <div className="field span-2">
              <label htmlFor="p-name">Product name <span className="req">*</span></label>
              <input id="p-name" className="input" value={editor.form.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-sku">SKU <span className="req">*</span></label>
              <input id="p-sku" className="input mono" value={editor.form.sku} onChange={(e) => setField('sku', e.target.value.toUpperCase())} />
            </div>
            <div className="field">
              <label htmlFor="p-barcode">Barcode</label>
              <input id="p-barcode" className="input mono" value={editor.form.barcode} onChange={(e) => setField('barcode', e.target.value)} placeholder="EAN-13" />
            </div>
            <div className="field">
              <label htmlFor="p-brand">Brand</label>
              <input id="p-brand" className="input" value={editor.form.brand} onChange={(e) => setField('brand', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-category">Category</label>
              <input id="p-category" className="input" list="catalogue-category-options" value={editor.form.category} onChange={(e) => setField('category', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-unit">Base unit</label>
              <select id="p-unit" className="select" value={editor.form.baseUnit} onChange={(e) => setField('baseUnit', e.target.value as ServerProduct['baseUnit'])}>
                <option value="each">each</option>
                <option value="kg">kg</option>
                <option value="litre">litre</option>
                <option value="metre">metre</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-pack">Pack size</label>
              <input id="p-pack" className="input" type="number" min={0.001} step="0.001" value={editor.form.packSize} onChange={(e) => setField('packSize', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-packlabel">Pack label</label>
              <input id="p-packlabel" className="input" value={editor.form.packLabel} onChange={(e) => setField('packLabel', e.target.value)} placeholder="carton, sachet, bag" />
            </div>
            <div className="field">
              <label htmlFor="p-cost">Unit cost (₦)</label>
              <input id="p-cost" className="input" type="number" min={0} step="0.01" value={editor.form.costNaira} onChange={(e) => setField('costNaira', e.target.value)} />
            </div>
            {editor.productId === null && (
              <div className="field">
                <label htmlFor="p-price">Selling price (₦) <span className="req">*</span></label>
                <input id="p-price" className="input" type="number" min={0} step="0.01" value={editor.form.priceNaira} onChange={(e) => setField('priceNaira', e.target.value)} placeholder="0.00" />
                <span className="field__hint">After creation, price changes go through the audited price action.</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="p-expiry">Expiry warning (days)</label>
              <input id="p-expiry" className="input" type="number" min={0} value={editor.form.expiryWarningDays} onChange={(e) => setField('expiryWarningDays', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-reorder">Reorder point</label>
              <input id="p-reorder" className="input" type="number" min={0} step="0.001" value={editor.form.reorderPoint} onChange={(e) => setField('reorderPoint', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-safety">Safety stock</label>
              <input id="p-safety" className="input" type="number" min={0} step="0.001" value={editor.form.safetyStock} onChange={(e) => setField('safetyStock', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-multiple">Order multiple</label>
              <input id="p-multiple" className="input" type="number" min={0.001} step="0.001" value={editor.form.reorderMultiple} onChange={(e) => setField('reorderMultiple', e.target.value)} />
            </div>
            <div className="span-2 divider" />
            {editor.productId !== null && (
              <label className="check">
                <input type="checkbox" checked={editor.form.active} onChange={(e) => setField('active', e.target.checked)} /> Active — available for sale and purchasing
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={editor.form.perishable} onChange={(e) => setField('perishable', e.target.checked)} /> Perishable — receiving requires an expiry date
            </label>
            <label className="check">
              <input type="checkbox" checked={editor.form.batchTracked} onChange={(e) => setField('batchTracked', e.target.checked)} /> Track stock by batch / lot
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={!!priceTarget}
        onClose={() => setPriceTarget(null)}
        title="Change selling price"
        subtitle={priceTarget ? `${priceTarget.name} · current ${money(priceTarget.priceKobo)}` : undefined}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setPriceTarget(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={() => void submitPrice()} disabled={saving}>
              {saving ? 'Saving…' : 'Save price'}
            </button>
          </>
        }
      >
        <div className="grid">
          {priceError && (
            <div className="banner banner--danger" role="alert">
              <span>{priceError}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="np">New price (₦)</label>
            <input id="np" className="input" type="number" min={0} step="0.01" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} />
            <span className="field__hint">The change is audited with your name, time and reason.</span>
          </div>
          <div className="field">
            <label htmlFor="nr">Reason <span className="req">*</span></label>
            <textarea id="nr" className="textarea" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder="Supplier cost change, promotion, competitor match…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
