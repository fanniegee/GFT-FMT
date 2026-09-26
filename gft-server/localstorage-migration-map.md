# GFT LocalStorage → PostgreSQL Migration Map

**Snapshot inspected:** `GFT-localstorage-snapshot.json`

**Snapshot timestamp:** 2026-09-25T21:11:28Z

**Storage keys:** 61

**Purpose:** This document is the migration design and reconciliation map. It does **not** import data, delete LocalStorage, or declare conflicting records authoritative.

## 1. Migration principles

1. PostgreSQL becomes the authoritative source after reconciliation and verification.
2. `guvazaTree.js` remains the canonical family-tree source during reconciliation; LocalStorage family copies must not silently overwrite it.
3. `trustRules.js` remains the canonical trust/registration-rules source.
4. Duplicate/legacy LocalStorage keys are retained in the snapshot for audit but are not blindly imported.
5. Passwords, 2FA secrets/codes, browser sessions, current-user state, and UI-only preferences are **not** migrated as ordinary domain data.
6. Financial balances must not be converted into fake transaction history. Where only a current balance exists, use a controlled opening-balance journal after Founder reconciliation.
7. Repeated names do not establish identity. `systemId` plus biological `parentId`/lineage remains the identity basis.

## 2. Snapshot facts

- `guvaza_registrations`: 225 records, 225 unique `systemId` values.
- `guvaza_registrations` generations: Gen1 = 1, Gen2 = 5, Gen3 = 37, Gen4 = 182.
- `guvaza_registrations` statuses: 204 `AUTO_LINEAGE_PENDING`, 19 `PLACEHOLDER_ADMIN_EDIT`, 1 `PHYSICALLY_VERIFIED`, 1 `NEW_REGISTRATION_VERIFIED`.
- 19 records are marked placeholders.
- 2 records are marked physically verified.
- `guvaza_ben_wallets`: 225 wallet balances; 3 are non-zero in the snapshot: `GFT-GEN4-057` = 1200, `GFT-GEN4-182` = 1200, `GFT-GEN3-011` = 1200.
- Company/trust scalar balances exist separately and require financial reconciliation before becoming ledger opening balances.
- `guvaza_admins` contains 1 Admin record in this snapshot.
- `gft_admin_audit_events` contains 6 audit events.
- `guvaza_custom_config` contains 13 top-level configuration sections.

## 3. Key-by-key map

