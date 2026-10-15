import {BalanceError, createBalanceReader} from './balance.js';
import {readFile} from 'node:fs/promises';

export const name = 'blue-whale-balance';
export const inject = ['webServer', 'credentials'];

export function apply(ctx, config = {}) {
  const timeoutMs = config.requestTimeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('requestTimeoutMs must be an integer between 1000 and 60000');
  const read = createBalanceReader(async () => (await ctx.credentials.resolve('DEEPSEEK_API_KEY'))?.value, {timeoutMs});
  const assets = new Set(['whalechan-rice.png','whalechan-low-grains.png','whalechan-low-offer.png','whalechan-working.png','whalechan-done.png',...['idle','working','done','low','dragged','clicked'].map(phase=>`whalechan-${phase}-sheet.png`)]);
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/blue-whale/api/balance',
    handler: async (req, res) => {
      const send = (status, value) => {
        res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
        res.end(JSON.stringify(value));
      };
      if (req.method !== 'POST') return send(405, {ok: false, error: '请通过鲸鱼按钮查询余额。'});
      const origin = req.headers.origin;
      const sameOrigin = origin === undefined || origin === 'dsh-app://app' || origin === `http://${req.headers.host}`;
      if (!sameOrigin || !req.headers['content-type']?.startsWith('application/json')) return send(403, {ok: false, error: '不允许来自外部页面的余额查询。'});
      try { send(200, {ok: true, result: await read()}); }
      catch (error) { send(200, {ok: false, code: error instanceof BalanceError ? error.code : 'INTERNAL', error: error instanceof BalanceError ? error.message : '查询暂时失败，请重试。'}); }
    }
  }), 'blue-whale-balance: official balance route');
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/blue-whale/assets',
    handler: async (req, res) => {
      const filename = req.url?.split('?')[0].slice('/blue-whale/assets/'.length);
      if (req.method !== 'GET' || !assets.has(filename)) {
        res.writeHead(404);res.end();return;
      }
      try {
        const image = await readFile(new URL(`../assets/${filename}`, import.meta.url));
        res.writeHead(200, {'content-type':'image/png','cache-control':'no-cache','x-content-type-options':'nosniff'});
        res.end(image);
      } catch {
        res.writeHead(503, {'cache-control':'no-store'});res.end();
      }
    }
  }), 'blue-whale-balance: bundled local skin');
}
