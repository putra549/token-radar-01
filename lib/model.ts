// The token radar's model ("validated comps", radar-3): one snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet (no CoinGecko id and no symbol in the
// snapshot) by an implied value: what a token would be worth if the market priced this protocol
// the way it already prices comparable protocols whose tokens do trade. Nothing is priced from a
// list of names; every figure below is computed from the snapshot itself at run time.
//
//   implied_value_usd = base value x momentum x maturity x breadth          (whole dollars)
//
//   base      One of three candidate pricings of the protocol's TVL, chosen by held-out
//             validation on the snapshot's own tokened peers (see validateModel):
//               median  TVL x the category's median tokened mcap/TVL multiple (radar-2's anchor);
//               fitted  a log-log regression of mcap on TVL fitted per category group;
//               blend   the geometric mean of the two.
//             The candidates are trained on one half of the peers (a deterministic split by
//             protocol-id hash) and scored on the other half by mean absolute log10 error; the
//             winner prices the board, and the report rides in the dashboard data so the choice
//             is auditable, never asserted.
//   momentum  The week's TVL change, clamped to [-30, +60] percent and mapped linearly to about
//             x0.87 .. x1.25. An unreported change counts as 0 (x1.00).
//   maturity  Years the protocol has run with no token, from listed_at to the snapshot's as_of:
//             x(1 + 0.05 x years), capped at 6 years (x1.30). An unknown listing date counts as
//             1 year.
//   breadth   One mild term for multi-chain reach: x(1 + 0.03 x ln(chains)).
//
// A 0..100 readiness score rides along for the dashboard only (it never moves a rank): age,
// 7-day growth and TVL scale contribute up to 35 / 30 / 35 points.
//
// Board membership (radar-3 widens radar-2's board): every watchlist slug (the floor), plus
// every other protocol that records no token, at any TVL the snapshot carries (its own floor is
// $5M), in any category — a category joins when a defensible multiple exists for it, and on this
// snapshot every category has one: 11 categories hold at least MIN_PEERS tokened peers of their
// own and every other category borrows a category group that pools at least MIN_PEERS (the same
// fallback the pricing uses). What stays out is only what the watchlist rule itself screens out
// as a product of a protocol whose token already trades, applied here to names at every size:
// a whole word wrapped / staked / staking, a version marker at the end of the name, or the name
// of a tokened exchange (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini) at the
// start of the name. Those are wrapped, staked, bridged or exchange-branded products, not first
// launches; everything else that records no token is a launch candidate the radar exists to find.
// One more product screen, from the name's form: in an asset-issuance category (Bridge, CDP,
// Liquid Staking and their kin) a bare ticker for a name — WBTC, USDT0, USDD here — is the
// denominated asset itself, whose token already trades under that ticker; the record simply
// does not carry it. A named organisation in the same categories stays a candidate.

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
export const MODEL_VERSION = 'radar-3 validated comps';

/** How many usable tokened peers a category (or group) needs before its own figure is trusted. */
export const MIN_PEERS = 4;

/** How many fitted peers a category group needs before its own regression is trusted. */
export const MIN_FIT_PEERS = 8;

/** Peer ratios are trimmed into this band before any median is taken or prediction is priced. */
export const RATIO_MIN = 0.01;
export const RATIO_MAX = 5;

/** A name ending in a release marker is a pool of another protocol (the watchlist rule's test). */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name (the watchlist rule's test). */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with a tokened exchange's name (the watchlist rule's exchange test). */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Asset-issuance categories: the categories whose members issue a denominated asset (a wrapped
 * or staked coin, a bridged coin, a stablecoin) rather than run a service.
 */
const ASSET_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'CDP',
  'Stablecoin Wrapper',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
  'Liquid Staking',
]);

/** A bare ticker for a name: one word, at most 7 characters, capitals and digits only. */
const BARE_TICKER = /^[A-Z0-9]{2,7}$/;

/**
 * Whether the entry is the asset itself rather than a protocol that may launch one: in an
 * asset-issuance category, a bare ticker for a name (WBTC, USDT0, USDD in this snapshot) is the
 * denominated coin, whose token already trades under that ticker — the record simply does not
 * carry it. A named organisation in the same categories (a bridge, an issuer) stays a candidate.
 */
