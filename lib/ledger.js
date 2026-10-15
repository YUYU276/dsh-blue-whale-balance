// Exact decimal operations: no floating-point money accumulation or price guesses.
export function decimalDelta(left, right) {
  const split = value => { const [whole, fraction = ''] = String(value).split('.'); return {whole, fraction}; };
  const a = split(left), b = split(right), scale = Math.max(a.fraction.length, b.fraction.length);
  const units = value => BigInt(value.whole + value.fraction.padEnd(scale, '0'));
  const result = units(a) - units(b), sign = result < 0n ? '-' : '', digits = (result < 0n ? -result : result).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  return (sign + digits.slice(0, -scale) + '.' + digits.slice(-scale)).replace(/\.?0+$/, '') || '0';
}
export function decimalSum(left, right) { return decimalDelta(left, String(right).startsWith('-') ? String(right).slice(1) : '-' + right); }
export function localDay(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function emptyLedger() { return {version:1, accounts:{}}; }
export function validScope(keyId) { return typeof keyId === 'string' && /^[a-f0-9]{24}$/.test(keyId); }
export function loadLedger(storage) {
  try {
    const value = JSON.parse(storage.getItem('dsbw-ledger-v1'));
    if (value?.version !== 1 || !value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts)) return emptyLedger();
    // Validate stored snapshots before they can enter money calculations.
    for (const [key, account] of Object.entries(value.accounts)) {
      if (!validScope(key) || !account || !Number.isFinite(Date.parse(account.startedAt)) || !Array.isArray(account.points) || !account.points.length || !account.days || typeof account.days !== 'object' || Array.isArray(account.days)) throw new Error('Invalid ledger');
      const validMoney = x => typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x) && x.length < 100;
      for (const point of account.points) if (!Number.isFinite(Date.parse(point.at)) || !Array.isArray(point.balances) || point.balances.some(x => !['CNY','USD'].includes(x.currency) || !validMoney(x.total))) throw new Error('Invalid point');
      for (const [day, currencies] of Object.entries(account.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid day');
        for (const [currency, row] of Object.entries(currencies)) if (!['CNY','USD'].includes(currency) || !validMoney(row.decrease) || !validMoney(row.increase) || !Number.isInteger(row.comparisons) || row.comparisons < 0) throw new Error('Invalid totals');
      }
    }
    return value;
  } catch { return emptyLedger(); }
}
export function recordBalance(ledger, result) {
  if (!validScope(result.keyId) || !Number.isFinite(Date.parse(result.checkedAt))) return ledger;
  const next = JSON.parse(JSON.stringify(ledger));
  const account = next.accounts[result.keyId] ||= {startedAt:result.checkedAt, points:[], days:{}};
  const previous = account.points.at(-1);
  if (previous && result.checkedAt <= previous.at) return ledger;
  const day = localDay(result.checkedAt), daily = account.days[day] ||= {};
  const changes = [];
  for (const info of result.balances) {
    const row = daily[info.currency] ||= {decrease:'0', increase:'0', comparisons:0};
    const prior = previous?.balances.find(x => x.currency === info.currency);
    if (!prior) {changes.push({currency:info.currency, kind:'baseline', value:null});continue;}
    const delta = decimalDelta(info.total, prior.total);
    const kind = delta.startsWith('-') ? 'decrease' : delta === '0' ? 'unchanged' : 'increase';
    const value = delta.replace(/^-/, '');
    row.comparisons++;
    if (kind !== 'unchanged') row[kind] = decimalSum(row[kind], value);
    changes.push({currency:info.currency,kind,value});
  }
  // Keep the immediately preceding reading even when unchanged; cap detailed history.
  account.points.push({at:result.checkedAt, balances:result.balances.map(({currency,total})=>({currency,total})), changes});
  account.points = account.points.slice(-240);
  for (const date of Object.keys(account.days).sort().slice(0,-30)) delete account.days[date];
  // Bound storage even after many key rotations. Current scope is always retained.
  const others = Object.keys(next.accounts).filter(key => key !== result.keyId).sort((a,b)=>next.accounts[b].points.at(-1).at.localeCompare(next.accounts[a].points.at(-1).at));
  for (const key of others.slice(7)) delete next.accounts[key];
  return next;
}
export function sevenDays(account, currency, now) {
  const end = new Date(localDay(now) + 'T12:00:00+08:00');
  return Array.from({length:7}, (_,index) => {
    const day = localDay(new Date(end.getTime() - (6-index)*86400000).toISOString());
    const row = account?.days[day]?.[currency];
    return {day, decrease:row?.comparisons ? row.decrease : null, increase:row?.comparisons ? row.increase : null};
  });
}
export const DEFAULT_PREFS = {theme:'host',accent:'',lowEnabled:true,thresholdCNY:'5',thresholdUSD:'1',cooldownMinutes:30,completionEnabled:true};
export function loadPreferences(storage) {
  let value; try {value = JSON.parse(storage.getItem('dsbw-settings-v1'));} catch { /* Defaults. */ }
  const prefs = {...DEFAULT_PREFS};
  if (!value || typeof value !== 'object') return prefs;
  if (['host','work','ocean','atelier'].includes(value.theme)) prefs.theme = value.theme;
  if (/^#[a-f0-9]{6}$/i.test(value.accent)) prefs.accent = value.accent;
  for (const key of ['lowEnabled','completionEnabled']) if (typeof value[key] === 'boolean') prefs[key]=value[key];
  for (const key of ['thresholdCNY','thresholdUSD']) if (/^\d{1,6}(\.\d{1,4})?$/.test(String(value[key]))) prefs[key]=String(value[key]);
  if ([5,15,30,60,120].includes(value.cooldownMinutes)) prefs.cooldownMinutes=value.cooldownMinutes;
  return prefs;
}
export function lowBalanceEvents(state, result, prefs, now) {
  const next = {...state}, events = [];
  if (!validScope(result?.keyId)) return {state:next,events};
  for (const balance of result.balances) {
    const key = result.keyId + ':' + balance.currency;
    const prior = next[key] || {low:false,lastAt:0};
    const below = result.available === false || Number(balance.total) <= Number(prefs['threshold' + balance.currency]);
    if (!prefs.lowEnabled || !below) { next[key]={...prior,low:false};continue; }
    // One notification per low episode; cooldown suppresses threshold bounce.
    if (!prior.low && (!prior.lastAt || now - prior.lastAt >= prefs.cooldownMinutes*60000)) {
      events.push(balance); next[key]={low:true,lastAt:now};
    } else next[key]={...prior,low:true};
  }
  return {state:next,events};
}
