# GFT LocalStorage → PostgreSQL Migration Map
Version: 1.0
Status: PLANNING / NO DATA MIGRATED

## Purpose
This document maps the browser localStorage data currently used by GFT
to the PostgreSQL schema created in gft-server/db/schema.sql.

IMPORTANT:
- This map does NOT migrate or delete any data.
- Existing localStorage remains untouched.
- Duplicate/legacy keys must be reconciled before import.
- The database becomes authoritative only after migration and API integration
  have been verified.

## 1. Identity / Beneficiaries

| LocalStorage key | Destination | Treatment |
|---|---|---|
| guvaza_bens | beneficiaries | Candidate approved-beneficiary source; reconcile first |
| gft_canonical_beneficiaries | beneficiaries | Candidate canonical source; verify against guvaza_bens |
| beneficiary/session records | users + beneficiaries | Separate login identity from beneficiary record |
| guvaza_current_admin | users | Session only; NOT imported as a permanent record |
| guvaza_admins | users + roles + user_roles + admin_deployments | Split into normalized server records |

## 2. Registrations

| LocalStorage key | Destination | Treatment |
|---|---|---|
| guvaza_pending_regs | registrations | Pending applications |
| pendingRegistrations | registrations | Legacy/candidate source; reconcile duplicates |
| guvaza_registrations | registrations | Candidate registration source; reconcile duplicates |

Registration data must not automatically become an approved beneficiary.
Approval remains a server-side workflow.

## 3. Family / Lineage

| Source | Destination | Treatment |
|---|---|---|
| guvazaTree.js | family_people + relationships | Canonical family source; preserve systemId/parentId |
| guvazaTree.json (where still used) | family_people + relationships | Compare with canonical JS data before import |
| guvazaFamily | family_people | Cached browser copy; do not treat as newer than canonical source |
| guvazaRules | — | Compare against trustRules.js; rules should become server configuration |

Family identity rules:
- systemId remains immutable.
- parentId/parent_system_id carries biological lineage.
- Repeated names are not identity keys.
- Do not fabricate parent records during migration.

## 4. Trust / Website Configuration

| LocalStorage key | Destination | Treatment |
|---|---|---|
| guvaza_custom_config | configuration store (server-side JSON/config tables) | Preserve nested homepage/about settings; merge sections rather than overwrite |
| guvaza_about_text | configuration | Legacy field; reconcile with customConfig.about |
| guvaza_about_title | configuration | Legacy field; reconcile with customConfig.about |
| aboutRoots | configuration | Legacy field; reconcile |
| aboutText | configuration | Legacy field; reconcile |
| aboutTitle | configuration | Legacy field; reconcile |

Configuration must be versioned/audited. Do not allow one editor to overwrite
unrelated sections of another editor's configuration.

## 5. Finance / Wallets

| LocalStorage key | Destination | Treatment |
|---|---|---|
| guvaza_dist | wallets + ledger_entries | Distribution wallet balance becomes opening ledger state |
| guvaza_ben_pool | wallets + ledger_entries | Beneficiary pool opening state |
| guvaza_fun | wallets + ledger_entries | Funeral wallet opening state |
| guvaza_sch | wallets + ledger_entries | School wallet opening state |
| guvaza_trust | wallets + ledger_entries | Main Trust wallet opening state |
| guvaza_fpb | wallets + ledger_entries | FPB wallet opening state |
| guvaza_reserve | wallets + ledger_entries | Reserve opening state |
| guvaza_ben_wallets | wallets + ledger_entries | One wallet per beneficiary where valid |
| guvaza_profits | ledger_entries / company finance records | Reconcile with company wallet records first |
| guvaza_ben_pool_loaded_at | — | Migration metadata; preserve as historical metadata if required |
| guvaza_ben_pool_payouts | payout_requests + transactions | Must be reconciled against wallet/ledger history |

CRITICAL:
Do not simply set PostgreSQL wallet balances from localStorage and call it
a financial migration. The safe approach is to create opening-balance ledger
entries and preserve the source value/date/audit information.

