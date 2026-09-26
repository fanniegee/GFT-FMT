# GFT LocalStorage → PostgreSQL Migration Map

This is a mapping/inspection document only. No browser data has been migrated.

## Discovered keys by source file

### script.js
- `guvazaFamily`
- `guvazaRules`
- `pendingRegistrations`

### beneficiary-portal-fixed-1.html
- `gft_cashout_history`
- `gft_payout_requests`
- `guvaza_admin_companies`
- `guvaza_ben_wallets`
- `guvaza_beneficiary_session`
- `guvaza_bens`
- `guvaza_current_user`
- `guvaza_current_user_id`
- `guvaza_current_user_name`
- `guvaza_registrations`
- `pendingRegistrations`

### admin.txt
- `aboutRoots`
- `aboutText`
- `aboutTitle`
- `guvazaTree_backup`
- `guvaza_about_text`
- `guvaza_about_title`
- `guvaza_admin_companies`
- `guvaza_admins`
- `guvaza_all_alerts`
- `guvaza_bens`
- `guvaza_current_admin`
- `guvaza_custom_config`
- `guvaza_email_log`
- `guvaza_founder_email`
- `guvaza_founder_email2`
- `guvaza_funeral_paid`
- `guvaza_funeral_requests`
- `guvaza_pending_regs`
- `guvaza_registrations`
- `guvaza_school_paid`
- `guvaza_school_requests`
- `guvaza_whatsapp_number`
- `guvaza_wives_clean`

### founder.txt
- `guvaza_2fa_code`
- `guvaza_2fa_enabled`
- `guvaza_admins`
- `guvaza_all_alerts`
- `guvaza_auto_approve`
- `guvaza_ben_pool`
- `guvaza_ben_pool_loaded_at`
- `guvaza_ben_pool_payouts`
- `guvaza_ben_wallets`
- `guvaza_bens`
- `guvaza_custom_config`
- `guvaza_del_log`
- `guvaza_dist`
- `guvaza_email_enabled`
- `guvaza_email_log`
- `guvaza_export_log`
- `guvaza_export_log_arr`
- `guvaza_founder_email`
- `guvaza_founder_pw`
- `guvaza_fpb`
- `guvaza_fun`
- `guvaza_funeral_paid`
- `guvaza_funeral_requests`
- `guvaza_pending_regs`
- `guvaza_profits`
- `guvaza_reserve`
- `guvaza_sch`
- `guvaza_school_paid`
- `guvaza_school_requests`
- `guvaza_trust`
- `guvaza_verified_schools`
- `guvaza_whatsapp_enabled`
- `guvaza_whatsapp_log`
- `guvaza_whatsapp_number`
- `members`
- `vv_members`

## Canonical mapping decisions

- `guvaza_bens` → **beneficiaries** — Approved beneficiary records; use system_id/membership as stable identity. Do not import blindly until deduped against canonical tree.
- `guvaza_pending_regs` → **registrations** — Pending beneficiary registrations.
- `guvaza_admins` → **users + user_roles + admin_deployments** — Admin accounts, roles, deployment authority. PasswordPlain MUST NOT be migrated.
- `guvaza_current_admin` → **sessions (future server session store)** — Current browser session only; do not migrate as permanent user data.
- `guvaza_custom_config` → **configuration (new table/API to add)** — Founder/Admin website configuration; merge nested sections instead of replacing the whole object.
- `guvaza_profits` → **ledger_entries + companies** — Company profit inputs; preserve source records and date/reference.
- `guvaza_dist` → **ledger_entries / wallets** — Distribution wallet balance; migration must create opening balance entry rather than simply setting an unexplained balance.
- `guvaza_ben_pool` → **ledger_entries / wallets** — Beneficiary pool opening balance.
- `guvaza_fun` → **ledger_entries / wallets** — Funeral wallet opening balance.
- `guvaza_sch` → **ledger_entries / wallets** — School wallet opening balance.
- `guvaza_trust` → **ledger_entries / wallets** — Trust/main wallet opening balance.
- `guvaza_fpb` → **ledger_entries / wallets** — FPB wallet opening balance.
- `guvaza_reserve` → **ledger_entries / wallets** — Reserve wallet opening balance.
- `guvaza_ben_wallets` → **wallets + ledger_entries** — Per-beneficiary wallet balances; migrate as opening ledger entries.
- `guvaza_ben_pool_loaded_at` → **migration metadata** — Pool load timestamp.
- `guvaza_ben_pool_payouts` → **payout_requests + transactions + ledger_entries** — Historical beneficiary pool payouts; needs schema-specific import.
- `guvaza_2fa_enabled` → **users/security credentials (future)** — Security setting; do not migrate raw 2FA code.
- `guvaza_2fa_code` → **authentication credentials (future)** — Sensitive secret; NEVER copy plaintext code into database.
- `guvaza_founder_pw` → **users authentication** — Do not migrate plaintext password. Founder must establish a new server-side password hash.
- `guvaza_auto_approve` → **configuration/governance** — Founder workflow setting.
- `guvaza_email_enabled` → **configuration/communications** — Communication setting.
- `guvaza_whatsapp_enabled` → **configuration/communications** — Communication setting.
- `guvaza_founder_email` → **configuration/communications** — Founder contact setting.
- `guvaza_founder_email2` → **configuration/communications** — Backup Founder contact setting.
- `guvaza_whatsapp_number` → **configuration/communications** — WhatsApp contact setting.
- `guvaza_verified_schools` → **configuration/services** — Verified school registry.
- `guvaza_email_log` → **communications** — Email communication log.
- `guvaza_del_log` → **audit_events** — Deletion history; preserve as audit history.
- `guvaza_about_text` → **configuration** — Legacy About field; merge into canonical about config.
- `guvaza_about_title` → **configuration** — Legacy About field; merge into canonical about config.
- `aboutRoots` → **configuration** — Legacy About field.
- `aboutText` → **configuration** — Legacy About field.
- `aboutTitle` → **configuration** — Legacy About field.

