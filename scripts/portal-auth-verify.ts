/**
 * Trace the portal sign-in gate.
 * A missing session and a rejected password must not open the dashboard.
 * Run: npx tsx scripts/portal-auth-verify.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dashboardAllowed,
  sessionFromSignIn,
  SIGN_IN_REQUIRED,
} from "../src/lib/auth/portal-auth";

const rejected = sessionFromSignIn({
  ok: false,
  error: "Invalid login credentials",
});
assert.equal(rejected, null);
assert.equal(dashboardAllowed(rejected), false);
assert.equal(dashboardAllowed(null), false);

const unconfigured = sessionFromSignIn({ ok: false, error: SIGN_IN_REQUIRED });
assert.equal(unconfigured, null);
assert.equal(dashboardAllowed(unconfigured), false);

const accepted = sessionFromSignIn({
  ok: true,
  userId: "auth-user",
  email: "owner@example.com",
});
assert.ok(accepted);
assert.equal(dashboardAllowed(accepted), true);
assert.equal(dashboardAllowed({ userId: "", email: "owner@example.com" }), false);

const layout = readFileSync(new URL("../src/routes/_app.tsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../src/components/portal-gate.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/lib/auth/portal-auth.ts", import.meta.url), "utf8");

assert.match(layout, /<PortalGate>[\s\S]*<TLBDashboard \/>[\s\S]*<\/PortalGate>/);
assert.match(gate, /useState<"checking" \| "closed" \| "open">\("checking"\)/);
assert.match(gate, /if \(phase !== "open"\)/);
assert.match(gate, /sessionFromSignIn\(result\)/);
assert.match(gate, /!result\.ok \|\| !dashboardAllowed\(session\)/);
assert.match(auth, /signInWithPassword/);
assert.doesNotMatch(auth, /lockWorkspaceToOwner|currentUserId|OWNER_USER_ID|service_role|SERVICE_ROLE/);
assert.doesNotMatch(gate, /lockWorkspaceToOwner|currentUserId/);

console.log("portal auth gate: unauthenticated and failed sign-in stay closed");
