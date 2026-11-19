// The token radar's model ("peer-priced", radar-2): one snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet (no CoinGecko id and no symbol in the
// snapshot) by an implied value: what a token would be worth if the market priced this protocol
// the way it already prices comparable protocols whose tokens do trade. Nothing is priced from a
// list of names; every figure below is computed from the snapshot itself at run time.
//
//   implied_value_usd = TVL x multiple x momentum x maturity x breadth        (whole dollars)
//
//   multiple  The category's own price of TVL: the median market-cap / TVL ratio of the tokened
//             protocols in the same DefiLlama category, each peer ratio first trimmed to
//             [0.01, 5] so one absurd peer cannot carry a category. A category with fewer than
//             MIN_PEERS usable peers falls back to the median of its category group (see GROUPS),
//             and a group that is still too thin falls back to the global median of all peers.
//   momentum  The week's TVL change, clamped to [-30, +60] percent and mapped linearly to about
//             x0.87 .. x1.25: a protocol gaining TVL is priced a little richer, one shrinking a
//             little cheaper. An unreported change counts as 0 (x1.00).
//   maturity  Years the protocol has run with no token, from listed_at to the snapshot's as_of:
//             x(1 + 0.05 x years), capped at 6 years (x1.30). Surviving years without issuing a
//             token is evidence of a real product, so it earns a modest premium, never a large one.
//             An unknown listing date counts as 1 year.
//   breadth   One mild term for multi-chain reach: x(1 + 0.03 x ln(chains)), so 1 chain is x1.00,
//             10 chains about x1.07, 30 chains about x1.10.
//
// A 0..100 readiness score rides along for the dashboard only (it never moves a rank): age,
// 7-day growth and TVL scale contribute up to 35 / 30 / 35 points.
//
// Board membership: every watchlist slug (the floor), plus every other protocol that records no
// token with at least $15,000,000 of TVL, leaving out the categories the watchlist rule leaves
// out (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX) and the
// names that rule leaves out (a version marker at the end, or a whole word wrapped / staked /
// staking): those are mostly products of protocols whose token already trades, not launches.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board's data carries it. */
export const MODEL_VERSION = 'radar-2 peer-priced';

/** The TVL floor for non-watchlist rows, in whole dollars. */
export const EARLY_FLOOR_USD = 15_000_000;

/** How many usable tokened peers a category (or group) needs before its own median is trusted. */
export const MIN_PEERS = 4;

/** Peer ratios are trimmed into this band before any median is taken. */
export const RATIO_MIN = 0.01;
export const RATIO_MAX = 5;

/** Categories the board leaves out, exactly the watchlist rule's list. */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a release marker is a pool of another protocol (the watchlist rule's test). */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name (the watchlist rule's test). */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Category groups for the multiple's fallback: categories whose tokens the market prices alike.
 * A category in no group falls back straight to the global median.
 */
export const GROUPS: Record<string, string[]> = {
  credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management'],
  trading: ['Dexs', 'Derivatives', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Synthetics', 'Prediction Market', 'Launchpad'],
  yield: ['Yield', 'Yield Aggregator', 'Farm', 'Leveraged Farming', 'Basis Trading', 'Liquidity Manager'],
  staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC'],
  'stable-and-rwa': ['Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency', 'RWA'],
  services: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Chain', 'Risk Curators', 'Onchain Capital Allocator', 'Indexes', 'Insurance', 'Payments', 'Crypto Card Issuer', 'CeDeFi', 'Governance Incentives', 'AI Agents', 'Decentralized AI', 'NFT Marketplace', 'OTC Marketplace', 'Token Locker', 'DOR', 'Privacy', 'CEX'],
};

/** One row of board.json: the required keys, then the model's working for the dashboard. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  readiness: number;
}

/** Everything the dashboard renders: header figures plus the board's rows, in rank order. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  protocols_total: number;
  watchlist_size: number;
  board_size: number;
  median_implied_usd: number;
  model_version: string;
  rows: BoardRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, computed on a sorted copy (the input is never mutated). */
function median(values: number[]): number {
  const x = [...values].sort((a, b) => a - b);
  const mid = Math.floor(x.length / 2);
  return x.length % 2 === 1 ? x[mid]! : (x[mid - 1]! + x[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Whether a protocol records a token in the snapshot (a CoinGecko id or a symbol). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The peer set the multiples come from: tokened protocols whose record also carries a market
 * cap, as category -> trimmed mcap/TVL ratios. (Many tokened protocols record no market cap in
 * the snapshot; they cannot price anything and are left out, which the dashboard footer states.)
 */
function peerRatios(snapshot: Snapshot): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.tvl_usd <= 0 || p.category === null) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, RATIO_MIN, RATIO_MAX);
    const list = byCategory.get(p.category);
    if (list === undefined) byCategory.set(p.category, [ratio]);
    else list.push(ratio);
  }
  return byCategory;
}