## Keys requiring additional inspection before migration

- `gft_cashout_history` → NOT YET MAPPED — inspect before import.
- `gft_payout_requests` → NOT YET MAPPED — inspect before import.
- `guvazaFamily` → NOT YET MAPPED — inspect before import.
- `guvazaRules` → NOT YET MAPPED — inspect before import.
- `guvazaTree_backup` → NOT YET MAPPED — inspect before import.
- `guvaza_admin_companies` → NOT YET MAPPED — inspect before import.
- `guvaza_all_alerts` → NOT YET MAPPED — inspect before import.
- `guvaza_beneficiary_session` → NOT YET MAPPED — inspect before import.
- `guvaza_current_user` → NOT YET MAPPED — inspect before import.
- `guvaza_current_user_id` → NOT YET MAPPED — inspect before import.
- `guvaza_current_user_name` → NOT YET MAPPED — inspect before import.
- `guvaza_export_log` → NOT YET MAPPED — inspect before import.
- `guvaza_export_log_arr` → NOT YET MAPPED — inspect before import.
- `guvaza_funeral_paid` → NOT YET MAPPED — inspect before import.
- `guvaza_funeral_requests` → NOT YET MAPPED — inspect before import.
- `guvaza_registrations` → NOT YET MAPPED — inspect before import.
- `guvaza_school_paid` → NOT YET MAPPED — inspect before import.
- `guvaza_school_requests` → NOT YET MAPPED — inspect before import.
- `guvaza_whatsapp_log` → NOT YET MAPPED — inspect before import.
- `guvaza_wives_clean` → NOT YET MAPPED — inspect before import.
- `members` → NOT YET MAPPED — inspect before import.
- `pendingRegistrations` → NOT YET MAPPED — inspect before import.
- `vv_members` → NOT YET MAPPED — inspect before import.

## Migration order
1. Freeze/backup browser data.
2. Export raw localStorage snapshots from the relevant browser/device.
3. Validate JSON and preserve the raw snapshot as an immutable migration artifact.
4. Import canonical family/beneficiary identity first.
5. Import registrations and admin/governance records.
6. Import wallets as opening balances plus ledger entries; do not silently overwrite balances.
7. Import historical payouts/transactions and audit records.
8. Merge website configuration fields without overwriting unrelated Founder/Admin changes.
9. Reconcile counts, balances and identity keys.
10. Only then switch front ends from localStorage to API reads/writes.

## Critical security rules
- Never migrate `passwordPlain` or raw Founder passwords.
- Never migrate plaintext 2FA codes as authentication secrets.
- Browser session keys are not permanent user records.
- Financial balances require ledger/opening-balance treatment and reconciliation.
- `systemId` is the authoritative identity key; repeated names are not identity.
- Do not treat legacy duplicate keys as separate authoritative datasets.