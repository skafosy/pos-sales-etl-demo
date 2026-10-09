'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSalesReport } = require('../src/parsers/sales');

const BANNER = ['บริษัท เดโม่ เพ็ท ซัพพลาย จำกัด', '', 'รายงานรายละเอียดการขาย'];
const HEADER = ['วันที่', 'เลขที่บิล', 'สมาชิก', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'ยอดสุทธิ'];

test('skips page banners, repeated headers and subtotal rows', () => {
  const rows = [
    BANNER, HEADER,
    ['01/08/2569', '0001-2608-00001', 'W0001', '885A', 'Item A', '2', '100.10'],
    ['01/08/2569', '0001-2608-00001', 'W0001', '885B', 'Item B', '1', '0.20'],
    ['รวมวันที่ 01/08/2569', '', '', '', '', '3', '100.30'],
    [],
    BANNER, HEADER,
    ['02/08/2569', '0003-2608-00001', '', '885A', 'Item A', '1', '1,250.00'],
  ];
  const r = parseSalesReport(rows);
  assert.equal(r.lines.length, 3);
  assert.equal(r.stats.bills, 2);
  assert.equal(r.stats.amount, 1350.3);               // no float drift (satang sums)
  assert.equal(r.lines[2].member_code, null);
  assert.equal(r.lines[2].sales_date, '2026-08-02');
  assert.equal(r.companyName, BANNER[0]);
});

test('finds columns by label even if the ERP reorders them', () => {
  const rows = [
    ['ยอดสุทธิ', 'จำนวน', 'รหัสสินค้า', 'สมาชิก', 'เลขที่บิล', 'วันที่'],
    ['99.00', '1', '885A', 'R0001', '0002-2608-00009', '46253'],
  ];
  const [l] = parseSalesReport(rows).lines;
  assert.deepEqual(
    { bill: l.bill_no, date: l.sales_date, amount: l.amount, member: l.member_code },
    { bill: '0002-2608-00009', date: '2026-08-19', amount: 99, member: 'R0001' });
});

test('refuses the summary report (no member column) with an explanation', () => {
  const rows = [BANNER, ['วันที่', 'เลขที่บิล', 'พนักงาน', 'จำนวน', 'ยอดสุทธิ'],
                ['01/08/2569', '0001-2608-00001', 'cashier01', '3', '1027.00']];
  assert.throws(() => parseSalesReport(rows), /no member column/);
});

test('no header at all', () => {
  assert.throws(() => parseSalesReport([['hello'], ['world']]), /header row/);
});
