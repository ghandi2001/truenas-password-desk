# TrueNAS password self-service implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. User has selected a full single Next.js application.

**Goal:** Deliver the requested authenticated link-issuance dashboard and secure SMB self-service flow, tested, documented and incrementally committed.

**Architecture:** Next.js App Router serves React pages and Node route handlers on one origin. PostgreSQL persists sessions, SHA-256 token digests, attempt limits, durable in-flight claims and safe audit events. Caddy terminates HTTPS. A dedicated server-side client verifies an SMB3 encrypted session with the supplied current password before issuing a version-pinned WebSocket `user.set_password` request using a backend API key.

**Tech Stack:** Next.js, React, TypeScript, Prisma 6/PostgreSQL, Argon2id, Zod, ws, Python smbprotocol, Node test runner, Playwright.

**Spec:** User requirements in this session, including the single-application Next.js choice.

## Global constraints

- No secrets or real infrastructure addresses in Git; only backend TRUENAS_URL determines the NAS host.
- Version target: TrueNAS SCALE 25.10.0, API v25.10; other patch versions require operator validation.
- TrueNAS TS-25.10.0 account.py explicitly skips old-password PAM checks for FULL_ADMIN. Never rely on the set_password old_password field as verification with a privileged key. Ordinary SMB users cannot necessarily log in to the management API. Use independent SMB authentication, without granting management roles to users.
- No current/new passwords, raw tokens or upstream payloads in persisted records or application logs. No request logging and no third-party browser resources.
- Fail closed on ambiguous mutation results: retain the durable claim, never automatically retry. Administrator can revoke and issue a new link after confirming the NAS state.
- Atomic per-token claims and a partial unique per-username in-flight index prevent competing mutations. Revocation refuses an in-flight link; it cannot cancel an already-dispatched NAS operation.

## Tasks

### 1. Configuration and security primitives
Files: package.json, tsconfig.json, next.config.ts, eslint.config.mjs, .prettierrc.json, .env.example, src/server/config.ts, src/server/security.ts, tests/security.test.ts.
- [ ] Add runnable tests asserting missing/invalid config rejection, secure opaque token length and digest, Argon2id verification, password confirmation and weak-password rejection, spaces preserved, exact-origin CSRF checks.
- [ ] Run `npm test` and observe missing feature failures.
- [ ] Implement config with Zod; reject non-HTTPS NAS URLs, userinfo, paths and placeholder secrets. Default password minimum 12; cap input bytes, prohibit NUL and weak common/repeated choices.
- [ ] Format, lint, typecheck, test; review staged files; commit `chore: configure secure Next.js password service`.

### 2. TrueNAS boundary
Files: src/server/truenas.ts, scripts/verify_smb.py, requirements.txt, tests/truenas.test.ts, docs/truenas-compatibility.md.
- [ ] Write local WebSocket-server tests for API-key auth true/false, version mismatch, exact set_password tuple params, null result, RPC errors, socket close and deadline handling.
- [ ] Implement correlated JSON-RPC with connection and request deadlines, certificate verification, bounded frames and generic errors. Authenticate, check system.version, verify SMB password, then set_password; close in finally. Track whether mutation was dispatched.
- [ ] Test subprocess verification contract without logging input or child output. SMB session requires encryption/signing; credentials travel solely through stdin.
- [ ] Run checks; commit `feat: add verified TrueNAS password-change client`.

### 3. Persistence and HTTP services
Files: prisma/schema.prisma, prisma/migrations, src/server/db.ts, src/server/service.ts, src/server/http.ts, src/app/api/[...path]/route.ts, scripts/create-admin.ts, tests/service.test.ts.
- [ ] Integration tests against PostgreSQL assert admin login/logout, expired sessions, atomic rate limits, token issuance/expiry/revocation/claim, username binding, CSRF, rejected payload keys and duplicate use.
- [ ] Implement hashed random sessions, session-secret HMAC keys for rate-limit buckets, fixed expiry, Argon2id initial-admin CLI with hidden TTY input, and generic login errors.
- [ ] Implement link lifecycle with a durable claim committed before network calls. Definitive non-mutation failures release claim; post-dispatch ambiguity retains claim. Success persists used_at and an audit event atomically.
- [ ] All mutation endpoints check Origin and JSON content type. Session-bound CSRF header for authenticated operations; cross-origin public requests denied. Never trust arbitrary forwarded headers.
- [ ] Run tests/checks; commit `feat: add authenticated single-use password-link service`.

### 4. Responsive application pages
Files: src/app/layout.tsx, src/app/page.tsx, src/app/admin/page.tsx, src/app/password-change/[token]/page.tsx, src/app/globals.css, src/components/*.tsx, src/proxy.ts.
- [ ] Browser tests cover login, link creation/copy, revocation, invalid/expired link, password reset and reuse denial with mocked NAS boundary.
- [ ] Build accessible forms with loading and status states; raw link appears only after creation, never listing. User page does not render username. Password inputs are cleared in finally.
- [ ] Add per-request CSP nonce, no-referrer, no-store, frame denial and production HSTS. No analytics, external fonts or browser storage.
- [ ] Run checks and production build; commit `feat: add admin and self-service Next.js pages`.

### 5. Deployment, operating guide and final verification
Files: Dockerfile, compose.yaml, Caddyfile, README.md, tests/e2e*, scripts/integration.ts.
- [ ] Docker build uses Node 22 Debian slim plus Python verifier; non-root app container, migrations service, healthy PostgreSQL and HTTPS Caddy. No database port exposed by default.
- [ ] Document exact API contract/source URLs, SMB requirement, credential privileges, admin setup, environment, deployment, migration, local tests, optional destructive real test (dedicated disposable user), recovery, encrypted backups and logging/history caveats.
- [ ] Run full tests, formatting, lint, types, build and live application smoke test. Inspect browser chunks for backend imports/credential material, inspect logs and tracked file names.
- [ ] Review security and resolve findings in new commits. Record actual results and limitations; do not claim Docker/real-NAS verification without executing it.
