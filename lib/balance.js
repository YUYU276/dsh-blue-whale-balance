import {createHash} from 'node:crypto';

export class BalanceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function parseBalance(data) {
  const validAmount = value => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value));
  if (typeof data?.is_available !== 'boolean' || !Array.isArray(data.balance_infos) || !data.balance_infos.length) {
    throw new BalanceError('INVALID_RESPONSE', '余额接口返回了无法识别的数据，请重试。');
  }
  const balances = data.balance_infos.map(info => {
    if (!['CNY', 'USD'].includes(info.currency) || !['total_balance', 'granted_balance', 'topped_up_balance'].every(key => validAmount(info[key]))) {
      throw new BalanceError('INVALID_RESPONSE', '余额接口返回了无法识别的数据，请重试。');
    }
    return {currency: info.currency, total: info.total_balance, granted: info.granted_balance, toppedUp: info.topped_up_balance};
  });
  return {available: data.is_available, balances};
}

export function createBalanceReader(resolveKey, {fetcher = globalThis.fetch, timeoutMs = 10000, now = Date.now} = {}) {
  let pending;
  return function read() {
    // Share overlapping clicks only. Every subsequent read makes a fresh API request.
    if (pending) return pending;
    pending = (async () => {
      const key = await resolveKey();
      if (!key) throw new BalanceError('MISSING_KEY', '请先在 dsh 的模型设置中配置 DeepSeek 官方 API Key。');
      let response;
      try {
        response = await fetcher('https://api.deepseek.com/user/balance', {
          headers: {Authorization: `Bearer ${key}`, Accept: 'application/json'},
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store'
        });
      } catch (error) {
        throw new BalanceError('NETWORK', error?.name === 'TimeoutError' ? '查询超时，请检查网络后重试。' : '暂时无法连接 DeepSeek，请检查网络后重试。');
      }
      if (!response.ok) {
        const messages = {401: 'API Key 无效或已失效，请在 dsh 模型设置中更新。', 429: '查询过于频繁，请稍后重试。'};
        throw new BalanceError(`HTTP_${response.status}`, messages[response.status] || `DeepSeek 余额服务暂不可用（${response.status}）。`);
      }
      let data;
      try { data = await response.json(); }
      catch { throw new BalanceError('INVALID_RESPONSE', '余额接口返回了无法识别的数据，请重试。'); }
      // An opaque credential scope, not an account identifier. Never expose the key.
      const keyId = createHash('sha256').update('dsh-blue-whale-balance:v1\0').update(key).digest('hex').slice(0, 24);
      return {...parseBalance(data), keyId, checkedAt: new Date(now()).toISOString(), source: 'DeepSeek 官方 API'};
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