| # | LocalStorage key | Current shape | PostgreSQL destination | Action | Notes |
|---|---|---|---|---|---|
| 1 | `aboutRoots` | text | `configuration` (new table) | Migrate | Legacy About content; reconcile with `guvaza_custom_config.about` before import. |
| 2 | `aboutText` | text | `configuration` (new table) | Migrate | Legacy duplicate of About story content. |
| 3 | `aboutTitle` | text | `configuration` (new table) | Migrate | Legacy duplicate of About title. |
| 4 | `dipvtc_contacts_v2` | JSON array | Separate education/DIPVTC data store | Exclude from GFT migration | Not part of the GFT Trust domain. Preserve snapshot only. |
| 5 | `dipvtc_courses` | JSON array | Separate education/DIPVTC data store | Exclude from GFT migration | Not part of GFT core. |
| 6 | `dipvtc_current` | JSON object | Separate education/DIPVTC data store | Exclude from GFT migration | Current user/session for another application. |
| 7 | `dipvtc_pathways_v2` | JSON array | Separate education/DIPVTC data store | Exclude from GFT migration | Not part of GFT core. |
| 8 | `dipvtc_subjects_image_boxes` | JSON array | Separate education/DIPVTC data store | Exclude from GFT migration | Not part of GFT core. |
| 9 | `founder_beneficiary_pool` | JSON array | `beneficiaries` | Candidate source | Reconcile against physical registry, approved payout list and registrations before import. |
| 10 | `gft_admin_audit_events` | JSON array | `audit_events` | Migrate | Preserve action, admin identity, details and timestamp; resolve actor UUIDs after users are created. |
| 11 | `gft_approved_for_payout` | JSON array | `payout_requests` / `approvals` | Reconcile then migrate | Represents approved-for-payout state, not complete payment history. Do not mark paid without transaction evidence. |
| 12 | `gft_physical_registry` | JSON array | `beneficiaries` + verification/profile fields | Candidate source | Physical verification registry; reconcile with beneficiary records. |
| 13 | `guvaza_about_text` | text | `configuration` (new table) | Migrate/reconcile | Same content family as `aboutText`/`aboutRoots`; choose one canonical configuration record. |
| 14 | `guvaza_about_title` | text | `configuration` (new table) | Migrate/reconcile | Same content family as `aboutTitle`. |
| 15 | `guvaza_admin_companies` | JSON array | `companies` | Migrate | Admin-managed company records. Treat as candidate current company source. |
| 16 | `guvaza_admins` | JSON array | `users` + `roles` + `user_roles` + `admin_deployments` | Migrate with security reset | Do not migrate `passwordPlain`. Do not trust legacy `passwordHash` as production password hashing without validation; require secure password reset/re-enrolment. |
| 17 | `guvaza_all_alerts` | JSON array | `notifications` (new table) | Migrate | Notification/alert history needs a dedicated table; `communications` alone is not a precise model. |
| 18 | `guvaza_auto_approve` | boolean text | `configuration` / governance setting | Migrate only after Founder review | Security-sensitive workflow setting. Must become server-side authorization/workflow configuration. |
| 19 | `guvaza_auto_tree_view` | JSON array | None | Exclude | Empty UI/view state in snapshot. |
| 20 | `guvaza_ben_pool` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current pool balance only; do not fabricate history. |
| 21 | `guvaza_ben_pool_payouts` | JSON array | `payout_requests` + `transactions`/`ledger_entries` | Reconcile | Contains an aggregate payout event; lacks enough information for individual payment transactions. Preserve as historical aggregate evidence until reconciled. |
| 22 | `guvaza_ben_wallets` | JSON object | `wallets` + opening `ledger_entries` | Reconcile then migrate | 225 wallet balances. Only current balances are present; create controlled opening entries, not invented transaction history. |
| 23 | `guvaza_bens` | JSON array | `beneficiaries` | Reconcile / legacy | Small beneficiary list overlaps other beneficiary sources. Do not blindly duplicate. |
| 24 | `guvaza_card_bg_GFT-GEN4-043` | JSON object | `family_people.profile` or `beneficiaries.profile` | Optional | Personal UI colour preference; not core identity. |
| 25 | `guvaza_card_bg_GFT-GEN4-057` | JSON object | `family_people.profile` or `beneficiaries.profile` | Optional | Personal UI colour preference; not core identity. |
| 26 | `guvaza_child_bg_GFT-GEN4-043` | JSON object | `family_people.profile` | Optional | Descendant UI colour preference. |
| 27 | `guvaza_child_bg_GFT-GEN4-057` | JSON object | `family_people.profile` | Optional | Descendant UI colour preference. |
| 28 | `guvaza_current_user_id` | text | None | Exclude | Browser session/current-user state. Authentication server must determine current user. |
| 29 | `guvaza_current_user_name` | text | None | Exclude | Browser session/current-user state. |
| 30 | `guvaza_custom_config` | JSON object | `configuration` (new table) | Migrate after merge reconciliation | Main public-site configuration object. Must merge with About legacy keys rather than overwrite unrelated fields. |
| 31 | `guvaza_del_log` | JSON array | `audit_events` or `correction_requests` history | Reconcile | Deletion history should become immutable audit records; do not treat it as current family data. |
| 32 | `guvaza_dist` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current distribution balance only. Requires controlled opening balance. |
| 33 | `guvaza_extra_GFT-GEN4-043` | JSON array | `family_people.profile` / `relationships` | Candidate migration | Extra parent/mother/father lineage context; must be validated against canonical lineage. |
| 34 | `guvaza_extra_GFT-GEN4-057` | JSON array | `family_people.profile` / `relationships` | Candidate migration | Extra parent/mother/father lineage context; must be validated against canonical lineage. |
| 35 | `guvaza_founder_email` | text | `users.email` / `configuration` | Migrate after verification | Founder contact address; verify which address is authoritative. |
| 36 | `guvaza_founder_email2` | text | `configuration` or user contact metadata | Migrate after verification | Secondary Founder/Admin contact. |
| 37 | `guvaza_fpb` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current FPB balance only. |
| 38 | `guvaza_fun` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current funeral balance only. |
| 39 | `guvaza_gender_22-192469Y22` | text | `family_people.gender` | Candidate migration | Legacy ID-based gender cache; canonical family record must win after reconciliation. |
| 40 | `guvaza_gender_GFT-GEN3-011` | text | `family_people.gender` | Candidate migration | Personal profile cache; reconcile by systemId. |
| 41 | `guvaza_gender_GFT-GEN4-043` | text | `family_people.gender` | Candidate migration | Personal profile cache; reconcile by systemId. |
| 42 | `guvaza_gender_GFT-GEN4-057` | text | `family_people.gender` | Candidate migration | Personal profile cache; reconcile by systemId. |
| 43 | `guvaza_logged_user` | JSON object | None | Exclude | Browser session state; replace with server session/token. |
| 44 | `guvaza_personal_color_GFT-GEN3-011` | text | `family_people.profile` | Optional | Personal UI colour. |
| 45 | `guvaza_personal_color_GFT-GEN4-063` | text | `family_people.profile` | Optional | Personal UI colour. |
| 46 | `guvaza_personal_descendants_GFT-GEN3-011` | JSON array | `relationships` / family records | Candidate migration | Empty in snapshot; do not create records from it. |
| 47 | `guvaza_proper_v6` | version marker | None | Exclude | UI/data-version marker, not domain data. |
| 48 | `guvaza_proper_v7` | version marker | None | Exclude | UI/data-version marker, not domain data. |
| 49 | `guvaza_registrations` | JSON array, 225 records | `family_people` primarily; possibly `registrations` for true applicants | Reconcile then migrate | This key currently contains the family-tree population, not merely pending applicants. Use `systemId`/`parentId`; never blindly treat all 225 as new registration applications. |
| 50 | `guvaza_reserve` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current reserve balance only. |
| 51 | `guvaza_sch` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current school balance only. |
| 52 | `guvaza_spouses_GFT-GEN3-011` | JSON array | `relationships` | Candidate migration | Spouse cache. Reconcile with canonical relationship data; empty in snapshot. |
| 53 | `guvaza_trust` | numeric text | `ledger_entries` / finance configuration | Reconcile | Current Trust balance only. |
| 54 | `guvaza_whatsapp_number` | text | `configuration` / Founder contact | Migrate after verification | Operational contact setting. |
| 55 | `guvaza_wife_bg_GFT-GEN4-043` | JSON object | `relationships` + profile metadata | Optional | Wife UI colour map; not a relationship authority by itself. |
| 56 | `guvaza_wife_bg_GFT-GEN4-057` | JSON object | `relationships` + profile metadata | Optional | Wife UI colour map; not a relationship authority by itself. |
| 57 | `guvaza_wives_22-192469Y22` | JSON array | `relationships` | Candidate migration | Spouse/wife cache keyed by legacy ID; reconcile against current person IDs and relationship rules. |
| 58 | `guvaza_wives_GFT-GEN3-011` | JSON array | `relationships` | Candidate migration | Current wife list cache for systemId. |
| 59 | `guvaza_wives_GFT-GEN4-043` | JSON array | `relationships` | Candidate migration | Current wife list cache for systemId. |
| 60 | `guvaza_wives_GFT-GEN4-057` | JSON array | `relationships` | Candidate migration | Current wife list cache for systemId. |
| 61 | `guvaza_wives_clean` | JSON array | `relationships` | Candidate source / reconcile | Cleaned wife list. This may be the preferred UI cache, but canonical wife-number rules must be enforced by the server. |