function isAssetItself(p: SnapshotProtocol): boolean {
  return p.category !== null && ASSET_CATEGORIES.has(p.category) && !/\s/.test(p.name) && BARE_TICKER.test(p.name);
}

/**
 * Category groups: categories whose tokens the market prices alike. The median multiple falls
 * back through them, and the fitted regression is fitted per group. A category in no group
 * falls back straight to the global figures.
 */
export const GROUPS: Record<string, string[]> = {
  credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management'],
  trading: ['Dexs', 'Derivatives', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Synthetics', 'Prediction Market', 'Launchpad'],
  yield: ['Yield', 'Yield Aggregator', 'Farm', 'Leveraged Farming', 'Basis Trading', 'Liquidity Manager'],
  staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC'],
  'stable-and-rwa': ['Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency', 'RWA'],
  services: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Chain', 'Risk Curators', 'Onchain Capital Allocator', 'Indexes', 'Insurance', 'Payments', 'Crypto Card Issuer', 'CeDeFi', 'Governance Incentives', 'AI Agents', 'Decentralized AI', 'NFT Marketplace', 'OTC Marketplace', 'Token Locker', 'DOR', 'Privacy', 'CEX'],
};

/** The three candidate base pricings the validation chooses between. */
export type BaseModel = 'median' | 'fitted' | 'blend';

/** The held-out validation report: how each candidate priced the peers it had never seen. */
export interface ValidationReport {
  peers: number;
  train: number;
  test: number;
  median_male: number;
  fitted_male: number;
  blend_male: number;
  median_med: number;
  fitted_med: number;
  blend_med: number;
  adopted: BaseModel;
}

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
  median_multiple: number;
  fit_multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  readiness: number;
}

/** Everything the dashboard renders: header figures, the validation report, the board's rows. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  protocols_total: number;
  watchlist_size: number;
  board_size: number;
  median_implied_usd: number;
  model_version: string;
  validation: ValidationReport;
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

/** The group a category belongs to, or null. */
function groupOf(category: string | null): string | null {
  if (category === null) return null;
  for (const [group, members] of Object.entries(GROUPS)) if (members.includes(category)) return group;
  return null;
}

// ------------------------------------------------------------------ peer pricing
//
// The peers are the snapshot's tokened protocols whose record also carries a market cap: they
// are the market's own prices for TVL, and both candidate pricings are built from them alone.
// (Many tokened protocols record no market cap in the snapshot; they cannot price anything and
// are left out, which the dashboard footer states.)

/** One usable peer: a tokened protocol with a market cap, a TVL and a category. */
interface Peer {
  slug: string;
  category: string;
  group: string | null;
  tvl: number;
  mcap: number;
  ratio: number;
}

/** Every usable peer in the snapshot, in snapshot order. */
function peerList(snapshot: Snapshot): Peer[] {
  const peers: Peer[] = [];
  for (const p of snapshot.protocols) {
    if (!recordsToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null) continue;
    peers.push({
      slug: p.slug,
      category: p.category,
      group: groupOf(p.category),
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
      ratio: clamp(p.mcap_usd / p.tvl_usd, RATIO_MIN, RATIO_MAX),
    });
  }
  return peers;
}

/** Trimmed mcap/TVL ratios by category, out of a peer list. */
function ratiosByCategory(peers: Peer[]): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const peer of peers) {
    const list = byCategory.get(peer.category);
    if (list === undefined) byCategory.set(peer.category, [peer.ratio]);
    else list.push(peer.ratio);
  }
  return byCategory;
}

/** The global median ratio of a peer list (0.15 when the list is empty: a neutral placeholder). */
function globalMedianOf(peers: Peer[]): number {
  return peers.length > 0 ? median(peers.map((p) => p.ratio)) : 0.15;
}

/**
 * The median multiple for one category out of a peer list: its own median when it has MIN_PEERS
 * usable peers, else its group's pooled median when the group has MIN_PEERS, else the global.
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

/** A fitted log-log line: ln(mcap) = a + b x ln(tvl), with the peer count it was fitted on. */
interface LogLogFit {
  a: number;
  b: number;
  n: number;
}

/** An ordinary least squares fit of ln(mcap) on ln(tvl); null when the spread is degenerate. */
function fitLogLog(peers: Peer[]): LogLogFit | null {
  if (peers.length < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const p of peers) {
    sx += Math.log(p.tvl);
    sy += Math.log(p.mcap);
  }
  const mx = sx / peers.length;
  const my = sy / peers.length;
  let sxx = 0;
  let sxy = 0;
  for (const p of peers) {
    const dx = Math.log(p.tvl) - mx;
    sxx += dx * dx;
    sxy += dx * (Math.log(p.mcap) - my);
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n: peers.length };
}

