'use strict';

/** Shared helpers for ERP report parsers. */

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** '1,234.50' -> 1234.5, '(12.00)' -> -12, '' -> null */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = cellText(v);
  if (s === '' || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/** Money as integer satang to avoid float drift when summing. */
const toSatang = n => Math.round(n * 100);
const fromSatang = s => s / 100;

/** First "บริษัท ..." (company name) cell in the first few rows of a report. */
function detectCompanyName(rows, scanRows = 5) {
  for (let i = 0; i < Math.min(rows.length, scanRows); i++) {
    for (const v of rows[i] || []) {
      const s = cellText(v);
      if (s.startsWith('บริษัท')) return s;
    }
  }
  return '';
}

/**
 * Guard against uploading company B's file into company A.
 * companies: [{ code, name_match }] — name_match is a substring of the legal name.
 * Unknown names pass (fail-open) so a renamed company never blocks imports;
 * a name that clearly belongs to *another* company fails before anything is
 * deleted or written.
 */
function assertCompany(detectedName, expectedCode, companies) {
  const hit = companies.find(c => c.name_match && detectedName.includes(c.name_match));
  if (hit && hit.code !== expectedCode) {
    throw new Error(
      `This file belongs to "${detectedName}" (${hit.code}) but was imported as ${expectedCode}. ` +
      'Nothing was changed. Re-run with the correct --company.'
    );
  }
  return hit ? hit.code : null;
}

module.exports = { cellText, toNumber, toSatang, fromSatang, detectCompanyName, assertCompany };
