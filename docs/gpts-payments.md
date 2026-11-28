# GPTS Payments

Company 7: **GPTS | Guvaza Pro-Technology Solutions**.

The current accounting, security, verification, recipient, quote/transfer, operations, reconciliation and support implementation is documented in [gpts-payment-controls.md](gpts-payment-controls.md). That guide includes deployment configuration, staff setup, the supported accounting model and provider integration requirements.

## Customer entrances

- `company.html?id=7` redirects to the GPTS homepage, `gpts.html`.
- `gpts-customer-access.html` provides independent customer registration, email verification, sign-in, password reset and verification-email resend.
- `gpts-customer.html` retains saved transfer-instruction intake and links to the new payments workspace.
- `gpts-customer-controls.html` provides security, encrypted identity/recipient records, provider quotes, transfers, receipts and customer support.
- Beneficiaries retain their existing wallet-PIN-protected instruction page. Their Trust balances and beneficiary eligibility do not become GPTS customer funds.
- `gpts-operations.html` requires a Trust staff session and separately assigned GPTS permissions. The Founder manages those grants.

Customer registration does not create a family ID, beneficiary registration, entitlement or wallet balance. Email verification does not establish financial identity or provider screening clearance. Passwords use the existing server's scrypt implementation. Verification and reset emails use the existing Resend sender, with links based on `GPTS_PUBLIC_ORIGIN` or `https://guvazafamilytrust.com`, never a request Host header.

Existing instruction IDs and beneficiary/customer ownership are preserved. Instructions have exactly one owner. A saved instruction is not a funded or settled transfer. Transfers are separate records with immutable accepted terms, permanent references and a dedicated balanced payments ledger.

## Reference exchange board

`gpts-exchange-rates.html` and `/api/gpts-payments/rates` are public. The server checks real dated Reserve Bank of Zimbabwe PDFs from the official domain, newest first. If the HTML index is unavailable, it checks actual publications within the last ten Harare calendar dates, within a bounded network budget. It never creates a missing publication or rate.

The importer validates publication date, PDF header, recognised layout, five regional currency rows and all six published values per row. It preserves original labels and quoting conventions without deriving a customer quote. Validated reports are stored in PostgreSQL by source SHA-256. Source checks are coalesced for 15 minutes; visible browser pages refresh every five minutes. Free hosting can sleep, so the next visit checks the source.

Publication date, retrieval time and source-check time are distinct. Refresh failure retains the last valid dated report with a visible warning. No stored report means unavailable, never fixture rates. A changed source layout/filename fails closed and requires maintenance. This is a published daily reference board, not a continuous trading feed or guaranteed GPTS buy/sell offer.

## Verification

Run `npm run test:gpts` from `gft-server`. The controls tests use isolated PostgreSQL through PGlite; the remaining account, reference-board, instruction and wallet tests use isolated fixtures. No production database, real approval, real payment, real document or email is used for these checks.

Provider registration starts empty. Production encryption configuration, authorised staff/rules, legal operating arrangements and actual provider credentials/contracts are prerequisites to enabling financial operations. They are not replaced by browser flags, sample balances or simulated provider responses.
