# Password Desk — TrueNAS SMB password self-service

A single **Next.js application** with React pages and server-side API routes. Administrators sign in, issue expiring links bound to one local SMB account, copy each link once, inspect recent links/audit events, and revoke unused links. Users must supply their current password. No frontend connection to TrueNAS, exposed API credential, or default admin account.

> **Compatibility target, not a deployment certification:** TrueNAS SCALE **25.10.0**, JSON-RPC API **v25.10**. The installed NAS version was not provided and no real NAS was accessed during development. The client rejects other versions. Validate against a disposable local SMB account before production. This is not compatible with CORE, AD/LDAP users, or arbitrary SCALE releases.

## Important TrueNAS security detail

In TrueNAS 25.10.0, `user.set_password` **skips `old_password` verification for FULL_ADMIN credentials**. Merely including `old_password` with an administrator API key is **not** secure self-service. Ordinary SMB-only accounts also cannot necessarily log in to the management API because authentication token creation requires privileges.

This application therefore first authenticates an **SMB 3.1.1, signed and encrypted session** using the submitted current password, then changes the bound account with the backend WebSocket client. Python's `smbprotocol` performs this small verification step; passwords pass through stdin, never command-line arguments, environment, files or output. No SMB files or shares are accessed. SMB service/port 445 must be reachable from the application. A failure to verify never dispatches a password change.

The API-key principal requires the authority to change the target local users (`FULL_ADMIN` in this version). Use a dedicated credential, restrict network access and rotate it. This is a powerful credential: protect the app host as an administrative system. This implementation is intended for a standalone NAS with local SMB accounts; do not deploy against a domain-joined NAS without validating local identity resolution.

### Verified API contract

- URL: `wss://<host[:port]>/api/v25.10`, derived exclusively from backend `TRUENAS_URL`.
- JSON-RPC 2.0, individual messages with correlated numeric IDs; no batches.
- Authenticate: `auth.login_with_api_key`, `params: [apiKey]`, success exactly `true`.
- Version: `system.version`, `params: []`; accept exactly `25.10.0` or `TrueNAS-25.10.0`.
- Change: `user.set_password`, `params: [{ username, old_password, new_password }]`; success exactly `null`.
- No `user.update` call. Certificate verification stays enabled. No redirects, automatic retries, or raw upstream errors exposed.
- API-key login is deprecated upstream and scheduled for removal in v27. Supporting another version requires updating and testing `src/server/truenas.ts`, not changing an arbitrary URL in the browser.

Official references checked during implementation:

