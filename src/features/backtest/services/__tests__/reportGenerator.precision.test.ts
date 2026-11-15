import { describe, expect, it } from 'vitest';
import { makePortfolioData } from '@/test/fixtures/backtestResults';
import { generateCSVReport } from '../reportGenerator';

describe('T05 CSV round-trip ledger precision', () => {
  it.each([0.00000001, 0.0001, 1, 10000, 100000000])('preserves a $50 sale when the price unit is scaled by %s', scale => {
    // $100 stock + $100 cash -> stock doubles -> sell $50 to restore 50:50.
    const shares = 0.000025 / scale, price = 2000000 * scale;
    const data = makePortfolioData({ rebalance_history: [{ date:'2023-01-09', weights_before:{}, weights_after:{}, commission_cost:0,
      trades:[{symbol:'HIGH', action:'sell', shares, price, commission:0}] }] });
    const row = generateCSVReport(data,true).split('\n').find(line => line.startsWith('2023-01-09,HIGH,'))!.split(',');
    expect(Number(row[4])).toBe(shares);
    expect(Number(row[5])).toBe(price);
    expect(Number(row[4])).toBeGreaterThan(0);
    expect(Number(row[4])*Number(row[5])).toBeCloseTo(50,10);
    expect(Number(row[3])).toBe(50);
    expect(Number(row[6])).toBe(0);
  });
});