## 6. Payouts / Service Payments

| Source pattern | Destination |
|---|---|
| beneficiary payout records | payout_requests + transactions |
| funeral payment records | service_requests + transactions |
| school payment records | service_requests + transactions |
| company financial records | transactions + ledger_entries / companies |

Exact key names must be extracted from all relevant current files before
the migration script is written.

## 7. Admin / Governance

| LocalStorage key/source | Destination | Treatment |
|---|---|---|
| guvaza_admins | users + roles + user_roles + admin_deployments | Normalize |
| guvaza_current_admin | — | Session/cache only |
| Founder deployment data | admin_deployments | Founder authority becomes server-side |
| ROLE_PERMISSIONS | roles/permissions | Template only; actual deployment belongs to server |
| temporary overrides | admin_deployments / governance records | Preserve expiry/reason/audit |

Passwords currently stored in browser/localStorage must NOT be migrated as
plaintext. Production accounts must establish secure server-side credentials.

## 8. Security

| LocalStorage key | Destination | Treatment |
|---|---|---|
| guvaza_founder_pw | — | DO NOT import plaintext password |
| guvaza_2fa_code | — | DO NOT import stored 2FA code |
| guvaza_2fa_enabled | security configuration | Re-enrolment preferred |
| guvaza_auto_approve | governance/configuration | Review before enabling server-side |
| guvaza_email_enabled | communications/configuration | Server setting |
| guvaza_whatsapp_enabled | communications/configuration | Server setting |
| guvaza_founder_email | communications/configuration | Server setting |
| guvaza_founder_email2 | communications/configuration | Server setting |
| guvaza_whatsapp_number | communications/configuration | Server setting |

Security secrets must be re-established securely on the server rather than
copied from browser storage.

## 9. Communications / Audit

| LocalStorage key/source | Destination |
|---|---|
| guvaza_email_log | communications + audit_events |
| WhatsApp/communication logs | communications + audit_events |
| admin audit data | audit_events |
| delete logs | audit_events |
| alert logs | audit_events |
| export logs | audit_events |

Audit history should preserve original timestamps and actor information where
available.

## 10. Documents / Verification

Documents must NOT be migrated by copying arbitrary localStorage JSON into
documents.

The migration must identify:
- document metadata
- owner systemId
- document type
- original filename
- verification state
- storage location/reference

Actual document files must move to secure server/object storage separately.

## 11. Duplicate / Legacy Reconciliation

Known duplicate or potentially overlapping sources include:

- guvaza_bens
- gft_canonical_beneficiaries
- guvaza_registrations
- guvaza_pending_regs
- pendingRegistrations
- guvazaTree.js
- guvazaTree.json
- guvazaFamily
- guvazaRules
- guvaza_custom_config plus older About keys

RULE:
No destructive merge will occur automatically.

Each record will be reconciled using:
1. systemId where available
2. biological parentId/lineage
3. membership/idNumber where appropriate
4. name only as supporting information
5. DOB/context where available
6. Founder/Admin review for unresolved conflicts

## 12. Migration Order

1. Snapshot/export existing localStorage.
2. Freeze a migration source snapshot.
3. Import family/lineage foundation.
4. Import beneficiary identities.
5. Import registrations.
6. Import admin/governance records.
7. Import configuration.
8. Import wallets as opening balances + ledger entries.
9. Import transactions/payouts/services.
10. Import audit/communication history.
11. Handle documents separately.
12. Run reconciliation reports.
13. Compare database counts/records against source snapshot.
14. Only then connect front ends to the API.
15. Keep localStorage as read-only fallback until verification is complete.

## 13. Not Yet Implemented

This map intentionally does NOT:
- migrate data
- delete localStorage
- change Founder/Admin
- change beneficiary portal
- connect a domain
- execute financial transfers
- establish production authentication
- upload documents to production storage

Those are later phases.
