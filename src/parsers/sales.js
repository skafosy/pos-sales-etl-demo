'use strict';

const { parseDate } = require('../dates');
const { cellText, toNumber, toSatang, fromSatang, detectCompanyName } = require('./common');

/**
 * Parser for a paginated "sales detail" report (one row per item sold).
 *
 * Real ERP exports are not tables: they repeat the company banner and column
 * headers on every page, insert daily subtotal rows ("รวม..."), and may
 * reorder columns between versions. So instead of fixed column positions we
 * locate the header row by its labels and map columns by name.
 *
 * Fail fast on the wrong report: a very similar "sales summary" report has no
 * member column. Importing it would silently classify every bill as retail
 * (wholesale = known member), so we refuse it with an explicit message.
 */

const COLUMNS = {
  date:    ['วันที่'],
  bill:    ['เลขที่บิล'],
  member:  ['สมาชิก', 'รหัสสมาชิก'],
  barcode: ['รหัสสินค้า', 'บาร์โค้ด'],
  name:    ['ชื่อสินค้า'],
  qty:     ['จำนวน'],
  amount:  ['ยอดสุทธิ', 'ขายสุทธิ'],
};
const REQUIRED = ['date', 'bill', 'member', 'barcode', 'qty', 'amount'];

function mapHeader(row) {
  const txt = row.map(cellText);
  if (!txt.includes('วันที่') || !txt.some(t => t.startsWith('เลขที่บิล'))) return null;
  const idx = {};
  for (const [key, labels] of Object.entries(COLUMNS)) {
    const i = txt.findIndex(t => labels.some(l => t === l || t.startsWith(l)));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

function parseSalesReport(rows) {
  let idx = null;
  for (const r of rows) { idx = mapHeader(r || []); if (idx) break; }
  if (!idx) throw new Error('Sales report: header row (วันที่ / เลขที่บิล) not found.');

  const missing = REQUIRED.filter(k => idx[k] === undefined);
  if (missing.includes('member')) {
    throw new Error(
      'Sales report has no member column (สมาชิก) — this looks like the summary report, ' +
      'not the item-level detail report. Importing it would classify every bill as retail.'
    );
  }
  if (missing.length) throw new Error(`Sales report: missing columns: ${missing.join(', ')}`);

  const lines = [];
  let skipped = 0;
  let totalSatang = 0;

  for (const r of rows) {
    if (!r || mapHeader(r)) continue;                       // repeated page header
    const first = cellText(r[0]);
    if (first.startsWith('รวม') || first.startsWith('บริษัท')) continue;
    const sales_date = parseDate(r[idx.date]);
    const bill_no = cellText(r[idx.bill]);
    const qty = toNumber(r[idx.qty]);
    const amount = toNumber(r[idx.amount]);
    const barcode = cellText(r[idx.barcode]);
    if (!sales_date || !bill_no || !barcode || qty === null || amount === null) {
      if (r.some(v => cellText(v) !== '')) skipped++;
      continue;
    }
    totalSatang += toSatang(amount);
    lines.push({
      bill_no,
      sales_date,
      member_code: cellText(r[idx.member]) || null,
      barcode,
      product_name: idx.name !== undefined ? cellText(r[idx.name]) : '',
      qty,
      amount,
    });
  }

  return {
    companyName: detectCompanyName(rows),
    lines,
    stats: {
      lines: lines.length,
      bills: new Set(lines.map(l => l.bill_no)).size,
      amount: fromSatang(totalSatang),
      skippedRows: skipped,
    },
  };
}

module.exports = { parseSalesReport };
