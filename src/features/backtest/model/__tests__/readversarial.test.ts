import { describe, expect, it } from 'vitest';
import { backtestFormReducer, backtestFormHelpers, recalcAmountsByWeight } from '../backtestFormReducer';
import { initialBacktestFormState, type BacktestFormState, type Stock } from '../types/backtest-form-types';
import { validateBacktestForm } from '../../hooks/useFormValidation';
import { extractTradeLogs } from '../../utils/chartDataTransform';

const stock = (symbol: string, weight: number): Stock => ({symbol, weight, amount: 10000, assetType: 'stock', investmentType: 'lump_sum', dcaFrequency: 'monthly_1'});
const state = (portfolio: Stock[]): BacktestFormState => ({...initialBacktestFormState,
  portfolioInputMode: 'weight', totalInvestment: 10000,
  portfolio: recalcAmountsByWeight(portfolio, 10000, '2023-01-02', '2023-02-10'),
  dates: {startDate: '2023-01-02', endDate: '2023-02-10'},
  strategy: {selectedStrategy: 'buy_hold_strategy', strategyParams: {}},
  settings: {...initialBacktestFormState.settings, commission: 0, rebalanceFrequency: 'none'}});

describe('second adversarial financial regressions', () => {
  it('R04 refuses an added asset until its weight is specified; never doubles the budget', () => {
    let s=state([stock('A',100)]);
    s=backtestFormReducer(s,{type:'ADD_STOCK',payload:backtestFormHelpers.addStock()});
    s=backtestFormReducer(s,{type:'UPDATE_STOCK',payload:{index:1,field:'symbol',value:'B'}});
    expect(s.portfolio.reduce((a,b)=>a+(b.totalAmount??b.amount),0)).toBe(10000);
    expect(s.portfolio[1]?.amount).toBe(0);
    expect(validateBacktestForm(s)).toContain('비중 모드에서는 모든 종목의 비중을 0 초과 100% 이하로 입력해주세요.');
    s=backtestFormReducer(s,{type:'UPDATE_STOCK',payload:{index:0,field:'weight',value:50}});
    s=backtestFormReducer(s,{type:'UPDATE_STOCK',payload:{index:1,field:'weight',value:50}});
    expect(validateBacktestForm(s)).toEqual([]);
    expect(s.portfolio.map(a=>a.totalAmount)).toEqual([5000,5000]);
  });
  it('R04 reallocates the full budget after removal, including DCA exact totals', () => {
    let s=state([stock('A',5),stock('B',95)]);
    s=backtestFormReducer(s,{type:'REMOVE_STOCK',payload:0});
    expect(s.portfolio[0]?.totalAmount).toBe(10000);
    expect(validateBacktestForm(s)).toEqual([]);
    s=backtestFormReducer(s,{type:'UPDATE_STOCK',payload:{index:0,field:'investmentType',value:'dca'}});
    expect(s.portfolio[0]?.amount).toBe(5000);
    expect(s.portfolio[0]?.totalAmount).toBe(10000);
    expect(validateBacktestForm(s)).toEqual([]);
  });
  it('R04 rejects stale/inconsistent allocations at submission', () => {
    const s=state([stock('A',100)]);s.portfolio[0]!.totalAmount=9500;
    expect(validateBacktestForm(s)).toContain('종목별 예정 납입액의 합계가 전체 투자금액과 일치해야 합니다.');
  });
  it.each([[95,10],[50,45],[33.333,33.333,33.334]])('R08 preserves asset allocation under input permutation (%s)',(...weights) => {
    const p=weights.map((w,i)=>stock(String.fromCharCode(65+i),w));
    const allocate=(items:Stock[])=>Object.fromEntries(recalcAmountsByWeight(items,10000,'2023-01-02','2023-02-10').map(a=>[a.symbol,a.totalAmount]));
    expect(allocate(p)).toEqual(allocate([...p].reverse()));
    expect(Object.values(allocate(p)).reduce<number>((a,b)=>a+(b??0),0)).toBeCloseTo(10000,8);
  });
  it('R08 normalizes 95:10 and only rounds cents', () => {
    expect(state([stock('A',95),stock('B',10)]).portfolio.map(a=>a.totalAmount)).toEqual([9047.62,952.38]);
  });
  it('R07 includes open-position BUY once and never invents a SELL', () => {
    const position={EntryTime:'2023-01-05',EntryPrice:97,Size:96,MarketPrice:97,MarketValue:9312};
    const output=extractTradeLogs({TEST:{trade_log:[],open_positions:[position]}});
    expect(output.TEST).toEqual([{...position,Type:'BUY'}]);
    expect(extractTradeLogs({TEST:{trade_log:output.TEST,open_positions:[position]}})).toEqual(output);
  });
  it('R09 accepts two real calendar installments inside fewer than 60 days', () => {
    const s=state([stock('A',100)]);s.dates={startDate:'2023-01-30',endDate:'2023-03-29'};
    s.portfolio=[{...s.portfolio[0]!,investmentType:'dca',dcaFrequency:'monthly_2',amount:5000}];
    expect(validateBacktestForm(s)).toEqual([]);
    s.dates.endDate='2023-03-26';
    expect(validateBacktestForm(s)).toContain('A: 선택한 기간에 추가 DCA 납입일이 없습니다.');
  });
});
