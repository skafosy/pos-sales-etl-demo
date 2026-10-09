'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePurchaseReport } = require('../src/parsers/purchase');
const { assertCompany } = require('../src/parsers/common');

const rows = [
  ['บริษัท เดโม่ เพ็ท ซัพพลาย จำกัด', '', 'รายงานรายละเอียดใบรับสินค้า ตามเอกสาร'],
  ['01/08/2569', 'RR2608/0001', 'S001', 'Alpha Pet Foods Co., Ltd.'],
  ['8850000000011', 'Alpha Adult Dog 3kg', 'bag', '24', '0', '8280.00', 'HQ-STORE'],
  ['8850000000028', 'Alpha Puppy 1.5kg', 'bag', '0', '6', '0.00', 'BR-A'],      // free goods
  ['รวม เอกสาร', 'RR2608/0001', '', '24', '6', '8280.00'],
  ['02/08/2569', 'RR2608/0002', 'S003', 'Gamma Pet Accessories'],
  ['8850000000097', 'Gamma Leash Nylon', 'pcs', '12', '0', '1320.00', 'BR-B'],
  ['รวม เอกสาร', 'RR2608/0002', '', '12', '0', '1320.00'],
];

test('parses documents, keeps free-goods lines, captures location', () => {
  const r = parsePurchaseReport(rows);
  assert.equal(r.docs.length, 2);
  assert.equal(r.docs[0].lines.length, 2);
  assert.equal(r.docs[0].lines[1].free_qty, 6);
  assert.equal(r.docs[0].doc_date, '2026-08-01');
  assert.equal(r.stats.amount, 9600);
  assert.deepEqual(r.stats.locations, ['BR-A', 'BR-B', 'HQ-STORE']);
  assert.deepEqual(r.mismatches, []);
});

test('detects a document whose items do not add up to its total', () => {
  const broken = rows.map(r => [...r]);
  broken[4][5] = '8290.00';
  const r = parsePurchaseReport(broken);
  assert.deepEqual(r.mismatches, [{ doc_no: 'RR2608/0001', reported: 8290, parsed: 8280 }]);
});

const COMPANIES = [
  { code: 'DEMO', name_match: 'เดโม่ เพ็ท' },
  { code: 'DEMO2', name_match: 'ตัวอย่าง เพ็ท' },
];

test('wrong-company guard blocks a file that belongs to another company', () => {
  const name = parsePurchaseReport(rows).companyName;
  assert.equal(assertCompany(name, 'DEMO', COMPANIES), 'DEMO');
  assert.throws(() => assertCompany(name, 'DEMO2', COMPANIES), /belongs to .* \(DEMO\) but was imported as DEMO2/);
});

test('wrong-company guard fails open for unknown names', () => {
  assert.equal(assertCompany('บริษัท อื่น ๆ จำกัด', 'DEMO', COMPANIES), null);
  assert.equal(assertCompany('', 'DEMO', COMPANIES), null);
});
