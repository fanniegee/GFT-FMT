# GPTS payments controls

This build implements the internal accounting, identity/recipient workflows, quote consent, staff controls, support, reconciliation and execution recovery for company 7. It does not register a financial institution or connect a payment provider. No runtime test provider, opening balance, simulated settlement, default exchange quote or manual credit endpoint is supplied.

## Entrances

- GPTS customer account → **Payments workspace** (`gpts-customer-controls.html`).
- Founder sidebar → **GPTS Operations**. The existing read-only instruction page also links to operations.
- Trust Admin sidebar → **GPTS Payments operations**. A separate payments grant is required; a Trust role alone does not confer payment authority.
- Public registration, the company homepage, the published RBZ reference board, existing family instructions and Trust wallet/PIN rules remain separate.

## Deployment configuration

Set `GPTS_DATA_KEY` to a securely generated 32-byte base64 secret in Render's environment settings, and keep a protected recovery copy. One way to generate a key locally is:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not commit the value or put it in a browser. The system intentionally blocks encryption-dependent actions until the key is configured; it never substitutes a hard-coded or temporary key. Losing the key loses access to encrypted recipient details, identity images, support messages and authenticator secrets. Backups must include protected access to the correct keys.

`GPTS_ACTIVE_KEY_ID` defaults to `v1`. To rotate, retain the previous key under its key ID in `GPTS_RETIRED_DATA_KEYS` (a JSON object), set a new active ID and new `GPTS_DATA_KEY`, and retain old keys until an audited re-encryption/retention process is complete. Every ciphertext records its key ID and uses an authenticated purpose/record context. A rotation-compatible decryption test is included. Do not simply overwrite the only copy of an old key.

Schema initialization is transaction-protected, uses PostgreSQL advisory locks and preserves existing instruction/customer IDs. It also corrects the existing malformed `DO $` initialization block to valid `DO $$`. No live database is changed by the test suite.

Identity images are held as encrypted PostgreSQL data, not public assets or ephemeral Render files. The server accepts JPEG/PNG only, checks file signatures and pixel limits, decodes/re-encodes the image and removes original metadata. Review access is permission-checked, requires fresh MFA, is audited, and returns a JPEG attachment with nosniff. This is not an antivirus certification, biometric service or proof that the person/document is genuine. Authorised reviewers must perform the configured checks. Retention/deletion requirements and production backup retention must be established with the approved operating policy before collecting real identity documents.

## Security and staff setup

1. The Founder enters operations, confirms the current account password, enrolls a TOTP authenticator and saves the ten single-use recovery codes.
2. Fresh TOTP/recovery confirmation issues an opaque five-minute step-up token bound to the active staff/customer session. The page keeps it only in memory. Codes cannot be replayed. Five incorrect confirmations cause a persistent 15-minute lock.
3. Assign active Trust Admin accounts the required payments permissions. Link any personal GPTS customer accounts they own, including accounts using a different email; the Founder must maintain this identity mapping. `operations:view` is the workspace prerequisite. Compliance, payment review, finance, support and audit permissions remain independently assignable. No department or Super Admin role inherits these permissions.
4. Configure verification checks, independent verification-review count and transfer-approval count explicitly. There are no financial or approval defaults. Configure route currencies and funding limits only against a registered provider's actual capabilities. Disabled/unconnected routes cannot issue quotes.

Policy versions, their settings and their hashes are permanently recorded. Accepted transfers preserve terms and policy snapshots. Matching-email and explicitly linked personal customer accounts cannot be self-reviewed or self-approved. This controls known account ownership; it does not replace real staff identity/conflict-of-interest checks. A staff refund requester cannot approve that refund. Approval votes are distinct per officer and operation. Rejections and missing approvals prevent execution. Increasing the current approval requirement cannot be bypassed with an older transfer snapshot.

## Identity and recipients

