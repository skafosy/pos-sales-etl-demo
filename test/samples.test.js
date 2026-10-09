'use strict';

/**
 * End-to-end without a database: generate the sample reports, serialise them
 * to CSV, parse them back with the real parsers, and check that the totals
 * equal what the generator knows it wrote — including the overlapping export.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateAll } = require('../scripts/generate-samples');
const { parseCsv, toCsv } = require('../src/csv');
const { parseSalesReport } = require('../src/parsers/sales');
const { parsePurchaseReport } = require('../src/parsers/purchase');

const { files, expected, wrongReport } = generateAll();
const roundTrip = name => parseCsv('﻿' + toCsv(files[name].rows));

test('generator is deterministic', () => {
  assert.deepEqual(generateAll().expected, expected);
});

test('DEMO sales: two overlapping exports dedupe to the true month total', () => {
  // Same rule as the loader: a later file replaces every bill it contains.
  const part2Bills = new Set(parseSalesReport(roundTrip('sales_DEMO_2026-08_part2.csv')).lines.map(l => l.bill_no));
  const final = [
    ...parseSalesReport(roundTrip('sales_DEMO_2026-08_part1.csv')).lines.filter(l => !part2Bills.has(l.bill_no)),
    ...parseSalesReport(roundTrip('sales_DEMO_2026-08_part2.csv')).lines,
  ];
  const satang = final.reduce((s, l) => s + Math.round(l.amount * 100), 0);
  assert.equal(satang / 100, expected.DEMO.sales);
});

test('DEMO2 sales use Excel serial dates and still land on the right days', () => {
  const r = parseSalesReport(roundTrip('sales_DEMO2_2026-08.csv'));
  assert.equal(r.stats.amount, expected.DEMO2.sales);
  const days = new Set(r.lines.map(l => l.sales_date));
  assert.equal(days.size, 31);
  assert.ok([...days].every(d => d.startsWith('2026-08-')));
});

test('purchase files parse with zero total mismatches', () => {
  for (const [company, name] of [['DEMO', 'purchase_DEMO_2026-08.csv'], ['DEMO2', 'purchase_DEMO2_2026-08.csv']]) {
    const r = parsePurchaseReport(roundTrip(name));
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.stats.amount, expected[company].purchase);
  }
});

test('the wrong-report sample is rejected', () => {
  assert.throws(() => parseSalesReport(wrongReport), /no member column/);
});
