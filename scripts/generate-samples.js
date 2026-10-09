#!/usr/bin/env node
'use strict';

/**
 * Generates fictional ERP-style report exports into samples/.
 * Deterministic (seeded PRNG) so the expected totals never change.
 *
 * The files deliberately reproduce the awkward parts of real exports:
 * repeated page banners/headers, daily subtotal rows, Buddhist-era dates,
 * Excel serial dates, overlapping exports of the same days, reused document
 * numbers across companies, free-goods lines and items with no supplier.
 */

const fs = require('fs');
const path = require('path');
const { toCsv } = require('../src/csv');

function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANY = {
  DEMO:  'บริษัท เดโม่ เพ็ท ซัพพลาย จำกัด',
  DEMO2: 'บริษัท ตัวอย่าง เพ็ท เทรด จำกัด',
};

// barcode, name, unit, supplier, retail price, cost
const PRODUCTS = [
  ['8850000000011', 'Alpha Adult Dog 3kg',       'bag',  'S001', 459,  345],
  ['8850000000028', 'Alpha Puppy 1.5kg',         'bag',  'S001', 289,  215],
  ['8850000000035', 'Alpha Cat Indoor 1.2kg',    'bag',  'S001', 319,  238],
  ['8850000000042', 'Alpha Wet Tuna 85g',        'pcs',  'S001', 25,   17.5],
  ['8850000000059', 'Beta Flea Drops Small',     'box',  'S002', 690,  520],
  ['8850000000066', 'Beta Flea Drops Large',     'box',  'S002', 890,  670],
  ['8850000000073', 'Beta Dewormer Tablet',      'tab',  'H002', 95,   62],
  ['8850000000080', 'Beta Joint Chew 60s',       'jar',  'H002', 1250, 905],
  ['8850000000097', 'Gamma Leash Nylon',         'pcs',  'S003', 199,  110],
  ['8850000000103', 'Gamma Bowl Steel M',        'pcs',  'S003', 149,  82],
  ['8850000000110', 'Gamma Cat Toy Feather',     'pcs',  'S003', 59,   28],
  ['8850000000127', 'Delta Clumping Litter 10L', 'bag',  'S004', 245,  176],
  ['8850000000134', 'Delta Pee Pad 50s',         'pack', 'S004', 329,  240],
  ['2000000000017', 'Grooming service',          'job',  null,   350,  0],
  ['9999999999994', 'Unregistered item',         'pcs',  null,   120,  80],   // not in products table
];

const sat = n => Math.round(n * 100);
const money = s => (s / 100).toFixed(2);
const pad = (n, w) => String(n).padStart(w, '0');

