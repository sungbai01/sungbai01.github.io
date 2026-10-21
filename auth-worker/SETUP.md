# Authentication deployment

This Worker is separate from all existing Cloudflare applications. It has no database, R2, route, or storage bindings.

1. In Google Auth Platform create a Web application OAuth client. Add `https://sungbai01.github.io` as an authorized JavaScript origin. Configure the consent screen, support contact and any required privacy notice. Add test users if the app remains in testing.
2. Put the public client ID in this Worker's secret: `npx wrangler secret put GOOGLE_CLIENT_ID` (run inside auth-worker).
3. Generate a stable, random AUTH_SECRET (at least 32 random bytes encoded as base64url); store using `npx wrangler secret put AUTH_SECRET`. Do not rotate this casually: it also determines stable pseudonymous ownership IDs.
4. Deploy with `npm ci` then `npm run deploy` in auth-worker. No existing Worker is referenced by this configuration.
5. Set the GitHub repository Actions variable VITE_AUTH_API_URL to the new Worker HTTPS URL and publish the frontend.

Only /auth/config, /auth/google and /auth/me exist. Login uses Google Identity Services and checks RS256 signature, issuer, audience, expiration and nonce server-side. Exact allowed Origin and JSON-only POST prevent browser cross-origin login injection; no cross-site cookies are used. Never accept a user ID supplied by a client as authorization.

The Worker discards Google name, email and photo claims. A service-specific HMAC of Google sub is the only user identifier issued. This remains a pseudonymous account identifier, not anonymous data. Google login can transmit profile claims; do not describe the service as collecting no personal data. The identity provider and infrastructure may process their own operational data. Worker application request logs are disabled; no token or body logging is implemented.

App sessions last one hour and live in browser memory, never localStorage/sessionStorage or URLs. Logout clears the local token; already-issued tokens remain valid until expiry. A refresh/reload requires signing in again. Immediate global revocation, per-user quotas, bans and ownership persistence require a separate server-side store when sharing is implemented. Future APIs must call authenticate and check the verified subject against the shared book owner; login by itself does not stop upload abuse or grant any upload permissions.

Local library access does not require login and login does not automatically upload any books. No sharing/upload endpoint is included in this change. Keep Workers Free; deploying this Worker does not switch the account plan.
