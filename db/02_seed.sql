-- ===========================================================================
-- Reference data — fictional companies, suppliers and products.
-- ===========================================================================

INSERT INTO companies (code, name, name_match) VALUES
  ('DEMO',  'บริษัท เดโม่ เพ็ท ซัพพลาย จำกัด', 'เดโม่ เพ็ท'),
  ('DEMO2', 'บริษัท ตัวอย่าง เพ็ท เทรด จำกัด',  'ตัวอย่าง เพ็ท')
ON CONFLICT (code) DO NOTHING;

INSERT INTO suppliers (code, name) VALUES
  ('S001', 'Alpha Pet Foods Co., Ltd.'),
  ('S002', 'Beta Vet Pharma Co., Ltd.'),
  ('H002', 'Beta Vet Pharma (legacy code)'),
  ('S003', 'Gamma Pet Accessories'),
  ('S004', 'Delta Litter & Hygiene'),
  ('S900', 'บริษัท เดโม่ เพ็ท ซัพพลาย จำกัด')      -- DEMO, as a supplier of DEMO2
ON CONFLICT (code) DO NOTHING;

INSERT INTO supplier_alias (code, canonical_code, canonical_name) VALUES
  ('S002', 'S002', 'Beta Vet Pharma (group)'),
  ('H002', 'S002', 'Beta Vet Pharma (group)')
ON CONFLICT (code) DO NOTHING;

-- Note: S900 *and* its canonical code could both be flagged one day; the views
-- use EXISTS, not a JOIN, so double flags can never duplicate rows.
INSERT INTO supplier_flags (code, is_affiliate) VALUES ('S900', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO products (barcode, name, unit, supplier_code) VALUES
  ('8850000000011', 'Alpha Adult Dog 3kg',          'bag',  'S001'),
  ('8850000000028', 'Alpha Puppy 1.5kg',            'bag',  'S001'),
  ('8850000000035', 'Alpha Cat Indoor 1.2kg',       'bag',  'S001'),
  ('8850000000042', 'Alpha Wet Tuna 85g',           'pcs',  'S001'),
  ('8850000000059', 'Beta Flea Drops Small',        'box',  'S002'),
  ('8850000000066', 'Beta Flea Drops Large',        'box',  'S002'),
  ('8850000000073', 'Beta Dewormer Tablet',         'tab',  'H002'),
  ('8850000000080', 'Beta Joint Chew 60s',          'jar',  'H002'),
  ('8850000000097', 'Gamma Leash Nylon',            'pcs',  'S003'),
  ('8850000000103', 'Gamma Bowl Steel M',           'pcs',  'S003'),
  ('8850000000110', 'Gamma Cat Toy Feather',        'pcs',  'S003'),
  ('8850000000127', 'Delta Clumping Litter 10L',    'bag',  'S004'),
  ('8850000000134', 'Delta Pee Pad 50s',            'pack', 'S004'),
  ('2000000000017', 'Grooming service',             'job',  NULL)   -- no supplier by nature
ON CONFLICT (barcode) DO NOTHING;

INSERT INTO wholesale_members (member_code) VALUES
  ('W0001'), ('W0002'), ('W0003'), ('W0004'), ('W0005')
ON CONFLICT DO NOTHING;

-- DEMO: terminal 0004 moved from HQ to BRANCH-B on 2026-08-16.
-- DEMO2 reuses prefix 0003 but has no branches — it must not inherit DEMO's map.
INSERT INTO branch_prefix (company, prefix, branch, valid_from, valid_to) VALUES
  ('DEMO',  '0001', 'HQ',       DATE '2000-01-01', NULL),
  ('DEMO',  '0002', 'HQ',       DATE '2000-01-01', NULL),
  ('DEMO',  '0003', 'BRANCH-A', DATE '2000-01-01', NULL),
  ('DEMO',  '0004', 'HQ',       DATE '2000-01-01', DATE '2026-08-16'),
  ('DEMO',  '0004', 'BRANCH-B', DATE '2026-08-16', NULL),
  ('DEMO2', '0003', 'HQ',       DATE '2000-01-01', NULL)
ON CONFLICT DO NOTHING;
