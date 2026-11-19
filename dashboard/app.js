// Token Launch Radar — the board page. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, its filters and sorts, and a per-protocol detail drawer carrying
// the model's own working and the protocol's farm plan. No network: every byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    watchlist: params.get('watchlist') === '1',
    sort: 'rank',
    dir: 1,
    selected: null
  };

  function el(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return null;
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''); }
  function ageText(listedAt) {
    if (!listedAt) return 'unknown';
    var days = Math.floor((Date.parse(DATA.as_of + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000);
    if (!isFinite(days) || days < 0) return 'unknown';
    if (days >= 365) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 30) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }

  // ---- header stats -------------------------------------------------------
  var stats = el('stats');
  [
    ['Protocols ranked', String(DATA.board_size)],
    ['On the watchlist', String(DATA.watchlist_size)],
    ['Median implied value', fmtUsd(DATA.median_implied_usd)],
    ['Snapshot as of', DATA.as_of]
  ].forEach(function (pair) {
    var d = make('div');
    d.appendChild(make('dt', null, pair[0]));
    d.appendChild(make('dd', null, pair[1]));
    stats.appendChild(d);
  });

  // ---- controls -----------------------------------------------------------
  var qInput = el('q');
  var catSelect = el('category');
  var wlToggle = el('watchlist-only');
  qInput.value = state.q;
  wlToggle.checked = state.watchlist;

  var cats = [];
  var catCount = {};
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (!(c in catCount)) { catCount[c] = 0; cats.push(c); }
    catCount[c]++;
  });
  cats.sort();
  catSelect.appendChild(new Option('All categories (' + rows.length + ')', 'all'));
  cats.forEach(function (c) { catSelect.appendChild(new Option(c + ' (' + catCount[c] + ')', c)); });
  if (state.category !== 'all' && cats.indexOf(state.category) === -1) state.category = 'all';
  catSelect.value = state.category;

  qInput.addEventListener('input', function () { state.q = qInput.value; render(); });
  catSelect.addEventListener('change', function () { state.category = catSelect.value; render(); });
  wlToggle.addEventListener('change', function () { state.watchlist = wlToggle.checked; render(); });

  // ---- sorting ------------------------------------------------------------
  var KEY = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    chains: function (r) { return r.chains.length; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d; },
    implied: function (r) { return r.implied_value_usd; },
    readiness: function (r) { return r.readiness; }
  };
  var heads = Array.prototype.slice.call(document.querySelectorAll('thead th'));
  function markHeads() {
    heads.forEach(function (th) {
      var old = th.querySelector('.dir');
      if (old) old.remove();
      if (th.getAttribute('data-sort') === state.sort) {
        th.appendChild(make('span', 'dir', state.dir === 1 ? ' ▲' : ' ▼'));
      }
    });
  }
  heads.forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) {
        state.dir = -state.dir;
      } else {
        state.sort = key;
        state.dir = (key === 'rank' || key === 'name' || key === 'category') ? 1 : -1;
      }
      render();
    });
  });

  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1 && (r.category || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = KEY[state.sort];
    list.sort(function (a, b) {
      var av = key(a), bv = key(b);
      if (av === null && bv === null) return a.rank - b.rank;
      if (av === null) return 1;
      if (bv === null) return -1;
      var cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return cmp * state.dir || a.rank - b.rank;
    });
    return list;
  }

  // ---- board --------------------------------------------------------------
  var tbody = el('rows');
  var count = el('count');
  function render() {
    var list = visible();
    markHeads();
    count.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
    var frag = document.createDocumentFragment();
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.setAttribute('data-slug', r.slug);
      var rank = make('td', 'num rank', String(r.rank));
      var name = make('td', 'name');
      if (r.watchlist) {
        var dot = make('span', 'wl-dot');
        dot.title = 'On the snapshot watchlist';
        name.appendChild(dot);
      }
      name.appendChild(document.createTextNode(r.name));
      name.appendChild(make('span', 'slug', r.slug));
      var cat = make('td', 'cat', r.category || 'Uncategorised');
      var chains = make('td', 'num chains', String(r.chains.length));
      chains.title = r.chains.join(', ');
      var tvl = make('td', 'num', fmtUsd(r.tvl_usd));
      var chg = make('td', 'num');
      var pct = fmtPct(r.change_7d);
      if (pct === null) chg.appendChild(make('span', 'na', 'n/a'));
      else chg.appendChild(make('span', r.change_7d >= 0 ? 'up' : 'down', pct));
      var implied = make('td', 'num implied', fmtUsd(r.implied_value_usd));
      var ready = make('td', 'num');
      var wrap = make('div', 'ready');
      var bar = make('span', 'bar');
      var fill = make('i');
      fill.style.width = r.readiness + '%';
      bar.appendChild(fill);
      wrap.appendChild(bar);
      wrap.appendChild(make('span', null, String(r.readiness)));
      ready.appendChild(wrap);
      [rank, name, cat, chains, tvl, chg, implied, ready].forEach(function (td) { tr.appendChild(td); });
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openDetail(r.slug); });
      frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);
  }

  // ---- detail drawer ------------------------------------------------------
  var detail = el('detail');
  var scrim = el('scrim');
  function compRow(label, value, frac) {
    var row = make('div', 'comp');
    row.appendChild(make('span', 'lbl', label));
    var bar = make('span', 'bar');
    var fill = make('i');
    fill.style.width = Math.max(3, Math.min(100, frac * 100)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(make('span', 'val', fmtMult(value)));
    return row;
  }
  function kv(label, value) {
    var d = make('div');
    var t = make('dt', null, label);
    var dd = make('dd', null, value);
    d.appendChild(t); d.appendChild(dd);
    return d;
  }
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.selected = slug;
    detail.replaceChildren();
    var close = make('button', 'close', '×');
    close.setAttribute('aria-label', 'Close detail');
    close.addEventListener('click', closeDetail);
    detail.appendChild(close);
    detail.appendChild(make('h2', null, r.name));
    var sub = make('p', 'sub');
    if (r.watchlist) {
      var b = make('span', 'badge wl', 'Watchlist');
      sub.appendChild(b);
    }
    var cb = make('span', 'badge', r.category || 'Uncategorised');
    sub.appendChild(cb);
    sub.appendChild(document.createTextNode(' Rank #' + r.rank + ' of ' + rows.length));
    detail.appendChild(sub);
    detail.appendChild(make('p', 'big-label', 'Implied value'));
    detail.appendChild(make('p', 'big', fmtUsd(r.implied_value_usd)));
    var grid = make('dl', 'kv');
    grid.appendChild(kv('TVL', fmtUsd(r.tvl_usd)));
    var pct = fmtPct(r.change_7d);
    grid.appendChild(kv('7d TVL change', pct === null ? 'n/a' : pct));
    grid.appendChild(kv('Running for', ageText(r.listed_at) + (r.listed_at ? ' (since ' + r.listed_at + ')' : '')));
    grid.appendChild(kv('Readiness', r.readiness + ' / 100'));
    grid.appendChild(kv('Chains (' + r.chains.length + ')', r.chains.length ? r.chains.join(', ') : 'none recorded'));
    grid.appendChild(kv('Token', 'none recorded in the snapshot'));
    detail.appendChild(grid);
    detail.appendChild(make('h3', null, 'How the value is built'));
    var formula = make('p', 'formula',
      fmtUsd(r.tvl_usd) + ' TVL x ' + r.multiple.toFixed(3) + ' multiple x ' + fmtMult(r.momentum) +
      ' momentum x ' + fmtMult(r.maturity) + ' maturity x ' + fmtMult(r.breadth) + ' breadth = ' + fmtUsd(r.implied_value_usd));
    detail.appendChild(formula);
    detail.appendChild(compRow('Multiple', r.multiple, Math.min(r.multiple, 2) / 2));
    detail.appendChild(compRow('Momentum', r.momentum, (r.momentum - 0.85) / 0.4));
    detail.appendChild(compRow('Maturity', r.maturity, (r.maturity - 1) / 0.3));
    detail.appendChild(compRow('Breadth', r.breadth, (r.breadth - 1) / 0.1));
    detail.appendChild(make('h3', null, 'Farm plan'));
    var ol = make('ol', 'steps');
    r.farm_steps.forEach(function (s) { ol.appendChild(make('li', null, s)); });
    detail.appendChild(ol);
    detail.hidden = false;
    scrim.hidden = false;
  }
  function closeDetail() {
    state.selected = null;
    detail.hidden = true;
    scrim.hidden = true;
  }
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDetail(); });

  render();
  var startDetail = params.get('detail');
  if (startDetail && bySlug[startDetail]) openDetail(startDetail);
})();