Email verification is not financial verification. Customers create encrypted identity drafts, upload sanitised images and submit them against the configured review requirements. Required checks and independent review counts must be satisfied before the customer becomes VERIFIED. Changed requirements block stale approval and allow requesting a new submission. Staff-only evidence notes remain private; customer-facing correction messages are separately encrypted and returned only to the owning customer.

Compliance restrictions block quotes and initial dispatch. Adverse/expired provider screening creates an audit flag and blocks a quote. Account/security flags are visible to compliance staff. No local sanction list or invented “clear” result is substituted for provider screening.

Bank/wallet details are encrypted, owner-scoped and masked in ordinary lists. Replacement details create a new recipient ID and archive the previous version; the database prevents editing old receiving details. Old quotes referencing archived recipients cannot be accepted. An accepted transfer retains its recipient version. A new quote requires provider screening of the verified sender identity and the recipient. Actual destination/network validation remains the connected provider's responsibility.

## Quotes, funding and ledger

Provider quotes carry exact integer minor-unit amounts, sending/receiving currencies, customer fee, provider cost, recipient amount, quoted rate and expiry. The customer explicitly accepts a snapshot/hash; reference-board rates are never used as executable quotes. The current supported contract model charges provider cost from the disclosed fee (`costSource=FEE`, cost no greater than customer fee). A provider needing operating prefunding, other fee treatment or other currency precision needs an explicit integration/accounting extension; the system rejects that unsupported model rather than inventing its treatment.

Each saved instruction can be accepted as a transfer only once. Retries with the same customer request ID and terms return the existing transfer; changed terms are rejected. Start a new instruction for a genuinely new attempt. Transfer funding and rolling 24-hour request limits are explicitly configured by currency/route. The rolling limit counts accepted requests, including subsequently refunded requests, to avoid refund/retry limit bypass.

The payments ledger is separate from `wallets`, `ledger_entries`, Trust distributions, Trust eligibility and company contribution accounting. It has no browser-generated balances or manual balance-editing endpoint.

| Confirmed event        | Accounting                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Funding received       | Debit provider cash; credit transfer-specific available customer liability                     |
| Exact funding reserved | Debit available liability; credit reserved liability                                           |
| Confirmed settlement   | Debit reserved liability and provider-cost expense; credit provider cash and earned fee income |
| Confirmed refund       | Debit the actual reserved/available liability refunded; credit provider cash                   |

All entries use exact decimal/integer arithmetic. PostgreSQL deferrable constraints require each journal to have at least two lines and balance **within each currency**. Account/currency foreign keys prevent currency mixing. Journals, lines, receipts and audit records are immutable. New lines cannot be appended to an already committed journal. A journal and the associated transfer/audit update succeed or roll back together.

Funding is allocated to its own transfer; another customer's funds or Trust balance cannot fund it. Partial, late or excess funding is held for review rather than silently repriced or executed. Unmatched or inconsistent external confirmations stay in the immutable provider inbox as errors and are surfaced for reconciliation; they are not silently discarded or represented as completed payments. Unexpected money after a terminal transfer requires provider-specific investigation and an explicit accounting treatment; an operator cannot manufacture a balancing entry through this UI.

Fee income appears only after confirmed delivery. Fee income less provider cost is not the company's final net profit: operating costs, tax, audit and the existing approved company-contribution process still apply. Customer principal is never distributable business income.

## Lifecycle and recovery

Normal flow: AWAITING_FUNDS → PENDING_APPROVAL → PROCESSING → SETTLED.

Confirmed failure/refund flow: PROCESSING → FAILED → REFUND_REVIEW → REFUNDING → REFUNDED. Partial refunds remain REFUNDING until the full recorded customer funding has been returned. No refund fee or forfeiture is invented. A contract allowing retained fees needs separately approved terms/accounting before use.

Unfunded cancellation is separate from funded refund review. Processing/settled payments cannot be cancelled in the browser. Holds, quote expiry, screening expiry, unexpected funding or disabled routes prevent fresh execution. Out-of-order/inconsistent events remain retryable in the provider inbox after review; they never force a state transition.

