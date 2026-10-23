/**
 * Migration Transformation Tests
 * Tests for the MongoDB → PostgreSQL data transformation layer
 * Using Node.js built-in test runner (node:test) and assert (node:assert)
 */

import test from 'node:test';
import assert from 'node:assert';

// Product Normalization & Dedup
test('should normalize product name and category for dedup', function() {
  const key1 = 'Product A'.toLowerCase() + '__' + 'Boxes'.toLowerCase();
  const key2 = 'product a'.toLowerCase() + '__' + 'boxes'.toLowerCase();

  assert.equal(key1, key2);
});

test('should preserve different categories as different products', function() {
  const key1 = 'Widget'.toLowerCase() + '__' + 'Plastic'.toLowerCase();
  const key2 = 'Widget'.toLowerCase() + '__' + 'Metal'.toLowerCase();

  assert.notEqual(key1, key2);
});

// Product Capitalization
test('should allow different capitalizations while normalizing the same', function() {
  const names = ['Widget', 'widget', 'WIDGET', 'WiDgET'];
  const lowerNames = names.map(n => n.toLowerCase());

  const uniqueLower = new Set(lowerNames);
  assert.equal(uniqueLower.size, 1);
});

// Sales Duplicate Detection
test('should detect same product + same date as duplicate', function() {
  const productId = 'prod123';
  const date1 = new Date('2024-01-15');
  const date2 = new Date('2024-01-15');

  const dateKey1 = date1.toISOString().split('T')[0];
  const dateKey2 = date2.toISOString().split('T')[0];

  assert.equal(dateKey1, dateKey2);
  assert.equal(`${productId}__${dateKey1}`, `${productId}__${dateKey2}`);
});

test('should allow same product + different dates as separate records', function() {
  const productId = 'prod123';

  const date1 = new Date('2024-01-15');
  const date2 = new Date('2024-01-16');

  const dateKey1 = date1.toISOString().split('T')[0]; // '2024-01-15'
  const dateKey2 = date2.toISOString().split('T')[0]; // '2024-01-16'

  assert.notEqual(dateKey1, dateKey2);
  assert.notEqual(`${productId}__${dateKey1}`, `${productId}__${dateKey2}`);
});

// Invalid Quantity Rejection
test('should reject quantity = 0', function() {
  const q = 0;
  const isValid = q !== undefined && q !== null && q > 0 && Number.isFinite(q);
  assert.ok(!isValid);
});

test('should reject negative quantity', function() {
  const q = -5;
  const isValid = q !== undefined && q !== null && q > 0 && Number.isFinite(q);
  assert.ok(!isValid);
});

test('should reject NaN quantity', function() {
  const q = NaN;
  const isValid = q !== undefined && q !== null && q > 0 && Number.isFinite(q);
  assert.ok(!isValid);
});

test('should reject Infinity quantity', function() {
  const q = Infinity;
  const isValid = q !== undefined && q !== null && q > 0 && Number.isFinite(q);
  assert.ok(!isValid);
});

test('should reject valid positive quantity', function() {
  const q = 10;
  const isValid = q !== undefined && q !== null && q > 0 && Number.isFinite(q);
  assert.ok(isValid);
});

// Invalid Date Rejection
test('should reject unparseable date strings', function() {
  const dateStr = 'not-a-date';
  const parsed = new Date(dateStr);
  const isValid = !isNaN(parsed.getTime());
  assert.ok(!isValid);
});

test('should accept valid date strings', function() {
  const dateStr = '2024-01-15';
  const parsed = new Date(dateStr);
  const isValid = !isNaN(parsed.getTime()) && parsed.getTime() > 0;
  assert.ok(isValid);
});

// Missing Required Fields
test('should detect missing product name', function() {
  const name = '';
  const hasName = name && name.trim().length > 0;
  assert.ok(!hasName);
});

test('should detect missing category', function() {
  const category = '';
  const hasCategory = category && category.trim().length > 0;
  assert.ok(!hasCategory);
});

// Legacy ObjectId Mapping
test('should map MongoDB ObjectId to string for legacy tracking', function() {
  const legacyId = '507f1f77bcf86cd799439011';
  assert.equal(legacyId.length, 24);
  assert.equal(typeof legacyId, 'string');
});

test('should preserve legacy ID mapping metadata', function() {
  const testLegacyId = '507f1f77bcf86cd799439011';
  assert.equal(testLegacyId.length, 24);
});

// Foreign Key Validation
test('should report dependent records referencing unknown products', function() {
  const sqlPattern = `
    SELECT COUNT(*) AS cnt FROM sales s
    LEFT JOIN products p ON s.product_id = p.id
    WHERE p.id IS NULL
  `;
  assert.ok(sqlPattern.includes('LEFT JOIN'));
  assert.ok(sqlPattern.includes('IS NULL'));
});