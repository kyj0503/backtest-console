import { describe, expect, it } from 'vitest';
import { calculateDcaSchedule } from '../calculateDcaPeriods';
import { recalcAmountsByWeight } from '../../model/backtestFormReducer';
import { aggregateReturns } from '@/shared/utils/dataSampling/returnAggregation';
import { generateCSVReport } from '../../services/reportGenerator';
import { makePortfolioData } from '@/test/fixtures/backtestResults';

describe('independent financial regression cases', () => {
  it('uses calendar deposits, preserving the original fifth weekday after clamping', () => {
    expect(calculateDcaSchedule('2024-01-31', '2024-04-30', 'monthly_1'))
      .toEqual(['2024-01-31', '2024-02-28', '2024-03-27', '2024-04-24']);
    expect(calculateDcaSchedule('2024-01-31', '2024-05-31', 'monthly_2'))
      .toEqual(['2024-01-31', '2024-03-27', '2024-05-29']);
    expect(calculateDcaSchedule('2023-01-02', '2023-10-31', 'monthly_1'))
      .toEqual(['2023-01-02','2023-02-06','2023-03-06','2023-04-03','2023-05-01','2023-06-05','2023-07-03','2023-08-07','2023-09-04','2023-10-02']);
  });

  it('keeps the exact budget and carries the fractional installment remainder', () => {
    const stocks = recalcAmountsByWeight([
      {symbol:'A', amount:0, weight:33.33, investmentType:'dca', dcaFrequency:'monthly_1'},
      {symbol:'B', amount:0, weight:66.67, investmentType:'lump_sum'},
    ], 1000, '2023-01-02', '2023-03-31');
    expect(stocks.map(s => s.totalAmount)).toEqual([333.3, 666.7]);
    expect(stocks[0]!.amount).toBe(111.1);
    const [single] = recalcAmountsByWeight([{symbol:'A',amount:0,weight:100,investmentType:'dca',dcaFrequency:'monthly_1'}],1000,'2023-01-02','2023-03-31');
    expect(single!.amount).toBe(333.33);
    expect(single!.totalAmount).toBe(1000);
  });

  it('aligns daily-market and business-day series to the same calendar weeks', () => {
    const daily = Array.from({length:21}, (_, i) => {
      const date = new Date(Date.UTC(2023,0,2+i));
      return {date:date.toISOString().slice(0,10),return_pct:[0,6].includes(date.getUTCDay()) ? 0 : 1};
    });
    const business = daily.filter(d => d.return_pct !== 0);
    const a = aggregateReturns(business,'weekly');
    const b = aggregateReturns(daily,'weekly');
    expect(a.map(d=>d.date)).toEqual(['2023-01-08','2023-01-15','2023-01-22']);
    expect(a).toEqual(b);
    for (const point of a) expect(point.return_pct).toBeCloseTo(5.10100501,9);
    expect(aggregateReturns(daily.slice(0,3),'weekly','2023-01-04')[0]!.date).toBe('2023-01-04');
  });

  it('quotes grouped numbers and names containing commas, quotes and newlines in CSV', () => {
    const data = makePortfolioData();
    data.portfolio_composition[0]!.symbol = '현금,"보유"\n예금';
    const csv = generateCSVReport(data,true);
    expect(csv).toContain('최종 자산가치,"$10,700"');
    expect(csv).toContain('"현금,""보유""\n예금"');
  });
});
