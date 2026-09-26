# GFT LocalStorage Reconciliation Report

**Mode:** READ-ONLY — no PostgreSQL writes and no source-file changes.  
**Generated:** 2026-09-25T21:22:54.797Z  
**Snapshot exported:** 2026-09-25T21:02:30.633Z

## 1. Family population

| Source | Records | Unique systemId |
|---|---:|---:|
| Canonical family | 224 | 224 |
| LocalStorage snapshot | 225 | 225 |

### Snapshot generations

- 1: 1
- 2: 5
- 3: 37
- 4: 182

### Snapshot statuses

- AUTO_LINEAGE_PENDING: 204
- PLACEHOLDER_ADMIN_EDIT: 19
- PHYSICALLY_VERIFIED: 1
- NEW_REGISTRATION_VERIFIED: 1

## 2. System-ID reconciliation

### Snapshot IDs not in canonical
- GFT-GEN4-182

### Canonical IDs not in snapshot
- None

### Field mismatches
- None

### Fields present in canonical but absent from snapshot
- isFemaleChild: absent in 224 shared records

### Snapshot-only record details
- {"fullName":"Deigratia Nyasha Guvaza","name":"Deigratia Nyasha Guvaza","systemId":"GFT-GEN4-182","membership":"GFT-GEN4-182","idNumber":"22-2029604A22","parentId":"GFT-GEN3-011","generation":4,"branch":"BRANCH_VURAYAI","wifeNo":"WIFE1_VaZvichaipwi","rootSurname":"Guvaza","currentSurname":"Guvaza","secondSurname":"","dob":"2007-10-08","phone":"+263713735970","username":"deiggee","parentName":"Fannuel Guvaza","grandParentName":"Zekia Guvaza","gender":"FEMALE","status":"NEW_REGISTRATION_VERIFIED","isAutoLineage":false,"isPhysicallyVerified":true}

### Fields present in snapshot but absent from canonical
- None

## 3. Parent/lineage integrity

### Snapshot missing parents
- None

### Snapshot generation-vs-parent mismatches
- None

### Canonical missing parents
- None

## 4. Beneficiary source reconciliation

- {"systemId":"GFT-GEN3-011","sources":["founder_beneficiary_pool","gft_approved_for_payout","gft_physical_registry","guvaza_bens"]}
- {"systemId":"GFT-GEN4-182","sources":["founder_beneficiary_pool","gft_approved_for_payout","gft_physical_registry"]}

## 5. Finance / wallets

Scalar balances are reported as opening-balance candidates only; this script does not create ledger entries.

```json
{
  "scalarBalances": {
    "guvaza_dist": 900,
    "guvaza_ben_pool": 0,
    "guvaza_fun": 3800,
    "guvaza_sch": 2100,
    "guvaza_trust": 24000,
    "guvaza_fpb": 0,
    "guvaza_reserve": 900
  },
  "nonZeroWallets": [
    {
      "systemId": "GFT-GEN4-057",
      "balance": 1200
    },
    {
      "systemId": "GFT-GEN4-182",
      "balance": 1200
    },
    {
      "systemId": "GFT-GEN3-011",
      "balance": 1200
    }
  ],
  "payoutEvents": [
    {
      "date": "9/21/2026, 9:13:02 PM",
      "total": 3600,
      "count": 3,
      "perHead": 1200
    }
  ]
}
```

## 6. Configuration

Custom configuration present: **true**  
Top-level custom-config sections: name, tagline, email, logo, footerText, caps, rules, companies, homepage, about, branding, contact, social  
Legacy About keys present: aboutRoots, aboutText, aboutTitle, guvaza_about_text, guvaza_about_title

## 7. Security migration warnings

- {"systemId":1789717339537,"field":"passwordPlain"}
- Founder password key present: false
- 2FA code key present: false
- Browser session keys present: guvaza_logged_user, guvaza_current_user_id, guvaza_current_user_name

**Rule:** passwords, session state and 2FA codes must not be imported as authoritative server credentials.

## 8. Migration gate

**PostgreSQL import allowed by this script: NO.**

The next step is human review of the reconciliation results, followed by an explicit migration plan for each discrepancy class.
