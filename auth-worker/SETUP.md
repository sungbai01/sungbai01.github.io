# Authentication deployment

This Worker is separate from all existing Cloudflare applications. It binds only the new galpi-bookshelf-text D1 database. No existing databases, Workers, R2 buckets or routes are changed.

1. In Google Auth Platform create a Web application OAuth client. Add `https://sungbai01.github.io` as an authorized JavaScript origin. Configure the consent screen, support contact and any required privacy notice. Add test users if the app remains in testing.
2. Put the public client ID in this Worker's secret: `npx wrangler secret put GOOGLE_CLIENT_ID` (run inside auth-worker).
3. Generate a stable, random AUTH_SECRET (at least 32 random bytes encoded as base64url); store using `npx wrangler secret put AUTH_SECRET`. Do not rotate this casually: it also determines stable pseudonymous ownership IDs.
4. Deploy with `npm ci` then `npm run deploy` in auth-worker. No existing Worker is referenced by this configuration.
5. Set the GitHub repository Actions variable VITE_AUTH_API_URL to the new Worker HTTPS URL and publish the frontend.

Authentication endpoints: /auth/config, /auth/google and /auth/me. Private text library endpoints: GET /library/books and GET/PUT/DELETE /library/books/:id. Every library request is authenticated server-side and every SQL statement includes verified owner_id, never a client-provided owner. Login uses Google Identity Services and checks RS256 signature, issuer, audience, expiration and nonce server-side. Exact allowed Origin and JSON-only POST prevent browser cross-origin login injection; no cross-site cookies are used. Never accept a user ID supplied by a client as authorization.

The Worker discards Google name, email and photo claims. A service-specific HMAC of Google sub is the only user identifier issued. This remains a pseudonymous account identifier, not anonymous data. Google login can transmit profile claims; do not describe the service as collecting no personal data. The identity provider and infrastructure may process their own operational data. Worker application request logs are disabled; no token or body logging is implemented.

App sessions last one hour and live in browser memory, never localStorage/sessionStorage or URLs. Logout clears the local token; already-issued tokens remain valid until expiry. A refresh/reload requires signing in again. The service-specific owner ID is persisted with cloud books. AUTH_SECRET must stay stable: rotating it changes IDs and requires an explicit migration strategy.

Text library writes use a positive schema allowlist, reject asset fields and inline image data, cap each JSON book at 1.5MB and total prose at 400,000 characters, enforce a 100MB/1,000 active-book per-owner quota and require baseRevision CAS. All SQL uses bound parameters and verified owner scoping. Tombstones retain only book ID, owner, version and deletion time to propagate deletions. Library tables are created only in the new D1 via schema.sql. Server storage is private; public share links are not implemented.

Logged-in books use D1 as the only persistent text store. GET /library/books returns metadata only, in pages of 50 using nextCursor; book prose is fetched by GET /library/books/:id only when opened or explicitly exported/edited. The metadata SQL selects a separate metadata column, not the body. PUT/DELETE commit directly to the API with revision checks. No background synchronization, polling, cloud-index journal, offline text queue, or account book text IndexedDB is used. Page counts can accompany metadata.

The old browser library remains guest-only and is never automatically uploaded. Device-only images and their resolution rules/style references use the separate galpi-device-images IndexedDB keyed by service owner/book; no book title, text, chapter content or bookmark position is stored there. Account text is memory-only in the browser and disappears on reload/logout. Explicit guest import uploads one text book at a time and copies its images only to device image storage. Public share links are not implemented.

Keep Workers Free when possible; deploying this Worker does not switch the account plan. D1 and Workers free limits apply independently. No tests, typechecking, live login/API tests or browser verification have been run per user instruction. Deploy/build operations are not functional verification.
