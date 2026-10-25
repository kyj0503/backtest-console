import { useState, useCallback, useRef, useEffect } from 'react';
import { BacktestService } from '../services/backtestService';
import { extractErrorMessage } from '@/shared/api/client';
import type { BacktestRequest, UnifiedBacktestResponse, MarketData, MarketDataResponses, MarketDataSection } from '../model/types/api-types';
import type { PortfolioData, SupplementalSection } from '../model/types/backtest-result-types';

export const MARKET_SECTIONS: MarketDataSection[] = ['prices', 'exchangeRates', 'benchmarks', 'news'];
export interface MarketReadState {
  phase: 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'skipped';
  error: string | null;
}
export type MarketReadStates = Record<MarketDataSection, MarketReadState>;
const statusFields: Record<MarketDataSection, SupplementalSection[]> = {
  prices: ['ticker_info', 'stock_data', 'volatility_events'],
  exchangeRates: ['exchange_rates'], benchmarks: ['benchmarks'], news: ['news'],
};
const initialReads = (): MarketReadStates => ({
  prices: { phase: 'idle', error: null }, exchangeRates: { phase: 'idle', error: null },
  benchmarks: { phase: 'idle', error: null }, news: { phase: 'idle', error: null },
});

// Only this resource's fields may change. In particular, later GET responses
// cannot overwrite another GET's data or any simulation output.
function mergeRead(portfolio: PortfolioData, section: MarketDataSection, data: MarketData): PortfolioData {
  let fields: Partial<PortfolioData>;
  switch (section) {
    case 'prices': {
      const prices = data as MarketDataResponses['prices'];
      fields = {
        ticker_info: prices.ticker_info ?? portfolio.ticker_info,
        stock_data: prices.stock_data ?? portfolio.stock_data,
        volatility_events: prices.volatility_events ?? portfolio.volatility_events,
      };
      break;
    }
    case 'exchangeRates': {
      const exchange = data as MarketDataResponses['exchangeRates'];
      fields = { exchange_rates: exchange.exchange_rates ?? portfolio.exchange_rates,
        exchange_stats: exchange.exchange_stats ?? portfolio.exchange_stats };
      break;
    }
    case 'benchmarks': {
      const benchmarks = data as MarketDataResponses['benchmarks'];
      const statistics = { ...portfolio.portfolio_statistics };
      delete statistics.sp500_total_return_pct;
      delete statistics.alpha_vs_sp500_pct;
      const value = benchmarks.sp500_total_return_pct;
      if (typeof value === 'number' && Number.isFinite(value)) {
        statistics.sp500_total_return_pct = value;
        statistics.alpha_vs_sp500_pct = statistics.Total_Return - value;
      }
      fields = { sp500_benchmark: benchmarks.sp500_benchmark ?? portfolio.sp500_benchmark,
        nasdaq_benchmark: benchmarks.nasdaq_benchmark ?? portfolio.nasdaq_benchmark,
        portfolio_statistics: statistics };
      break;
    }
    case 'news':
      fields = { latest_news: (data as MarketDataResponses['news']).latest_news ?? portfolio.latest_news };
  }
  const statuses = { ...portfolio.supplemental_status };
  for (const key of statusFields[section]) {
    const status = data.supplemental_status?.[key];
    if (status) statuses[key] = status;
  }
  return { ...portfolio, ...fields, supplemental_status: statuses };
}

