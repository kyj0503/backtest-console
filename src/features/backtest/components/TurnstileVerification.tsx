import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';

interface WidgetOptions {
  sitekey: string;
  action: string;
  size: 'flexible';
  appearance: 'always';
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  'timeout-callback': () => void;
}
export interface TurnstileApi {
  render: (container: HTMLElement, options: WidgetOptions) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const failed = () => {
      clearTimeout(timer);
      script.remove();
      scriptPromise = undefined;
      reject(new Error('Turnstile could not load'));
    };
    const timer = window.setTimeout(failed, 15_000);
    script.onerror = failed;
    script.onload = () => {
      if (!window.turnstile) { failed(); return; }
      clearTimeout(timer);
      resolve(window.turnstile);
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface Props {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}

export function TurnstileVerification({ siteKey, resetKey, onToken }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let api: TurnstileApi | undefined;
    let widget: string | undefined;
    onToken('');
    if (siteKey) {
      void loadTurnstile().then(loaded => {
        if (!active || !container.current) return;
        api = loaded;
        const invalidate = () => { if (active) onToken(''); };
        widget = api.render(container.current, {
          sitekey: siteKey, action: 'backtest', size: 'flexible',
          appearance: 'always', 'response-field': false,
          callback: token => { if (active) { setError(false); onToken(token); } },
          'expired-callback': invalidate,
          'error-callback': () => { if (active) { invalidate(); setError(true); } },
          'timeout-callback': () => { if (active) { invalidate(); setError(true); } },
        });
      }).catch(() => { if (active) { onToken(''); setError(true); } });
    }
    return () => {
      active = false;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [siteKey, resetKey, retry, onToken]);

  return (
    <div className="w-full max-w-[300px] space-y-2" aria-label="사람 인증">
      <div ref={container} className="w-full" />
      {(!siteKey || error) && (
        <div role="alert" className="text-sm text-destructive">
          인증을 불러오지 못했습니다. 네트워크와 차단 확장 프로그램을 확인해 주세요.
          {siteKey && <Button type="button" variant="outline" className="ml-2" onClick={() => {
            setError(false); setRetry(value => value + 1);
          }}>인증 다시 시도</Button>}
        </div>
      )}
    </div>
  );
}
