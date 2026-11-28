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

Run `node --test test/gpts-payments.test.mjs` from gft-server. HTTP checks use isolated fixtures, including transaction snapshots and controlled audit failures; they do not exercise a real PostgreSQL engine or provider. Production data must not be populated with fixture payments. Before production execution is introduced, run PostgreSQL integration tests against an isolated database and the contracted provider's test environment.
