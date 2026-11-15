import { test, expect } from '@playwright/test';

// Run against the Rust fixture server and the actual Vite proxy. No API mocks.
// RUST_MIGRATION_E2E=1 npm run test:e2e -- e2e/rust-migration.spec.ts
test('Rust 계산 결과와 네 참고 조회를 기존 화면에 표시한다', async ({ page }) => {
  test.skip(process.env.RUST_MIGRATION_E2E !== '1', 'Requires the Rust synthetic fixture server');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/backtest');
  await page.locator('table').getByLabel('1번째 종목 심볼').fill('AAPL');
  await page.getByLabel('시작 날짜').fill('2023-01-02');
  await page.getByLabel('종료 날짜').fill('2023-10-31');
  const paths = ['/backtest', '/prices', '/exchange-rates', '/benchmarks', '/news'];
  const responses = paths.map(path => page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/v1${path}`));
  await page.getByRole('button', { name: '백테스트 실행', exact: true }).click();
  for (const response of await Promise.all(responses)) {
    expect(response.status(), response.url()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('success');
  }
  await expect(page.getByRole('button', { name: 'CSV 다운로드' })).toBeVisible();
  await expect(page.getByText('오류가 발생했습니다')).not.toBeVisible();
  expect(errors).toEqual([]);
});