/** The group a category belongs to, or null. */
function groupOf(category: string): string | null {
  for (const [group, members] of Object.entries(GROUPS)) if (members.includes(category)) return group;
  return null;
}

/**
 * The multiple for one category: its own median when it has MIN_PEERS usable peers, else its
 * group's pooled median when the group has MIN_PEERS, else the global median of every peer.
 */
export function categoryMultiple(category: string | null, peers: Map<string, number[]>, globalMedian: number): number {
  if (category === null) return globalMedian;
  const own = peers.get(category) ?? [];
  if (own.length >= MIN_PEERS) return median(own);
  const group = groupOf(category);
  if (group !== null) {
    const pooled: number[] = [];
    for (const member of GROUPS[group]!) pooled.push(...(peers.get(member) ?? []));
    if (pooled.length >= MIN_PEERS) return median(pooled);
  }
  return globalMedian;
}

/** The momentum multiplier: the week's TVL change, clamped, mapped to about x0.87 .. x1.25. */
export function momentumOf(change7d: number | null): number {
  const c = clamp(change7d ?? 0, -30, 60);
  return 1 + (c / 100) * 0.42;
}

/** The maturity multiplier: years run with no token, 5 points a year, capped at 6 years. */
export function maturityOf(age: number | null): number {
  const years = age === null ? 1 : age / 365.25;
  return 1 + 0.05 * Math.min(years, 6);
}

/** The breadth multiplier: a mild log term over the number of chains the protocol runs on. */
export function breadthOf(chains: string[]): number {
  return 1 + 0.03 * Math.log(Math.max(1, chains.length));
}

/** The dashboard's readiness score, 0..100: age 35, growth 30, TVL scale 35. Never a rank input. */
export function readinessOf(p: SnapshotProtocol, age: number | null): number {
  const years = age === null ? 1 : age / 365.25;
  const ageScore = (Math.min(years, 6) / 6) * 35;
  const growthScore = ((clamp(p.change_7d ?? 0, -10, 40) + 10) / 50) * 30;
  const scaleScore = clamp((Math.log10(Math.max(1, p.tvl_usd)) - 7) / 3.2, 0, 1) * 35;
  return Math.round(clamp(ageScore + growthScore + scaleScore, 0, 100));
}

/** Whether a non-watchlist protocol may join the board under the membership rule above. */
function isEarlyRow(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.tvl_usd >= EARLY_FLOOR_USD &&
    !(p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The protocols the board ranks: the watchlist whole, then the early rows, each slug once. */
export function selectProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) if (!chosen.has(p.slug) && isEarlyRow(p)) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** The ranked board: every selected protocol scored, sorted by implied value, ranks 1..N. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerRatios(snapshot);
  const everyRatio: number[] = [];
  for (const list of peers.values()) everyRatio.push(...list);
  const globalMedian = everyRatio.length > 0 ? median(everyRatio) : 0.15;
  const watchlist = new Set(snapshot.watchlist);
  const scored = selectProtocols(snapshot).map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const multiple = categoryMultiple(p.category, peers, globalMedian);
    const momentum = momentumOf(p.change_7d);
    const maturity = maturityOf(age);
    const breadth = breadthOf(p.chains);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
    return { p, age, multiple, momentum, maturity, breadth, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.age),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    watchlist: watchlist.has(s.p.slug),
    multiple: round4(s.multiple),
    momentum: round4(s.momentum),
    maturity: round4(s.maturity),
    breadth: round4(s.breadth),
    readiness: readinessOf(s.p, s.age),
  }));
}

