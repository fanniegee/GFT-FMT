CREATE TABLE IF NOT EXISTS registration_otps (
  otp_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registration_otps_email
  ON registration_otps(email);

CREATE INDEX IF NOT EXISTS idx_registration_otps_expires
  ON registration_otps(expires_at);
