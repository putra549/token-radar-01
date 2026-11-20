# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/putra549/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/putra549/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty, "Build the best token launch radar". The program reads the sealed DefiLlama snapshot, ranks the protocols that record no token yet by an implied value, gives each a concrete farm plan generated from its own record, and renders the board as a static dashboard.

## The board

**296 rows** on this snapshot: all 40 watchlist protocols plus 256 further pre-token protocols. Membership is a rule, not a list: every protocol that records no token is a candidate, in any category and at any TVL the snapshot carries, because every category prices defensibly (11 categories hold at least 4 tokened peers of their own; every other borrows a category group pooling at least 4). What stays out is only what marks a product of a protocol whose token already trades, screened from the record itself: a whole word *wrapped / staked / staking* in the name, a version marker at the end of the name, a tokened exchange's name at the start of the name — and, in asset-issuance categories, a bare ticker for a name (WBTC, USDT0), which is the denominated asset itself rather than a protocol awaiting a launch.

## The model

Implied value is **peer-priced and validated** — nothing comes from a list of names; every figure is computed from the snapshot itself:

```
implied_value_usd = base value x momentum x maturity x breadth
```

The base value is chosen by held-out validation, not asserted. Three candidate pricings of a protocol's TVL are built on one half of the snapshot's 128 usable tokened peers (a deterministic split by protocol-id hash: 59 train / 69 held out) and scored on the held-out half by mean absolute log10 error of their market-cap predictions:

| candidate | held-out mean abs log10 error | held-out median abs log10 error |
|---|---|---|
| category median multiple (v1's anchor) | 0.7888 | 0.6227 |
| fitted log-log curve (mcap on TVL, per category group) | 0.7633 | 0.7251 |
| **geometric blend of the two — adopted** | **0.7448** | **0.5942** |

- **Base value** — the blend: the geometric mean of the median-multiple price (the category's median tokened mcap/TVL, peer ratios trimmed to [0.01, 5], a thin category borrowing its group's pooled median, then the global median) and the fitted curve's price (a log-log regression per category group, so the implied multiple bends down as TVL grows).
- **Momentum** — the week's TVL change, clamped to [-30%, +60%] and mapped to about x0.87–x1.25.
- **Maturity** — years the protocol has run with no token (from `listed_at` to the snapshot date): +5% a year, capped at 6 years.
- **Breadth** — a mild log term over the number of chains the protocol runs on.

Each row also carries a 0–100 readiness score (age, growth, TVL scale; a dashboard aid, never a rank input) and both rejected anchors beside the adopted one, so a reader can see the model's disagreement, not just its answer. The errors above are large in absolute terms — pricing an unlaunched token from TVL alone is genuinely uncertain — and the board says so: the validation exists to pick the least-wrong pricing on evidence, and its numbers are printed in the dashboard's footer and in every run's data.

## Farm plans

Each protocol's five-step plan is generated from **its own record**: its category's mechanics, filled with its name, its TVL and what a position is worth against it (in basis points of TVL), its own 7-day trend (a shrinking protocol gets a half-size start), its chains by name with the main chain's gas band and a second-chain breadth step, its age turned into a season length, and a capital tier from its TVL ($50–$1,000). No two protocols share a plan unless their records coincide; every step states its cost and its time.

An implied value is this entry's own estimate from the snapshot's figures — not a prediction that a token will launch, or when, or what it would trade at.

## The dashboard

A single offline page (no framework, no network): a sortable, filterable board with text search, a category filter and a watchlist-only toggle; a detail drawer per protocol showing the model's full decomposition (base, momentum, maturity and breadth as bars with the formula), both peer anchors with their base values, and the numbered farm plan; and a side-by-side comparison — pick up to three protocols with the `vs` buttons and read every model figure for them on the same rows. It stages from query parameters for screenshots: `?detail=<slug>` opens a protocol, `?category=<name>` applies a filter on load, `?compare=<slug,slug,slug>` opens the comparison.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22 or later, standard library only. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, and two runs write identical bytes.
