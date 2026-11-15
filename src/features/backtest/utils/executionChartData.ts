import type { TradeLog } from '../model/types/backtest-result-types';

export interface ExecutionChartPoint {
  date: string;
  time: number;
  price?: number;
  buySignal?: number;
  sellSignal?: number;
}

/** Price sampling must never change an execution's date, price or currency. */
export function buildExecutionChartData(
  prices: Array<{ date: string; price: number }>,
  trades: TradeLog[],
  currency: string,
): ExecutionChartPoint[] {
  const rows: ExecutionChartPoint[] = prices.map(p => ({ ...p, time: Date.parse(p.date) }));
  for (const trade of trades) {
    const events = trade.Type
      ? [{ date: trade.EntryTime, price: trade.EntryPrice, native: trade.EntryPriceNative, buy: trade.Type === 'BUY' }]
      : [
        { date: trade.EntryTime, price: trade.EntryPrice, native: trade.EntryPriceNative, buy: true },
        { date: trade.ExitTime, price: trade.ExitPrice, native: trade.ExitPriceNative, buy: false },
      ];
    for (const event of events) {
      if (!event.date) continue;
      const date = event.date.slice(0, 10);
      const time = Date.parse(date);
      const price = trade.NativeCurrency === currency && event.native !== undefined
        ? event.native
        : (!trade.PriceCurrency || trade.PriceCurrency === currency) ? event.price : undefined;
      // Never put a USD execution on a KRW axis when native metadata is absent.
      if (!Number.isFinite(time) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
      rows.push({ date, time, ...(event.buy ? { buySignal: price } : { sellSignal: price }) });
    }
  }
  return rows.sort((a, b) => a.time - b.time);
}