/** Everything the dashboard needs, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const implied = board.map((r) => r.implied_value_usd);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    protocols_total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    median_implied_usd: implied.length > 0 ? Math.round(median(implied)) : 0,
    model_version: MODEL_VERSION,
    rows: board,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ------------------------------------------------------------------ farm plans
//
// A farm plan is generated, never written per protocol: the protocol's category picks a family of
// steps, and the protocol's own record fills them in — its name, its first chain and chain count,
// a capital tier from its TVL, a season length from its age, and a gas band from its main chain.
// Every step states its cost and its time, because a plan without either is a slogan.

/** The farm families: category -> the family whose steps fit how that kind of protocol is used. */
const FAMILY: Record<string, string> = {
  Dexs: 'dex',
  'Liquidity Manager': 'dex',
  Lending: 'lending',
  CDP: 'lending',
  'CDP Manager': 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  Derivatives: 'derivatives',
  Synthetics: 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  Options: 'options',
  'Options Vault': 'options',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  Farm: 'yield',
  'Leveraged Farming': 'yield',
  'Basis Trading': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Risk Curators': 'yield',
  Indexes: 'yield',
  'Staking Pool': 'staking',
  Restaking: 'staking',
  'Anchor BTC': 'staking',
  'Decentralized BTC': 'staking',
  'Dual-Token Stablecoin': 'staking',
  'Stablecoin Wrapper': 'staking',
  CeDeFi: 'staking',
  RWA: 'rwa',
  Payments: 'payments',
  'Crypto Card Issuer': 'payments',
  Insurance: 'insurance',
  'Prediction Market': 'prediction',
  Chain: 'chain',
};

/** The working capital of one farm position, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 1000;
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** The season length in weeks, from the protocol's age: younger protocols get a longer window. */
function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 12;
  if (age < 365) return 10;
  if (age < 730) return 8;
  return 6;
}

/** A plain gas band for the protocol's main chain, as a farmer budgets it. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$5-$25 of gas per transaction on Ethereum at busy times';
  if (chain === 'Solana') return 'about $0.05 of network fees per transaction on Solana';
  if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode'].includes(chain)) {
    return `about $0.05-$1 of gas per transaction on ${chain}`;
  }
  if (chain === 'BSC' || chain === 'BNB Chain') return 'about $0.10-$0.50 of gas per transaction on BNB Chain';
  return `about $0.10-$3 of gas per transaction on ${chain}`;
}

/** The chain phrasing a step uses: the main chain, and the reach when there is more than one. */
function chainText(p: SnapshotProtocol): { main: string; reach: string } {
  const main = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const reach = p.chains.length > 1 ? ` (it runs on ${p.chains.length} chains; start on ${main})` : '';
  return { main, reach };
}

