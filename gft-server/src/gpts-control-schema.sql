CREATE TABLE IF NOT EXISTS gpts_ops_grants (
  admin_id TEXT PRIMARY KEY, permissions JSONB NOT NULL, granted_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_staff_customer_links (
  admin_id TEXT NOT NULL,customer_id UUID NOT NULL REFERENCES gpts_customers,
  linked_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(admin_id,customer_id)
);
CREATE TABLE IF NOT EXISTS gpts_ops_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), version INTEGER NOT NULL DEFAULT 1,
  settings JSONB NOT NULL, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_policy_versions (
  version INTEGER PRIMARY KEY,settings JSONB NOT NULL,updated_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_ops_events (
  event_id UUID PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, reference TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
  note_enc BYTEA, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_mfa (
  owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, secret_enc BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE, setup_expires_at TIMESTAMPTZ NOT NULL,
  last_counter BIGINT NOT NULL DEFAULT -1, recovery_hashes JSONB NOT NULL DEFAULT '[]',
  failures INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
  PRIMARY KEY(owner_type,owner_id)
);
CREATE TABLE IF NOT EXISTS gpts_stepup (
  token_hash CHAR(64) PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  session_hash CHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS gpts_recipients (
  recipient_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES gpts_customers,
  replaces_id UUID REFERENCES gpts_recipients, label TEXT NOT NULL, country CHAR(2) NOT NULL,
  method TEXT NOT NULL CHECK(method IN('BANK','MOBILE_WALLET')),
  details_enc BYTEA NOT NULL, fingerprint TEXT NOT NULL, last_four TEXT NOT NULL,
  archived_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_verifications (
  case_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES gpts_customers,
  identity_enc BYTEA NOT NULL, status TEXT NOT NULL CHECK(status IN('DRAFT','SUBMITTED','VERIFIED','CHANGES_REQUIRED')),
  policy_version INTEGER, submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS gpts_verification_active_idx ON gpts_verifications(customer_id) WHERE status IN('DRAFT','SUBMITTED');
CREATE TABLE IF NOT EXISTS gpts_identity_images (
  image_id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES gpts_verifications,
  kind TEXT NOT NULL CHECK(kind IN('IDENTITY_FRONT','IDENTITY_BACK','ADDRESS')),
  image_enc BYTEA NOT NULL, digest CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id,kind)
);
CREATE TABLE IF NOT EXISTS gpts_verification_reviews (
  review_id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES gpts_verifications,
  admin_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN('APPROVE','CHANGES_REQUIRED')),
  checks JSONB NOT NULL, note_enc BYTEA NOT NULL, customer_message_enc BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(case_id,admin_id)
);
CREATE TABLE IF NOT EXISTS gpts_customer_holds (
  customer_id UUID PRIMARY KEY REFERENCES gpts_customers, frozen BOOLEAN NOT NULL,
  note_enc BYTEA NOT NULL, changed_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_quotes (
  quote_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES gpts_customers,
  instruction_id UUID NOT NULL REFERENCES gpts_payment_instructions, recipient_id UUID NOT NULL REFERENCES gpts_recipients,
  provider_key TEXT NOT NULL, provider_quote_id TEXT NOT NULL, policy_version INTEGER NOT NULL,
  terms JSONB NOT NULL, terms_hash CHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(provider_key,provider_quote_id)
);
CREATE TABLE IF NOT EXISTS gpts_payment_transfers (
  transfer_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES gpts_customers,
  instruction_id UUID NOT NULL UNIQUE REFERENCES gpts_payment_instructions,
  client_request_id UUID NOT NULL, quote_id UUID NOT NULL UNIQUE REFERENCES gpts_quotes,
  recipient_id UUID NOT NULL REFERENCES gpts_recipients, provider_key TEXT NOT NULL,
  terms JSONB NOT NULL, terms_hash CHAR(64) NOT NULL, policy JSONB NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status TEXT NOT NULL CHECK(status IN(
    'AWAITING_FUNDS','PENDING_APPROVAL','PROCESSING','SETTLED','FAILED','REFUND_REVIEW','REFUNDING','REFUNDED','CANCELLED','REVIEW_REQUIRED')),
  funded_minor NUMERIC(20,0) NOT NULL DEFAULT 0 CHECK(funded_minor>=0),
  refunded_minor NUMERIC(20,0) NOT NULL DEFAULT 0 CHECK(refunded_minor>=0),
  held_minor NUMERIC(20,0) NOT NULL DEFAULT 0 CHECK(held_minor>=0),
  hold_reason TEXT, provider_reference TEXT, funding_enc BYTEA, settled_at TIMESTAMPTZ,
  refund_requested_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id,client_request_id), CHECK(refunded_minor<=funded_minor)
);
CREATE INDEX IF NOT EXISTS gpts_transfer_customer_idx ON gpts_payment_transfers(customer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gpts_transfer_votes (
  vote_id UUID PRIMARY KEY, transfer_id UUID NOT NULL REFERENCES gpts_payment_transfers,
  operation TEXT NOT NULL CHECK(operation IN('EXECUTE','REFUND')), admin_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('APPROVE','REJECT')), note_enc BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(transfer_id,operation,admin_id)
);
CREATE TABLE IF NOT EXISTS gpts_money_accounts (
  account_id TEXT PRIMARY KEY, customer_id UUID REFERENCES gpts_customers, transfer_id UUID REFERENCES gpts_payment_transfers,
  currency CHAR(3) NOT NULL, kind TEXT NOT NULL CHECK(kind IN('ASSET','LIABILITY','INCOME','EXPENSE')), UNIQUE(account_id,currency)
);
CREATE TABLE IF NOT EXISTS gpts_money_journals (
  journal_id UUID PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, payload_hash CHAR(64) NOT NULL,
  transfer_id UUID NOT NULL REFERENCES gpts_payment_transfers, kind TEXT NOT NULL,
  posting_txid BIGINT NOT NULL DEFAULT txid_current(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_money_lines (
  journal_id UUID NOT NULL REFERENCES gpts_money_journals, account_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL, signed_minor NUMERIC(20,0) NOT NULL CHECK(signed_minor<>0),
  PRIMARY KEY(journal_id,account_id), FOREIGN KEY(account_id,currency) REFERENCES gpts_money_accounts(account_id,currency)
);
CREATE TABLE IF NOT EXISTS gpts_provider_events (
  provider_key TEXT NOT NULL, event_id TEXT NOT NULL, body_hash CHAR(64) NOT NULL, payload_enc BYTEA NOT NULL,
  transfer_id UUID NOT NULL, reference TEXT NOT NULL, event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(status IN('RECEIVED','APPLIED','ERROR')),
  error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), applied_at TIMESTAMPTZ,
  PRIMARY KEY(provider_key,event_id)
);
CREATE INDEX IF NOT EXISTS gpts_provider_reference_idx ON gpts_provider_events(provider_key,reference,event_type);
CREATE TABLE IF NOT EXISTS gpts_payment_jobs (
  job_id UUID PRIMARY KEY, transfer_id UUID NOT NULL REFERENCES gpts_payment_transfers,
  operation TEXT NOT NULL CHECK(operation IN('FUNDING','EXECUTE','REFUND')), status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN('PENDING','IN_FLIGHT','ACKNOWLEDGED','RETRY','MANUAL_REVIEW')),
  attempts INTEGER NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT, provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(transfer_id,operation)
);
CREATE TABLE IF NOT EXISTS gpts_payment_receipts (
  receipt_id UUID PRIMARY KEY, transfer_id UUID NOT NULL UNIQUE REFERENCES gpts_payment_transfers,
  summary JSONB NOT NULL, digest CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_statement_rows (
  provider_key TEXT NOT NULL, row_id TEXT NOT NULL, transfer_id UUID,
  currency CHAR(3) NOT NULL, signed_minor NUMERIC(20,0) NOT NULL, event_key TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(provider_key,row_id)
);
CREATE TABLE IF NOT EXISTS gpts_reconciliation_issues (
  issue_id UUID PRIMARY KEY, provider_key TEXT NOT NULL, row_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED')), reason TEXT NOT NULL,
  resolution_enc BYTEA, resolved_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
  UNIQUE(provider_key,row_id)
);
CREATE TABLE IF NOT EXISTS gpts_support_cases (
  case_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES gpts_customers,
  transfer_id UUID REFERENCES gpts_payment_transfers, category TEXT NOT NULL CHECK(category IN('PAYMENT','ACCOUNT','COMPLAINT')),
  subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gpts_support_messages (
  message_id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES gpts_support_cases,
  actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, internal BOOLEAN NOT NULL DEFAULT FALSE,
  body_enc BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION gpts_ops_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'GPTS accounting and audit history is permanent'; END $$;
DO $$ DECLARE tab TEXT; BEGIN
  FOREACH tab IN ARRAY ARRAY['gpts_policy_versions','gpts_ops_events','gpts_verification_reviews','gpts_quotes','gpts_transfer_votes','gpts_money_accounts','gpts_money_journals','gpts_money_lines','gpts_payment_receipts','gpts_statement_rows','gpts_support_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS gpts_history_guard ON %I',tab);
    EXECUTE format('CREATE TRIGGER gpts_history_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION gpts_ops_no_change()',tab);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION gpts_line_open_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM gpts_money_journals WHERE journal_id=NEW.journal_id AND posting_txid=txid_current()) THEN
    RAISE EXCEPTION 'Cannot append to a previously committed journal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gpts_line_open_guard ON gpts_money_lines;
CREATE TRIGGER gpts_line_open_guard BEFORE INSERT ON gpts_money_lines FOR EACH ROW EXECUTE FUNCTION gpts_line_open_journal();
CREATE OR REPLACE FUNCTION gpts_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM gpts_money_lines WHERE journal_id=NEW.journal_id)<2 OR
    EXISTS(SELECT 1 FROM gpts_money_lines WHERE journal_id=NEW.journal_id GROUP BY currency HAVING SUM(signed_minor)<>0) THEN
    RAISE EXCEPTION 'Every journal must balance in each currency';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS gpts_journal_balance_guard ON gpts_money_journals;
CREATE CONSTRAINT TRIGGER gpts_journal_balance_guard AFTER INSERT ON gpts_money_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gpts_journal_balance();
CREATE OR REPLACE FUNCTION gpts_transfer_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed TEXT[]; BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfers cannot be deleted'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','funded_minor','refunded_minor','held_minor','hold_reason','provider_reference','funding_enc','settled_at','refund_requested_by','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','funded_minor','refunded_minor','held_minor','hold_reason','provider_reference','funding_enc','settled_at','refund_requested_by','updated_at']) THEN
    RAISE EXCEPTION 'Accepted transfer terms cannot be changed';
  END IF;
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  allowed=CASE OLD.status
    WHEN 'AWAITING_FUNDS' THEN ARRAY['PENDING_APPROVAL','REVIEW_REQUIRED','CANCELLED']
    WHEN 'PENDING_APPROVAL' THEN ARRAY['PROCESSING','REFUND_REVIEW','REVIEW_REQUIRED']
    WHEN 'PROCESSING' THEN ARRAY['SETTLED','FAILED','REVIEW_REQUIRED']
    WHEN 'FAILED' THEN ARRAY['REFUND_REVIEW','REVIEW_REQUIRED']
    WHEN 'REFUND_REVIEW' THEN ARRAY['REFUNDING','REVIEW_REQUIRED']
    WHEN 'REFUNDING' THEN ARRAY['REFUNDED','REVIEW_REQUIRED']
    WHEN 'REVIEW_REQUIRED' THEN ARRAY['REFUND_REVIEW','PENDING_APPROVAL']
    WHEN 'CANCELLED' THEN ARRAY['REVIEW_REQUIRED']
    WHEN 'REFUNDED' THEN ARRAY['REVIEW_REQUIRED'] ELSE ARRAY[]::TEXT[] END;
  IF NOT(NEW.status=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid transfer lifecycle transition'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gpts_transfer_change ON gpts_payment_transfers;
CREATE TRIGGER gpts_transfer_change BEFORE UPDATE OR DELETE ON gpts_payment_transfers FOR EACH ROW EXECUTE FUNCTION gpts_transfer_change_guard();
DROP TRIGGER IF EXISTS gpts_transfer_no_truncate ON gpts_payment_transfers;
CREATE TRIGGER gpts_transfer_no_truncate BEFORE TRUNCATE ON gpts_payment_transfers FOR EACH STATEMENT EXECUTE FUNCTION gpts_ops_no_change();
CREATE OR REPLACE FUNCTION gpts_provider_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Verified provider events cannot be deleted'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','error_code','applied_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','error_code','applied_at']) THEN
    RAISE EXCEPTION 'Verified provider event contents are permanent';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gpts_provider_event_immutable ON gpts_provider_events;
CREATE TRIGGER gpts_provider_event_immutable BEFORE UPDATE OR DELETE ON gpts_provider_events FOR EACH ROW EXECUTE FUNCTION gpts_provider_event_guard();
DROP TRIGGER IF EXISTS gpts_provider_event_no_truncate ON gpts_provider_events;
CREATE TRIGGER gpts_provider_event_no_truncate BEFORE TRUNCATE ON gpts_provider_events FOR EACH STATEMENT EXECUTE FUNCTION gpts_ops_no_change();
CREATE OR REPLACE FUNCTION gpts_recipient_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'archived_at') IS DISTINCT FROM (to_jsonb(OLD)-'archived_at') THEN
    RAISE EXCEPTION 'Receiving details require a new recipient version';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN RAISE EXCEPTION 'Archived recipients cannot be reactivated'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gpts_recipient_version_immutable ON gpts_recipients;
CREATE TRIGGER gpts_recipient_version_immutable BEFORE UPDATE ON gpts_recipients FOR EACH ROW EXECUTE FUNCTION gpts_recipient_version_guard();
