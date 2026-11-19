# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/putra549/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/putra549/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [token-radar-01](https://make.fun/bounty/token-radar-01) bounty, "Build the best token launch radar". The program reads the sealed DefiLlama snapshot, ranks the protocols that record no token yet by an implied value, gives each a concrete farm plan, and renders the board as a static dashboard.

## The model

Implied value is **peer-priced** — nothing comes from a list of names; every figure is computed from the snapshot itself:

```
implied_value_usd = TVL x category multiple x momentum x maturity x breadth
```

- **Category multiple** — the median market-cap / TVL ratio of the tokened protocols in the same DefiLlama category (peer ratios trimmed to [0.01, 5] first). A category with fewer than 4 usable peers falls back to its category group's pooled median, then to the global median.
- **Momentum** — the week's TVL change, clamped to [-30%, +60%] and mapped to about x0.87–x1.25.
- **Maturity** — years the protocol has run with no token (from `listed_at` to the snapshot date): +5% a year, capped at 6 years.
- **Breadth** — a mild log term over the number of chains the protocol runs on.

The board carries every one of the snapshot's 40 watchlist protocols plus every other pre-token protocol with at least $15M of TVL outside the watchlist rule's excluded categories and name patterns — 127 rows on this snapshot. Each row also carries a 0–100 readiness score (age, growth, TVL scale; a dashboard aid, never a rank input) and a five-step farm plan generated from its category, chains, TVL tier and age, each step stating its cost and its time.

An implied value is this entry's own estimate from the snapshot's figures — not a prediction that a token will launch, or when, or what it would trade at.

## The dashboard

A single offline page (no framework, no network): a sortable, filterable board with text search, a category filter and a watchlist-only toggle; a detail drawer per protocol showing the model's full working (the multiple and each adjustment, with the formula) and the numbered farm plan. It stages from query parameters for screenshots: `?detail=<slug>` opens a protocol, `?category=<name>` applies a filter on load.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22 or later, standard library only. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, and two runs write identical bytes.