- [25.10 user.set_password schema](https://api.truenas.com/v25.10/api_methods_user.set_password.html)
- [25.10 API-key authentication](https://api.truenas.com/v25.10/api_methods_auth.login_with_api_key.html)
- [25.10 JSON-RPC](https://api.truenas.com/v25.10/jsonrpc.html)
- [TS-25.10.0 password implementation](https://github.com/truenas/middleware/blob/TS-25.10.0/src/middlewared/middlewared/plugins/account.py)
- [TS-25.10.0 API routing](https://github.com/truenas/middleware/blob/TS-25.10.0/src/middlewared/middlewared/main.py)
- [TS-25.10.0 credential privilege checks](https://github.com/truenas/middleware/blob/TS-25.10.0/src/middlewared/middlewared/plugins/auth_/authenticate.py)

## Configuration

Copy `.env.example` to `.env` **locally**, set its permissions to owner-only, then edit it. Never commit it or paste credentials into a prompt, support ticket, screenshot or shell command.

```sh
cp .env.example .env
chmod 600 .env
```

Set the actual TrueNAS address in the **backend `.env` only**. Both IP and hostname work:

```dotenv
TRUENAS_URL=https://192.168.1.100
```

or:

```dotenv
TRUENAS_URL=https://truenas.home.local
```

These are examples, not hardcoded destinations. Replace them with the actual address. Do not include an API path, query, fragment, or credentials. An optional HTTPS port is accepted. An IP requires a trusted certificate with that IP in its SAN. For a private CA, mount its public CA certificate and configure `NODE_EXTRA_CA_CERTS`; never disable certificate validation.

| Variable                    | Purpose                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                   | Public exact origin; HTTPS in production. Local development permits only loopback HTTP.                                                                                   |
| `DATABASE_URL`              | PostgreSQL connection string. URL-encode password characters. For Compose use host `db`, database/user `password_service`, and the password matching `POSTGRES_PASSWORD`. |
| `TRUENAS_URL`               | Required backend-only HTTPS NAS origin.                                                                                                                                   |
| `TRUENAS_API_KEY`           | Required dedicated backend credential, configured locally.                                                                                                                |
| `TRUENAS_API_VERSION`       | Must be `v25.10`; actual server version is checked on every operation.                                                                                                    |
| `SESSION_SECRET`            | At least 48 randomly generated characters. Used for CSRF and private limiter keys.                                                                                        |
| `PASSWORD_LINK_TTL_MINUTES` | Default 30; permitted 1–1440 minutes.                                                                                                                                     |
| `PASSWORD_MIN_LENGTH`       | Default 12; configurable 12–128.                                                                                                                                          |
| `RATE_LIMIT_MAX_ATTEMPTS`   | Default 5 per token and target user, and per admin login account.                                                                                                         |
| `RATE_LIMIT_WINDOW_MINUTES` | Default 15; database-backed fixed windows.                                                                                                                                |
| `SMB_PYTHON`                | Python executable with requirements installed; Docker sets this automatically.                                                                                            |
| `TRUST_PROXY`               | Default false: all requests share an IP limiter. Set true only behind the supplied isolated Caddy; no direct app ingress.                                                 |
| `POSTGRES_PASSWORD`         | Compose PostgreSQL password; must match `DATABASE_URL`.                                                                                                                   |
| `APP_HOST`                  | Compose Caddy hostname; must match `APP_URL`.                                                                                                                             |
| `NODE_EXTRA_CA_CERTS`       | Optional path to the NAS private CA public certificate.                                                                                                                   |

Startup reports invalid **variable names only**, never their values. No `NEXT_PUBLIC_*` credential variables are used. `.env` is excluded from Git and Docker build context; Compose injects it at runtime. Build does not require real credentials.

### Create the NAS credential

1. Verify the exact TrueNAS version in system information and consult that version's API documentation.
2. In TrueNAS's API-key management UI, create a key for a dedicated, appropriately authorized local service administrator. Set expiry if available.
3. Store it only in backend `TRUENAS_API_KEY` (or inject the environment from your secret manager).
4. Permit app-to-NAS HTTPS and SMB 445 only as required. Keep the NAS management interface off the public Internet.
5. Test a disposable account. Revoke/rotate the key if the application host is compromised. Do not grant NAS management roles to ordinary SMB users just to make this application work.

## Local development

Prerequisites: Node.js 22+, Python 3.10+, PostgreSQL 17 (or a compatible maintained PostgreSQL), a trusted NAS certificate. Unit tests use an ephemeral PGlite PostgreSQL engine and do not require a NAS or database daemon.

```sh
npm ci
npx prisma generate
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Configure `.env` with `APP_URL=http://localhost:3000`, a local PostgreSQL URL, and `SMB_PYTHON` set to the absolute `.venv/bin/python` path. Then:

```sh
npm run db:migrate
npm run admin:create
npm run dev
```

Next.js and Prisma read `.env`; the admin command explicitly loads it. The setup command prompts in a TTY with passwords hidden and hashes them with Argon2id (64 MiB, 3 iterations, parallelism 1). There is no remotely accessible setup endpoint. Existing usernames cannot be overwritten by this command.

Open `/admin`. The admin account is independent of TrueNAS. Sessions have an absolute eight-hour lifetime. Cookies are HttpOnly, SameSite=Strict, Secure in HTTPS deployments, and use the `__Host-` prefix in production. Login rotates the browser cookie; logout deletes the database session.

## Workflow

1. Sign in at `/admin`.
2. Enter the exact local SMB username, expiration duration and optional non-secret internal note.
3. Select **Generate one-time link**. Copy it immediately. The raw link is not recoverable from the listing or database.
4. Send privately. Do not paste links into public chat, analytics-enabled tools or ticket systems.
5. The recipient opens `/password-change/<opaque-token>`, enters their current password, new password and confirmation. The page never renders the assigned username or NAS address.
6. A successful change marks the token used. All password fields clear after every submission, including failed requests.
7. To cancel an unused active link, select **Revoke**. Expired, used, revoked and processing links cannot be submitted.

User input cannot override the username: the public request schema rejects extra fields and the NAS target is resolved only from the persisted token row. Link creation deliberately does not disclose whether the username exists.

## Password policy

Minimum 12 characters by default. Maximum 512 UTF-8 bytes. Confirmation must match; nonempty current/new values are required. NUL, username-equivalent values, unchanged passwords, simple short repeated patterns and a small set of extremely common passwords are rejected. **No trimming or character transformation** occurs. Spaces and Unicode are preserved.

This is not a comprehensive breached-password service or an entropy guarantee. Use long unique passphrases. TrueNAS's configured complexity, password history and account state rules are authoritative and can reject an otherwise acceptable password. The v25.10 API schema specifies a nonempty new password; deployment-specific password policies need validation against the real test account. Administrative changes may override NAS password-aging rules.

## HTTPS deployment

```sh
./scripts/deploy.sh
# Equivalent: npm run deploy
```

The script builds the app and tools images, validates runtime configuration, waits for PostgreSQL, applies migrations, runs the first-admin seeder, and starts the app and HTTPS proxy with health checks. Run from an interactive terminal: the first run asks for an admin username and hidden password/confirmation. Passwords must satisfy the policy; no default password or password environment variable is used. Repeat deployments skip seeding when any admin already exists and never reset that admin's password. Concurrent seed processes serialize creation with a database lock.

To prepare only the database before NAS credentials and public HTTPS are ready:

```sh
./scripts/deploy.sh --database-only
```

This builds the migration image, starts PostgreSQL and applies pending migrations, but does **not** seed or start the application. It requires only `.env` and `POSTGRES_PASSWORD`. To seed separately afterward:

```sh
APP_HOST=localhost docker compose run --rm --no-deps migrate npm run db:seed
# Without Docker, with DATABASE_URL configured locally:
npm run db:seed
```

For the bundled database, use a randomly generated hexadecimal `POSTGRES_PASSWORD` (at least 32 bytes). Compose derives the app/tools `DATABASE_URL` from it so they cannot accidentally migrate a different database configured for local development. Reserved URL characters in this password are not supported by the bundled Compose interpolation; use hex. Existing database volumes retain their original password—do not regenerate it on repeat deployments. Direct non-Docker commands still use `DATABASE_URL` in `.env`.

Only Caddy exposes ports 80/443; neither app nor database publishes a host port. Point DNS to the host and permit ACME validation for automatic HTTPS. Use a private CA/internal Caddy configuration for private-only hostnames and distribute trust correctly. Mount your NAS CA in the app container if necessary.

The `migrate` service waits for database readiness and completes migrations before the app starts. The app runs as a non-root user. `/api/health` checks database availability and returns only a generic status; it is not a NAS credential probe. No Redis is required: atomic PostgreSQL upserts enforce limits across application instances.

Do not enable proxy access logs, request-body capture, APM payload collection, Next.js development request logging, session replay, or browser analytics. Token paths are secrets. The supplied Caddy has no access log; production errors still require deployment-level log review. Never use `next dev` for real users.

## Tests and verification

```sh
npm test                     # security, DB lifecycle, HTTP boundary, WebSocket mocks, Python verifier
npm run format:check
npm run lint
npm run typecheck
npm run build
npx tsx scripts/check-bundle.ts
npm audit
npx playwright install chromium
npm run test:e2e              # starts an isolated local Next.js app + ephemeral PostgreSQL engine
```

Browser tests cover actual admin sign-in, creation, revocation and logout, plus public UI states with an intercepted API. The service tests use the real Prisma queries and an injected NAS mutation; separate local WebSocket tests exercise the NAS adapter. No production mock/bypass environment flag exists. Browser tracing/video/screenshots are disabled to avoid credential capture.

PGlite tests are useful but are not a substitute for a production PostgreSQL concurrency/load test. Before rollout, repeat parallel submissions against PostgreSQL 17 and the real test NAS. Run `docker compose config --quiet` to validate deployment configuration without printing secrets.

### Optional real NAS test (changes a real password)

```sh
npm run test:integration
```

Requires an interactive TTY, your locally configured `.env`, a dedicated disposable local SMB account and explicit typed confirmation. Passwords are entered hidden, not arguments/environment. Success actually changes that account's password. Verify SMB access afterward. The test does not automatically restore the previous password because history policies may forbid it. Never use a production account as a test fixture.

## Security model and limitations

- 256-bit random link tokens and sessions; only SHA-256 digests persisted. Rate-limit identities are keyed HMACs. No recoverable raw token column exists.
- Strict origin + JSON content-type checks protect every POST, including login/public reset. Authenticated POSTs also require a session-bound CSRF header. Browser fetches are same-origin only.
- CSP with per-request nonces, no-referrer, no-store, frame denial, restrictive permissions and production HSTS. No third-party fonts/scripts or browser storage.
- Atomic link claim is committed **before** network access. A partial unique index prevents concurrent mutations for the same username across links. Repeated requests cannot claim a token twice.
- A remote NAS mutation and local SQL transaction cannot be made atomic. A timeout, connection loss, unexpected response, process crash or database failure after dispatch leaves the claim locked as **Needs review**. Tokens are marked used only after success. No automatic retry/reset of ambiguous claims.
- Revocation cannot cancel an operation already in flight. The revoke endpoint refuses a claimed link. See recovery below.
- Per-account limits persist across links, resisting repeated issuance as a brute-force bypass. IP limits assume a trusted proxy. Fixed windows permit boundary bursts; upstream volumetric DDoS controls remain necessary. NAS account lockout policies still apply.
- The admin UI intentionally returns only the latest 200 links/events; long-term audit export is an operator database task. User-agent strings are not stored: they are attacker-controlled and can contain secrets.
- Usernames and optional notes are stored plaintext for administration. Encrypt disks, backups and database transport; add field-level encryption if your policy requires it. Notes must never contain passwords.
- A URL token necessarily exists in browser memory/history and the recipient's message. No-referrer/no-store reduce leakage but cannot erase browser history or prevent screenshots or a compromised device. Send privately; close the page afterward.
- Passwords necessarily exist briefly in process memory and encrypted network requests. JavaScript cannot guarantee memory zeroization. Disable core dumps, diagnostics capturing requests and untrusted extensions.
- Independent SMB verification and password mutation have a small time-of-check/time-of-use window. Do not run other password automation concurrently for the same accounts. A user can prove the previous password just before another actor changes it; the privileged update is not an atomic current-password compare-and-swap.
- No admin MFA or SSO is included. Restrict `/admin` by VPN/network policy for sensitive deployments. Dependency updates and independent security review are operational responsibilities.

## Backup and recovery

Back up PostgreSQL to an encrypted destination with restricted permissions. It contains admin password hashes, session digests, usernames and audit history. Example (local output is sensitive):

```sh
umask 077
docker compose exec -T db pg_dump -U password_service -d password_service -Fc > /secure-backups/password-service.dump
```

Encrypt using your organization's backup system, retain according to policy and regularly test restores. Never put dumps in this repository. Back up the externally managed runtime secrets separately; do not include them in image layers.

Before restoring: stop application ingress, restore into a clean database using `pg_restore`, apply migrations, **delete all Session rows and revoke all previously active PasswordLink rows** before reopening access. A backup predates consumption/revocation and can otherwise resurrect old links. Rotate `SESSION_SECRET` and API credentials if compromise is suspected. Existing admins can be supplemented by the local admin CLI.

### Reconcile a Needs review link

1. Stop the app (all replicas) so no NAS request remains in flight. Investigate the affected account through a trusted administrative channel; do not assume failure means no change.
2. Confirm the NAS account state and whether the password changed. Never ask users to send you their password.
3. With operator database access, set that link's `revokedAt` to the current timestamp (do **not** clear `claimedAt` to reuse it). Record an operator reconciliation audit event without secrets.
4. Restart the app and issue a new link if needed. The recipient uses whichever password is now current.

Regularly purge expired sessions and expired rate-limit rows with database maintenance. Audit/link retention is a deployment policy; retain evidence needed for investigations and avoid unbounded growth. Do not delete active limiter records to evade a lockout.

## Troubleshooting

- **Startup configuration error:** correct the named fields locally. Placeholder secrets and missing NAS URL are deliberately rejected.
- **Generic password failure:** verify current password, local SMB account state, SMB3 encryption/signing support, port 445 reachability, trusted HTTPS certificate, API-key expiry/privileges and exact server version. Never enable payload logging to diagnose it.
- **Needs review:** reconcile as above; never blindly retry an uncertain change.
- **403 on forms:** `APP_URL` must exactly match the public origin. Ensure proxy forwarding and CSRF header are intact; do not loosen origin validation.
- **429 for many users:** check whether requests are sharing the fallback IP limiter. Only enable `TRUST_PROXY=true` when direct access to the app is blocked and the proxy overwrites forwarding headers.
- **Admin setup cannot run:** use an interactive terminal (`docker compose run`, not a piped password); run migrations first and choose a new username.
- **Database connection error:** verify URL encoding, DB hostname `db` inside Compose, matching database password and readiness. Errors are intentionally not returned verbatim.
