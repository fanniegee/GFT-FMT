GFT-FMT BENEFICIARY ACCOUNT NUMBER UPDATE

Files:
- server-account-number.js: based on the latest supplied server(8).js; adds an idempotent wallet account-number schema setup and returns accountNumber from the beneficiary wallet API.
- beneficiary-portal-account-number.html: removes the shared hard-coded 4219 and displays the server-issued account number.
- wallet-account-number-migration.sql: standalone migration for the existing PostgreSQL database.
- schema-account-number.sql: updated schema for fresh installations.

Account number format: GFT-0000000001, GFT-0000000002, etc.
Each wallet receives a unique persistent value. Existing wallet IDs, balances, ledger entries and transaction history are not changed.

Deployment notes:
1. Back up the database.
2. Run wallet-account-number-migration.sql once against the GFT PostgreSQL database (or allow the included server helper to apply the same idempotent changes when the wallet API is first called; running the SQL first is recommended).
3. Replace the repository's active server.js with server-account-number.js (rename it to server.js).
4. Replace the live beneficiary portal HTML with beneficiary-portal-account-number.html (rename it to the existing beneficiary-portal.html path).
5. Run `node --check server.js`, then commit and push the two application files. The SQL migration must be applied to the production database separately.

The server file is based on the latest available server(8).js project source in this conversation. Confirm it is the active repository version before replacing your local server.js.
