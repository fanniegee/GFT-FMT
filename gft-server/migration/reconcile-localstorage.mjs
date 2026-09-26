#!/usr/bin/env node
/**
 * GFT LocalStorage -> PostgreSQL reconciliation (READ ONLY)
 *
 * Inputs:
 *   ../db/GFT-localstorage-snapshot.json
 *   ./guvazaTree.txt (canonical family snapshot used for comparison)
 *   ./trustRules.js (optional; not required for this report)
 *
 * Outputs:
 *   ./localstorage-reconciliation-report.json
 *   ./localstorage-reconciliation-report.md
 *
 * IMPORTANT: This script NEVER writes to PostgreSQL and NEVER changes the
 * LocalStorage snapshot or canonical family data.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const snapshotPath = path.join(ROOT, 'db', 'GFT-localstorage-snapshot.json');
const treePath = path.join(__dirname, 'guvazaTree.txt');
const optionalRulesPath = path.join(ROOT, '..', 'trustRules.js');
let snapshotIdSet = new Set();
const outJson = path.join(__dirname, 'localstorage-reconciliation-report.json');
const outMd = path.join(__dirname, 'localstorage-reconciliation-report.md');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalize(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function same(a, b) {
  return normalize(a) === normalize(b);
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function extractArrayLiteral(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${marker}`);
  const open = source.indexOf('[', start);
  if (open < 0) throw new Error('Canonical tree array opening [ not found');

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];

    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[') depth++;
    if (c === ']') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('Canonical tree array closing ] not found');
}

function loadCanonicalTree() {
  const source = fs.readFileSync(treePath, 'utf8');
  const literal = extractArrayLiteral(source, 'const guvazaTree');
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 2000 });
}

function snapshotRecords(storage) {
  const raw = storage.guvaza_registrations;
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

function parseArrayKey(storage, key) {
  if (!(key in storage)) return [];
  try {
    const parsed = typeof storage[key] === 'string' ? JSON.parse(storage[key]) : storage[key];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return { parseError: e.message };
  }
}

function parseObjectKey(storage, key) {
  if (!(key in storage)) return null;
  try {
    return typeof storage[key] === 'string' ? JSON.parse(storage[key]) : storage[key];
  } catch (e) {
    return { parseError: e.message };
  }
}

function mapById(rows) {
  const map = new Map();
  const duplicates = [];
  for (const row of rows) {
    const id = row && row.systemId;
    if (!id) continue;
    if (map.has(id)) duplicates.push(id);
    else map.set(id, row);
  }
  return { map, duplicates: sortedUnique(duplicates) };
}

function compareFields(a, b, fields) {
  const mismatches = [];
  const missingInSnapshot = [];
  const missingInCanonical = [];
  for (const field of fields) {
    const aHas = Object.prototype.hasOwnProperty.call(a || {}, field);
    const bHas = Object.prototype.hasOwnProperty.call(b || {}, field);
    if (!aHas && bHas) {
      missingInSnapshot.push({ field, canonical: b[field] });
      continue;
    }
    if (aHas && !bHas) {
      missingInCanonical.push({ field, snapshot: a[field] });
      continue;
    }
    if (aHas && bHas && !same(a[field], b[field])) {
      mismatches.push({ field, snapshot: a[field], canonical: b[field] });
    }
  }
  return { mismatches, missingInSnapshot, missingInCanonical };
}

function checkParentIntegrity(rows) {
  const byId = new Map(rows.filter(x => x?.systemId).map(x => [x.systemId, x]));
  const missingParents = [];
  const generationMismatches = [];
  for (const row of rows) {
    if (!row?.systemId || !row.parentId) continue;
    const parent = byId.get(row.parentId);
    if (!parent) {
      missingParents.push({ systemId: row.systemId, parentId: row.parentId });
      continue;
    }
    if (Number.isFinite(Number(row.generation)) && Number.isFinite(Number(parent.generation))) {
      if (Number(row.generation) !== Number(parent.generation) + 1) {
        generationMismatches.push({ systemId: row.systemId, generation: row.generation, parentId: row.parentId, parentGeneration: parent.generation });
      }
    }
  }
  return { missingParents, generationMismatches };
}

function summarizeBy(rows, field) {
  const result = {};
  for (const r of rows) {
    const k = String(r?.[field] ?? '(blank)');
    result[k] = (result[k] || 0) + 1;
  }
  return result;
}

function financeSummary(storage) {
  const scalarKeys = ['guvaza_dist','guvaza_ben_pool','guvaza_fun','guvaza_sch','guvaza_trust','guvaza_fpb','guvaza_reserve'];
  const scalars = {};
  for (const key of scalarKeys) {
    const raw = storage[key];
    const value = raw == null ? null : Number(raw);
    scalars[key] = Number.isFinite(value) ? value : raw;
  }
  const wallets = parseObjectKey(storage, 'guvaza_ben_wallets');
  const walletRows = [];
  if (wallets && typeof wallets === 'object' && !wallets.parseError) {
    for (const [systemId, value] of Object.entries(wallets)) {
      walletRows.push({ systemId, balance: Number(value) || 0 });
    }
  }
  const nonZero = walletRows.filter(x => x.balance !== 0);
  const payoutEvents = parseArrayKey(storage, 'guvaza_ben_pool_payouts');
  return {
    scalarBalances: scalars,
    walletCount: walletRows.length,
    nonZeroWallets: nonZero,
    walletIdsNotInSnapshot: nonZero.filter(x => !snapshotIdSet.has(x.systemId)).map(x => x.systemId),
    payoutEvents: Array.isArray(payoutEvents) ? payoutEvents : [],
    note: 'Balances are reconciliation candidates only. No ledger entries or transactions are created by this script.'
  };
}

function beneficiarySources(storage) {
  const keys = ['founder_beneficiary_pool','gft_physical_registry','gft_approved_for_payout','guvaza_bens'];
  const result = {};
  const allIds = new Map();
  const overlaps = [];
  for (const key of keys) {
    const rows = parseArrayKey(storage, key);
    result[key] = Array.isArray(rows) ? {
      count: rows.length,
      systemIds: sortedUnique(rows.map(r => r?.systemId || r?.membership || r?.idNumber)),
      records: rows
    } : rows;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = row?.systemId || row?.membership || row?.idNumber;
      if (!id) continue;
      const prior = allIds.get(id) || [];
      prior.push(key);
      allIds.set(id, prior);
    }
  }
  for (const [systemId, sources] of allIds) {
    const unique = sortedUnique(sources);
    if (unique.length > 1) overlaps.push({ systemId, sources: unique });
  }
  return { sources: result, overlaps };
}

function securityReview(storage) {
  const adminRows = parseArrayKey(storage, 'guvaza_admins');
  const admins = Array.isArray(adminRows) ? adminRows : [];
  return {
    adminCount: admins.length,
    plaintextPasswordFields: admins.flatMap(a => Object.keys(a || {}).filter(k => /passwordplain/i.test(k)).map(k => ({ systemId: a.systemId || a.id || a.email || null, field: k }))),
    passwordHashFields: admins.flatMap(a => Object.keys(a || {}).filter(k => /passwordhash/i.test(k)).map(k => ({ systemId: a.systemId || a.id || a.email || null, field: k }))),
    founderPasswordPresent: Object.prototype.hasOwnProperty.call(storage, 'guvaza_founder_pw'),
    twoFactorCodePresent: Object.prototype.hasOwnProperty.call(storage, 'guvaza_2fa_code'),
    currentSessionKeysPresent: ['guvaza_logged_user','guvaza_current_user_id','guvaza_current_user_name'].filter(k => Object.prototype.hasOwnProperty.call(storage, k)),
    action: 'Do not migrate plaintext passwords, browser sessions, or 2FA codes. Re-enrollment/reset is required on the server.'
  };
}

const snapshot = readJson(snapshotPath);
const storage = snapshot.storage || {};
const snapshotRows = snapshotRecords(storage);
const canonicalRows = loadCanonicalTree();

const snapIndex = mapById(snapshotRows);
const canonIndex = mapById(canonicalRows);
const commonIds = sortedUnique([...snapIndex.map.keys()].filter(id => canonIndex.map.has(id)));

const fields = ['fullName','rootSurname','currentSurname','generation','branch','parentId','wifeNo','isPlaceholder','isFemaleChild'];
const fieldMismatches = [];
const fieldMissingInSnapshot = [];
const fieldMissingInCanonical = [];
for (const id of commonIds) {
  const diffs = compareFields(snapIndex.map.get(id), canonIndex.map.get(id), fields);
  if (diffs.mismatches.length) fieldMismatches.push({ systemId: id, differences: diffs.mismatches });
  if (diffs.missingInSnapshot.length) fieldMissingInSnapshot.push({ systemId: id, fields: diffs.missingInSnapshot });
  if (diffs.missingInCanonical.length) fieldMissingInCanonical.push({ systemId: id, fields: diffs.missingInCanonical });
}

const parentSnapshot = checkParentIntegrity(snapshotRows);
const parentCanonical = checkParentIntegrity(canonicalRows);
snapshotIdSet = new Set(snapIndex.map.keys());

const missingFieldCounts = {};
for (const item of fieldMissingInSnapshot) {
  for (const f of item.fields) missingFieldCounts[f.field] = (missingFieldCounts[f.field] || 0) + 1;
}
const snapshotOnlyDetails = reportPlaceholder => reportPlaceholder;

const config = parseObjectKey(storage, 'guvaza_custom_config');
const legacyConfigKeys = ['aboutRoots','aboutText','aboutTitle','guvaza_about_text','guvaza_about_title'];
const legacyConfigPresence = legacyConfigKeys.filter(k => Object.prototype.hasOwnProperty.call(storage, k));

const report = {
  metadata: {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    writesToPostgres: false,
    writesToLocalStorage: false,
    snapshotExportedAt: snapshot.exportedAt || null,
    snapshotKeyCount: Object.keys(storage).length,
    canonicalSource: path.basename(treePath),
    optionalTrustRulesSourcePresent: fs.existsSync(optionalRulesPath)
  },
  canonicalFamily: {
    recordCount: canonicalRows.length,
    uniqueSystemIdCount: canonIndex.map.size,
    duplicateSystemIds: canonIndex.duplicates,
    generations: summarizeBy(canonicalRows, 'generation')
  },
  snapshotFamily: {
    recordCount: snapshotRows.length,
    uniqueSystemIdCount: snapIndex.map.size,
    duplicateSystemIds: snapIndex.duplicates,
    generations: summarizeBy(snapshotRows, 'generation'),
    statuses: summarizeBy(snapshotRows, 'status'),
    placeholders: snapshotRows.filter(r => r?.isPlaceholder).map(r => r.systemId),
    physicallyVerified: snapshotRows.filter(r => r?.isPhysicallyVerified).map(r => r.systemId)
  },
  familyComparison: {
    snapshotNotInCanonical: sortedUnique([...snapIndex.map.keys()].filter(id => !canonIndex.map.has(id))),
    snapshotNotInCanonicalRecords: [...snapIndex.map.keys()].filter(id => !canonIndex.map.has(id)).map(id => snapIndex.map.get(id)),
    canonicalNotInSnapshot: sortedUnique([...canonIndex.map.keys()].filter(id => !snapIndex.map.has(id))),
    commonCount: commonIds.length,
    fieldMismatches: fieldMismatches,
    fieldsMissingInSnapshot: fieldMissingInSnapshot,
    missingFieldCounts: missingFieldCounts,
    fieldsMissingInCanonical: fieldMissingInCanonical,
    snapshotDuplicateSystemIds: snapIndex.duplicates,
    canonicalDuplicateSystemIds: canonIndex.duplicates
  },
  parentIntegrity: {
    snapshot: parentSnapshot,
    canonical: parentCanonical
  },
  beneficiarySources: beneficiarySources(storage),
  finance: null,
  configuration: {
    customConfigPresent: !!config && !config.parseError,
    customConfigTopLevelKeys: config && typeof config === 'object' && !config.parseError ? Object.keys(config) : [],
    legacyAboutKeysPresent: legacyConfigPresence,
    warning: 'Configuration sources must be merged field-by-field; do not let one browser object overwrite unrelated Founder/Admin changes.'
  },
  security: securityReview(storage),
  auxiliaryKeys: {
    allKeys: Object.keys(storage).sort(),
    excludedFromGftCore: ['dipvtc_contacts_v2','dipvtc_courses','dipvtc_current','dipvtc_pathways_v2','dipvtc_subjects_image_boxes'],
    sessionOrUiOnly: ['guvaza_logged_user','guvaza_current_user_id','guvaza_current_user_name','guvaza_auto_tree_view'],
    appearanceOrPersonalization: Object.keys(storage).filter(k => /^guvaza_(card_bg|child_bg|wife_bg|gender_|personal_color_|personal_descendants_|spouses_|wives_)/.test(k)).sort()
  },
  migrationGate: {
    readyToImport: false,
    reason: 'Reconciliation is informational only. Any discrepancies, duplicate beneficiary sources, security fields, and financial opening balances require review before PostgreSQL import.'
  }
};
report.finance = financeSummary(storage);

const severity = {
  snapshotNotInCanonical: report.familyComparison.snapshotNotInCanonical.length,
  canonicalNotInSnapshot: report.familyComparison.canonicalNotInSnapshot.length,
  fieldMismatches: report.familyComparison.fieldMismatches.length,
  fieldsMissingInSnapshot: report.familyComparison.fieldsMissingInSnapshot.length,
  fieldsMissingInCanonical: report.familyComparison.fieldsMissingInCanonical.length,
  parentMissing: report.parentIntegrity.snapshot.missingParents.length,
  beneficiaryOverlaps: report.beneficiarySources.overlaps.length,
  plaintextPasswords: report.security.plaintextPasswordFields.length,
  twoFactorCode: report.security.twoFactorCodePresent ? 1 : 0,
  payoutEvents: report.finance.payoutEvents.length
};
report.severitySummary = severity;

function mdList(arr, empty='None') {
  return arr.length ? arr.map(x => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : `- ${empty}`;
}

const md = `# GFT LocalStorage Reconciliation Report\n\n` +
`**Mode:** READ-ONLY — no PostgreSQL writes and no source-file changes.  \n` +
`**Generated:** ${report.metadata.generatedAt}  \n` +
`**Snapshot exported:** ${report.metadata.snapshotExportedAt || 'unknown'}\n\n` +
`## 1. Family population\n\n` +
`| Source | Records | Unique systemId |\n|---|---:|---:|\n| Canonical family | ${report.canonicalFamily.recordCount} | ${report.canonicalFamily.uniqueSystemIdCount} |\n| LocalStorage snapshot | ${report.snapshotFamily.recordCount} | ${report.snapshotFamily.uniqueSystemIdCount} |\n\n` +
`### Snapshot generations\n\n${mdList(Object.entries(report.snapshotFamily.generations).map(([k,v]) => `${k}: ${v}`))}\n\n` +
`### Snapshot statuses\n\n${mdList(Object.entries(report.snapshotFamily.statuses).map(([k,v]) => `${k}: ${v}`))}\n\n` +
`## 2. System-ID reconciliation\n\n` +
`### Snapshot IDs not in canonical\n${mdList(report.familyComparison.snapshotNotInCanonical)}\n\n` +
`### Canonical IDs not in snapshot\n${mdList(report.familyComparison.canonicalNotInSnapshot)}\n\n` +
`### Field mismatches\n${mdList(report.familyComparison.fieldMismatches)}\n\n` +
`### Fields present in canonical but absent from snapshot\n${mdList(Object.entries(report.familyComparison.missingFieldCounts).map(([k,v]) => `${k}: absent in ${v} shared records`))}\n\n` +
`### Snapshot-only record details\n${mdList(report.familyComparison.snapshotNotInCanonicalRecords)}\n\n` +
`### Fields present in snapshot but absent from canonical\n${mdList(report.familyComparison.fieldsMissingInCanonical)}\n\n` +
`## 3. Parent/lineage integrity\n\n` +
`### Snapshot missing parents\n${mdList(report.parentIntegrity.snapshot.missingParents)}\n\n` +
`### Snapshot generation-vs-parent mismatches\n${mdList(report.parentIntegrity.snapshot.generationMismatches)}\n\n` +
`### Canonical missing parents\n${mdList(report.parentIntegrity.canonical.missingParents)}\n\n` +
`## 4. Beneficiary source reconciliation\n\n` +
`${mdList(report.beneficiarySources.overlaps, 'No cross-source systemId overlaps detected.')}\n\n` +
`## 5. Finance / wallets\n\n` +
`Scalar balances are reported as opening-balance candidates only; this script does not create ledger entries.\n\n` +
'```json\n' + JSON.stringify({scalarBalances: report.finance.scalarBalances, nonZeroWallets: report.finance.nonZeroWallets, payoutEvents: report.finance.payoutEvents}, null, 2) + '\n```\n\n' +
`## 6. Configuration\n\n` +
`Custom configuration present: **${report.configuration.customConfigPresent}**  \n` +
`Top-level custom-config sections: ${report.configuration.customConfigTopLevelKeys.join(', ') || 'none'}  \n` +
`Legacy About keys present: ${report.configuration.legacyAboutKeysPresent.join(', ') || 'none'}\n\n` +
`## 7. Security migration warnings\n\n` +
`${mdList(report.security.plaintextPasswordFields, 'No passwordPlain fields found.')}\n` +
`- Founder password key present: ${report.security.founderPasswordPresent}\n` +
`- 2FA code key present: ${report.security.twoFactorCodePresent}\n` +
`- Browser session keys present: ${report.security.currentSessionKeysPresent.join(', ') || 'none'}\n\n` +
`**Rule:** passwords, session state and 2FA codes must not be imported as authoritative server credentials.\n\n` +
`## 8. Migration gate\n\n` +
`**PostgreSQL import allowed by this script: NO.**\n\n` +
`The next step is human review of the reconciliation results, followed by an explicit migration plan for each discrepancy class.\n`;

fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
fs.writeFileSync(outMd, md);
console.log(`READ-ONLY reconciliation complete.`);
console.log(`JSON report: ${outJson}`);
console.log(`Markdown report: ${outMd}`);
console.log(`Canonical records: ${canonicalRows.length}`);
console.log(`Snapshot records: ${snapshotRows.length}`);
console.log(`Snapshot-only IDs: ${severity.snapshotNotInCanonical}`);
console.log(`Canonical-only IDs: ${severity.canonicalNotInSnapshot}`);
console.log(`Field-mismatch records: ${severity.fieldMismatches}`);
console.log(`Beneficiary source overlaps: ${severity.beneficiaryOverlaps}`);
console.log(`Plaintext password fields: ${severity.plaintextPasswords}`);
