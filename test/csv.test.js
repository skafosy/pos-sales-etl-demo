'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, toCsv } = require('../src/csv');

test('parses quotes, escaped quotes, commas and newlines inside quotes', () => {
  const rows = parseCsv('a,"b,c","say ""hi""","line1\nline2"\r\n1,2,3,4\n');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"', 'line1\nline2'], ['1', '2', '3', '4']]);
});

test('strips UTF-8 BOM and keeps Thai text', () => {
  assert.deepEqual(parseCsv('﻿วันที่,เลขที่บิล\n'), [['วันที่', 'เลขที่บิล']]);
});

test('round trip', () => {
  const rows = [['x', 'a,b', 'q"q', ''], ['ไทย', '1', '', 'z']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('unterminated quote is an error, not silent data loss', () => {
  assert.throws(() => parseCsv('a,"b\n'), /unterminated/);
});