export function useBacktest() {
  const [lastRequest, setLastRequest] = useState<BacktestRequest | null>(null);
  const [result, setResult] = useState<UnifiedBacktestResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketReads, setMarketReads] = useState<MarketReadStates>(initialReads);
  const activeControllerRef = useRef<AbortController | null>(null);
  const readControllers = useRef<Partial<Record<MarketDataSection, AbortController>>>({});

  const abortCurrent = useCallback(() => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    for (const controller of Object.values(readControllers.current)) controller?.abort();
    readControllers.current = {};
  }, []);

  const loadSection = useCallback(async (
    section: MarketDataSection, request: BacktestRequest, symbols: string[], run: AbortController,
  ) => {
    if (!symbols.length && (section === 'prices' || section === 'news')) {
      setMarketReads(current => ({ ...current, [section]: { phase: 'skipped', error: null } }));
      return;
    }
    readControllers.current[section]?.abort();
    const controller = new AbortController();
    readControllers.current[section] = controller;
    const isCurrent = () => activeControllerRef.current === run && readControllers.current[section] === controller;
    setMarketReads(current => ({ ...current, [section]: { phase: 'loading', error: null } }));
    try {
      const data = await BacktestService.loadMarketData(section, request, symbols, controller.signal);
      if (!isCurrent()) return;
      setResult(current => {
        if (activeControllerRef.current !== run || !current || !('portfolio_statistics' in current.data)) return current;
        return { ...current, data: mergeRead(current.data, section, data) };
      });
      const outcomes = statusFields[section].map(key => data.supplemental_status?.[key]);
      const failed = outcomes.some(outcome => outcome === 'error' || outcome === 'timeout');
      const primary = section === 'prices' ? data.supplemental_status?.stock_data : outcomes[0];
      setMarketReads(current => ({ ...current, [section]: {
        phase: failed ? 'error' : primary === 'empty' ? 'empty' : 'success',
        error: failed ? '일부 자료를 불러오지 못했습니다. 다시 시도해 주세요.' : null,
      } }));
    } catch (err) {
      if (isCurrent() && !controller.signal.aborted) {
        setMarketReads(current => ({ ...current, [section]: { phase: 'error', error: extractErrorMessage(err) } }));
      }
    } finally {
      if (isCurrent()) delete readControllers.current[section];
    }
  }, []);

  const runBacktest = useCallback(async (request: BacktestRequest) => {
    abortCurrent();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setLastRequest(request);
    setIsLoading(true);
    setMarketReads(initialReads());
    setError(null);
    try {
      const data = await BacktestService.executeBacktest({
        ...request, include_stock_data: false, include_volatility_events: false,
        include_exchange_rates: false, include_benchmarks: false, include_news: false,
      }, controller.signal);
      if (activeControllerRef.current === controller) {
        setResult(data);
        if ('portfolio_statistics' in data.data && Array.isArray(data.data.portfolio_composition)) {
          const symbols = data.data.portfolio_composition
            .filter(stock => stock.asset_type !== 'cash' && stock.symbol !== 'CASH').map(stock => stock.symbol);
          for (const section of MARKET_SECTIONS) void loadSection(section, request, symbols, controller);
        }
      }
      return data;
    } catch (err) {
      if (activeControllerRef.current === controller) {
        setError(extractErrorMessage(err));
        setResult(null);
      }
      throw err;
    } finally {
      if (activeControllerRef.current === controller) setIsLoading(false);
    }
  }, [abortCurrent, loadSection]);

  const retryMarketData = useCallback((section: MarketDataSection) => {
    const run = activeControllerRef.current;
    if (!result || !lastRequest || !run || isLoading || marketReads[section].phase === 'loading') return;
    if (!('portfolio_statistics' in result.data) || !Array.isArray(result.data.portfolio_composition)) return;
    const symbols = result.data.portfolio_composition
      .filter(stock => stock.asset_type !== 'cash' && stock.symbol !== 'CASH').map(stock => stock.symbol);
    void loadSection(section, lastRequest, symbols, run);
  }, [result, lastRequest, isLoading, marketReads, loadSection]);

  useEffect(() => abortCurrent, [abortCurrent]);
  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    abortCurrent();
    setResult(null);
    setLastRequest(null);
    setError(null);
    setIsLoading(false);
    setMarketReads(initialReads());
  }, [abortCurrent]);

  return { result, isLoading, error, runBacktest, clearError, reset, lastRequest, marketReads, retryMarketData };
}
