/**
 * Repair live Owner identity on mfyvhpwjrpjcxdlsqgit via linked Supabase SQL.
 *
 * Prefer: npx supabase db query --linked -f scripts/repair-owner-identity-mfyv.sql
 * This script applies the same profile/role fixes when public.app_settings is
 * absent (canonical tlb-only DBs — staff directory lives in localStorage).
 *
 * Usage:
 *   npx tsx scripts/repair-owner-identity-mfyv.ts
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  OWNER_DISPLAY_NAME,
  PORTAL_OWNER_AUTH_EMAIL,
  PORTAL_OWNER_AUTH_USER_ID,
} from "../src/lib/domain/permissions";

const sql = `
update tlb.profiles
   set full_name = '${OWNER_DISPLAY_NAME}',
       email = '${PORTAL_OWNER_AUTH_EMAIL}',
       active = true,
       updated_at = now()
 where id = '${PORTAL_OWNER_AUTH_USER_ID}';

insert into tlb.user_roles (user_id, role_id)
select '${PORTAL_OWNER_AUTH_USER_ID}', r.id
  from tlb.roles r
 where r.code = 'OWNER'
   and r.is_system
   and r.active
   and r.deleted_at is null
on conflict do nothing;

delete from tlb.user_roles ur
 using tlb.roles r
 where ur.user_id = '${PORTAL_OWNER_AUTH_USER_ID}'
   and ur.role_id = r.id
   and r.code <> 'OWNER';

update tlb.invites
   set consumed_at = coalesce(consumed_at, now())
 where lower(btrim(email)) = '${PORTAL_OWNER_AUTH_EMAIL}'
   and consumed_at is null;

select p.id, p.email, p.full_name, r.code as role_code
  from tlb.profiles p
  left join tlb.user_roles ur on ur.user_id = p.id
  left join tlb.roles r on r.id = ur.role_id
 where p.id = '${PORTAL_OWNER_AUTH_USER_ID}';
`;

const result = spawnSync("npx", ["supabase", "db", "query", "--linked", sql], {
  cwd: resolve(process.cwd()),
  encoding: "utf8",
  shell: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error("repair-owner-identity-mfyv failed");
  process.exit(result.status ?? 1);
}
console.log("repair-owner-identity-mfyv: Owner profile/role repaired");
