import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber } from '../src/presentation/number-format.ts';

test('scientific and engineering number formats preserve magnitude',()=>{
  assert.equal(formatNumber(1230000000000,2,'scientific'),'1.23e+12');
  assert.equal(formatNumber(1230000000000,2,'engineering'),'1.23e+12');
  assert.equal(formatNumber(1234,2,'engineering'),'1.23e+3');
});
test('short scale suffix format covers K through Qi and larger groups',()=>{
  assert.equal(formatNumber(1200,2,'suffix','en-US'),'1.20K');
  assert.equal(formatNumber(1.2e6,2,'suffix','en-US'),'1.20M');
  assert.equal(formatNumber(1.2e9,2,'suffix','en-US'),'1.20B');
  assert.equal(formatNumber(1.2e12,2,'suffix','en-US'),'1.20T');
  assert.equal(formatNumber(1.2e15,2,'suffix','en-US'),'1.20Qa');
  assert.equal(formatNumber(1.2e18,2,'suffix','en-US'),'1.20Qi');
  assert.equal(formatNumber(1.2e21,2,'suffix','en-US'),'1.20Sx');
});
test('full number format uses locale grouping and invalid values remain safe',()=>{
  assert.equal(formatNumber(1234567,0,'full','en-US'),'1,234,567');
  assert.equal(formatNumber(Number.NaN,2,'suffix'),'—');
});
