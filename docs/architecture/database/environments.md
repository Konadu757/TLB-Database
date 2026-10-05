# Supabase environments (names and refs only)

Do not commit secrets. Local `.env` holds values; this doc maps **project refs** and **repos** only.

## Projects

| Ref | Dashboard name | Role | Status |
| --- | --- | --- | --- |
| `mfyvhpwjrpjcxdlsqgit` | TLB Database | **Production** portal DB ([portal.tlbgh.com](https://portal.tlbgh.com)) | Active — CP01 verified here (linked CLI) |
| `myjwrhimhkakiczjfzeo` | (legacy) | Former / prototype | **Obsolete** — do not apply SQL (called out in `docs/operations/client-runbook.md`) |

No separate staging or preview Supabase project ref is documented in-repo. Vercel preview deployments would use whatever env vars are configured per environment (see below).

## Repos and remotes

| Git remote | Repository | Typical use |
| --- | --- | --- |
| `origin` | `mccaesartech/TLB-Management-System` | App (Vite/TanStack), migrations, portal |
| `tlb-database` | `Konadu757/TLB-Database` | Collaborative database mirror; **remote `main` still lists `.env` in tree** — treat as separate hygiene issue |

Both remotes can carry the same migration files under `supabase/migrations/`. Production apply target is **`mfyvhpwjrpjcxdlsqgit`**, not the obsolete ref.

## Config drift

| Source | Points to | Notes |
| --- | --- | --- |
| `supabase/.temp/linked-project.json` | `mfyvhpwjrpjcxdlsqgit` | Matches live CP01 work |
| `supabase/config.toml` `project_id` | `myjwrhimhkakiczjfzeo` | Stale local/CLI template id only; does **not** override `supabase link` (linked ref is `mfyvhpwjrpjcxdlsqgit` via `.temp`) |
| `.env.example` | `YOUR_PROJECT_REF` placeholders | Correct pattern for new clones |
| `docs/operations/client-runbook.md` | Live `mfyvhpwjrpjcxdlsqgit`; backup examples still mention obsolete ref in one `pg_dump` placeholder | Human runbook — confirm General settings before SQL |

## Live migration history (mfyv) — Oct 2026 diagnosis

- CLI link is **mfyv**; project is healthy.
- Schema **`tlb` CP01 objects are present** (verify / gap-check OK). Invites RPCs (`create_invite` / `accept_invite`) are also present.
- Schema **`supabase_migrations` does not exist** — apply was via SQL Editor, not `db push`. `migration list --linked` shows **all Remote empty**.
- Re-applying CP01 → Postgres **`42P07: relation "…" already exists`** (expected conflict). Live foundation is **not** broken.
- Do **not** `db push` the full migrations folder onto live until history/version naming is repaired. See `scripts/apply-cp01-foundation.md`.
- Filename versions collapse to date-only in the CLI (`20260928`, `20260909`, …), so multiple files share a displayed version — blocks clean `migration repair` without an architect rename plan.

## Vercel env mapping (names only)

Pulled development env file present locally (`.env.vercel.pull`) defines these **names** (values empty in pull artifact):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_TLB_USE_SUPABASE` (in `.env.example`)

Server-side invite/SMS routes use names from `.env.example` such as `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and optionally `SUPABASE_SERVICE_ROLE_KEY` (commented in example). Exact production vs preview values: **UNKNOWN** without dashboard access; assume production portal uses **`mfyvhpwjrpjcxdlsqgit`** per runbook and linked CLI.

## Local / clean DB

Requires Docker (or Podman) for `npx supabase start`. This verification host had **no Docker** — see CP01 final review for migration replay commands.

**CP01-only apply order:** `100001` → `100002` → `100003` → `100004` (see `scripts/apply-cp01-foundation.md`).

**Full chain:** historical `20260909_*` / `20260911_*` (if portal `public` prototype needed), then `100001`–`100007`, then later files only as required (`scripts/apply-canonical-db.md`).
