'use strict';

const { parseDate } = require('../dates');
const { cellText, toNumber, toSatang, fromSatang, detectCompanyName } = require('./common');

/**
 * Parser for a multi-level "goods received by document" report:
 *
 *   DOC HEADER  date | doc_no | supplier_code | supplier_name
 *   ITEM        barcode | product_name | unit | qty | free_qty | amount | location
 *   ...
 *   DOC TOTAL   "รวม เอกสาร" | doc_no | | qty | free_qty | amount
 *
 * Every document total is cross-checked against the sum of its items; any
 * mismatch is reported and makes the import fail, because a silently
 * mis-parsed column would otherwise flow straight into cost reports.
 *
 * Free-goods rows (qty 0, amount 0, free_qty > 0) are kept: they are real
 * stock received and they lower the effective unit cost.
 */

const DOC_NO = /^[A-Z]{2,4}\d{4}\/\d{1,5}$/;

function isDocHeader(r) {
  return DOC_NO.test(cellText(r[1])) && parseDate(r[0]) !== null;
}

function parsePurchaseReport(rows) {
  const docs = [];
  const mismatches = [];
  let cur = null;
  let itemSatang = 0;

  for (const r of rows) {
    if (!r) continue;
    const a = cellText(r[0]);

    if (isDocHeader(r)) {
      cur = {
        doc_no: cellText(r[1]),
        doc_date: parseDate(r[0]),
        supplier_code: cellText(r[2]),
        supplier_name: cellText(r[3]),
        lines: [],
        satang: 0,
      };
      docs.push(cur);
      continue;
    }

    if (a.startsWith('รวม')) {
      const docNo = cellText(r[1]);
      const reported = toNumber(r[5]);
      const doc = docs.find(d => d.doc_no === docNo);
      if (doc && reported !== null && toSatang(reported) !== doc.satang) {
        mismatches.push({ doc_no: docNo, reported, parsed: fromSatang(doc.satang) });
      }
      cur = null;
      continue;
    }

    if (!cur || a === '') continue;
    const qty = toNumber(r[3]);
    const free = toNumber(r[4]) ?? 0;
    const amount = toNumber(r[5]);
    if (qty === null || amount === null) continue;          // page banners etc.
    if (qty === 0 && amount === 0 && free === 0) continue;

    cur.lines.push({
      barcode: a,
      product_name: cellText(r[1]),
      unit: cellText(r[2]),
      qty,
      free_qty: free,
      amount,
      location: cellText(r[6]) || null,
    });
    cur.satang += toSatang(amount);
    itemSatang += toSatang(amount);
  }

  const out = docs.map(({ satang, ...d }) => ({ ...d, total_amount: fromSatang(satang) }));
  return {
    companyName: detectCompanyName(rows),
    docs: out,
    mismatches,
    stats: {
      docs: out.length,
      lines: out.reduce((n, d) => n + d.lines.length, 0),
      amount: fromSatang(itemSatang),
      locations: [...new Set(out.flatMap(d => d.lines.map(l => l.location)).filter(Boolean))].sort(),
    },
  };
}

module.exports = { parsePurchaseReport };
