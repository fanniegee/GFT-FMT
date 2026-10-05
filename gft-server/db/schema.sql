-- GFT DATABASE FOUNDATION
-- PostgreSQL
-- This is the authoritative-data foundation.
-- LocalStorage must not be treated as the permanent source of truth.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  phone TEXT,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED','PENDING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS admin_deployments (
  deployment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED','DRAFT')),
  modules JSONB NOT NULL DEFAULT '[]',
  permissions JSONB NOT NULL DEFAULT '[]',
  tasks JSONB NOT NULL DEFAULT '[]',
  overrides JSONB NOT NULL DEFAULT '[]',
  approval_level TEXT,
  scope JSONB NOT NULL DEFAULT '{}',
  deployed_by UUID REFERENCES users(user_id),
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  beneficiary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id TEXT UNIQUE NOT NULL,
  membership TEXT UNIQUE,
  full_name TEXT NOT NULL,
  username TEXT,
  phone TEXT,
  id_number TEXT,
  identity_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  lineage_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  status TEXT NOT NULL DEFAULT 'PENDING',
  profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beneficiary_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id UUID NOT NULL REFERENCES beneficiaries(beneficiary_id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_beneficiary_sessions_beneficiary
  ON beneficiary_sessions(beneficiary_id);

CREATE INDEX IF NOT EXISTS idx_beneficiary_sessions_expires
  ON beneficiary_sessions(expires_at);

CREATE TABLE IF NOT EXISTS family_people (
  person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id TEXT UNIQUE NOT NULL,
  parent_system_id TEXT REFERENCES family_people(system_id),
  full_name TEXT NOT NULL,
  gender TEXT,
  generation INTEGER,
  branch_code TEXT,
  date_of_birth DATE,
  profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registrations (
  registration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_system_id TEXT,
  full_name TEXT NOT NULL,
  username TEXT,
  phone TEXT,
  id_number TEXT,
  email TEXT,
  parent_full_name TEXT,
  grandparent_full_name TEXT,
  supporting_document_ref TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_system_id TEXT NOT NULL,
  related_system_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  source TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_system_id, related_system_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS correction_requests (
  correction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_system_id TEXT NOT NULL,
  requested_changes JSONB NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  requested_by UUID REFERENCES users(user_id),
  reviewed_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_system_id TEXT,
  document_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  identity_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  lineage_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  verification JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL,
  subject JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(workflow_id),
  action TEXT NOT NULL,
  subject JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by UUID REFERENCES users(user_id),
  approved_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'OPEN',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wallets (
  wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_system_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(wallet_id),
  entry_type TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(wallet_id),
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  external_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_requests (
  payout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(wallet_id),
  amount NUMERIC(20,2) NOT NULL,
  reason TEXT,
  destination JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  requested_by UUID REFERENCES users(user_id),
  approved_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
  reconciliation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(transaction_id),
  external_reference TEXT,
  expected_amount NUMERIC(20,2),
  actual_amount NUMERIC(20,2),
  status TEXT NOT NULL DEFAULT 'UNRECONCILED',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL,
  subject_system_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  company_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id TEXT UNIQUE,
  name TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_records (
  library_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  classification TEXT NOT NULL,
  storage_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communications (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID REFERENCES users(user_id),
  recipient_user_id UUID REFERENCES users(user_id),
  recipient_system_id TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(user_id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_family_parent ON family_people(parent_system_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_status ON beneficiaries(status);
CREATE INDEX IF NOT EXISTS idx_registration_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_payout_status ON payout_requests(status);
