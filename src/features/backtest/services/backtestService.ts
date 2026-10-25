/**
 * 백테스트 서비스
 *
 * 계산은 POST /api/v1/backtest, 참고 데이터는 GET /api/v1/market-data로 분리한다.
 * 참고 데이터 조회·재시도는 계산을 다시 실행하지 않는다.
 */

import { apiClient } from '@/shared/api/client';
import {
  BacktestRequest,
  UnifiedBacktestResponse,
  MarketData,
} from '../model/types/api-types';

export class BacktestService {
  /**
   * 백테스트 실행 (단일 종목 또는 포트폴리오)
   */
  static async executeBacktest(request: BacktestRequest, signal?: AbortSignal): Promise<UnifiedBacktestResponse> {
    const response = await apiClient.post<UnifiedBacktestResponse>('/api/v1/backtest', request, { signal });
    return response.data;
  }

  static async loadMarketData(request: BacktestRequest, symbols: string[], signal: AbortSignal): Promise<MarketData> {
    const params = new URLSearchParams({ start_date: request.start_date, end_date: request.end_date });
    for (const symbol of new Set(symbols)) params.append('symbols', symbol);
    const response = await apiClient.get<{ status: 'success'; data: MarketData }>('/api/v1/market-data', {
      params, signal, timeout: 27_000,
    });
    return response.data.data;
  }
}

export default BacktestService;
