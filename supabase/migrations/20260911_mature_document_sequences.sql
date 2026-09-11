-- Raise commercial document counters so newly issued numbers start at ~125
-- (TLB-ORD-YYMM-00125 style) instead of looking brand-new at 00001.
-- Does not renumber existing document rows — only advances sequence floors.

update public.document_counters
set
  order_seq = greatest(order_seq, 124),
  supply_seq = greatest(supply_seq, 124),
  invoice_seq = greatest(invoice_seq, 124),
  receipt_seq = greatest(receipt_seq, 124),
  delivery_seq = greatest(delivery_seq, 124),
  payment_seq = greatest(payment_seq, 124)
where id = 1;

-- Prefer mature defaults for fresh installs that only hit the insert path later.
alter table public.document_counters
  alter column order_seq set default 124,
  alter column supply_seq set default 124,
  alter column invoice_seq set default 124,
  alter column receipt_seq set default 124,
  alter column delivery_seq set default 124,
  alter column payment_seq set default 124;
