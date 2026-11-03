-- GFT-FMT: permanent unique account numbers for existing and future wallets.
-- Safe to run repeatedly. Existing wallet IDs and financial records are untouched.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS account_number TEXT;
CREATE SEQUENCE IF NOT EXISTS gft_wallet_account_number_seq START WITH 1 INCREMENT BY 1;
UPDATE wallets
SET account_number = 'GFT-' || LPAD(nextval('gft_wallet_account_number_seq')::TEXT, 10, '0')
WHERE account_number IS NULL OR BTRIM(account_number) = '';
CREATE UNIQUE INDEX IF NOT EXISTS wallets_account_number_uidx ON wallets (account_number);
ALTER TABLE wallets ALTER COLUMN account_number SET NOT NULL;
ALTER TABLE wallets ALTER COLUMN account_number SET DEFAULT (
  'GFT-' || LPAD(nextval('gft_wallet_account_number_seq')::TEXT, 10, '0')
);
