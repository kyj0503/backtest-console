import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import BenchmarkIndexChart from '../results/BenchmarkIndexChart';
import StockPriceChart from '../StockPriceChart';
import { buildPortfolioEquitySeries, buildBenchmarkSeries } from '../../hooks/charts/chartSeriesBuilders';
import { extractTradeLogs } from '../../utils/chartDataTransform';
import { generateCSVReport } from '../../services/reportGenerator';
import { makePortfolioData } from '@/test/fixtures/backtestResults';
import type { AggregationType } from '@/shared/utils/dataSampling';

// Capture the data actually supplied by the components to the chart renderer.
vi.mock('recharts', () => {
  const chart = ({ data, children }: { data: unknown; children?: ReactNode }) => <div data-testid="chart" data-rows={JSON.stringify(data)}>{children}</div>;
  const empty = () => null;
  return { LineChart: chart, ComposedChart: chart, ResponsiveContainer: ({children}: {children: ReactNode}) => <>{children}</>,
    Line: empty, XAxis: empty, YAxis: empty, CartesianGrid: empty,
    Tooltip: ({content}: {content?: (props: {active: boolean; label: number}) => ReactNode}) =>
      <>{typeof content === 'function' ? content({active: true, label: Date.parse('2023-01-11')}) : null}</>,
    Legend: empty, Scatter: empty };
});
function rows(container: HTMLElement): Array<Record<string, number | string>> {
  return JSON.parse(container.querySelector('[data-rows]')!.getAttribute('data-rows')!);
}

describe('S01–S06 independent chart/export accounting', () => {
  it.each<[number, AggregationType]>([[40,'daily'],[400,'daily'],[800,'weekly'],[2000,'monthly']])(
    'S02/S03 compounds first cost and first gain for %i observations (%s)', (n, aggregation) => {
      const dates = Array.from({length:n}, (_,i) => new Date(Date.UTC(2020,0,2+i)).toISOString().slice(0,10));
      const data = makePortfolioData({
        equity_curve: Object.fromEntries(dates.map((d,i)=>[d,10000/1.01*(i ? 1.2 : 1)])),
        daily_returns: Object.fromEntries(dates.map((d,i)=>[d,i===0 ? (1/1.01-1)*100 : i===1 ? 20 : 0])),
        sp500_benchmark: dates.map((date,i)=>({date,close:i ? 120 : 100,return_pct:i===1 ? 20 : 0})),
      });
      const portfolio = buildPortfolioEquitySeries(data,dates[0],dates[n-1],aggregation);
      const benchmark = buildBenchmarkSeries(data,'sp500',dates[0],dates[n-1],aggregation);
      const {container} = render(<BenchmarkIndexChart portfolioEquityData={portfolio} sp500Data={benchmark} nasdaqData={[]} />);
      const last = rows(container).slice(-1)[0]!;
      expect(last.portfolio).toBeCloseTo(120/1.01,9);
      expect(last.sp500).toBeCloseTo(120,9);
      cleanup();
    },
  );

  it.each<AggregationType>(['daily','weekly','monthly'])('S04 keeps exact executions between %s samples and multiple same-day fills', aggregation => {
    const logs = extractTradeLogs({TEST:{trade_log:[
      {EntryTime:'2023-01-11T00:00:00',EntryPrice:97,ExitTime:'2023-01-12',ExitPrice:101,Size:1},
      {Type:'BUY',EntryTime:'2023-01-11',EntryPrice:98,Size:2},
    ],open_positions:[{EntryTime:'2023-01-13',EntryPrice:99,Size:3}]}});
    const {container}=render(<StockPriceChart aggregationType={aggregation} tradeLogs={logs} stocksData={[{symbol:'TEST',data:[
      {date:'2023-01-09',price:100},{date:'2023-01-16',price:110},
    ]}]} />);
    expect(rows(container).filter(p=>p.buySignal).map(p=>[p.date,p.buySignal])).toEqual([
      ['2023-01-11',97],['2023-01-11',98],['2023-01-13',99],
    ]);
    expect(rows(container).filter(p=>p.sellSignal).map(p=>[p.date,p.sellSignal])).toEqual([['2023-01-12',101]]);
    expect(rows(container).filter(p=>p.price)).toHaveLength(2);
    expect(container.textContent).toContain('날짜: 2023-01-11');
    expect(container.textContent).toContain('매수: $97.00');
    expect(container.textContent).toContain('매수: $98.00');
    cleanup();
  });

  it('S04 preserves native price metadata for an open KRW position', () => {
    const tradeLogs=extractTradeLogs({TEST:{open_positions:[{EntryTime:'2023-01-11',EntryPrice:97,EntryPriceNative:97000,PriceCurrency:'USD',NativeCurrency:'KRW',Size:1}]}});
    const {container}=render(<StockPriceChart tradeLogs={tradeLogs} tickerInfo={{TEST:{symbol:'TEST',currency:'KRW',company_name:'test',exchange:'test'}}}
      stocksData={[{symbol:'TEST',data:[{date:'2023-01-09',price:100000},{date:'2023-01-16',price:110000}]}]} />);
    expect(rows(container).find(p=>p.buySignal)?.buySignal).toBe(97000);
    expect(container.textContent).toContain('매수: ₩97,000');
    cleanup();
  });

  it('S05 includes assets missing from the first weight row in CSV', () => {
    const data=makePortfolioData({weight_history:[{date:'2023-01-01'},{date:'2023-01-02',AAPL:0.6,MSFT:0.4,LATE:0}]});
    const csv=generateCSVReport(data,true);
    expect(csv).toContain('날짜,AAPL,MSFT,LATE');
    expect(csv).toContain('2023-01-02,60.00%,40.00%,0.00%');
  });

  it('S06 exports each actual commission and does not invent an allocation when missing', () => {
    const data=makePortfolioData({rebalance_history:[{date:'2023-01-09',weights_before:{},weights_after:{},commission_cost:16.50165016,trades:[
      {symbol:'A',action:'sell',shares:10,price:83.3333333,commission:8.33333333},
      {symbol:'B',action:'buy',shares:10,price:81.6831683,commission:8.16831683},
      {symbol:'C',action:'buy',shares:1,price:1},
      {symbol:'CASH',action:'increase',amount:1,price:1,commission:0},
    ]}]});
    const lines=generateCSVReport(data,true).split('\n').filter(line=>line.startsWith('2023-01-09,'));
    expect(lines.map(line=>line.split(',').slice(-1)[0])).toEqual(['8.33','8.17','N/A','0.00']);
    expect(8.33+8.17).toBeCloseTo(16.50165016,2);
  });
});
