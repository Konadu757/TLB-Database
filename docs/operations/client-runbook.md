# TLB portal — operator runbook

This is for the person who runs [https://portal.tlbgh.com](https://portal.tlbgh.com) without the original developer. It tells you how to apply the database scripts that are already in the project folder, how to check they worked, and how a second person signs in.

Applying these scripts does not rebuild the website. After `20260928_100001` through `20260928_100007`, two parts of the portal call schema `tlb` when the hosted project is configured: stock movements and document numbers (only with a Supabase Auth session), and staff invites (`public.create_invite` / `public.accept_invite`). Orders, invoices, and the communication hub stay on the browser and on schema `public`.

The Supabase project the portal has used is `mfyvhpwjrpjcxdlsqgit` (TLB Database). Open that project in the Supabase dashboard and confirm **Project Settings → General** shows the same reference. If it does not, stop. Older docs may still mention `myjwrhimhkakiczjfzeo`; that project is dead — do not apply SQL there.

Whether those files have been applied on the hosted project is recorded at the end of a handover, in [handover-checklist.md](handover-checklist.md). Do not assume a git push applied the SQL.

### Hosted apply from the handover machine

This machine could not apply `20260928_100001` through `20260928_100007` to project `myjwrhimhkakiczjfzeo`.

The Supabase CLI stopped with: `Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.`

Local env and the Vercel production environment have the publishable URL and key only. There is no database password, no `DATABASE_URL`, and no service-role key on this machine. `psql` is not installed. The publishable key cannot run these scripts. Paste the files below in the SQL Editor instead. Do not put a service-role key in the browser to get past this.

Ordered paste, one file per run, after the historical check in [scripts/apply-canonical-db.md](../../scripts/apply-canonical-db.md):

1. `supabase/migrations/20260928_100001_core_identity.sql`
2. `supabase/migrations/20260928_100002_master_data.sql`
3. `supabase/migrations/20260928_100003_inventory_ledger.sql`
4. `supabase/migrations/20260928_100004_documents_audit_rls.sql`
5. `supabase/migrations/20260928_100005_ledger_post_and_document_numbers.sql`
6. `supabase/migrations/20260928_100006_access_control.sql`
7. `supabase/migrations/20260928_100007_app_catalog.sql`

## What the live portal stores today

The website keeps a copy in the browser and also saves a large part of the business to Supabase schema `public` when the hosted project is reachable.

Browser keys (this computer only):

| Browser storage key | What it holds |
| --- | --- |
| `tlb.enterprise.state.v1` | A full local snapshot, including the signed-in person |
| `tlb.enterprise.local-only.v1` | The slices that are not saved as their own Supabase tables |
| `tlb.enterprise.product-extras.v1` | Extra product fields (reorder, costing, strategy) |
| `tlb.enterprise.stock-extras.v1` | Extra stock fields |

Still only in the browser (and in that local snapshot), even while the portal is online:

- Batches (a stock post can reach `tlb` without copying the batch row)
- Quotations
- Suppliers, supplier purchase orders, supplier receipts, supplier payments
- Returns, non-PO purchases, import shipments, export shipments, as documents
- Operations hub (requests, drivers, messages, custody, discrepancies, approval rules)
- Trash / catalog deletions
- The staff session on this browser. That session is not a Supabase Auth login, so stock posts stay on this computer until a GoTrue session exists

When Supabase is configured and the browser holds a Supabase Auth session, a stock post calls `public.ensure_ledger_ref` and then `public.post_movement`. Document numbers call `public.issue_document_number`. Seeded ids such as `prod-hcl` and `wh-main` are mapped to the uuids inserted by `20260928_100007_app_catalog.sql`. Without that Auth session the same post stays in the browser. Orders, invoices, and the communication hub are not moved by this.

Saved to Supabase `public` when sync is on (Table Editor, schema `public`):

- Warehouses, products, stock balances
- Customers, customer orders, order lines, supplies, supply lines
- Invoices, receipts, deliveries, payments, and their lines
- Notifications, stock reservations, VAT rates
- Audit events, document counters
- `app_settings` rows for the company profile, ageing, soft-delete notes, and `auth_directory` (the user and role list, including invite codes)

Outstanding quantities are calculated on screen. They are not a stored balance.

## What appears in Supabase after you apply the new scripts

Schema `tlb` is the new layout. After a successful apply it contains these tables:

`profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `warehouses`, `user_warehouse_access`, `units_of_measure`, `product_categories`, `products`, `customers`, `suppliers`, `inventory_batches`, `inventory_movements`, `inventory_balances`, `inventory_reservations`, `document_sequences`, `audit_events`, `invites`.

There is also a view, `tlb.v_inventory_availability`.

Customers, stock balances, and invoices you see on the website still load from the browser and from `public`. These scripts do not copy existing rows into `tlb`. `public` tables are left in place.

`20260928_100007_app_catalog.sql` inserts the portal’s seeded warehouses (`MAIN`, `FACTORY`, `ACCRA`) and products (`CHEM-A`, `CHEM-B`, `MAT-B`, `CHEM-001`, `CHEM-014`) into `tlb` so a later stock post has a real uuid to use.

Orders, quotations, invoices, receipts, payments, deliveries, procurement, factory, quality, and the operations hub are still not tables in `tlb`. A supply or goods issue can write a `tlb` movement when an Auth session exists. The order or invoice itself stays where it is.

Passwords are not stored in `tlb`. Supabase Auth holds credentials. `tlb.profiles` is a name and email linked to that account. Settings → Users calls `public.create_invite`. The access page calls `public.accept_invite`. That function creates a profile. It does not sign the person into Supabase Auth, and it does not email the code. The access code is also kept in the browser user list (`app_settings` / `auth_directory` when sync is on).

## Keys

The SQL Editor is already logged in as the database owner. You do not paste any API key into it.

The **service-role** key (Supabase **Project Settings → API**, secret key named service_role) must not go in the browser, in a `VITE_` variable, in email, in chat, or in this document. The portal’s public anon / publishable key is the only browser key, and it is already configured if the site loads data. Leave the service-role key in the Supabase dashboard.

The database password used in the `pg_dump` and `psql` lines below is also not the service-role key. Take it from **Project Settings → Database**, and do not write the real password into this file.

## Backup before you paste SQL

Take a backup first.

1. In the Supabase dashboard open **Database → Backups**.
2. If the page offers a download or a scheduled backup, take one and wait until it finishes.
3. Point-in-time recovery (a restore to an exact minute) exists only when the project is on a paid plan that shows PITR or “Point in time” on that Backups page. If you only see daily backups, you do not have PITR. Take the dump below as well.

Logical dump, from a computer that has PostgreSQL client tools installed. Replace the bracketed placeholders. Do not put a real password in the command history you share with anyone.

```text
pg_dump --dbname="postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" --format=custom --no-owner --no-privileges --file=tlb-backup-YYYYMMDD.dump
```

`[PROJECT_REF]` for this portal is `myjwrhimhkakiczjfzeo` after you have confirmed it on the General settings page. Use port `5432` (direct connection), not the pooler port.

Keep the `.dump` file somewhere outside the project folder and outside the browser.

### Restore, same level of care

Prefer the **Restore** action on **Database → Backups** for a backup Supabase itself took. That is the button that matches those backups.

A dump file is restored with `pg_restore`. This replaces objects in the database you point it at. Run it only when you mean to put that backup back, and only against the project reference you confirmed.

```text
pg_restore --dbname="postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" --no-owner --no-privileges --clean --if-exists tlb-backup-YYYYMMDD.dump
```

If restore fails halfway, stop and copy the error. Do not run a second restore on top of a half-finished one until someone has looked at that error.

## Apply order

Full click-by-click file list: [scripts/apply-canonical-db.md](../../scripts/apply-canonical-db.md).

Short version:

1. Run the “what is already applied” query in that page.
2. If the historical `public` tables are missing, paste these files in the SQL Editor, one at a time, and wait for success after each:
   - `supabase/migrations/20260909_customer_orders.sql`
   - `supabase/migrations/20260909_p1_documents.sql`
   - `supabase/migrations/20260909_p2_text_ids_and_soft_delete.sql`
   - `supabase/migrations/20260911_mature_document_sequences.sql`
3. Then paste, one at a time:
   - `supabase/migrations/20260928_100001_core_identity.sql`
   - `supabase/migrations/20260928_100002_master_data.sql`
   - `supabase/migrations/20260928_100003_inventory_ledger.sql`
   - `supabase/migrations/20260928_100004_documents_audit_rls.sql`
   - `supabase/migrations/20260928_100005_ledger_post_and_document_numbers.sql` — `public.post_movement` and `public.issue_document_number`
   - `supabase/migrations/20260928_100006_access_control.sql` — `public.create_invite`, `public.accept_invite`, and the anon write revoke list below
   - `supabase/migrations/20260928_100007_app_catalog.sql` — seeded product and warehouse uuids, plus `public.ensure_ledger_ref`
4. `scripts/apply-canonical-db.sql` is the `psql` shortcut for those seven files. It uses `\i` and does not contain a second copy of the SQL. The SQL Editor cannot run `\i`; paste the files there instead.

Open each file from the project folder, select the entire contents, paste into **SQL Editor → New query**, and run it. One file per run.

## How to confirm it worked

In the SQL Editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'tlb'
  and table_type = 'BASE TABLE'
order by table_name;
```

You should see exactly these 19 names: `audit_events`, `customers`, `document_sequences`, `inventory_balances`, `inventory_batches`, `inventory_movements`, `inventory_reservations`, `invites`, `permissions`, `product_categories`, `products`, `profiles`, `role_permissions`, `roles`, `suppliers`, `units_of_measure`, `user_roles`, `user_warehouse_access`, `warehouses`.

The older portal tables must still be there:

```sql
select
  to_regclass('public.warehouses') as warehouses,
  to_regclass('public.products') as products,
  to_regclass('public.customers') as customers,
  to_regclass('public.audit_events') as audit_events;
```

Each column should show a name, not blank.

Then run the project’s check script, `supabase/tests/verify-canonical-db.sql`. Paste the **whole** file into the SQL Editor and run it once. It inserts test rows, checks them, and ends with `ROLLBACK`, so a successful run leaves no test data.

- Success: the editor finishes with no error (often “Success” and no result rows).
- Failure: the message starts with `VERIFY FAIL`. Copy that message. Do not run the file in pieces. The rollback only protects you when the whole script runs together.

With `psql`, from the repository root:

```text
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/verify-canonical-db.sql
```

A clean finish prints `ROLLBACK`. The script checks the 19 tables, the permission seed, that two document numbers differ (`TLB-ORD-2099-000125` then `TLB-ORD-2099-000126`), that a posted stock movement updates `tlb.inventory_balances`, that `anon` has no table access to `tlb`, and that `anon` cannot write the public stock tables revoked in `100006`. Those test numbers are rolled back. Do not call `tlb.next_document_number` yourself outside this script; that would consume a real number.

`100005` adds `public.post_movement` and `public.issue_document_number` for signed-in users. `anon` must not be able to execute either one. `100006` adds `public.accept_invite` and `public.create_invite`. `100006` revokes anon and authenticated insert, update, and delete on these public tables when they exist: `stock_movements`, `batches`, `goods_receipts`, `goods_receipt_lines`, `stock_issues`, `stock_issue_lines`, `warehouse_transfers`, `warehouse_transfer_lines`, `stock_adjustments`, `stock_adjustment_lines`. Select on those tables stays. The hybrid portal still writes the other `public` business tables with the publishable key.

Mark the boxes in [handover-checklist.md](handover-checklist.md).

Then open [https://portal.tlbgh.com](https://portal.tlbgh.com) and confirm the dashboard still loads. If the dashboard errors after the apply, stop and copy the on-screen message. Do not re-run the SQL.

## If an apply fails halfway

Stop. Leave the SQL Editor as it is.

- Copy the full error, including the file name you were running.
- Do not press Run again on `20260928_100001` through `100006` after one of them has failed in the middle. Those files are not written to be run twice. “already exists” means that part is already there. `100007` skips catalog rows that are already present, but a failure in the function section should still be copied before you run that file again.
- Do not run `DROP SCHEMA`, `DROP TABLE`, `TRUNCATE`, or any delete to “clean up” and start over.
- The historical `20260909` and `20260911` files are written so a second run is possible, but you still stop and copy the error before you try again.
- Send the error text to whoever maintains the code, with the name of the last file that succeeded and the file that failed.

## How a second person signs in

Invites are access codes inside the portal. When the Supabase environment is set, Settings also calls `public.create_invite`, and the access page calls `public.validate_invite` then `public.accept_invite` with the password the invitee chose. After assign, the portal POSTs to same-origin `/api/invite-email` (Resend) and, when contact looks like a phone, `/api/invite-sms` (Arkesel preferred; Termii then Twilio fallback). Those routes read server env only. If the keys are missing, the **Invitation ready** panel still shows the code/link and says email/SMS were not sent. `accept_invite` stores a profile, assigns a role, and sets the Auth password. It does not open a GoTrue session by itself — the access page signs the person in with email + that new password.

### Invite bootstrap (Owner Auth + anon execute)

`public.create_invite` is still executable by `anon`, and so is `public.accept_invite`. That is deliberate for the first invite before a GoTrue session exists.

The portal Owner now signs in with Supabase Auth. When `auth.uid()` is set, `create_invite` requires `users.manage` via `tlb.user_roles`. If the Owner Auth user was created in the dashboard without an Owner role row, Settings shows **Not synced** / `users.manage required`, and `/access` returns **invalid invite** because nothing was stored in `tlb.invites`.

Fix (applied on `mfyvhpwjrpjcxdlsqgit`): run `scripts/bootstrap-owner-users-manage-mfyv.sql` (and optionally `scripts/patch-create-invite-owner-selfheal-mfyv.sql`). Then **Re-issue** from Settings so a fresh code is written to the cloud. Old codes from a failed cloud save will not work on other devices.

Leave the anon execute grant until you are ready to revoke it for callers that always send a `users.manage` session. Do not put the service-role key in the browser.

The steps:

1. An administrator opens [https://portal.tlbgh.com](https://portal.tlbgh.com) and goes to **Settings → Users & role assignment**.
2. Enter name, contact, email, and role, then choose **Assign role** (or **Re-issue** on a pending row).
3. Directly under the form, the green **Invitation ready** panel shows the access code (`TLB-XXXX-XXXX`) and the full `/access?invite=…` link. Use **Copy access code**, **Copy invite link**, or **Copy SMS text**. The panel stays until you dismiss it.
4. The panel lists cloud / email / SMS status honestly (sent, not configured, or failed). Copy buttons stay available either way. Treat the code and link like a password.
5. The other person opens the link (`https://portal.tlbgh.com/access?invite=...`) or opens [https://portal.tlbgh.com/access](https://portal.tlbgh.com/access) and enters the **access code** (not a password).
6. After the code is validated, they **create their own password** (and confirm it), then the portal signs them in.
7. Later visits use the normal sign-in screen with **email + that password**. The access code is single-use.
8. If the page says the invite is invalid or expired, the administrator refreshes the portal once (so the user list can finish saving) and sends a fresh code via **Re-issue**.

### Email and SMS (Resend + Arkesel on Vercel)

The portal never puts Resend, Arkesel, Termii, Twilio, or the Supabase **service_role** key in a `VITE_` variable. Delivery runs only on the server routes `/api/invite-email` and `/api/invite-sms`. SMS prefers Arkesel when `ARKESEL_API_KEY` and `ARKESEL_SENDER_ID` are set; on Arkesel failure/timeout it falls through to Termii if `TERMII_*` is set, then Twilio if `TWILIO_*` is set.

After Resend or Arkesel soft-accepts a message, the portal briefly checks delivery status. Immediate **bounces / FAILED** are shown as Failed (not Sent). “Sent / accepted” still means the provider took the message — check spam and provider logs if the phone/inbox never gets it.

**Required Production env vars** on Vercel project `tlb-management-system` (Production + Preview if you test previews):

| Name | Purpose |
|------|---------|
| `RESEND_API_KEY` | Resend API key (Dashboard → API Keys) |
| `RESEND_FROM_EMAIL` | Verified from address, e.g. `TLB Portal <invites@tlbgh.com>` |
| `ARKESEL_API_KEY` | Arkesel API key (Dashboard → API Keys / Developer settings) |
| `ARKESEL_SENDER_ID` | Approved Arkesel sender ID / brand name, max 11 characters (Dashboard → Sender ID) |

Optional:

| Name | Purpose |
|------|---------|
| `RESEND_REPLY_TO` | Optional reply address (must be a real mailbox) |
| `ARKESEL_BASE_URL` | Default `https://sms.arkesel.com` |
| `TERMII_API_KEY` / `TERMII_SENDER_ID` | Fallback SMS when Arkesel fails (recommended) |
| `TERMII_BASE_URL` | Default `https://api.ng.termii.com` |
| `TERMII_CHANNEL` | Default `dnd` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Second SMS fallback |

#### DNS that must stay correct for `invites@tlbgh.com` (Resend)

Public check on 2026-10-02 found:

- DKIM present: `resend._domainkey.tlbgh.com` TXT (good)
- **Broken return-path:** `send.tlbgh.com` is a **CNAME → `send.forge.rmta.net`** (not Resend). That breaks SPF/bounce handling and is the permanent cause of Gmail/other bounces after Resend says accepted.
- Root `tlbgh.com` has **no SPF** TXT (only Google site verification)
- DMARC: `_dmarc.tlbgh.com` = `v=DMARC1; p=none;` (ok for now)

**Owner must fix DNS at the registrar (Namecheap / registrar-servers) — exact records:**

1. **Delete** the CNAME `send` → `send.forge.rmta.net` (conflicts with Resend; you cannot keep both on `send`).
2. Add Resend return-path / SPF for subdomain `send` (copy region from Resend → Domains → tlbgh.com → Records if different):

| Type | Host / Name | Value | Priority |
|------|-------------|-------|----------|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

3. Keep DKIM (already present — do not delete):

| Type | Host / Name | Value |
|------|-------------|-------|
| TXT | `resend._domainkey` | *(exact value shown in Resend Domains → Records — already live)* |

4. Optional root SPF (helps alignment; do not invent IPs — if Google Workspace sends from the root too, include Google):

| Type | Host / Name | Value |
|------|-------------|-------|
| TXT | `@` | `v=spf1 include:_spf.google.com include:amazonses.com ~all` |

5. In Resend → Domains → `tlbgh.com` → **Verify DNS Records**. Status must be **Verified**.
6. Keep `RESEND_FROM_EMAIL` = `TLB Portal <invites@tlbgh.com>` on Vercel Production, then **redeploy**.

**If marketing/forge must keep `send.tlbgh.com`:** do not fight over `send`. Instead add a dedicated Resend domain `invites.tlbgh.com` (or `mail.tlbgh.com`), paste every Resend record for that subdomain, set `RESEND_FROM_EMAIL` to `TLB Portal <noreply@invites.tlbgh.com>`, verify, redeploy.

#### Arkesel SMS

- Sender ID `TLB` must be **Approved** in Arkesel (pending IDs cause accept-then-fail / rejects).
- Account needs SMS credit.
- Ghana numbers normalize `0544967381` → `+233544967381` before send.
- Add `TERMII_*` (or Twilio) on Vercel so Arkesel failures automatically fall through.

**Owner setup steps**

1. Create a [Resend](https://resend.com) account. Verify your sending domain with the DNS table above (or use Resend’s onboarding from-address only for tests). Create an API key. Note the from address you will use.
2. Open your [Arkesel](https://sms.arkesel.com) dashboard (or [arkesel.com](https://arkesel.com) → login). Copy the **API key** from API / Developer settings. Register and wait for an **approved Sender ID** (alphanumeric brand name, max 11 characters). Ensure the account has SMS credit.
3. In Vercel → **tlb-management-system** → **Settings** → **Environment Variables**, add `RESEND_*` and `ARKESEL_API_KEY` + `ARKESEL_SENDER_ID` for **Production** (and Preview if needed). Paste the real values there — do not put them in the repo or in any `VITE_*` name. Optionally add Termii/Twilio fallbacks.
4. Redeploy Production (Deployments → … → Redeploy, or push a commit). Without a redeploy, server routes will not see new env.
5. Assign a role again. The panel should say **Email accepted/delivered…** and **SMS accepted/delivered…** when keys are valid. Immediate bounces show as **Failed** with the provider reason. If a key is missing, it still says not configured and Copy still works.

CLI (names only; do not print secrets):

```text
npx vercel env add RESEND_API_KEY production
npx vercel env add RESEND_FROM_EMAIL production
npx vercel env add ARKESEL_API_KEY production
npx vercel env add ARKESEL_SENDER_ID production
npx vercel env ls
```

Signing in this way switches the portal session. It does not create a password in Supabase Authentication, and it does not grant them the Supabase dashboard.

## What still needs a developer

- Orders, quotations, invoices, receipts, payments, deliveries, and the communication / operations hub records (they are not `tlb` tables)
- Copying historical browser stock into `tlb` (new posts do that only when a Supabase Auth session exists)
- A GoTrue session for the Owner, so `create_invite` can require `users.manage` and the anon execute grant can be revoked
- Batch rows in `tlb` (a post omits a batch id that is not a uuid)
- Any restore that failed halfway, and any change on Vercel
