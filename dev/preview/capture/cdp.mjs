// Minimal Chrome DevTools Protocol client for the capture scripts (Node built-ins only:
// child_process to start Chrome, the global WebSocket to talk to it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchChrome(chromePath = DEFAULT_CHROME) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-preview-chrome-'));
  const proc = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    // No macOS keychain prompt ("Chromium Safe Storage") for a throwaway profile.
    '--use-mock-keychain', '--password-store=basic', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const close = async () => {
    if (proc.exitCode === null && proc.signalCode === null) await new Promise((r) => { proc.once('exit', r); proc.kill(); });
    fs.rmSync(profile, { recursive: true, force: true });
  };

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let log = '';
      proc.stderr.on('data', (d) => {
        log += d;
        const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      proc.on('error', reject);
      proc.on('exit', (code) => reject(new Error(`Chrome exited (${code}). ${log.slice(-400)}`)));
      setTimeout(() => reject(new Error(`Chrome did not start: ${chromePath}`)), 20000).unref();
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let seq = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(`${m.error.message} ${m.error.data || ''}`.trim()));
        else resolve(m.result);
      } else if (m.method) {
        listeners.forEach((l) => l(m));
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    // Calls fn(params) for every `method` event of this session; returns an unsubscribe function.
    const on = (method, fn, sessionId) => {
      const l = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) fn(m.params); };
      listeners.add(l);
      return () => listeners.delete(l);
    };
    // Resolves on the event, or after `ms` anyway (some pages never fire load).
    const waitFor = (method, ms, sessionId) => new Promise((resolve) => {
      const off = on(method, (p) => { off(); resolve(p); }, sessionId);
      setTimeout(() => { off(); resolve(); }, ms).unref();
    });

    const { userAgent } = await send('Browser.getVersion');

    async function newPage() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const cmd = (method, params) => send(method, params, sessionId);
      await cmd('Page.enable');
      return {
        sessionId,
        cmd,
        on: (method, fn) => on(method, fn, sessionId),
        async evaluate(expression) {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        async goto(url, ms = 45000) {
          const loaded = waitFor('Page.loadEventFired', ms, sessionId);
          const { errorText } = await cmd('Page.navigate', { url });
          if (errorText) throw new Error(`${url}: ${errorText}`);
          await loaded;
        },
      };
    }

    return {
      userAgent,
      send,
      on,
      waitFor,
      newPage,
      close: async () => { ws.close(); await close(); },
    };
  } catch (e) {
    await close();
    throw e;
  }
}
