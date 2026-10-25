import { Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { MARKET_SECTIONS, type MarketReadStates } from '../../hooks/usePortfolioBacktest';
import type { MarketDataSection } from '../../model/types/api-types';

const labels: Record<MarketDataSection, string> = {
  prices: '주가', exchangeRates: '환율', benchmarks: '벤치마크', news: '뉴스',
};

interface Props {
  reads: MarketReadStates;
  onRetry: (section: MarketDataSection) => void;
}

export default function MarketDataStatus({ reads, onRetry }: Props) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {MARKET_SECTIONS.map(section => {
        const { phase, error } = reads[section];
        const label = labels[section];
        return (
          <div key={section} role="status" aria-label={`${label} 조회 상태`}
            className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{label}</p>
            <div className="mt-1 text-muted-foreground">
              {phase === 'loading' && <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />불러오는 중...</p>}
              {phase === 'idle' && <p>조회 준비 중</p>}
              {phase === 'success' && <p>조회 완료</p>}
              {phase === 'skipped' && <p>조회할 주식 종목이 없습니다.</p>}
              {phase === 'empty' && <p>조회된 자료가 없습니다.</p>}
              {phase === 'error' && <p>{error} 계산 결과와 다른 자료는 유지됩니다.</p>}
            </div>
            {(phase === 'error' || phase === 'empty') && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onRetry(section)}>
                {label} 다시 불러오기
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
