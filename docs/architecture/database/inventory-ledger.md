# Inventory ledger

Physical stock in schema `tlb` has one source of truth: `inventory_movements`. Balances, reserved quantity, and batch remaining quantity are projections. Available quantity is derived again on read.

The frontend ledger in `src/lib/store/inventory-store.ts` is unchanged. It still keeps `signedQty` on each movement and can soft-hide a movement in the UI. The canonical table cannot do that.

## Movements are immutable

`inventory_movements` has no `updated_at`, no `deleted_at`, and no update or delete policy. `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` call `tlb.reject_row_mutation()`.

A row records:

- `movement_type`
- `direction` of `-1` or `1`
- `quantity` greater than zero, `numeric(18,4)`
- `qty_before` and `qty_after` for the product and warehouse on-hand chain
- optional `batch_id`
- `movement_number` (business number, not the UUID)
- optional `actor_id`, reason, and a loose reference (`reference_type`, `reference_id`, `reference_number`)

`qty_after` must equal `qty_before + direction * quantity`. The signed amount is that product. It is not stored as its own column. The frontend `signedQty` can be reconstructed as `direction * quantity`.

`reservation` and `release` are not movement types. In `postStockMovement` those two types do not change physical quantity. Holds belong on `inventory_reservations`.

| Direction | Types |
| --- | --- |
| `1` inbound | `opening`, `grn`, `transfer_in`, `adjustment_plus`, `return_customer`, `production` |
| `-1` outbound | `issue`, `transfer_out`, `adjustment_minus`, `return_supplier`, `damage`, `expiry`, `sample`, `supply` |

`movementSignedQty()` in the frontend also treats `release` as inbound. The poster does not apply that to physical stock, and this schema follows the poster.

## How a row is applied

`tlb.apply_inventory_movement()` runs after insert:

1. It locks the balance row for `(product_id, warehouse_id)`, creating a zero row if this is the first movement.
2. It rejects the movement when `qty_before` is not the locked on-hand quantity. Two posters cannot both start from the same `qty_before`.
3. It sets `quantity_on_hand` to `qty_after`. The balance check constraint rejects a negative result. `products.allow_negative_stock` does not override that.
4. If `batch_id` is set, the batch must be the same product and warehouse. Remaining quantity moves by `direction * quantity` and must stay between 0 and `quantity_received`. An open batch whose remaining quantity hits 0 becomes `Closed`. A closed batch that receives stock becomes `Open` again. Quarantine, Expired, and Damaged are left as they are.

Insert a batch with `quantity_remaining = 0` and `quantity_received` set to the lot size, then post the inbound movement in the same transaction. Setting remaining quantity on insert, or editing it later, is rejected. `quantity_received` cannot change after insert.

`damage` and `expiry` movements only reduce on-hand. The frontend issue path also increments `damagedQty` or `expiredQty` for some reasons. Those bucket columns exist on `inventory_balances` (`quantity_damaged`, `quantity_expired`, `quantity_quarantine`, `quantity_in_transit`, `quantity_allocated`) so the shape matches `StockBalance`, but this foundation does not post them yet. They stay 0 until a later posting function updates them through the projection flag. Direct updates are rejected.

## Balances are a projection

`inventory_balances` primary key is `(product_id, warehouse_id)`. There is no surrogate id.

| Column | Written by |
| --- | --- |
| `quantity_on_hand` | movement trigger |
| `quantity_reserved` | reservation trigger |
| other quantity buckets | reserved for a later poster; not written today |

Every quantity is `>= 0`. Reserved, damaged, expired, and quarantine together cannot exceed on-hand.

`tlb.v_inventory_availability.quantity_available` is:

```text
greatest(0, on_hand - reserved - damaged - expired - quarantine)
```

That matches `calcAvailable` in `src/lib/domain/calculations.ts`. `in_transit` and `allocated` are visible and are not part of that formula. The view is `security_invoker`, so balance RLS applies. Available quantity is not stored.

The projection flag `tlb.inventory_projection` is set only for the statements inside the triggers and cleared before those functions return. A following statement in the same transaction cannot use it to overwrite a balance.

## Reservations

`inventory_reservations` holds quantity for a product and warehouse, optionally a batch. `quantity` is `> 0`. `status` is `active`, `released`, `consumed`, or `expired`. An active row cannot have `released_at` set.

There is no `order_line_id`. Sales orders are not in this schema. `reference_type` and `reference_id` are the placeholder for that link.

After insert or update, `tlb.recompute_quantity_reserved()` sets `quantity_reserved` to the sum of active rows. If that sum plus damaged, expired, and quarantine would exceed on-hand, the reservation fails. Delete and truncate are rejected. Release a hold by changing `status`.

Reservations do not change `quantity_on_hand` and do not write a movement.

## Future FEFO

`products.issue_strategy` is `FIFO`, `LIFO`, or `FEFO`. The default is `FEFO`.

Nothing in this migration picks a batch. The frontend `sortBatchesForStrategy` / `recommendBatches` still does that in TypeScript. The table is ready for a later picker:

- `expires_at` is a date. Null means the lot has no expiry and sorts last under FEFO, matching the frontend’s `9999-12-31` fallback.
- `received_at` is the FIFO / LIFO timestamp, and the FEFO tie-break.
- Partial index `inventory_batches_expiry_idx` covers open batches with remaining quantity, ordered by product, warehouse, expiry, then receipt time.

A future function should only recommend. The movement row remains the thing that actually takes quantity, and it must name the `batch_id` it consumed.

## What is still out of scope

Goods receipts, issues, transfers, adjustments, returns, production, and samples are movement types, not documents. Their headers (GRN, transfer, adjustment) are not tables yet. Posting them should be a later `SECURITY DEFINER` function that checks `stock.receive`, `stock.issue`, `stock.transfer`, `stock.adjust`, or `stock.approve`, allocates a `movement_number`, and inserts the ledger row. Authenticated users cannot insert movements directly.