function dmy(y, m, d, buddhist) {
  return `${pad(d, 2)}/${pad(m, 2)}/${buddhist ? y + 543 : y}`;
}
function excelSerial(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** One month of bills -> array of {day, bill_no, member, lines[]} */
function generateBills(rand, { prefixes, billsPerDay, days }) {
  const bills = [];
  const seq = {};
  for (const day of days) {
    const n = billsPerDay[0] + Math.floor(rand() * (billsPerDay[1] - billsPerDay[0] + 1));
    for (let i = 0; i < n; i++) {
      const prefix = prefixes[Math.floor(rand() * prefixes.length)];
      seq[prefix] = (seq[prefix] || 0) + 1;
      const r = rand();
      const member = r < 0.2 ? `W000${1 + Math.floor(rand() * 5)}`
                   : r < 0.6 ? `R${pad(1 + Math.floor(rand() * 400), 4)}` : '';
      const wholesale = member.startsWith('W');
      const lines = [];
      const k = 1 + Math.floor(rand() * 4);
      for (let j = 0; j < k; j++) {
        const p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
        const qty = wholesale ? 6 + Math.floor(rand() * 25) : 1 + Math.floor(rand() * 3);
        const unit = wholesale ? Math.round(p[4] * 0.88 * 100) / 100 : p[4];
        lines.push({ barcode: p[0], name: p[1], qty, amountSat: sat(unit * qty) });
      }
      bills.push({ day, bill_no: `${prefix}-2608-${pad(seq[prefix], 5)}`, member, lines });
    }
  }
  return bills;
}

/** Render bills as a paginated sales detail report. */
function renderSalesReport(company, bills, { dateStyle, rowsPerPage = 45 }) {
  const header = ['วันที่', 'เลขที่บิล', 'สมาชิก', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'ยอดสุทธิ'];
  const out = [];
  let onPage = rowsPerPage;
  let page = 0;
  const newPage = () => {
    page++;
    out.push([COMPANY[company], '', 'รายงานรายละเอียดการขาย', '', '', `หน้าที่ ${page}`, '']);
    out.push(header);
    onPage = 0;
  };
  const fmtDate = d => (dateStyle === 'serial' ? excelSerial(2026, 8, d)
                                               : dmy(2026, 8, d, dateStyle === 'buddhist'));
  let totalSat = 0;
  const days = [...new Set(bills.map(b => b.day))];
  for (const day of days) {
    let daySat = 0, dayQty = 0;
    for (const b of bills.filter(x => x.day === day)) {
      for (const l of b.lines) {
        if (onPage >= rowsPerPage) { if (page > 0) out.push([]); newPage(); }
        out.push([fmtDate(day), b.bill_no, b.member, l.barcode, l.name, l.qty, money(l.amountSat)]);
        onPage++;
        daySat += l.amountSat; dayQty += l.qty;
      }
    }
    out.push([`รวมวันที่ ${dmy(2026, 8, day, dateStyle === 'buddhist')}`, '', '', '', '', dayQty, money(daySat)]);
    totalSat += daySat;
  }
  return { rows: out, totalSat };
}

function generatePurchases(rand, { company, suppliers, docs, locations }) {
  const out = [[COMPANY[company], '', 'รายงานรายละเอียดใบรับสินค้า ตามเอกสาร', '', '', '', '']];
  let totalSat = 0;
  for (let i = 1; i <= docs; i++) {
    const day = 1 + Math.floor(((i - 1) * 31) / docs);
    const [supCode, supName] = suppliers[Math.floor(rand() * suppliers.length)];
    const docNo = `RR2608/${pad(i, 4)}`;
    out.push([dmy(2026, 8, day, true), docNo, supCode, supName, '', '', '']);
    const pool = PRODUCTS.filter(p => p[3] && (supCode === 'S900' || p[3] === supCode));
    const k = 2 + Math.floor(rand() * 5);
    let docSat = 0, docQty = 0, docFree = 0;
    for (let j = 0; j < k; j++) {
      const p = pool[Math.floor(rand() * pool.length)];
      const qty = 12 * (1 + Math.floor(rand() * 10));
      const isFreeOnly = rand() < 0.08;
      const free = isFreeOnly ? 6 : (rand() < 0.2 ? 2 : 0);
      const lineQty = isFreeOnly ? 0 : qty;
      const cost = supCode === 'S900' ? p[5] * 1.05 : p[5];
      const amtSat = sat(Math.round(cost * lineQty * 100) / 100);
      const loc = locations[Math.floor(rand() * locations.length)];
      out.push([p[0], p[1], p[2], lineQty, free, money(amtSat), loc]);
      docSat += amtSat; docQty += lineQty; docFree += free;
    }
    out.push(['รวม เอกสาร', docNo, '', docQty, docFree, money(docSat), '']);
    totalSat += docSat;
  }
  return { rows: out, totalSat };
}

function generateAll() {
  const rand = mulberry32(20260801);
  const allDays = Array.from({ length: 31 }, (_, i) => i + 1);

  const demoBills = generateBills(rand, { prefixes: ['0001', '0002', '0003', '0004'],
                                          billsPerDay: [8, 14], days: allDays });
  const demo2Bills = generateBills(rand, { prefixes: ['0003'], billsPerDay: [3, 6], days: allDays });

  // DEMO is exported twice with overlapping days (1–27 and 25–31) to prove
  // that re-importing the same bills never double counts.
  const files = {
    'sales_DEMO_2026-08_part1.csv':  renderSalesReport('DEMO', demoBills.filter(b => b.day <= 27), { dateStyle: 'buddhist' }),
    'sales_DEMO_2026-08_part2.csv':  renderSalesReport('DEMO', demoBills.filter(b => b.day >= 25), { dateStyle: 'buddhist' }),
    'sales_DEMO2_2026-08.csv':       renderSalesReport('DEMO2', demo2Bills, { dateStyle: 'serial' }),
    'purchase_DEMO_2026-08.csv': generatePurchases(rand, {
      company: 'DEMO', docs: 40, locations: ['HQ-STORE', 'HQ-STORE', 'BR-A', 'BR-B'],
      suppliers: [['S001', 'Alpha Pet Foods Co., Ltd.'], ['S002', 'Beta Vet Pharma Co., Ltd.'],
                  ['H002', 'Beta Vet Pharma (legacy code)'], ['S003', 'Gamma Pet Accessories'],
                  ['S004', 'Delta Litter & Hygiene']] }),
    'purchase_DEMO2_2026-08.csv': generatePurchases(rand, {
      company: 'DEMO2', docs: 15, locations: ['HQ-STORE'],
      suppliers: [['S900', COMPANY.DEMO], ['S900', COMPANY.DEMO], ['S004', 'Delta Litter & Hygiene']] }),
  };

  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const billSat = bills => sum(bills.flatMap(b => b.lines.map(l => l.amountSat)));
  const expected = {
    DEMO:  { sales: billSat(demoBills) / 100,  purchase: files['purchase_DEMO_2026-08.csv'].totalSat / 100 },
    DEMO2: { sales: billSat(demo2Bills) / 100, purchase: files['purchase_DEMO2_2026-08.csv'].totalSat / 100 },
  };

  const wrongReport = [
    [COMPANY.DEMO, '', 'รายงานสรุปยอดขายรายบิล', '', ''],
    ['วันที่', 'เลขที่บิล', 'พนักงาน', 'จำนวน', 'ยอดสุทธิ'],
    ['01/08/2569', '0001-2608-00001', 'cashier01', 3, '1027.00'],
  ];

  return { files, expected, wrongReport };
}

function main() {
  const dir = path.join(__dirname, '..', 'samples');
  fs.mkdirSync(path.join(dir, 'bad'), { recursive: true });
  const { files, expected, wrongReport } = generateAll();
  for (const [name, f] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), '﻿' + toCsv(f.rows));
    console.log(`wrote samples/${name} (${f.rows.length} rows)`);
  }
  fs.writeFileSync(path.join(dir, 'bad', 'sales_summary_wrong_report.csv'), '﻿' + toCsv(wrongReport));
  fs.writeFileSync(path.join(dir, 'expected_totals.json'), JSON.stringify(expected, null, 2) + '\n');
  console.log('expected totals:', expected);
}

if (require.main === module) main();
module.exports = { generateAll, mulberry32 };
