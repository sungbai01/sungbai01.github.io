import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5175' });

async function setup(page: Page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/config') return route.fulfill({ json: { clientId: 'mock-client' } });
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/google-login-test') return route.fulfill({ contentType: 'text/html', body: '<html><head><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body></body></html>' });
    return route.continue();
  });
  await page.goto('/google-login-test');
  await page.evaluate(async () => {
    const state = window as any;
    state.renders = [];
    state.callbacks = [];
    state.google = { accounts: { id: {
      initialize: (options: any) => state.callbacks.push(options.callback),
      renderButton: (host: HTMLElement, options: any) => {
        const placeholder = document.createElement('button');
        placeholder.textContent = 'GIS placeholder';
        placeholder.style.visibility = 'visible';
        host.append(placeholder);
        state.renders.push({ host, options });
      },
      disableAutoSelect: () => {},
    } } };
    state.addFrame = (index: number, hidden = false) => {
      const frame = document.createElement('iframe');
      frame.src = 'about:blank';
      frame.style.cssText = 'width:300px;height:40px;border:0';
      if (hidden) frame.style.display = 'none';
      state.renders[index].frame = frame;
      state.renders[index].host.append(frame);
    };
    state.loadFrame = (index: number) => {
      const { host, frame } = state.renders[index];
      host.querySelector('button')?.remove();
      frame.src = 'data:text/html,<button>Google mock button</button>';
    };
    const { mountLogin } = await import('/tests/google-login-harness.tsx');
    state.unmountLogin = mountLogin();
  });
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).renders.length)).toBe(1);
}

async function pending(page: Page) {
  const provider = page.locator('.google-account-provider');
  await expect(provider).toHaveAttribute('data-ready', 'false');
  await expect(provider).toHaveCSS('opacity', '0');
  await expect(provider).toHaveAttribute('inert', '');
  await expect(page.locator('.google-login-progress')).toBeVisible();
}

for (const width of [390, 1440]) test('waits for loaded, laid-out iframe at ' + width, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const before = await page.locator('.google-login-slot').boundingBox();
  await pending(page);
  await page.evaluate(() => (window as any).addFrame(0, true));
  await pending(page);
  await page.evaluate(() => (window as any).loadFrame(0));
  await expect(page.frameLocator('.google-account-provider iframe').getByText('Google mock button')).toHaveCount(1);
  await pending(page);
  await page.evaluate(() => { (window as any).renders[0].frame.style.display = 'block'; });
  await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.google-account-provider')).toHaveCSS('opacity', '1');
  await expect(page.locator('.google-login-progress')).toHaveCount(0);
  expect(await page.locator('.google-login-slot').boundingBox()).toEqual(before);
  expect(await page.evaluate(() => (window as any).renders[0].options.width)).toBeGreaterThan(0);
});

test('closing and reopening ignores the cancelled render and credential', async ({ page }) => {
  let verifications = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/auth/google') verifications++; });
  await setup(page);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).renders.length)).toBe(2);
  await page.evaluate(() => {
    const state = window as any;
    state.addFrame(0); state.loadFrame(0); state.callbacks[0]({ credential: 'stale' });
  });
  await pending(page);
  await page.evaluate(() => { (window as any).addFrame(1); (window as any).loadFrame(1); });
  await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready', 'true');
  expect(verifications).toBe(0);
});

test('times out and retries with an isolated render host', async ({ page }) => {
  await page.clock.install();
  await setup(page);
  await page.clock.fastForward(15_100);
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).renders.length)).toBe(2);
  await page.evaluate(() => { (window as any).addFrame(0); (window as any).loadFrame(0); });
  await pending(page);
  await page.evaluate(() => { (window as any).addFrame(1); (window as any).loadFrame(1); });
  await page.clock.resume();
  await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready', 'true');
});

test('unmount cancels pending work without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await setup(page);
  await page.evaluate(() => {
    const state = window as any;
    state.unmountLogin(); state.addFrame(0); state.loadFrame(0); state.callbacks[0]({ credential: 'stale' });
  });
  await page.clock.fastForward(16_000);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('render exception can retry and only the ready button verifies', async ({ page }) => {
  let verifications = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/auth/google') verifications++; });
  await setup(page);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.evaluate(() => {
    const state = window as any;
    state.originalRender = state.google.accounts.id.renderButton;
    state.google.accounts.id.renderButton = () => { throw new Error('Mock render failure'); };
  });
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    state.callbacks[1]({ credential: 'failed-attempt' });
    state.google.accounts.id.renderButton = state.originalRender;
  });
  expect(verifications).toBe(0);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).renders.length)).toBe(2);
  await page.evaluate(() => (window as any).callbacks[2]({ credential: 'too-early' }));
  await pending(page);
  expect(verifications).toBe(0);
  await page.evaluate(() => { (window as any).addFrame(1); (window as any).loadFrame(1); });
  await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const callback = (window as any).callbacks[2];
    callback({ credential: 'mock-credential' });
    callback({ credential: 'duplicate' });
  });
  await expect.poll(() => verifications).toBe(1);
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
});

test('DOM Google button becomes ready without any iframe load',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const host=(window as any).renders[0].host;host.replaceChildren();const button=document.createElement('div');button.setAttribute('role','button');button.textContent='Sign in with Google';button.style.cssText='width:300px;height:40px';host.append(button);});
 await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready','true');
 await expect(page.locator('.google-login-progress')).toHaveCount(0);
});

test('keeps the temporary DOM-to-iframe handoff hidden',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const host=(window as any).renders[0].host;const node=document.createElement('div');node.setAttribute('role','button');node.style.cssText='width:300px;height:40px';host.replaceChildren(node);});
 await pending(page);
 await page.waitForTimeout(250);
 await pending(page);
 await page.evaluate(()=>{const state=window as any;state.addFrame(0);state.loadFrame(0);state.renders[0].host.querySelector('[role=button]')?.remove();});
 await expect(page.locator('.google-account-provider')).toHaveAttribute('data-ready','true');
});
