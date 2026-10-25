import { useState, useCallback, useRef, useEffect } from 'react';
import { BacktestService } from '../services/backtestService';
import { extractErrorMessage } from '@/shared/api/client';
import type { BacktestRequest, UnifiedBacktestResponse } from '../model/types/api-types';
import type { PortfolioData } from '../model/types/backtest-result-types';

export function useBacktest() {
  const [lastRequest, setLastRequest] = useState<BacktestRequest | null>(null);
  const [result, setResult] = useState<UnifiedBacktestResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupplementalLoading, setIsSupplementalLoading] = useState(false);
  const [supplementalError, setSupplementalError] = useState<string | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const loadSupplemental = useCallback(async (
    request: BacktestRequest, core: UnifiedBacktestResponse, controller: AbortController,
  ) => {
    if (!('portfolio_statistics' in core.data) || !Array.isArray(core.data.portfolio_composition)) return;
    const portfolio = core.data as PortfolioData;
    setIsSupplementalLoading(true);
    setSupplementalError(null);
    try {
      const symbols = portfolio.portfolio_composition
        .filter(stock => stock.asset_type !== 'cash' && stock.symbol !== 'CASH')
        .map(stock => stock.symbol);
      const data = await BacktestService.loadMarketData(request, symbols, controller.signal);
      if (activeControllerRef.current !== controller) return;
      const benchmark = data.sp500_total_return_pct;
      setResult({
        ...core,
        data: {
          ...portfolio,
          // A feed response may only replace reference fields, never simulation results.
          ticker_info: data.ticker_info ?? portfolio.ticker_info,
          stock_data: data.stock_data ?? portfolio.stock_data,
          exchange_rates: data.exchange_rates ?? portfolio.exchange_rates,
          exchange_stats: data.exchange_stats ?? portfolio.exchange_stats,
          volatility_events: data.volatility_events ?? portfolio.volatility_events,
          latest_news: data.latest_news ?? portfolio.latest_news,
          sp500_benchmark: data.sp500_benchmark ?? portfolio.sp500_benchmark,
          nasdaq_benchmark: data.nasdaq_benchmark ?? portfolio.nasdaq_benchmark,
          supplemental_status: data.supplemental_status ?? portfolio.supplemental_status,
          portfolio_statistics: {
            ...portfolio.portfolio_statistics,
            ...(typeof benchmark === 'number' && Number.isFinite(benchmark) ? {
              sp500_total_return_pct: benchmark,
              alpha_vs_sp500_pct: portfolio.portfolio_statistics.Total_Return - benchmark,
            } : {}),
          },
        },
      });
    } catch (err) {
      if (activeControllerRef.current === controller && !controller.signal.aborted) {
        setSupplementalError(extractErrorMessage(err));
      }
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsSupplementalLoading(false);
      }
    }
  }, []);

  const runBacktest = useCallback(async (request: BacktestRequest) => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setLastRequest(request);
    setIsLoading(true);
    setIsSupplementalLoading(false);
    setSupplementalError(null);
    setError(null);
    let supplementalStarted = false;
    try {
      const data = await BacktestService.executeBacktest({
        ...request,
        include_stock_data: false,
        include_volatility_events: false,
        include_exchange_rates: false,
        include_benchmarks: false,
        include_news: false,
      }, controller.signal);
      if (activeControllerRef.current === controller) {
        setResult(data);
        if ('portfolio_statistics' in data.data && Array.isArray(data.data.portfolio_composition)) {
          supplementalStarted = true;
          void loadSupplemental(request, data, controller);
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
      if (activeControllerRef.current === controller) {
        setIsLoading(false);
        if (!supplementalStarted) activeControllerRef.current = null;
      }
    }
  }, [loadSupplemental]);

  const retrySupplemental = useCallback(() => {
    if (!result || !lastRequest || isLoading || isSupplementalLoading) return;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    void loadSupplemental(lastRequest, result, controller);
  }, [result, lastRequest, isLoading, isSupplementalLoading, loadSupplemental]);

  useEffect(() => () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setResult(null);
    setError(null);
    setIsLoading(false);
    setIsSupplementalLoading(false);
    setSupplementalError(null);
  }, []);

  return {
    result, isLoading, error, runBacktest, clearError, reset, lastRequest,
    isSupplementalLoading, supplementalError, retrySupplemental,
  };
}