/** The fits one peer list supports: one per group with MIN_FIT_PEERS peers, plus the global. */
interface FitSet {
  byGroup: Map<string, LogLogFit>;
  global: LogLogFit | null;
}

function fitSet(peers: Peer[]): FitSet {
  const byGroup = new Map<string, LogLogFit>();
  for (const group of Object.keys(GROUPS)) {
    const members = peers.filter((p) => p.group === group);
    if (members.length >= MIN_FIT_PEERS) {
      const fit = fitLogLog(members);
      if (fit !== null) byGroup.set(group, fit);
    }
  }
  return { byGroup, global: fitLogLog(peers) };
}

/** The fitted base value of a TVL in a category: the group's line where fitted, else the global. */
function fittedBase(category: string | null, tvl: number, fits: FitSet): number {
  const group = groupOf(category);
  const fit = (group !== null ? fits.byGroup.get(group) : undefined) ?? fits.global;
  if (fit === null || tvl <= 0) return tvl * 0.15;
  const predicted = Math.exp(fit.a + fit.b * Math.log(tvl));
  return tvl * clamp(predicted / tvl, RATIO_MIN, RATIO_MAX);
}

/** The median-multiple base value of a TVL in a category. */
function medianBase(category: string | null, tvl: number, ratios: Map<string, number[]>, globalMedian: number): number {
  return tvl * categoryMultiple(category, ratios, globalMedian);
}

/** The base value one candidate model gives a TVL in a category. */
function baseValue(model: BaseModel, category: string | null, tvl: number, ratios: Map<string, number[]>, globalMedian: number, fits: FitSet): number {
  const med = medianBase(category, tvl, ratios, globalMedian);
  if (model === 'median') return med;
  const fit = fittedBase(category, tvl, fits);
  if (model === 'fitted') return fit;
  return Math.sqrt(med * fit);
}

/** A deterministic FNV-1a hash of a slug: the validation split's coin, fixed for every run. */
function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The held-out validation: the peers split in two by slug hash; each candidate is built on the
 * training half alone and scored on the held-out half by the mean (and median) absolute log10
 * error of its market-cap predictions. The winner — the blend on an exact tie, then the median,
 * the incumbent — is the model that prices the board. Everything is a pure function of the
 * snapshot, so two runs report the same numbers.
 */
