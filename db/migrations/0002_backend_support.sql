-- Support objects required by the API layer.

-- Atomic per-store document numbering (sale, PO, receipt, count, write-off).
create table document_counters (
  store_id uuid not null references stores(id),
  kind     text not null,
  value    bigint not null default 0 check (value >= 0),
  primary key (store_id, kind)
);

-- Login is by phone within a store. Soft-deleted users free the number for reuse.
create unique index users_store_phone_key
  on users (store_id, phone)
  where deleted_at is null;