/**
 * A protocol's farm plan: five steps, each an action with its cost and its time, drawn from its
 * category's family and filled from its own record.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const family = (p.category !== null ? FAMILY[p.category] : undefined) ?? 'generic';
  const cap = capitalFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const { main, reach } = chainText(p);
  const gas = gasFor(main);
  const n = p.name;
  const setup = `Start with a fresh wallet funded only with the $${cap} you plan to farm plus gas money, and write its seed phrase on paper, offline. Cost: ${gas} to fund and make the first transaction. Time: 10 minutes.`;
  const log = `Keep a farm log for ${n}: wallet address, dates, amounts and transaction hashes, and set a weekly 15-minute slot to repeat the activity and check the position. Cost: nothing but the log. Time: 15 minutes a week for ${weeks} weeks.`;
  const claim = `Each week, open ${n}'s own app and follow only its own points, rewards or governance pages to see whether the activity is being counted; never pay a third party to "unlock" a claim. Cost: no fee to check. Time: 10 minutes a week.`;
  switch (family) {
    case 'dex':
      return [
        setup,
        `Provide $${cap} of liquidity to ${n}'s busiest stablecoin or ETH pair on ${main}${reach}, split evenly between the two assets, and keep the LP position open. Cost: the $${cap} stays in the pool plus ${gas}. Time: 20 minutes to set up.`,
        `Swap about $${Math.max(25, Math.round(cap / 4))} through ${n} twice a week, in both directions, so the wallet shows real trading volume and not one deposit. Cost: the pool's swap fee (usually 0.05%-0.30% a trade) plus ${gas}. Time: 5 minutes a session, for ${weeks} weeks.`,
        `Once a month, move a fifth of the position into a second pair on ${n} so the activity is not a single pool, and harvest any fees or rewards the app shows into the position. Cost: ${gas} per move. Time: 15 minutes a month.`,
        claim,
      ];
    case 'lending':
      return [
        setup,
        `Supply $${cap} of USDC (or the main stablecoin ${n} takes) as collateral on ${main}${reach} and leave it supplied; supplied balances are the activity lending markets count first. Cost: the $${cap} stays supplied plus ${gas}. Time: 15 minutes to set up.`,
        `Borrow about a third of the supplied value against the position and repay it in full after 3-5 days; repeat the borrow-repay cycle once a month so both sides of the market see the wallet. Cost: interest of roughly 3%-8% APR on the borrowed third for a few days (a few dollars) plus ${gas} per leg. Time: 10 minutes a cycle.`,
        `Keep the health factor above 2.0 at all times: check the position weekly and top up collateral if the borrowed asset's price moves against it, rather than farming close to liquidation. Cost: a possible top-up of 10%-20% of the position. Time: 10 minutes a week for ${weeks} weeks.`,
        claim,
      ];
    case 'derivatives':
      return [
        setup,
        `Deposit $${cap} of USDC as margin on ${n} on ${main}${reach} and keep the balance there; margin balances and open interest are what derivatives venues count. Cost: the $${cap} stays as margin plus ${gas}. Time: 15 minutes to set up.`,
        `Open one small hedged trade a week (for example a long and a short of similar size on two liquid markets) and close it within the day, so the wallet builds trading history without directional risk. Cost: taker fees of roughly 0.05% a leg plus funding, about $${Math.max(1, Math.round(cap / 100))} a week. Time: 15 minutes a week for ${weeks} weeks.`,
        `Vary the markets: rotate through ${n}'s two or three most liquid pairs across the season instead of repeating one pair, and keep each trade under a fifth of the margin. Cost: the same weekly fees. Time: included in the weekly session.`,
        claim,
      ];
    case 'options':
      return [
        setup,
        `Deposit $${cap} into ${n}'s flagship vault on ${main}${reach} and keep the vault shares; vault deposits held across epochs are the activity options protocols count. Cost: the $${cap} stays in the vault plus ${gas}. Time: 15 minutes to set up.`,
        `Stay through at least ${Math.max(4, weeks - 2)} full vault epochs without withdrawing: partial in-and-out activity is what most points seasons discount, so let the shares sit and let the yield compound. Cost: the vault's performance fee comes out of yield, not principal. Time: ${weeks} weeks of holding.`,
        `If ${n} lists more than one vault, split a quarter of the position into a second vault after the first epoch so the wallet is not tied to a single strategy. Cost: ${gas} per deposit. Time: 15 minutes.`,
        claim,
      ];
    case 'yield':
      return [
        setup,
        `Deposit $${cap} into ${n}'s main vault or strategy on ${main}${reach} and keep the receipt shares in the wallet; assets under management held over time are the activity yield protocols count. Cost: the $${cap} stays deposited plus ${gas}. Time: 15 minutes to set up.`,
        `Leave the position untouched for the full ${weeks}-week season except a weekly check: harvest rewards only when they exceed the gas to claim them, and restake what you harvest back into the same vault. Cost: ${gas} per harvest, only when worth it. Time: 10 minutes a week.`,
        `In the season's second half, add a second, smaller position of about $${Math.max(25, Math.round(cap / 4))} in another of ${n}'s vaults or on a second chain it runs on, so the wallet shows breadth as well as patience. Cost: the extra deposit plus ${gas}. Time: 20 minutes.`,
        claim,
      ];
    case 'staking':
      return [
        setup,
        `Stake $${cap} of the underlying asset through ${n} on ${main}${reach} and keep the receipt token in the wallet; a held receipt is the clearest on-chain record of participation. Cost: the $${cap} stays staked plus ${gas}. Time: 15 minutes to set up.`,
        `Hold the receipt for the full ${weeks}-week season and do not sell it into a liquidity pool: unstaking queues and early exits are what staking points seasons usually discount. Cost: the stake stays locked or queued per ${n}'s own rules. Time: ${weeks} weeks.`,
        `Use the receipt once in a second venue ${n} itself points to (a restaking layer, a lending market or an LP it lists) with no more than a quarter of the position, so the main stake stays intact. Cost: ${gas} per extra transaction. Time: 20 minutes.`,
        claim,
      ];
    case 'rwa':
      return [
        setup,
        `Complete ${n}'s own onboarding on ${main}${reach} first, including any KYC or eligibility check it requires in your jurisdiction, with the fresh wallet; RWA issuers count verified holders, not anonymous deposits. Cost: no fee to onboard at most issuers. Time: 30-45 minutes once.`,
        `Mint or buy $${cap} of ${n}'s yield asset and hold it in the wallet; holdings across monthly distribution dates are the record that matters here. Cost: the $${cap} stays in the asset plus ${gas}. Time: 20 minutes to set up.`,
        `Hold through at least two distribution or reporting dates (about ${weeks} weeks) and keep the issuer's statements with your farm log, so the position reads as an investor's, not a pass-through. Cost: nothing extra. Time: 10 minutes a month.`,
        claim,
      ];
    case 'payments':
      return [
        setup,
        `Open a ${n} account or card from the fresh wallet on ${main}${reach} and complete the verification it asks for; payments products count verified, active users first. Cost: any card or account fee ${n} lists (often $0-$10). Time: 20-30 minutes once.`,
        `Route about $${Math.max(25, Math.round(cap / 2))} a month of ordinary spending or transfers through ${n} for ${weeks} weeks, in several small payments rather than one lump sum. Cost: the spending itself, plus any per-payment fee ${n} lists (usually 0%-1%). Time: a few minutes a payment.`,
        `Keep a small balance of about $${Math.max(25, Math.round(cap / 4))} in the account between payments so it reads as an account in use, and log every payment in the farm log. Cost: the balance stays in the account. Time: 5 minutes a week.`,
        claim,
      ];
    case 'insurance':
      return [
        setup,
        `Buy a small cover from ${n} on ${main}${reach} for a position you actually hold (for example $${cap} of cover on a lending or staking position in this same farm). Cost: the premium, roughly 2%-4% of the cover a year, plus ${gas}. Time: 15 minutes.`,
        `Keep the cover active for the full ${weeks}-week season and renew it once if it lapses mid-season; an unbroken cover history is the activity insurance protocols can verify. Cost: the renewal premium for the second period. Time: 10 minutes to renew.`,
        `If ${n} runs a capital pool, stake about $${Math.max(25, Math.round(cap / 4))} into it alongside the cover so the wallet appears on both sides of the market. Cost: the stake stays in the pool plus ${gas}. Time: 15 minutes.`,
        claim,
      ];
    case 'prediction':
      return [
        setup,
        `Fund the fresh wallet's ${n} account with $${cap} on ${main}${reach}; prediction markets count funded accounts that trade more than one event. Cost: the $${cap} stays in the account plus ${gas}. Time: 15 minutes.`,
        `Place small positions of about $${Math.max(10, Math.round(cap / 10))} on at least six different markets across the season, favouring liquid markets you can exit, and let at least two settle. Cost: the positions themselves; expect to lose some, so size them as a cost of farming. Time: 15 minutes a week for ${weeks} weeks.`,
        `Provide liquidity on one market if ${n} supports it, with no more than a quarter of the account, and keep quotes up for at least two weeks. Cost: the quoted funds stay in the market. Time: 20 minutes to set up, 5 minutes a week to check.`,
        claim,
      ];
    case 'chain':
      return [
        setup,
        `Bridge $${cap} of stablecoins or ETH to ${n} from ${main === n ? 'Ethereum' : main} using the bridge ${n} itself documents, and keep the funds on the chain; bridged-and-held balances are the first thing a chain's own launch counts. Cost: bridge fees of roughly $1-$10 plus ${gas}. Time: 20 minutes.`,
        `Use two or three of ${n}'s native apps each week (a swap, a lending market, a name or NFT mint it features) so the wallet has ordinary user history, not one bridge transaction. Cost: ${gas} per use, small on a young chain. Time: 20 minutes a week for ${weeks} weeks.`,
        `Hold a small gas-token balance on ${n} the whole season and vote in any governance or community programme the chain runs from its own page. Cost: the balance stays on the chain. Time: 10 minutes a week.`,
        claim,
      ];
    default:
      return [
        setup,
        `Use ${n}'s core product on ${main}${reach} with $${cap}: make the deposit, stake or trade that is its main action, and keep the position open rather than passing through once. Cost: the $${cap} stays in the position plus ${gas}. Time: 20 minutes to set up.`,
        `Repeat one real action a week for ${weeks} weeks (a top-up, a second position, a vote or a claim inside the app) so the wallet shows a season of use and not a single day. Cost: ${gas} per action. Time: 10-15 minutes a week.`,
        log,
        claim,
      ];
  }
}
