# GFT LocalStorage → PostgreSQL Migration Decision Report

**Status:** PRE-MIGRATION REVIEW  
**Purpose:** Convert the read-only reconciliation findings into explicit migration decisions.  
**Database writes:** NONE. This document does not authorize or perform PostgreSQL imports.

---

## 1. Executive decision summary

| Category | Decision | Action |
|---|---|---|
| 224 canonical family records matching LocalStorage | SAFE TO MIGRATE | Use canonical family data as the authority; carry matching LocalStorage fields only where the migration map permits |
| GFT-GEN4-182 Deigratia Nyasha Guvaza | FOUNDER REVIEW REQUIRED | Do not add to or remove from canonical family automatically |
| 0 canonical IDs missing from snapshot | SAFE | No family record is missing from the snapshot |
| 0 field mismatches among shared family IDs | SAFE | No automatic family-field correction required |
| 0 missing-parent findings | SAFE | No parent repair required from reconciliation |
| Beneficiary-source overlaps for GFT-GEN3-011 and GFT-GEN4-182 | MERGE / RECONCILE | Consolidate status into one authoritative beneficiary record per person |
| Scalar wallet balances | OPENING BALANCE REVIEW | Do not fabricate historical transactions; reconcile and post controlled opening balances |
| 3 non-zero beneficiary wallets | OPENING BALANCE REVIEW | Verify entitlement/evidence before creating opening ledger entries |
| Aggregate payout event ($3,600 / 3 people / $1,200 each) | FOUNDER/FINANCE REVIEW | Do not create three payment transactions from the aggregate event alone |
| `guvaza_custom_config` + legacy About keys | MERGE / RECONCILE | Merge field-by-field; do not let one browser object overwrite another |
| Browser session/current-user keys | DO NOT MIGRATE | Server authentication/session state must be created separately |
| Plaintext password field | DO NOT MIGRATE | Never import plaintext credentials |
| 2FA code/browser security state | DO NOT MIGRATE | Re-enrol through the server security system |
| DIPVTC LocalStorage keys | DO NOT MIGRATE TO GFT | They belong to the separate education site |
| Empty/UI/cache/version keys | DO NOT MIGRATE | Not authoritative business records |

---

## 2. Family population

### Reconciled

- Canonical family: **224 records / 224 unique System IDs**
- LocalStorage snapshot: **225 records / 225 unique System IDs**
- Shared System IDs: **224**
- Canonical IDs absent from snapshot: **0**
- Snapshot IDs absent from canonical: **1**
- Field mismatches among the shared 224: **0**
- Missing parents: **0**
- Generation/parent inconsistencies: **0**

### Safe family migration rule

The 224 shared records may proceed through the migration pipeline without changing the canonical family structure.

The canonical family source remains authoritative. LocalStorage must not silently overwrite canonical lineage.

---

## 3. Founder review item: GFT-GEN4-182

**Person:** Deigratia Nyasha Guvaza  
**System ID:** `GFT-GEN4-182`  
**Generation:** Gen 4  
**Parent:** `GFT-GEN3-011`  
**Parent name reported:** Fannuel Guvaza  
**Grandparent:** Zekia Guvaza  
**Gender:** Female  
**Snapshot status:** `NEW_REGISTRATION_VERIFIED`  
**Physical verification:** Present

### Decision

**FOUNDER REVIEW REQUIRED.**

Do not:

- delete the record;
- automatically insert it into the canonical `guvazaTree.js`;
- change its parent;
- create a second System ID;
- treat the LocalStorage presence alone as proof of canonical family membership.

Founder review should determine whether the verified registration becomes part of the canonical family dataset.

---

## 4. Beneficiary-source reconciliation

The reconciliation identified overlapping beneficiary representations involving:

### GFT-GEN3-011

Appears in multiple beneficiary-related sources, including:

- `founder_beneficiary_pool`
- `gft_approved_for_payout`
- `gft_physical_registry`
- `guvaza_bens`

### GFT-GEN4-182

Appears in:

- `founder_beneficiary_pool`
- `gft_approved_for_payout`
- `gft_physical_registry`

### Decision

**MERGE / RECONCILE.**

The migration must create or update one authoritative beneficiary record per System ID and preserve source evidence/status as appropriate.

Do not create duplicate beneficiary rows merely because the same person appears in several LocalStorage keys.

---

## 5. Finance and wallets

### Scalar balances found

- Distribution: **900**
- Beneficiary Pool: **0**
- Funeral: **3,800**
- School: **2,100**
- Trust: **24,000**
- FPB: **0**
- Reserve: **900**

### Non-zero beneficiary wallets

- `GFT-GEN4-057`: **1,200**
- `GFT-GEN4-182`: **1,200**
- `GFT-GEN3-011`: **1,200**

### Aggregate payout event

- Date: **21 September 2026**
- Total: **3,600**
- Count: **3**
- Per head: **1,200**

### Decision

**OPENING BALANCE REVIEW.**

The balances should not be converted into invented historical transaction histories.

After reconciliation, the approved current balances can be represented by controlled opening-balance ledger entries with:

- source;
- reconciliation reference;
- date/effective date;
- approving authority;
- audit event;
- supporting evidence where available.

The aggregate payout event must not automatically generate three individual payment transactions without supporting evidence.

---

## 6. Configuration

The snapshot contains `guvaza_custom_config` with major sections including:

- name
- tagline
- email
- logo
- footerText
- caps
- rules
- companies
- homepage
- about
- branding
- contact
- social

It also contains legacy About keys such as:

- `aboutRoots`
- `aboutText`
- `aboutTitle`
- `guvaza_about_text`
- `guvaza_about_title`

### Decision

**MERGE / RECONCILE.**

Configuration must be merged field-by-field.

One stale browser configuration object must never replace unrelated Founder/Admin changes.

---

## 7. Security and session data

### Do not migrate

- plaintext password fields;
- browser current-user/session keys;
- temporary 2FA codes;
- browser-only authentication state.

The production server must establish its own:

- password credential storage;
- authentication sessions/tokens;
- MFA/2FA enrolment;
- password reset/recovery;
- device/session management;
- audit events.

No plaintext password should enter PostgreSQL.

---

## 8. Separate/non-GFT data

The DIPVTC-related LocalStorage keys are separate education-site data.

### Decision

**DO NOT MIGRATE TO THE GFT CORE DATABASE.**

They should remain outside the GFT migration unless a separate DIPVTC migration is intentionally planned.

---

## 9. Migration gate

### PostgreSQL import is NOT yet authorized.

Before the first import, the following decisions must be resolved:

1. Founder decision on `GFT-GEN4-182`.
2. Beneficiary-source consolidation.
3. Finance opening-balance reconciliation.
4. Treatment of the aggregate payout event.
5. Configuration merge rules.
6. Server-side security enrollment/reset plan.
7. Final migration validation against the canonical family source.

---

## 10. Recommended migration order

1. Add required database structures for configuration and notifications.
2. Load/reconcile canonical family identity data.
3. Process the Founder-review record separately.
4. Consolidate beneficiary records.
5. Reconcile wallet balances and financial opening balances.
6. Merge approved configuration.
7. Migrate approved operational records.
8. Create audit records for migration actions.
9. Run post-import validation.
10. Only then switch frontends from LocalStorage authority to the GFT API.

---

## 11. Explicit safety rule

**This report is a decision checklist, not a database import command.**

No PostgreSQL record should be created solely because a LocalStorage key exists.  
Every migrated domain must use the authoritative source and reconciliation rule defined for that domain.

