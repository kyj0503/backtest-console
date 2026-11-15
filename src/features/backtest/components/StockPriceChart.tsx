import React, { useState, useEffect, memo, useMemo } from "react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Scatter } from "recharts";
import { useRenderPerformance } from "@/shared/components";
import StockSymbolSelector from './results/StockSymbolSelector';
import { formatPriceWithCurrency } from "@/shared/lib/utils/numberUtils";
import type { TickerInfo, TradeLog } from '../model/types/backtest-result-types';
import { buildExecutionChartData } from '../utils/executionChartData';

// 뷰포트 너비를 추적하는 훅.
// 기존에는 렌더 시점에 window.innerWidth를 직접 읽어 마진/틱 간격/각도를
// 계산했는데, 이는 최초 렌더 이후 리사이즈에 전혀 반응하지 않는 문제가 있었다.
// resize 이벤트를 구독해 상태로 관리하면 리사이즈마다 재렌더링되어 반응한다.
const useViewportWidth = (): number => {
  const [width, setWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return width;
};

interface StockData {
  symbol: string;
  data: Array<{
    date: string;
    price: number;
    volume?: number;
  }>;
}

interface StockPriceChartProps {
  stocksData: StockData[];
  tickerInfo?: { [symbol: string]: TickerInfo };
  tradeLogs?: Record<string, TradeLog[]>;
  aggregationType?: 'daily' | 'weekly' | 'monthly';
  className?: string;
}

const StockPriceChart: React.FC<StockPriceChartProps> = memo(({ stocksData, tickerInfo = {}, tradeLogs = {}, className = "" }) => {
  // 성능 모니터링
  useRenderPerformance('StockPriceChart');

  const viewportWidth = useViewportWidth();
  const isNarrowViewport = viewportWidth < 640;

  const [selectedSymbol, setSelectedSymbol] = useState<string>(() => stocksData[0]?.symbol || '');

  // 선택된 종목의 데이터 찾기
  const selectedStockData = stocksData.find(stock => stock.symbol === selectedSymbol);

  const chartCurrency = tickerInfo[selectedSymbol]?.currency || 'USD';
  const chartDataWithSignals = useMemo(() => buildExecutionChartData(
    selectedStockData?.data ?? [], tradeLogs[selectedSymbol] ?? [], chartCurrency,
  ), [selectedStockData, selectedSymbol, tradeLogs, chartCurrency]);

  // Y축 도메인 계산 (메모이제이션)
  const yAxisDomain = useMemo<[number, number]>(() => {
    const prices = chartDataWithSignals
      .flatMap(d => [d.price, d.buySignal, d.sellSignal])
      .filter((price): price is number => typeof price === 'number' && !isNaN(price));
    
    if (prices.length === 0) return [0, 100];
    
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    return [minPrice, maxPrice];
  }, [chartDataWithSignals]);

  // 매매 횟수 계산
  const tradeCount = useMemo(() => {
    const logs = tradeLogs[selectedSymbol];
    if (!logs || !Array.isArray(logs)) return { buys: 0, sells: 0 };

    let buys = 0;
    let sells = 0;

    logs.forEach(t => {
      // Type 필드가 있으면 타입으로 카운트
      if (t.Type) {
        if (t.Type === 'BUY') buys++;
        if (t.Type === 'SELL') sells++;
      } else {
        // Type 필드가 없으면 기존 로직 (하위 호환성)
        if (t.EntryTime && t.EntryPrice) buys++;
        if (t.ExitTime && t.ExitPrice) sells++;
      }
    });

    return { buys, sells };
  }, [selectedSymbol, tradeLogs]);

  if (!stocksData || stocksData.length === 0) {
    return (
      <div className={`bg-card border border-border rounded-lg shadow-sm ${className}`}>
        <div className="px-6 py-4 text-center">
          <p className="text-muted-foreground">표시할 주가 데이터가 없습니다.</p>
        </div>
      </div>
    );
  }

  // 날짜 포맷팅 함수
  const formatDate = (dateString: number) => {
    const date = new Date(dateString);
    return `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}/${date.getUTCDate().toString().padStart(2, '0')}`;
  };

  // 가격 포맷팅 함수
  const formatPrice = (value: number) => {
    return formatPriceWithCurrency(value, tickerInfo[selectedSymbol]?.currency || 'USD');
  };

  return (
    <div className={className}>
      {/* 종목 선택 버튼들 */}
      <StockSymbolSelector
        symbols={stocksData.map(s => s.symbol)}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
        className="mb-4"
      />

      {/* 차트 */}
      {selectedStockData && (
        <>
          <div style={{ width: '100%', height: '400px' }}>
            <ResponsiveContainer debounce={300}>
              <ComposedChart
                data={chartDataWithSignals}
                syncId="stockPriceChart"
                margin={{ top: 5, right: 20, left: 10, bottom: isNarrowViewport ? 60 : 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  allowDuplicatedCategory={false}
                  tickFormatter={formatDate}
                  tick={{ fontSize: 11 }}
                  interval={Math.max(1, Math.floor(chartDataWithSignals.length / (isNarrowViewport ? 4 : 8)))}
                  angle={isNarrowViewport ? -45 : 0}
                  textAnchor={isNarrowViewport ? 'end' : 'middle'}
                />
                <YAxis
                  tickFormatter={formatPrice}
                  domain={yAxisDomain}
                />
                <Tooltip
                  content={({ active, label }) => {
                    if (!active || label === undefined) return null;
                    const points = chartDataWithSignals.filter(point => point.time === Number(label));
                    if (!points.length) return null;
                    return <div className="rounded border border-border bg-background p-3 text-sm shadow-md" role="status">
                      <p>날짜: {points[0]?.date}</p>
                      {points.map((point, index) => <div key={index}>
                        {point.price !== undefined && <p>주가: {formatPrice(point.price)}</p>}
                        {point.buySignal !== undefined && <p>매수: {formatPrice(point.buySignal)}</p>}
                        {point.sellSignal !== undefined && <p>매도: {formatPrice(point.sellSignal)}</p>}
                      </div>)}
                    </div>;
                  }}
                />
                {/* 주가 라인 */}
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#8884d8"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                  connectNulls={true}
                />
                {/* 매수 신호 (빨간점) */}
                <Scatter
                  name="매수"
                  dataKey="buySignal"
                  fill="#ef4444"
                  shape="circle"
                  isAnimationActive={false}
                  r={8}
                />
                {/* 매도 신호 (파란점) */}
                <Scatter
                  name="매도"
                  dataKey="sellSignal"
                  fill="#3b82f6"
                  shape="circle"
                  isAnimationActive={false}
                  r={8}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 차트 하단 정보 */}
          <div className="flex flex-col gap-2">
            {/* 윗줄: 시작/종료/데이터 포인트 */}
            <div className="text-center">
              <small className="text-muted-foreground">
                시작: {selectedStockData.data[0]?.date} | 
                종료: {selectedStockData.data[selectedStockData.data.length - 1]?.date} | 
                데이터 포인트: {selectedStockData.data.length}개
              </small>
            </div>
            
            {/* 아랫줄: 매수/매도 횟수 (거래가 있는 경우에만) */}
            {(tradeCount.buys > 0 || tradeCount.sells > 0) && (
              <div className="text-center">
                <small className="text-muted-foreground">
                  <span className="text-red-500">● 매수: {tradeCount.buys}회</span>
                  {' | '}
                  <span className="text-blue-500">● 매도: {tradeCount.sells}회</span>
                </small>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

StockPriceChart.displayName = 'StockPriceChart';

export default StockPriceChart;
