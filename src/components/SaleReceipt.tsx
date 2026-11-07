import { useMemo } from 'react';
import { useApp } from '../store/AppStore';
import { dateTime, money, num } from '../lib/format';
import type { Sale } from '../types';

interface ReceiptLine {
  key: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  returnedQty: number;
}

export function SaleReceipt({ sale }: { sale: Sale }) {
  const { state } = useApp();

  const productById = useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
  const userById = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users]);

  const lines = useMemo(() => {
    const merged = new Map<string, ReceiptLine>();
    sale.lines.forEach((line) => {
      const product = productById.get(line.productId);
      const key = `${line.productId}:${line.unitPrice}`;
      const existing = merged.get(key);
      if (existing) {
        existing.qty += line.qty;
        existing.returnedQty += line.returnedQty;
        existing.total += Math.round(line.qty * line.unitPrice);
        return;
      }
      merged.set(key, {
        key,
        name: product?.name ?? line.productId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        total: Math.round(line.qty * line.unitPrice),
        returnedQty: line.returnedQty,
      });
    });
    return [...merged.values()];
  }, [sale.lines, productById]);

  const cashier = userById.get(sale.cashierId)?.name ?? 'Till operator';
  const returnedUnits = sale.lines.reduce((sum, line) => sum + line.returnedQty, 0);

  return (
    <article className="receipt-sheet" aria-label={`Receipt ${sale.number}`}>
      <header className="receipt-brand">
        <strong>{state.store.name}</strong>
        <span>{state.store.address}</span>
        <span>{state.store.code} · {sale.deviceId}</span>
      </header>

      <div className="receipt-rule" />

      <div className="receipt-title">Sales receipt</div>

      <div className="receipt-meta">
        <span>Receipt</span><strong className="mono">{sale.number}</strong>
        <span>Date</span><span>{dateTime(sale.occurredAt)}</span>
        <span>Cashier</span><span>{cashier}</span>
        <span>Customer</span><span>{sale.customerName ?? 'Walk-in'}</span>
        <span>Payment</span><span>{sale.payment}</span>
      </div>

      <div className="receipt-rule" />

      <table className="receipt-lines">
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <td>
                <div>{line.name}</div>
                <div className="receipt-line-meta">
                  {num(line.qty)} × {money(line.unitPrice)}
                  {line.returnedQty > 0 ? ` · ${num(line.returnedQty)} returned` : ''}
                </div>
              </td>
              <td className="receipt-amount">{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-rule" />

      <div className="receipt-totals">
        <div><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div><span>Discount</span><span>−{money(sale.discount)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(sale.total)}</span></div>
        <div><span>Paid by</span><span>{sale.payment}</span></div>
      </div>

      {sale.status === 'VOIDED' && (
        <div className="receipt-void">
          Voided
          {sale.voidReason ? <div className="receipt-void__reason">{sale.voidReason}</div> : null}
        </div>
      )}

      {sale.status !== 'VOIDED' && returnedUnits > 0 && (
        <div className="receipt-note">
          {num(returnedUnits)} unit(s) from this receipt have been returned.
        </div>
      )}

      <div className="receipt-rule" />

      <footer className="receipt-foot">
        <strong>Thank you for shopping with us.</strong>
        <span>Keep this receipt for returns and exchanges.</span>
      </footer>
    </article>
  );
}
