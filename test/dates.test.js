'use strict';

// Must be set before any Date is created in this process.
process.env.TZ = 'Asia/Bangkok';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, excelSerialToIso, naiveExcelSerialToLocalDate, snapLocalDateToIso } = require('../src/dates');

const SERIAL_2026_08_19 = 46253;

test('regression: naive Excel-serial conversion drifts in Asia/Bangkok (LMT +06:42:04 in 1899)', () => {
  const d = naiveExcelSerialToLocalDate(SERIAL_2026_08_19);
  const drift = d.getHours() * 60 + d.getMinutes();
  assert.notEqual(drift, 0, 'naive conversion should NOT land on midnight — that is the bug');
  assert.ok(Math.abs(drift - 18) <= 1 || Math.abs(drift - (24 * 60 - 18)) <= 1,
    `expected ~18 minutes of drift, got ${d.toString()}`);
});

test('excelSerialToIso is time-zone independent', () => {
  assert.equal(excelSerialToIso(SERIAL_2026_08_19), '2026-08-19');
  assert.equal(parseDate(SERIAL_2026_08_19), '2026-08-19');
  assert.equal(parseDate('46253'), '2026-08-19');
});

test('drifted Date objects snap back to the intended day', () => {
  // What a spreadsheet library produced for 19/08: 18/08 23:42:04 local time.
  assert.equal(snapLocalDateToIso(new Date(2026, 7, 18, 23, 42, 4)), '2026-08-19');
  // The opposite drift stays on the same day.
  assert.equal(snapLocalDateToIso(new Date(2026, 7, 19, 0, 17, 56)), '2026-08-19');
  // A real afternoon timestamp is untouched.
  assert.equal(snapLocalDateToIso(new Date(2026, 7, 19, 15, 30)), '2026-08-19');
});

test('text dates: Gregorian, Buddhist era, ISO', () => {
  assert.equal(parseDate('19/08/2026'), '2026-08-19');
  assert.equal(parseDate('19/08/2569'), '2026-08-19');
  assert.equal(parseDate('2026-08-19'), '2026-08-19');
  assert.equal(parseDate(' 1/8/2569 '), '2026-08-01');
});

test('invalid input returns null instead of a wrong date', () => {
  for (const v of ['', null, undefined, '31/02/2026', 'yesterday', '2026-13-01', -5]) {
    assert.equal(parseDate(v), null, `input ${JSON.stringify(v)}`);
  }
});
