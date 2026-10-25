import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { apiClient } from '@/shared/api/client';
import { makePortfolioResponse } from '@/test/fixtures/backtestResults';
import { useBacktest } from '../usePortfolioBacktest';
import type { BacktestRequest } from '../../model/types/api-types';

const origin = 'http://localhost:3000';
const request: BacktestRequest = {
  portfolio: [{ symbol: 'AAPL', amount: 1000 }], start_date: '2023-01-01',
  end_date: '2023-06-30', strategy: 'buy_hold_strategy',
};
beforeAll(() => { apiClient.defaults.baseURL = origin; });
afterAll(() => { apiClient.defaults.baseURL = ''; });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('simulation and reference-data lifecycle', () => {
  it('shows the completed simulation while a slow feed is still pending', async () => {
    const release = deferred();
    let body: BacktestRequest | undefined;
    server.use(
      http.post(`${origin}/api/v1/backtest`, async ({ request: incoming }) => {
        body = await incoming.json() as BacktestRequest;
        return HttpResponse.json(makePortfolioResponse());
      }),
      http.get(`${origin}/api/v1/market-data`, async () => {
        await release.promise;
        return HttpResponse.json({ status: 'success', data: { latest_news: {} } });
      }),
    );
    const { result } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      expect(result.current.result?.status).toBe('success');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSupplementalLoading).toBe(true);
      expect(body?.include_news).toBe(false);
      expect(body?.include_benchmarks).toBe(false);
    } finally {
      await act(async () => release.resolve());
    }
    await waitFor(() => expect(result.current.isSupplementalLoading).toBe(false));
  });

  it('retries only failed reference data and preserves the calculated result', async () => {
    let calculations = 0;
    let reads = 0;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => {
        calculations++;
        return HttpResponse.json(makePortfolioResponse());
      }),
      http.get(`${origin}/api/v1/market-data`, () => {
        reads++;
        return reads === 1
          ? HttpResponse.json({ detail: 'feed unavailable' }, { status: 503 })
          : HttpResponse.json({ status: 'success', data: { sp500_total_return_pct: 5 } });
      }),
    );
    const { result } = renderHook(() => useBacktest());
    await act(async () => { await result.current.runBacktest(request); });
    await waitFor(() => expect(result.current.supplementalError).toBe('feed unavailable'));
    const data = result.current.result?.data;
    expect(result.current.error).toBeNull();
    expect(data).toBeTruthy();
    await act(async () => result.current.retrySupplemental());
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(result.current.isSupplementalLoading).toBe(false));
    expect(calculations).toBe(1);
    expect(result.current.supplementalError).toBeNull();
    expect(result.current.result?.data).toMatchObject({ equity_curve: (data as { equity_curve: unknown }).equity_curve });
  });

  it('does not let a stale feed overwrite a newer simulation', async () => {
    const oldFeed = deferred();
    let reads = 0;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      http.get(`${origin}/api/v1/market-data`, async () => {
        if (++reads === 1) {
          await oldFeed.promise;
          return HttpResponse.json({ status: 'success', data: { sp500_total_return_pct: 99 } });
        }
        return HttpResponse.json({ status: 'success', data: { sp500_total_return_pct: 5 } });
      }),
    );
    const { result } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(reads).toBe(1));
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(result.current.isSupplementalLoading).toBe(false));
    } finally {
      await act(async () => oldFeed.resolve());
    }
    expect(result.current.result?.data).toMatchObject({ portfolio_statistics: { sp500_total_return_pct: 5 } });
  });

  it('aborts reference-data HTTP work on unmount', async () => {
    const release = deferred();
    let signal: AbortSignal | undefined;
    server.use(
      http.post(`${origin}/api/v1/backtest`, () => HttpResponse.json(makePortfolioResponse())),
      http.get(`${origin}/api/v1/market-data`, async ({ request: incoming }) => {
        signal = incoming.signal;
        await release.promise;
        return HttpResponse.json({ status: 'success', data: {} });
      }),
    );
    const { result, unmount } = renderHook(() => useBacktest());
    try {
      await act(async () => { await result.current.runBacktest(request); });
      await waitFor(() => expect(signal).toBeDefined());
      unmount();
      await waitFor(() => expect(signal?.aborted).toBe(true));
    } finally {
      release.resolve();
    }
  });
});
