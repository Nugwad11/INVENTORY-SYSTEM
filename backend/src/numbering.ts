import type { Queryable } from './db.js';

export async function nextDocumentNumber(
  tx: Queryable,
  storeId: string,
  kind: string,
  prefix: string,
): Promise<string> {
  const { rows } = await tx.query<{ value: string | number | bigint }>(
    `insert into document_counters (store_id, kind, value)
     values ($1, $2, 1)
     on conflict (store_id, kind)
     do update set value = document_counters.value + 1
     returning value`,
    [storeId, kind],
  );

  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Failed to allocate a document number.');
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