The durable queue uses row locks, leases, stable per-job idempotency keys, retries and explicit manual-review states. External calls occur outside the database transaction and have a bounded timeout. A lost response keeps funds reserved. Recovery queries the provider using the original key before considering another submission; the same key is retained. An acknowledgement alone is not settlement. Authenticated provider-status queries can recover a missing callback using provider facts, not browser-supplied amounts or statuses.

With registered integrations, the server checks queued work every 15 seconds in bounded batches. Queue processing can also be requested by authorised payment staff. PostgreSQL leases and provider idempotency protect concurrent workers. After a crash/termination, the lease expires and recovery queries the original operation. Review-held work requires an audited resume action and cannot bypass missing approvals or expired terms.

## Provider integration contract

`gpts-provider-registry.js` starts empty. Register only reviewed server-side adapters with `idempotent:true` and these methods:

- `screen({customerId, identity, recipient})`: real screening outcome and expiry.
- `quote(...)`: actual executable terms, including costs, expiry and provider quote reference.
- `prepareFunding({idempotencyKey, transferId, quote, recipient})`: provider reference and human-readable funding instructions. No local bank account is invented.
- `execute(...)`: submits exactly the accepted terms under the stable key; returns an acknowledgement, not a browser settlement flag.
- `refund({idempotencyKey, transferId, amountMinor, currency, originalSourceOnly:true})`: returns money to its original funding source. The API supplies no replacement destination.
- `lookup({idempotencyKey, operation, transferId})`: authenticated provider status; may return a normalized event to recover a missing callback. NOT_FOUND must be an authoritative result, not a network error.
- `verifyEvent(rawBytes, headers)`: authenticates the provider's exact callback bytes and applies the actual provider's signature/timestamp/replay requirements before returning a normalized event.
- `statement({date})`: retrieves actual provider statement rows over authenticated channels.

Callbacks use `/api/gpts-payments/providers/:provider/events`. The server retains raw JSON bytes for signature verification. Implement the approved provider's exact protocol and approved countries/networks/currencies when connecting it; the foundation does not assume all providers use the same signature format. Credentials and endpoints are configured server-side. There is no browser adapter-code/API-URL upload endpoint.

The inbox records provider/event ID, source-body hash and encrypted normalized facts before application. Repeated events/references are idempotent only when their facts match. Conflicting facts are rejected and require reconciliation. A callback cannot change an accepted recipient, rate, fee or payout amount.

## Reconciliation, receipts and support

Provider statement rows are immutable and compared to matching provider cash journals by reference, currency and amount. Unmatched references and amount differences become exceptions. Resolving an exception requires an actual matching ledger record and a reason; an operator cannot clear a real difference by clicking “resolved.” Reconciliation does not independently mark a customer transfer as settled.

Settlement receipts are immutable and available only to the owning customer after confirmed settlement. Support cases are owner-scoped, with encrypted messages, customer-visible responses and separate internal staff notes. Staff actions, document reads, policy/access changes, security confirmations, approvals, provider acknowledgements and money events are audited.

## Verification

Run `npm run test:gpts` in gft-server. The controls suite uses an isolated, in-memory PostgreSQL engine (PGlite), actual PL/pgSQL constraints and database transactions. No production database, local `gft_database`, real approval, real document, email or real payment is used. Provider adapters exist only inside isolated tests.

Coverage includes schema initialization and legacy instruction migration; zero opening accounts; exact money; authenticated encryption/key rotation; TOTP vectors/replay/lock/recovery; owner isolation; staff grants and MFA; document sanitisation and independent review; quote consent/retries/recipient changes; signed-event rejection/replay; funding/reservations; independent approvals; lost-response recovery; settlement/fees/receipts; failure and partial/full refunds; audit-write rollback; immutable and cross-currency journal checks; restrictions; adverse screening and configured limits; reconciliation mismatches; private support notes; and sensitive HTTP access controls.

Real-provider contract tests, legal operating approvals, production key setup and operational staff assignments remain deployment/connection prerequisites. Automated internal tests do not establish regulatory approval or verify a live provider connection.
