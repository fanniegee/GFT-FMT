# GPTS Payments foundation

Owner: company 7, GPTS | Guvaza Pro-Technology Solutions. This identifies the existing website company, not a new legal entity or a financial licence.

## Delivered boundary

Signed-in beneficiaries with a current wallet PIN grant can save and cancel cross-border payment instructions. Eight directions connect Zimbabwe with South Africa, Botswana, Zambia and Mozambique. Currency lists describe the sending country's currency choices; they are not provider coverage commitments. Bank and mobile-wallet choices express a receiving preference, not guaranteed payout support.

Instructions are PostgreSQL records. They carry no wallet balance, funding, FX quote, fees, payment approval or settlement. No Trust ledger, contribution, distribution or beneficiary eligibility code is changed. There is no send, fund, mark-paid or enable-channel endpoint. A record in AWAITING_CHANNEL cannot be mistaken for a completed transfer; only cancellation is currently a permitted state transition.

Founder oversight is read-only. Other Trust or department Admin roles have no access until a specific payment-operations permission policy is agreed. Customer verification under a future provider is separate from family verification. No family account is marked financially verified by this module.

## Records and authority

- `gpts_payment_corridors`: eight directions, each awaiting provider connection. Schema checks prevent enabling a route using the existing API or an accidental status update.
- `gpts_payment_instructions`: exact decimal sending amount, currency, recipient name, preferred payout type, purpose, authenticated owner and permanent reference. Bank account numbers, phone numbers, identity documents and credentials are not collected here.
- `gpts_payment_events`: permanent creation and cancellation events. Mutations and their event insert occur in the same transaction.
- Request UUIDs are unique per owner. A retry with identical normalized terms returns the existing record. Changed terms with the same request UUID are rejected. Cancellation locks the record and is idempotent.
- Customer history is owner-filtered; Founder history and events require a Founder session. Responses and protected pages use no-store. Financial API access remains behind the existing wallet PIN guard. No financial or personal state is stored in browser storage.

Schema initialization is lazy, transaction-protected and guarded by a PostgreSQL advisory lock. Failed initialization is retried, and failed audit writes roll back the associated change. History protections reject update/delete/truncate of events and alteration/deletion of instruction terms. Database-owner powers remain outside application guarantees; production backups and restricted DB credentials are still needed.

## Provider connection requirements

Before adding any execution path, obtain the appropriate RBZ permissions and signed partner scope for each direction, currency, funding rail and receiving rail. Configure real provider credentials server-side. Record the partner's verification outcome and reference; family registration is not financial KYC.

Implement provider-hosted or otherwise appropriately secured recipient enrollment, expiring server-recorded quotes with all charges and the recipient amount, explicit customer acceptance, and authenticated funding. Do not introduce browser estimates or use Trust distribution money as working liquidity.

Money movement requires a separate balanced double-entry payments ledger, segregated customer-money and operating accounts, currency-specific liquidity controls and atomic reservations. Existing Trust wallets must not be debited without a separately agreed funding and authorization design.

Integrate signed webhooks with replay protection, unique provider references, durable execution idempotency and reconciliation. Keep instruction acceptance, funding, execution, settlement, failure and refund distinct. Confirm settlement from the provider and reconciliation records, never an operator's browser action. Record revenue only when earned under the partner contract; customer principal is not revenue. Trust profit contributions follow the existing company accounting and audit rules.

Do not auto-execute saved instructions when a channel becomes available. Ask the customer to revalidate the recipient, complete verification and accept a fresh quote. Add supported workflow states via an explicit tested schema migration; do not loosen the current CHECK constraints merely to change the displayed status.

## Verification

Run `node --test test/gpts-payments.test.mjs test/gpts-customers.test.mjs test/gpts-exchange-rates.test.mjs test/beneficiary-family.test.mjs` from gft-server. HTTP checks use isolated fixtures, including transaction snapshots and controlled audit failures; they do not exercise a real PostgreSQL engine or provider. Production data must not be populated with fixture payments. Before production execution is introduced, run PostgreSQL integration tests against an isolated database and the contracted provider's test environment.

## Public reference exchange board

`gpts-exchange-rates.html` and `/api/gpts-payments/rates` are public. The server checks RBZ's published report date and retrieves dated PDFs from the official domain, newest first. If the HTML index is unavailable, it checks actual report files within the last ten Harare calendar dates; it never invents a missing publication or a rate. Retrieval has a 30-second network budget. It validates the PDF header, publication date, known table layout, all five regional currency rows, six positive values per row, and bid/mid/ask ordering. Values and currency labels are reproduced as published, without deriving exchange quotes or changing the publisher's quoting conventions.

Successfully parsed source reports are stored in `gpts_reference_rate_reports`, keyed by the PDF SHA-256. Source checks are coalesced and limited to once per 15 minutes per running process; browser views refresh every five minutes while visible. Free hosting may sleep; the next visit checks the source. This is a daily publication board, not a continuous market-price feed. Source date, retrieval time and check time are separate. Refresh failures retain the last valid dated report with a visible warning; no report means unavailable, never fixture or guessed rates. A publisher layout or filename change fails closed and needs parser maintenance.

Public customer registration is available from gpts.html and gpts-customer-access.html. Customers use gpts_customers, hashed single-use email tokens and hashed opaque sessions. They are never inserted into beneficiary, family or Trust wallet records. Email verification does not establish financial KYC; the financial verification state remains NOT_STARTED.

Instructions have exactly one owner: a beneficiary_id OR customer_id. The original beneficiary instruction rows and request references are preserved. Customer requests use a separate authenticated API namespace and a customer-specific unique request index. Customer references are not represented as family IDs.

The existing payments instruction area still requires beneficiary sign-in and wallet PIN. The separate public customer area requires a verified GPTS customer session. Founder oversight remains read-only and identifies the owner type.

## Public customer account operations

Company detail URLs with id=7 redirect to gpts.html. Registration records name, normalized email, residence country, service interest and acknowledgement of the account/membership separation. Passwords use the existing server scrypt functions. The Resend account and RESEND_FROM_EMAIL supply verification and recovery messages; no message is sent during automated tests. GPTS_PUBLIC_ORIGIN optionally sets the email link origin and defaults to https://guvazafamilytrust.com. Never derive verification links from request Host headers.

Verification and recovery tokens last 30 minutes, are hashed in PostgreSQL and are consumed only by explicit POST. Recovery revokes every customer session. Resend/recovery links are limited per account and IP. Failed logins persist a 15-minute account lock after five failures. All account mutations are transactionally audited; email delivery is attempted after commit. Delivery failure leaves a pending account, which can resend verification after the cooldown. The account cannot sign in before email verification. GPTS account cookies are HttpOnly, SameSite Strict, Secure in production, and expire after eight hours.

The account access page removes email-link secrets from the URL and uses no-referrer. No credential or session is stored in browser storage. Customer session authority does not authorize beneficiary APIs or Founder APIs. Financial execution, customer identity verification, transaction screening and the separate payments ledger remain gated on provider integration and the appropriate regulatory and operating arrangements.
