import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileVerification, type TurnstileApi } from '../TurnstileVerification';
import PortfolioBacktestForm from '../PortfolioBacktestForm';
import type { BacktestRequest } from '../../model/types/api-types';

vi.mock('../DateRangeForm', () => ({ default: () => null }));
vi.mock('../StrategyForm', () => ({ default: () => null }));
vi.mock('../CommissionForm', () => ({ default: () => null }));
vi.mock('../PortfolioForm', () => ({ default: () => null }));
const validation = vi.hoisted(() => ({ valid: true }));
vi.mock('../../hooks/useFormValidation', () => ({ useFormValidation: () => ({
  errors: [], validateForm: () => validation.valid,
}) }));

type Options = Parameters<TurnstileApi['render']>[1];
let options: Options[];
let api: TurnstileApi;
beforeEach(() => {
  options = [];
  api = { render: vi.fn((_container, config) => { options.push(config); return `widget-${options.length}`; }), remove: vi.fn() };
  window.turnstile = api;
  validation.valid = true;
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-sitekey');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); window.turnstile = undefined; });

describe('Turnstile calculation gate', () => {
  it('keeps submit disabled until verified, then invalidates expired/error/timeout tokens', async () => {
    render(<PortfolioBacktestForm onSubmit={vi.fn()} />);
    const button = screen.getByRole('button', { name: '백테스트 실행' });
    expect(button).toBeDisabled();
    await waitFor(() => expect(options).toHaveLength(1));
    expect(options[0]!).toMatchObject({ sitekey: 'public-sitekey', action: 'backtest',
      appearance: 'interaction-only', 'response-field': false });
    expect(screen.getByRole('status')).toHaveTextContent('사람 인증 확인 중');
    for (const callback of ['expired-callback', 'error-callback', 'timeout-callback'] as const) {
      act(() => options[0]!.callback('fresh-token'));
      expect(button).toBeEnabled();
      expect(screen.getByRole('status')).toHaveTextContent('사람 인증 완료');
      act(() => options[0]![callback]());
      expect(button).toBeDisabled();
      expect(screen.getByRole('status')).not.toHaveTextContent('사람 인증 완료');
    }
  });

  it.each([false, true])('forwards a token separately and renews after success/error (error=%s)', async failure => {
    const submit = vi.fn<(request: BacktestRequest, token?: string) => Promise<void>>(async () => {
      if (failure) throw new Error('request failed');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<PortfolioBacktestForm onSubmit={submit} />);
    await waitFor(() => expect(options).toHaveLength(1));
    // Even a programmatic submit without the widget must be blocked by the form.
    fireEvent.submit(container.querySelector('form')!);
    expect(submit).not.toHaveBeenCalled();
    act(() => options[0]!.callback('single-use-token'));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(options).toHaveLength(2));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]!).toHaveLength(2);
    expect(submit.mock.calls[0]![1]).toBe('single-use-token');
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('turnstileToken');
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    expect(screen.getByRole('button', { name: '백테스트 실행' })).toBeDisabled();
    vi.restoreAllMocks();
  });

  it('does not consume a token when local form validation fails', async () => {
    validation.valid = false;
    const submit = vi.fn();
    const { container } = render(<PortfolioBacktestForm onSubmit={submit} />);
    await waitFor(() => expect(options).toHaveLength(1));
    act(() => options[0]!.callback('not-yet-consumed'));
    fireEvent.submit(container.querySelector('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(options).toHaveLength(1);
  });

  it('recovers widget failure and ignores callbacks from a removed widget', async () => {
    const onToken = vi.fn();
    const { unmount } = render(<StrictMode><TurnstileVerification siteKey="public-sitekey" resetKey={0} onToken={onToken} /></StrictMode>);
    await waitFor(() => expect(options).toHaveLength(1));
    act(() => options[0]!['error-callback']());
    fireEvent.click(screen.getByRole('button', { name: '인증 다시 시도' }));
    await waitFor(() => expect(options).toHaveLength(2));
    onToken.mockClear();
    act(() => options[0]!.callback('stale'));
    expect(onToken).not.toHaveBeenCalled();
    unmount();
    act(() => options[1]!.callback('unmounted'));
    expect(onToken).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the public production configuration is absent', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    render(<PortfolioBacktestForm onSubmit={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('인증을 불러오지 못했습니다');
    expect(screen.getByRole('button', { name: '백테스트 실행' })).toBeDisabled();
    expect(api.render).not.toHaveBeenCalled();
  });

  it('fails closed when the vendor script is blocked and allows an explicit retry', async () => {
    window.turnstile = undefined;
    let script!: HTMLScriptElement;
    // Prevent happy-dom from fetching the actual vendor script. Drive its load/error events.
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node,>(node: T): T => {
      if (node instanceof HTMLScriptElement) script = node;
      return node;
    });
    render(<TurnstileVerification siteKey="public-sitekey" resetKey={0} onToken={vi.fn()} />);
    expect(window.turnstile).toBeUndefined();
    expect(script).toBeDefined();
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    fireEvent.error(script);
    expect(await screen.findByRole('alert')).toHaveTextContent('인증을 불러오지 못했습니다');
    window.turnstile = api;
    fireEvent.click(screen.getByRole('button', { name: '인증 다시 시도' }));
    await waitFor(() => expect(options).toHaveLength(1));
    act(() => options[0]!.callback('retry-token'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders only after the official script has loaded', async () => {
    window.turnstile = undefined;
    let script!: HTMLScriptElement;
    // Prevent happy-dom from fetching the actual vendor script. Drive its load/error events.
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node,>(node: T): T => {
      if (node instanceof HTMLScriptElement) script = node;
      return node;
    });
    render(<TurnstileVerification siteKey="public-sitekey" resetKey={0} onToken={vi.fn()} />);
    expect(window.turnstile).toBeUndefined();
    expect(script).toBeDefined();
    expect(api.render).not.toHaveBeenCalled();
    window.turnstile = api;
    fireEvent.load(script);
    await waitFor(() => expect(options).toHaveLength(1));
    script.remove();
  });
});