## 4. Required database additions before full migration

The current foundation schema covers most operational domains, but the snapshot shows several domains that deserve explicit tables instead of forcing everything into unrelated JSON fields.

### Add `configuration`

Recommended fields:

- `config_id`
- `config_key` UNIQUE
- `value JSONB`
- `version`
- `updated_by`
- `created_at`
- `updated_at`

Use this for public-site configuration, Founder contact settings, governance switches and other controlled configuration.

### Add `notifications`

Recommended fields:

- `notification_id`
- `recipient_user_id`
- `recipient_system_id`
- `type`
- `title`
- `message`
- `status`
- `metadata JSONB`
- `created_at`
- `read_at`

### Consider `family_profile_preferences`

UI-only colours/wife-card presentation can live in `family_people.profile`, but a dedicated table is cleaner if these preferences become substantial. They are not identity or lineage authority.

## 5. Reconciliation order

### Phase A — Canonical family identity

1. Load canonical `guvazaTree.js` into the reconciliation process.
2. Compare all LocalStorage `guvaza_registrations` records by `systemId`.
3. Flag additions, missing records, parent changes, generation changes, branch changes, placeholder changes and spelling differences.
4. Do not automatically merge records solely because names match.
5. Founder/Admin reviews unresolved lineage conflicts.

### Phase B — Beneficiaries

Reconcile these four candidate sources:

- `founder_beneficiary_pool`
- `gft_physical_registry`
- `gft_approved_for_payout`
- `guvaza_bens`

Match by `systemId`, then verify membership/ID/phone/profile information. Keep identity status and lineage status separate.

### Phase C — Admin/security

1. Import Admin identity records.
2. Create server-side users and roles.
3. Import deployment modules, permissions, tasks and overrides into `admin_deployments`.
4. **Do not import `passwordPlain`.**
5. Do not use the browser's stored 2FA code as production MFA material.
6. Force secure password setup and MFA enrolment.

### Phase D — Finance

1. Create wallets for beneficiary/system owners.
2. Reconcile current balances.
3. Create controlled opening-balance ledger entries where approved.
4. Reconcile company/trust pool balances.
5. Reconcile the aggregate `guvaza_ben_pool_payouts` event against actual beneficiaries/transactions.
6. Do not fabricate historical transactions that the snapshot does not contain.

### Phase E — Public configuration

Merge the About legacy keys with `guvaza_custom_config` using field-level precedence. The migration must preserve unrelated Homepage/About/branding/company fields rather than replacing the entire configuration object.

## 6. Items deliberately NOT treated as authoritative

- Browser current-user/session keys.
- UI colour caches.
- Version-marker keys.
- Empty UI arrays.
- Plaintext passwords.
- Browser-stored 2FA codes.
- Legacy duplicate About keys when the same information exists in the main custom configuration.
- Legacy beneficiary lists when they conflict with the reconciled beneficiary source.
- Any balance without a verified opening-balance decision.
- Any name-only identity match.

## 7. Migration status

**Current stage: INSPECTION / MAPPING ONLY.**

No PostgreSQL records have been imported from this snapshot yet.

The next implementation artifact should be a **read-only reconciliation/import script** that produces a report first. It should not write to PostgreSQL until the report is reviewed and approved.
