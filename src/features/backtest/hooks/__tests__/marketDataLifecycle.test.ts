import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { apiClient } from '@/shared/api/client';
import { makePortfolioResponse } from '@/test/fixtures/backtestResults';
import { useBacktest, MARKET_SECTIONS } from '../usePortfolioBacktest';
import type { BacktestRequest } from '../../model/types/api-types';

const origin = 'http://localhost:3000';
const paths = { prices: 'prices', exchangeRates: 'exchange-rates', benchmarks: 'benchmarks', news: 'news' };
const request: BacktestRequest = {
  portfolio: [{ symbol: 'AAPL', amount: 1000 }], start_date: '2023-01-01',
  end_date: '2023-06-30', strategy: 'buy_hold_strategy',
};
const success = (data = {}) => HttpResponse.json({ status: 'success', data });
const counts = () => ({ prices: 0, exchangeRates: 0, benchmarks: 0, news: 0 });
beforeAll(() => { apiClient.defaults.baseURL = origin; });
afterAll(() => { apiClient.defaults.baseURL = ''; });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('independent market-data lifecycles', () => {
  it('forwards human verification only to calculation; read retries need no token', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.post(`${origin}/api/v1/backtest`, async ({ request: incoming }) => {
        expect(incoming.headers.get('X-Turnstile-Token')).toBe('one-use-token');
        expect(await incoming.json()).not.toHaveProperty('turnstileToken');
        return HttpResponse.json(makePortfolioResponse());
      }),
      ...MARKET_SECTIONS.map(section => http.get(`${origin}/api/v1/${paths[section]}`, ({ request: incoming }) => {
        seen.push(incoming.headers.get('X-Turnstile-Token'));
        return success();
      })),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request, 'one-use-token'); });
    await waitFor(() => expect(seen).toHaveLength(4));
    await waitFor(() => expect(result.current.marketReads.news.phase).toBe('success'));
    act(() => result.current.retryMarketData('news'));
    await waitFor(() => expect(seen).toHaveLength(5));
    expect(seen.every(value => value === null)).toBe(true);
  });

  it('shows a verification rejection without starting reference reads', async () => {
    server.use(http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(
      { detail: '사람 인증이 필요합니다.' }, { status: 403 },
    )));
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await expect(result.current.runBacktest(request, 'expired')).rejects.toThrow(); });
    expect(result.current.error).toBe('사람 인증이 필요합니다.');
    expect(result.current.result).toBeNull();
    expect(MARKET_SECTIONS.every(section => result.current.marketReads[section].phase === 'idle')).toBe(true);
  });

  it('shows calculation and other feeds while news is pending; merges concurrent results', async () => {
    const release = deferred();
    let body: BacktestRequest | undefined;
    server.use(
      http.post(`${origin}/api/v1/backtest`, async ({ request: incoming }) => {
        body = await incoming.json() as BacktestRequest;
        return HttpResponse.json(makePortfolioResponse());
      }),
      http.get(`${origin}/api/v1/prices`, () => success({ stock_data: { AAPL: [{ date: '2023-01-02', price: 123 }] } })),
      http.get(`${origin}/api/v1/exchange-rates`, ({ request: incoming }) => {
        expect(new URL(incoming.url).searchParams.has('symbols')).toBe(false);
        return success({ exchange_stats: { test: 1300 } });
      }),
      http.get(`${origin}/api/v1/benchmarks`, () => success({ sp500_total_return_pct: 5 })),
      http.get(`${origin}/api/v1/news`, async ({ request: incoming }) => {
        expect(new URL(incoming.url).searchParams.has('start_date')).toBe(false);
        await release.promise;
        return success({ latest_news: { AAPL: [{ title: 'latest' }] } });
      }),
    );
    const { result } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(result.current.marketReads.benchmarks.phase).toBe('success'));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.marketReads.news.phase).toBe('loading');
      expect(result.current.result?.data).toMatchObject({
        stock_data: { AAPL: [{ price: 123 }] }, exchange_stats: { test: 1300 },
        portfolio_statistics: { sp500_total_return_pct: 5 },
      });
      expect(body?.include_news).toBe(false);
      expect(body?.include_stock_data).toBe(false);
    } finally {
      await act(async () => release.resolve());
    }
    await waitFor(() => expect(result.current.marketReads.news.phase).toBe('success'));
    expect(result.current.result?.data).toMatchObject({ stock_data: { AAPL: [{ price: 123 }] }, latest_news: { AAPL: [{ title: 'latest' }] } });
  });

  it('retries only news and rejects unrelated or calculated fields in its response', async () => {
    let calculations = 0;
    const reads = counts();
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => { calculations++; return HttpResponse.json(makePortfolioResponse()); }),
      ...MARKET_SECTIONS.map(section => http.get(`${origin}/api/v1/${paths[section]}`, () => {
        reads[section]++;
        if (section === 'news') return reads.news === 1
          ? HttpResponse.json({ detail: 'news unavailable' }, { status: 503 })
          : success({ latest_news: { AAPL: [] }, equity_curve: { injected: -1 },
            portfolio_statistics: { Total_Return: -999 }, stock_data: { injected: [] },
            supplemental_status: { news: 'ok', benchmarks: 'error' } });
        return success({});
      })),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request); });
    await waitFor(() => expect(result.current.marketReads.news.error).toBe('news unavailable'));
    await waitFor(() => expect(result.current.marketReads.prices.phase).toBe('success'));
    const before = result.current.result?.data;
    await act(async () => result.current.retryMarketData('news'));
    await waitFor(() => expect(result.current.marketReads.news.phase).toBe('success'));
    expect(calculations).toBe(1);
    expect(reads).toEqual({ prices: 1, exchangeRates: 1, benchmarks: 1, news: 2 });
    expect(result.current.result?.data).toMatchObject({ equity_curve: (before as { equity_curve: unknown }).equity_curve });
    expect(result.current.result?.data).not.toHaveProperty('stock_data.injected');
    expect(result.current.result?.data).not.toHaveProperty('portfolio_statistics.Total_Return', -999);
    expect(result.current.result?.data).not.toHaveProperty('supplemental_status.benchmarks', 'error');
  });

  it('retrying exchange rates leaves pending prices and a separate news error alone', async () => {
    const release = deferred();
    const reads = counts();
    let priceSignal: AbortSignal | undefined;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      ...MARKET_SECTIONS.map(section => http.get(`${origin}/api/v1/${paths[section]}`, async ({ request: incoming }) => {
        reads[section]++;
        if (section === 'prices') { priceSignal = incoming.signal; await release.promise; }
        if (section === 'news' || (section === 'exchangeRates' && reads.exchangeRates === 1)) {
          return HttpResponse.json({ detail: section }, { status: 503 });
        }
        return success({});
      })),
    );
    const { result } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(result.current.marketReads.exchangeRates.phase).toBe('error'));
      await act(async () => result.current.retryMarketData('exchangeRates'));
      await waitFor(() => expect(result.current.marketReads.exchangeRates.phase).toBe('success'));
      expect(priceSignal?.aborted).toBe(false);
      expect(result.current.marketReads.prices.phase).toBe('loading');
      expect(result.current.marketReads.news.phase).toBe('error');
      expect(reads).toEqual({ prices: 1, exchangeRates: 2, benchmarks: 1, news: 1 });
    } finally {
      await act(async () => release.resolve());
    }
    await waitFor(() => expect(result.current.marketReads.prices.phase).toBe('success'));
  });

  it('does not let any old feed overwrite a newer calculation', async () => {
    const oldFeed = deferred();
    let benchmarks = 0;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      http.get(`${origin}/api/v1/benchmarks`, async () => {
        if (++benchmarks === 1) { await oldFeed.promise; return success({ sp500_total_return_pct: 99 }); }
        return success({ sp500_total_return_pct: 5 });
      }),
    );
    const { result } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(benchmarks).toBe(1));
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(result.current.marketReads.benchmarks.phase).toBe('success'));
    } finally { await act(async () => oldFeed.resolve()); }
    expect(result.current.result?.data).toMatchObject({ portfolio_statistics: { sp500_total_return_pct: 5 } });
  });

  it('keeps a malformed news response inside its own error state', async () => {
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      http.get(`${origin}/api/v1/news`, () => HttpResponse.json({ status: 'success', data: null })),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request); });
    await waitFor(() => expect(result.current.marketReads.news.phase).toBe('error'));
    expect(result.current.marketReads.news.error).toContain('조회 응답 형식');
    expect(result.current.result?.status).toBe('success');
    await waitFor(() => expect(result.current.marketReads.prices.phase).toBe('success'));
  });

  it('aborts all four HTTP reads on unmount', async () => {
    const release = deferred();
    const signals: AbortSignal[] = [];
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      ...MARKET_SECTIONS.map(section => http.get(`${origin}/api/v1/${paths[section]}`, async ({ request: incoming }) => {
        signals.push(incoming.signal); await release.promise; return success({});
      })),
    );
    const { result, unmount } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(signals).toHaveLength(4));
      unmount();
      await waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true));
    } finally { release.resolve(); }
  });

  it('skips prices and news for a cash-only portfolio', async () => {
    const response = makePortfolioResponse();
    if ('portfolio_composition' in response.data) response.data.portfolio_composition = [{
      symbol: 'CASH', weight: 100, amount: 1000, asset_type: 'cash',
    }];
    const reads = counts();
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(response)),
      ...MARKET_SECTIONS.map(section => http.get(`${origin}/api/v1/${paths[section]}`, () => { reads[section]++; return success({}); })),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request); });
    await waitFor(() => expect(result.current.marketReads.benchmarks.phase).toBe('success'));
    expect(reads).toEqual({ prices: 0, exchangeRates: 1, benchmarks: 1, news: 0 });
    expect(result.current.marketReads.news.phase).toBe('skipped');
  });

  it('exposes a partial collection error and clears stale benchmark summaries on empty retry', async () => {
    let reads = 0;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      http.get(`${origin}/api/v1/benchmarks`, () => ++reads === 1
        ? success({ sp500_total_return_pct: 5, supplemental_status: { benchmarks: 'timeout' } })
        : success({ sp500_total_return_pct: null, sp500_benchmark: [], nasdaq_benchmark: [], supplemental_status: { benchmarks: 'empty' } })),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request); });
    await waitFor(() => expect(result.current.marketReads.benchmarks.phase).toBe('error'));
    await act(async () => result.current.retryMarketData('benchmarks'));
    await waitFor(() => expect(result.current.marketReads.benchmarks.phase).toBe('empty'));
    expect(result.current.result?.data).not.toHaveProperty('portfolio_statistics.sp500_total_return_pct');
    expect(result.current.result?.data).not.toHaveProperty('portfolio_statistics.alpha_vs_sp500_pct');
  });
});
