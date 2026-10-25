/**
 * 백테스트 서비스
 *
 * 계산은 POST /api/v1/backtest, 참고 데이터는 네 GET으로 독립 조회한다.
 * 참고 데이터 조회·재시도는 계산을 다시 실행하지 않는다.
 */

import { apiClient } from '@/shared/api/client';
import {
  BacktestRequest,
  UnifiedBacktestResponse,
  MarketDataResponses,
  MarketDataSection,
} from '../model/types/api-types';

export class BacktestService {
  /**
   * 백테스트 실행 (단일 종목 또는 포트폴리오)
   */
  static async executeBacktest(request: BacktestRequest, signal?: AbortSignal, turnstileToken?: string): Promise<UnifiedBacktestResponse> {
    const response = await apiClient.post<UnifiedBacktestResponse>('/api/v1/backtest', request, {
      signal, headers: turnstileToken ? { 'X-Turnstile-Token': turnstileToken } : undefined,
    });
    return response.data;
  }

  static async loadMarketData<S extends MarketDataSection>(
    section: S, request: BacktestRequest, symbols: string[], signal: AbortSignal,
  ): Promise<MarketDataResponses[S]> {
    const paths = { prices: 'prices', exchangeRates: 'exchange-rates', benchmarks: 'benchmarks', news: 'news' };
    const params = new URLSearchParams();
    if (section !== 'news') {
      params.set('start_date', request.start_date);
      params.set('end_date', request.end_date);
    }
    if (section === 'prices' || section === 'news') {
      for (const symbol of new Set(symbols)) params.append('symbols', symbol);
    }
    const response = await apiClient.get<{ status: 'success'; data: MarketDataResponses[S] }>(`/api/v1/${paths[section]}`, {
      params, signal, timeout: 27_000,
    });
    if (response.data?.status !== 'success' || !response.data.data ||
        typeof response.data.data !== 'object' || Array.isArray(response.data.data)) {
      throw new Error('조회 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
    }
    return response.data.data;
  }
}

export default BacktestService;
