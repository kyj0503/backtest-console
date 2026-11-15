import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StockPriceChart from '../StockPriceChart';
import { extractTradeLogs } from '../../utils/chartDataTransform';
import { installSizedCharts } from '@/test/sizedCharts';

installSizedCharts();
describe('R07 open entry rendering', () => {
  it('renders an actual BUY marker and no SELL for an open holding', () => {
    const logs=extractTradeLogs({TEST:{trade_log:[],open_positions:[{EntryTime:'2023-01-05',EntryPrice:97,Size:96}]}});
    const {container}=render(<StockPriceChart tradeLogs={logs} stocksData={[{symbol:'TEST',data:[
      {date:'2023-01-04',price:98,volume:1000},{date:'2023-01-05',price:97,volume:1000},{date:'2023-01-06',price:97,volume:1000},
    ]}]} />);
    expect(screen.getByText(/매수.*1회/)).toBeInTheDocument();
    expect(screen.getByText(/매도.*0회/)).toBeInTheDocument();
    expect(container.querySelector('svg.recharts-surface')).toBeTruthy();
    expect(container.querySelectorAll('.recharts-scatter-symbol path[fill="#ef4444"]')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-scatter-symbol path[fill="#3b82f6"]')).toHaveLength(0);
  });
});
