
-- ============================================================
-- GFT BENEFICIARY FAMILY EXTENSION
-- Stores beneficiary-managed spouses and descendants.
-- Official family_people records remain unchanged.
-- ============================================================

CREATE TABLE IF NOT EXISTS beneficiary_family_members (
    member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    beneficiary_id UUID NOT NULL
        REFERENCES beneficiaries(beneficiary_id)
        ON DELETE CASCADE,

    member_type TEXT NOT NULL
        CHECK (member_type IN ('SPOUSE', 'DESCENDANT')),

    system_id TEXT NOT NULL,

    full_name TEXT NOT NULL,

    parent_system_id TEXT,

    parent_member_id UUID
        REFERENCES beneficiary_family_members(member_id)
        ON DELETE CASCADE,

    spouse_member_id UUID
        REFERENCES beneficiary_family_members(member_id)
        ON DELETE SET NULL,

    lineage_id TEXT,

    generation INTEGER,

    family_position TEXT,

    card_colour TEXT NOT NULL DEFAULT '#e8f4ec',

    photo_document_id UUID
        REFERENCES documents(document_id)
        ON DELETE SET NULL,

    profile JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (beneficiary_id, system_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS
    idx_beneficiary_family_lineage_unique
ON beneficiary_family_members (beneficiary_id, UPPER(lineage_id))
WHERE lineage_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
    idx_beneficiary_family_position_unique
ON beneficiary_family_members (beneficiary_id, family_position)
WHERE member_type = 'SPOUSE'
  AND family_position IS NOT NULL;

CREATE INDEX IF NOT EXISTS
    idx_beneficiary_family_owner
ON beneficiary_family_members (beneficiary_id, member_type);

CREATE INDEX IF NOT EXISTS
    idx_beneficiary_family_parent
ON beneficiary_family_members (parent_member_id);

CREATE INDEX IF NOT EXISTS
    idx_beneficiary_family_parent_system
ON beneficiary_family_members (beneficiary_id, parent_system_id);

CREATE INDEX IF NOT EXISTS
    idx_beneficiary_family_spouse
ON beneficiary_family_members (spouse_member_id);
