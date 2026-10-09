'use strict';

/**
 * Minimal RFC 4180 CSV parser / writer — no dependencies.
 * Handles quoted fields, escaped quotes (""), commas and newlines inside
 * quotes, CRLF line endings and a leading UTF-8 BOM (common in exports
 * opened/saved by Excel on Windows).
 */

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (inQuotes) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

module.exports = { parseCsv, toCsv, csvCell };