export function validateModel(snapshot: Snapshot): ValidationReport {
  const peers = peerList(snapshot);
  const train = peers.filter((p) => hashSlug(p.slug) % 2 === 0);
  const test = peers.filter((p) => hashSlug(p.slug) % 2 === 1);
  const ratios = ratiosByCategory(train);
  const globalMedian = globalMedianOf(train);
  const fits = fitSet(train);
  const errors: Record<BaseModel, number[]> = { median: [], fitted: [], blend: [] };
  for (const peer of test) {
    for (const model of ['median', 'fitted', 'blend'] as BaseModel[]) {
      const predicted = baseValue(model, peer.category, peer.tvl, ratios, globalMedian, fits);
      errors[model].push(Math.abs(Math.log10(predicted / peer.mcap)));
    }
  }
  const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const male: Record<BaseModel, number> = { median: mean(errors.median), fitted: mean(errors.fitted), blend: mean(errors.blend) };
  let adopted: BaseModel = 'median';
  if (male.blend <= male.median && male.blend <= male.fitted) adopted = 'blend';
  else if (male.fitted < male.median) adopted = 'fitted';
  return {
    peers: peers.length,
    train: train.length,
    test: test.length,
    median_male: round4(male.median),
    fitted_male: round4(male.fitted),
    blend_male: round4(male.blend),
    median_med: round4(median(errors.median)),
    fitted_med: round4(median(errors.fitted)),
    blend_med: round4(median(errors.blend)),
    adopted,
  };
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

/**
 * Whether a non-watchlist protocol joins the board: it records no token and its name passes
 * the product screens — not a wrapped or staked product, not a versioned redeployment, not an
 * exchange-branded product of a tokened exchange. Category and TVL no longer screen a row out:
 * every category on this snapshot prices from at least MIN_PEERS peers of its own or its group.
 */
function isEarlyRow(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name) && !isAssetItself(p);
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

/** The ranked board: every selected protocol priced by the validated model, ranks 1..N. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerList(snapshot);
  const ratios = ratiosByCategory(peers);
  const globalMedian = globalMedianOf(peers);
  const fits = fitSet(peers);
  const validation = validateModel(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = selectProtocols(snapshot).map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const medBase = medianBase(p.category, p.tvl_usd, ratios, globalMedian);
    const fitBase = fittedBase(p.category, p.tvl_usd, fits);
    const base = validation.adopted === 'median' ? medBase : validation.adopted === 'fitted' ? fitBase : Math.sqrt(medBase * fitBase);
    const momentum = momentumOf(p.change_7d);
    const maturity = maturityOf(age);
    const breadth = breadthOf(p.chains);
    const implied = Math.max(1, Math.round(base * momentum * maturity * breadth));
    return { p, age, base, medBase, fitBase, momentum, maturity, breadth, implied };
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
    multiple: round4(s.base / s.p.tvl_usd),
    median_multiple: round4(s.medBase / s.p.tvl_usd),
    fit_multiple: round4(s.fitBase / s.p.tvl_usd),
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
    validation: validateModel(snapshot),
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
// A farm plan is generated per protocol, never shared: the protocol's category picks the family
// of mechanics, and the protocol's own record writes the steps — its name, its TVL and what a
// position is worth against it, its own 7-day trend, its chains by name (the main chain's gas
// band, a second chain for breadth), its age turned into a season length, and a capital tier
// from its TVL. Two protocols in one family therefore carry different plans, because their
// records differ. Every step states its cost and its time, because a plan without either is a
// slogan.

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
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
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
  Bridge: 'bridge',
  'Canonical Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  CEX: 'cex',
};

/** The working capital of one farm position, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 1000;
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 15_000_000) return 75;
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

/** A plain gas band for a chain, as a farmer budgets it. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$5-$25 of gas per transaction on Ethereum at busy times';
  if (chain === 'Solana') return 'about $0.05 of network fees per transaction on Solana';
  if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode'].includes(chain)) {
    return `about $0.05-$1 of gas per transaction on ${chain}`;
  }
  if (chain === 'BSC' || chain === 'BNB Chain') return 'about $0.10-$0.50 of gas per transaction on BNB Chain';
  return `about $0.10-$3 of gas per transaction on ${chain}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A short dollar figure for prose: $1.23B, $456.7M, $12.3M, $950K. */
function usdText(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** The protocol's own facts, phrased once and reused across its five steps. */
interface FarmFacts {
  n: string;
  main: string;
  second: string | null;
  chainList: string;
  tvl: string;
  share: string;
  trend: string;
  since: string;
  cap: number;
  weeks: number;
  gas: string;
  gas2: string;
}

function farmFacts(p: SnapshotProtocol, age: number | null): FarmFacts {
  const cap = capitalFor(p.tvl_usd);
  const main = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const shown = p.chains.slice(0, 3).join(', ');
  const chainList = p.chains.length > 3 ? `${shown} and ${p.chains.length - 3} more` : shown || 'no chain recorded';
  const shareBps = (cap / Math.max(1, p.tvl_usd)) * 10_000;
  const share = shareBps >= 1 ? `about ${shareBps.toFixed(1)} basis points of its TVL` : `about ${shareBps.toFixed(2)} basis points of its TVL`;
  const c = p.change_7d;
  const trend =
    c === null
      ? 'DefiLlama reports no 7-day TVL change for it, so size the position as if it were flat'
      : c >= 5
        ? `its TVL is up ${c.toFixed(1)}% in the last 7 days, so the season starts while it is growing`
        : c <= -5
          ? `its TVL is down ${Math.abs(c).toFixed(1)}% in the last 7 days, so start at half size and add only if the trend levels off`
          : `its TVL is roughly flat over 7 days (${c >= 0 ? '+' : ''}${c.toFixed(1)}%), so size the position steadily`;
  let since = 'DefiLlama gives no listing date for it, so treat its age as unproven';
  if (p.listed_at !== null && age !== null) {
    const parts = p.listed_at.split('-');
    const when = parts.length === 3 ? `${MONTHS[Number(parts[1]) - 1] ?? ''} ${parts[0]}` : p.listed_at;
    since = `DefiLlama has tracked it since ${when} (${(age / 365.25).toFixed(1)} years with no token recorded)`;
  }
  return {
    n: p.name,
    main,
    second,
    chainList,
    tvl: usdText(p.tvl_usd),
    share,
    trend,
    since,
    cap,
    weeks: weeksFor(age),
    gas: gasFor(main),
    gas2: gasFor(second ?? main),
  };
}

/**
 * A protocol's farm plan: five steps generated from its own record — its category's mechanics,
 * filled with its name, TVL, trend, chains, age and tier. Each step is an action with its cost
 * and its time.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const family = (p.category !== null ? FAMILY[p.category] : undefined) ?? 'generic';
  const f = farmFacts(p, age);
  const setup = `Open a fresh wallet for ${f.n} alone and fund it with the $${f.cap} you plan to farm plus gas money; write the seed phrase on paper, offline. ${f.n} holds ${f.tvl} of TVL across ${f.chainList}, and ${f.since}. Cost: ${f.gas} to fund it. Time: 10 minutes.`;
  const monitor = `Keep a farm log for ${f.n} (wallet, dates, amounts, hashes) and check its own app weekly for points, rewards or governance pages that count this activity; never pay a third party to "unlock" a claim. Cost: nothing to check. Time: 15 minutes a week for the ${f.weeks}-week season.`;
  const breadth =
    f.second !== null
      ? `In week 3, repeat a small action on ${f.second}, ${f.n}'s second chain, with about $${Math.max(25, Math.round(f.cap / 4))}, so the wallet is not a one-chain record. Cost: ${f.gas2}. Time: 20 minutes.`
      : `In week 3, add a second, smaller position of about $${Math.max(25, Math.round(f.cap / 4))} in another market or vault ${f.n} runs on ${f.main}, so the wallet is not a single action. Cost: ${f.gas}. Time: 20 minutes.`;
  switch (family) {
    case 'dex':
      return [
        setup,
        `Provide $${f.cap} of liquidity to ${f.n}'s busiest stablecoin or ETH pair on ${f.main}, split evenly between the two assets — ${shareNote(f)}; ${f.trend}. Cost: the $${f.cap} stays in the pool plus ${f.gas}. Time: 20 minutes to set up.`,
        `Swap about $${Math.max(25, Math.round(f.cap / 4))} through ${f.n} twice a week in both directions, so the wallet shows real volume and not one deposit. Cost: the pool fee (usually 0.05%-0.30% a trade) plus ${f.gas}. Time: 5 minutes a session, ${f.weeks} weeks.`,
        breadth,
        monitor,
      ];
    case 'lending':
      return [
        setup,
        `Supply $${f.cap} of USDC (or the main stablecoin ${f.n} takes) as collateral on ${f.main} and leave it supplied — ${shareNote(f)}; supplied balances are what lending markets count first. Cost: the $${f.cap} stays supplied plus ${f.gas}. Time: 15 minutes.`,
        `Borrow about a third of the supplied value and repay it in full after 3-5 days; repeat monthly so both sides of ${f.n}'s market see the wallet. Cost: roughly 3%-8% APR on the borrowed third for a few days (a few dollars) plus ${f.gas} per leg. Time: 10 minutes a cycle.`,
        `Keep the health factor above 2.0 all season: check weekly and top up collateral rather than farming near liquidation, because ${f.trend}. Cost: a possible top-up of 10%-20% of the position. Time: 10 minutes a week for ${f.weeks} weeks.`,
        monitor,
      ];
    case 'derivatives':
      return [
        setup,
        `Deposit $${f.cap} of USDC as margin on ${f.n} on ${f.main} and keep the balance there — ${shareNote(f)}; margin and open interest are what derivatives venues count. Cost: the $${f.cap} stays as margin plus ${f.gas}. Time: 15 minutes.`,
        `Open one small hedged trade a week (a long and a short of similar size on two liquid markets) and close it within the day, building history without directional risk. Cost: taker fees of roughly 0.05% a leg plus funding, about $${Math.max(1, Math.round(f.cap / 100))} a week. Time: 15 minutes a week, ${f.weeks} weeks.`,
        `Rotate through ${f.n}'s two or three most liquid pairs across the season instead of repeating one, keeping each trade under a fifth of the margin; ${f.trend}. Cost: the same weekly fees. Time: inside the weekly session.`,
        monitor,
      ];
    case 'options':
      return [
        setup,
        `Deposit $${f.cap} into ${f.n}'s flagship vault on ${f.main} and keep the vault shares — ${shareNote(f)}; deposits held across epochs are what options protocols count. Cost: the $${f.cap} stays in the vault plus ${f.gas}. Time: 15 minutes.`,
        `Stay through at least ${Math.max(4, f.weeks - 2)} full vault epochs without withdrawing: in-and-out activity is what points seasons discount, so let the shares sit and compound. Cost: the vault's performance fee comes out of yield, not principal. Time: ${f.weeks} weeks of holding.`,
        breadth,
        monitor,
      ];
    case 'yield':
      return [
        setup,
        `Deposit $${f.cap} into ${f.n}'s main vault or strategy on ${f.main} and keep the receipt shares — ${shareNote(f)}; assets held over time are what yield protocols count. Cost: the $${f.cap} stays deposited plus ${f.gas}. Time: 15 minutes.`,
        `Leave the position untouched for the ${f.weeks}-week season except a weekly check: harvest only when rewards exceed the gas to claim them, and restake what you harvest into the same vault. Cost: ${f.gas} per harvest, only when worth it. Time: 10 minutes a week.`,
        breadth,
        monitor,
      ];
    case 'staking':
      return [
        setup,
        `Stake $${f.cap} of the underlying asset through ${f.n} on ${f.main} and keep the receipt token in the wallet — ${shareNote(f)}; a held receipt is the clearest on-chain record of participation. Cost: the $${f.cap} stays staked plus ${f.gas}. Time: 15 minutes.`,
        `Hold the receipt for the full ${f.weeks}-week season and do not sell it into a liquidity pool: unstaking queues and early exits are what staking seasons usually discount. Cost: the stake stays locked or queued under ${f.n}'s own rules. Time: ${f.weeks} weeks.`,
        breadth,
        monitor,
      ];
    case 'rwa':
      return [
        setup,
        `Complete ${f.n}'s own onboarding on ${f.main} first, including any KYC or eligibility check it requires in your jurisdiction, with the fresh wallet; RWA issuers count verified holders, not anonymous deposits. Cost: no fee to onboard at most issuers. Time: 30-45 minutes once.`,
        `Mint or buy $${f.cap} of ${f.n}'s yield asset and hold it in the wallet — ${shareNote(f)}; holdings across distribution dates are the record that matters here. Cost: the $${f.cap} stays in the asset plus ${f.gas}. Time: 20 minutes.`,
        `Hold through at least two distribution or reporting dates (about ${f.weeks} weeks), because ${f.trend}, and keep the issuer's statements with the farm log so the position reads as an investor's. Cost: nothing extra. Time: 10 minutes a month.`,
        monitor,
      ];
    case 'payments':
      return [
        setup,
        `Open a ${f.n} account or card from the fresh wallet on ${f.main} and complete the verification it asks for; payments products count verified, active users first. Cost: any account or card fee ${f.n} lists (often $0-$10). Time: 20-30 minutes once.`,
        `Route about $${Math.max(25, Math.round(f.cap / 2))} a month of ordinary spending or transfers through ${f.n} for ${f.weeks} weeks, in several small payments rather than one lump sum. Cost: the spending itself plus any per-payment fee ${f.n} lists (usually 0%-1%). Time: a few minutes a payment.`,
        `Keep a balance of about $${Math.max(25, Math.round(f.cap / 4))} in the account between payments so it reads as an account in use, and log every payment; ${f.trend}. Cost: the balance stays in the account. Time: 5 minutes a week.`,
        monitor,
      ];
    case 'insurance':
      return [
        setup,
        `Buy a small cover from ${f.n} on ${f.main} for a position you actually hold (for example $${f.cap} of cover on a lending or staking position in this same farm). Cost: the premium, roughly 2%-4% of the cover a year, plus ${f.gas}. Time: 15 minutes.`,
        `Keep the cover active for the full ${f.weeks}-week season and renew it once if it lapses mid-season; an unbroken cover history is the activity insurance protocols can verify. Cost: the renewal premium for the second period. Time: 10 minutes to renew.`,
        `If ${f.n} runs a capital pool, stake about $${Math.max(25, Math.round(f.cap / 4))} into it alongside the cover so the wallet appears on both sides of its market. Cost: the stake stays in the pool plus ${f.gas}. Time: 15 minutes.`,
        monitor,
      ];
    case 'prediction':
      return [
        setup,
        `Fund the fresh wallet's ${f.n} account with $${f.cap} on ${f.main}; prediction markets count funded accounts that trade more than one event. Cost: the $${f.cap} stays in the account plus ${f.gas}. Time: 15 minutes.`,
        `Place small positions of about $${Math.max(10, Math.round(f.cap / 10))} on at least six different markets across the season, favouring liquid markets you can exit, and let at least two settle. Cost: the positions themselves; size them as a cost of farming. Time: 15 minutes a week for ${f.weeks} weeks.`,
        `Provide liquidity on one market if ${f.n} supports it, with no more than a quarter of the account, and keep quotes up for at least two weeks. Cost: the quoted funds stay in the market. Time: 20 minutes to set up, 5 minutes a week to check.`,
        monitor,
      ];
    case 'chain':
      return [
        setup,
        `Bridge $${f.cap} of stablecoins or ETH to ${f.n} using the bridge it documents, and keep the funds on the chain; bridged-and-held balances are the first thing a chain's own launch counts. Cost: bridge fees of roughly $1-$10 plus ${f.gas}. Time: 20 minutes.`,
        `Use two or three of ${f.n}'s native apps each week (a swap, a lending market, a name or NFT mint it features) so the wallet has ordinary user history, not one bridge transaction. Cost: ${f.gas} per use, small on a young chain. Time: 20 minutes a week for ${f.weeks} weeks.`,
        `Hold a small gas-token balance on ${f.n} the whole season and vote in any governance or community programme the chain runs from its own page. Cost: the balance stays on the chain. Time: 10 minutes a week.`,
        monitor,
      ];
    case 'bridge':
      return [
        setup,
        `Bridge $${f.cap} of stablecoins through ${f.n} from ${f.main} to ${f.second ?? 'a second chain it supports'} and keep the funds working on the far side for the season; routed-and-held volume is what bridges count. Cost: bridge fees of roughly $1-$10 plus ${f.gas}. Time: 20 minutes.`,
        `Make one crossing a week in alternating directions with about $${Math.max(25, Math.round(f.cap / 4))}, so the wallet shows habitual use rather than a single transfer. Cost: the same per-crossing fees. Time: 10 minutes a week for ${f.weeks} weeks.`,
        `If ${f.n} runs a liquidity pool, park about $${Math.max(25, Math.round(f.cap / 4))} in it between crossings so the wallet also appears as a liquidity provider. Cost: the funds stay in the pool plus ${f.gas}. Time: 15 minutes.`,
        monitor,
      ];
    case 'cex':
      return [
        setup,
        `Register on ${f.n} from the fresh wallet's email and complete the KYC tier that unlocks spot trading; exchanges count verified users who trade, not sign-ups. Cost: no fee to register at most exchanges. Time: 20-30 minutes once.`,
        `Deposit $${f.cap} of stablecoins and make two or three small spot trades a week across ${f.weeks} weeks, favouring its most liquid pairs. Cost: maker/taker fees of roughly 0.1% a trade on the amounts traded. Time: 10 minutes a session.`,
        `Keep a balance of about $${Math.max(25, Math.round(f.cap / 4))} on ${f.n} between sessions and join any launchpool or earn product it runs from its own page, because ${f.trend}. Cost: the balance stays on the exchange. Time: 5 minutes a week.`,
        monitor,
      ];
    default:
      return [
        setup,
        `Use ${f.n}'s core product on ${f.main} with $${f.cap}: make the deposit, stake or trade that is its main action — ${shareNote(f)} — and keep the position open rather than passing through once. Cost: the $${f.cap} stays in the position plus ${f.gas}. Time: 20 minutes.`,
        `Repeat one real action a week for ${f.weeks} weeks (a top-up, a second position, a vote or a claim inside the app) so the wallet shows a season of use and not a single day. Cost: ${f.gas} per action. Time: 10-15 minutes a week.`,
        breadth,
        monitor,
      ];
  }
}

/** A position's weight against the protocol's own TVL, phrased for a step. */
function shareNote(f: FarmFacts): string {
  return `the position is ${f.share} against its ${f.tvl} of TVL, sized to be a real user, not a whale`;
}
