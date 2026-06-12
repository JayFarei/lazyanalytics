import type { Context } from 'hono';
import type { Env } from './index';

// Self-contained dashboard page. No external assets, no secrets, and no site
// list baked in: the API token is entered by the user and kept in
// sessionStorage, then sent as a Bearer header to the existing /api/*
// endpoints. The site list is fetched from /api/sites after auth.
const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analytics</title>
<style>
  :root {
    --bg: #0b0e14;
    --panel: #121723;
    --panel-2: #161c2b;
    --border: #1f2738;
    --text: #e6ebf4;
    --muted: #8b94a7;
    --accent: #5eead4;
    --accent-dim: rgba(94, 234, 212, 0.12);
    --bar: rgba(94, 234, 212, 0.14);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 60px; }

  header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 24px; }
  header h1 { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  header h1 .dot { color: var(--accent); }
  .spacer { flex: 1; }
  .periods { display: flex; gap: 4px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
  .periods button {
    border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 13px;
    padding: 4px 10px; border-radius: 6px; cursor: pointer;
  }
  .periods button.active { background: var(--panel-2); color: var(--text); }
  .periods button:hover { color: var(--text); }
  .logout { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
  .logout:hover { color: var(--text); }

  .properties { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .prop {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; cursor: pointer; text-align: left; font: inherit; color: inherit;
    transition: border-color 0.15s;
  }
  .prop:hover { border-color: #2c3850; }
  .prop.active { border-color: var(--accent); background: var(--panel-2); }
  .prop .name { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  .prop.active .name { color: var(--accent); }
  .prop .nums { display: flex; align-items: baseline; gap: 10px; }
  .prop .views { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .prop .visitors { font-size: 12px; color: var(--muted); }
  .prop svg { display: block; width: 100%; height: 28px; margin-top: 10px; }

  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  .panel h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 14px; }

  .chart-panel { margin-bottom: 16px; }
  .chart-head { display: flex; align-items: baseline; gap: 24px; margin-bottom: 8px; }
  .bignum .v { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .bignum .l { font-size: 12px; color: var(--muted); }
  #chart { width: 100%; height: 220px; display: block; }
  .xlabels { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }

  .tabs { display: flex; gap: 12px; margin-bottom: 14px; }
  .tabs button { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; padding: 0; }
  .tabs button.active { color: var(--text); border-bottom: 2px solid var(--accent); padding-bottom: 2px; }

  .rows { display: flex; flex-direction: column; gap: 4px; }
  .row { position: relative; display: flex; justify-content: space-between; gap: 12px; padding: 5px 8px; border-radius: 6px; overflow: hidden; }
  .row .fill { position: absolute; inset: 0; background: var(--bar); border-radius: 6px; transform-origin: left; }
  .row .label, .row .val { position: relative; }
  .row .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .val { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .empty { color: var(--muted); font-size: 13px; padding: 8px 0; }

  .loading { opacity: 0.45; pointer-events: none; }
  .foot { margin-top: 24px; font-size: 12px; color: var(--muted); }
  .err { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.35); color: #fca5a5; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: none; }

  /* Token gate */
  #gate { max-width: 360px; margin: 18vh auto 0; padding: 0 20px; }
  #gate .panel { padding: 26px; }
  #gate h1 { font-size: 16px; margin-bottom: 6px; }
  #gate p { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  #gate input {
    width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font: inherit; padding: 9px 12px; margin-bottom: 12px;
  }
  #gate input:focus { outline: none; border-color: var(--accent); }
  #gate button {
    width: 100%; border: 0; border-radius: 8px; background: var(--accent); color: #06241f;
    font: inherit; font-weight: 600; padding: 9px 12px; cursor: pointer;
  }
  #gate .gate-err { color: #fca5a5; font-size: 13px; margin-top: 10px; display: none; }
</style>
</head>
<body>

<div id="gate" style="display:none">
  <div class="panel">
    <h1>Analytics<span style="color:var(--accent)">.</span></h1>
    <p>Enter your API token to view the dashboard.</p>
    <input id="gate-input" type="password" placeholder="API token" autocomplete="off">
    <button id="gate-btn">Unlock</button>
    <div class="gate-err" id="gate-err">Invalid token. Try again.</div>
  </div>
</div>

<div class="wrap" id="app" style="display:none">
  <header>
    <h1>Analytics<span class="dot">.</span></h1>
    <div class="spacer"></div>
    <div class="periods" id="periods"></div>
    <button class="logout" id="logout" title="Forget token">Sign out</button>
  </header>

  <div class="err" id="err"></div>

  <div class="properties" id="properties"></div>

  <div class="panel chart-panel" id="chart-wrap">
    <div class="chart-head">
      <div class="bignum"><div class="v" id="stat-views">&ndash;</div><div class="l">Pageviews</div></div>
      <div class="bignum"><div class="v" id="stat-visitors">&ndash;</div><div class="l">Visitors (approx)</div></div>
    </div>
    <svg id="chart" preserveAspectRatio="none"></svg>
    <div class="xlabels" id="xlabels"></div>
  </div>

  <div class="grid">
    <div class="panel" id="p-pages"><h2>Top pages</h2><div class="rows"></div></div>
    <div class="panel" id="p-referrers"><h2>Referrers</h2><div class="rows"></div></div>
    <div class="panel" id="p-geo"><h2>Countries</h2><div class="rows"></div></div>
    <div class="panel" id="p-devices">
      <div class="tabs" id="device-tabs">
        <button data-type="browser" class="active">Browsers</button>
        <button data-type="os">OS</button>
        <button data-type="device">Devices</button>
      </div>
      <div class="rows"></div>
    </div>
  </div>

  <div class="foot">Counts are sampling-adjusted (Cloudflare Analytics Engine). Data retained for 90 days.</div>
</div>

<script>
(function () {
  'use strict';
  var SITES = [];
  var PERIODS = [
    { key: '1d', label: '24h', unit: 'hour' },
    { key: '7d', label: '7d', unit: 'day' },
    { key: '30d', label: '30d', unit: 'day' },
    { key: '90d', label: '90d', unit: 'day' }
  ];

  var token = sessionStorage.getItem('aa_token') || '';
  var site = localStorage.getItem('aa_site');
  var period = localStorage.getItem('aa_period') || '7d';
  if (!PERIODS.some(function (p) { return p.key === period; })) period = '7d';
  var deviceType = 'browser';
  var loadSeq = 0;

  var $ = function (sel) { return document.querySelector(sel); };

  function api(endpoint, params) {
    var qs = new URLSearchParams(params).toString();
    return fetch('/api/' + endpoint + '?' + qs, {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (r) {
      if (r.status === 401) { showGate(true); throw new Error('unauthorized'); }
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          throw new Error(b.error || ('HTTP ' + r.status));
        });
      }
      return r.json();
    });
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\\.0$/, '') + 'k';
    return Math.round(n).toLocaleString();
  }

  var regionNames;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { regionNames = null; }
  function countryLabel(code) {
    if (!code || code.length !== 2) return code || 'Unknown';
    var flag = String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1));
    var name = code;
    if (regionNames) { try { name = regionNames.of(code) || code; } catch (e) {} }
    return flag + ' ' + name;
  }

  // --- Token gate ---
  function showGate(invalid) {
    $('#app').style.display = 'none';
    $('#gate').style.display = 'block';
    $('#gate-err').style.display = invalid ? 'block' : 'none';
    $('#gate-input').focus();
  }
  // Fetch the configured site list (also validates the token: 401 shows the gate).
  function fetchSites() {
    return api('sites', {}).then(function (res) {
      SITES = res.data.map(function (r) { return r.site; });
    });
  }
  function enterApp() {
    if (SITES.indexOf(site) === -1) site = SITES[0];
    $('#gate').style.display = 'none';
    $('#app').style.display = 'block';
    if (!SITES.length) {
      showErr(new Error('No sites configured. Add sites to ALLOWED_SITES and redeploy.'));
      return;
    }
    loadAll();
  }
  function submitToken() {
    var v = $('#gate-input').value.trim();
    if (!v) return;
    token = v;
    fetchSites().then(function () {
      sessionStorage.setItem('aa_token', token);
      enterApp();
    }).catch(function (e) {
      if (e.message !== 'unauthorized') {
        $('#gate-err').textContent = e.message;
        $('#gate-err').style.display = 'block';
      }
    });
  }
  $('#gate-btn').addEventListener('click', submitToken);
  $('#gate-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitToken(); });
  $('#logout').addEventListener('click', function () {
    sessionStorage.removeItem('aa_token');
    token = '';
    $('#gate-input').value = '';
    showGate(false);
  });

  // --- Header controls ---
  function renderPeriods() {
    var el = $('#periods');
    el.innerHTML = '';
    PERIODS.forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p.label;
      if (p.key === period) b.className = 'active';
      b.addEventListener('click', function () {
        period = p.key;
        localStorage.setItem('aa_period', period);
        renderPeriods();
        loadAll();
      });
      el.appendChild(b);
    });
  }

  // --- Property cards ---
  function sparkline(points) {
    if (!points || points.length < 2) return '';
    var max = Math.max.apply(null, points.map(function (p) { return p.v; })) || 1;
    var w = 100, h = 28;
    var step = w / (points.length - 1);
    var coords = points.map(function (p, i) {
      return (i * step).toFixed(1) + ',' + (h - 2 - (p.v / max) * (h - 4)).toFixed(1);
    });
    return '<svg viewBox="0 0 100 28" preserveAspectRatio="none">' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="1.5" points="' + coords.join(' ') + '"/></svg>';
  }

  function renderProperties(results) {
    var el = $('#properties');
    el.innerHTML = '';
    SITES.forEach(function (s, i) {
      var r = results[i];
      var b = document.createElement('button');
      b.className = 'prop' + (s === site ? ' active' : '');
      b.innerHTML =
        '<div class="name"></div>' +
        '<div class="nums"><span class="views">' + (r ? fmt(r.views) : '&ndash;') + '</span>' +
        '<span class="visitors">' + (r ? fmt(r.visitors) + ' visitors' : '') + '</span></div>' +
        (r ? sparkline(r.series) : '');
      b.querySelector('.name').textContent = s;
      b.addEventListener('click', function () {
        if (s === site) return;
        site = s;
        localStorage.setItem('aa_site', site);
        el.querySelectorAll('.prop').forEach(function (n) { n.classList.remove('active'); });
        b.classList.add('active');
        loadDetail();
      });
      el.appendChild(b);
    });
  }

  // --- Main chart ---
  function renderChart(series, unit) {
    var svg = $('#chart');
    var xl = $('#xlabels');
    svg.innerHTML = '';
    xl.innerHTML = '';
    if (!series.length) return;

    var W = 1000, H = 220, PAD = 6;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var max = Math.max.apply(null, series.map(function (p) { return p.v; })) || 1;
    var step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
    var pts = series.map(function (p, i) {
      var x = PAD + i * step;
      var y = H - 24 - (p.v / max) * (H - 44);
      return [x, y];
    });
    var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var area = 'M' + PAD + ',' + (H - 24) + ' L' + line.replace(/ /g, ' L') + ' L' + (PAD + (series.length - 1) * step).toFixed(1) + ',' + (H - 24) + ' Z';

    svg.innerHTML =
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(94,234,212,0.28)"/><stop offset="100%" stop-color="rgba(94,234,212,0)"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#g)"/>' +
      '<polyline fill="none" stroke="#5eead4" stroke-width="2" stroke-linejoin="round" points="' + line + '"/>' +
      pts.map(function (p, i) {
        return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="6" fill="transparent">' +
          '<title>' + series[i].label + ': ' + fmt(series[i].v) + ' views</title></circle>';
      }).join('');

    var labels = [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]];
    labels.forEach(function (p) {
      var d = document.createElement('span');
      d.textContent = p.label;
      xl.appendChild(d);
    });
  }

  function tsLabel(iso, unit) {
    var d = new Date(iso);
    if (unit === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // --- Bar lists ---
  function renderRows(panelSel, data, labelFn) {
    var el = document.querySelector(panelSel + ' .rows');
    el.innerHTML = '';
    if (!data.length) {
      el.innerHTML = '<div class="empty">No data for this period.</div>';
      return;
    }
    var max = Math.max.apply(null, data.map(function (r) { return Number(r.views) || 0; })) || 1;
    data.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row';
      var pct = ((Number(r.views) || 0) / max * 100).toFixed(1);
      var fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = pct + '%';
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = labelFn(r);
      var val = document.createElement('span');
      val.className = 'val';
      val.textContent = fmt(r.views);
      row.appendChild(fill); row.appendChild(label); row.appendChild(val);
      el.appendChild(row);
    });
  }

  // --- Device tabs ---
  $('#device-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || btn.dataset.type === deviceType) return;
    deviceType = btn.dataset.type;
    this.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    loadDevices();
  });

  function loadDevices() {
    var seq = loadSeq;
    var panel = $('#p-devices');
    panel.classList.add('loading');
    api('browsers', { site: site, period: period, limit: 10, type: deviceType }).then(function (res) {
      if (seq !== loadSeq) return;
      renderRows('#p-devices', res.data, function (r) { return r.name || 'Unknown'; });
    }).catch(showErr).finally(function () { panel.classList.remove('loading'); });
  }

  // --- Loaders ---
  function showErr(e) {
    if (e.message === 'unauthorized') return;
    var el = $('#err');
    el.textContent = e.message;
    el.style.display = 'block';
  }

  function unitFor(p) {
    return PERIODS.filter(function (x) { return x.key === p; })[0].unit;
  }

  function loadDetail() {
    var seq = ++loadSeq;
    $('#err').style.display = 'none';
    var unit = unitFor(period);
    ['#chart-wrap', '#p-pages', '#p-referrers', '#p-geo', '#p-devices'].forEach(function (s) {
      $(s).classList.add('loading');
    });

    api('stats', { site: site, period: period }).then(function (res) {
      if (seq !== loadSeq) return;
      $('#stat-views').textContent = fmt(res.data.pageviews);
      $('#stat-visitors').textContent = fmt(res.data.approx_daily_visitors);
    }).catch(showErr);

    api('timeseries', { site: site, period: period, unit: unit }).then(function (res) {
      if (seq !== loadSeq) return;
      var series = res.data.map(function (r) {
        return { v: Number(r.views) || 0, label: tsLabel(r.timestamp, unit) };
      });
      renderChart(series, unit);
      $('#chart-wrap').classList.remove('loading');
    }).catch(showErr);

    api('pages', { site: site, period: period, limit: 10 }).then(function (res) {
      if (seq !== loadSeq) return;
      renderRows('#p-pages', res.data, function (r) { return r.page; });
      $('#p-pages').classList.remove('loading');
    }).catch(showErr);

    api('referrers', { site: site, period: period, limit: 10 }).then(function (res) {
      if (seq !== loadSeq) return;
      renderRows('#p-referrers', res.data, function (r) { return r.referrer; });
      $('#p-referrers').classList.remove('loading');
    }).catch(showErr);

    api('geo', { site: site, period: period, limit: 10 }).then(function (res) {
      if (seq !== loadSeq) return;
      renderRows('#p-geo', res.data, function (r) { return countryLabel(r.country); });
      $('#p-geo').classList.remove('loading');
    }).catch(showErr);

    loadDevices();
  }

  function loadAll() {
    renderPeriods();
    // Overview cards: stats + sparkline per property
    Promise.all(SITES.map(function (s) {
      return Promise.all([
        api('stats', { site: s, period: period }),
        api('timeseries', { site: s, period: period, unit: unitFor(period) })
      ]).then(function (res) {
        return {
          views: res[0].data.pageviews,
          visitors: res[0].data.approx_daily_visitors,
          series: res[1].data.map(function (r) { return { v: Number(r.views) || 0 }; })
        };
      }).catch(function () { return null; });
    })).then(renderProperties);

    loadDetail();
  }

  // --- Boot ---
  // Accept token via URL fragment (#token=...) so it can be handed off without
  // typing. The fragment never reaches the server; strip it immediately.
  var hashMatch = location.hash.match(/^#token=(.+)$/);
  if (hashMatch) {
    token = decodeURIComponent(hashMatch[1]);
    sessionStorage.setItem('aa_token', token);
    history.replaceState(null, '', location.pathname);
  }
  if (!token) {
    showGate(false);
  } else {
    fetchSites().then(enterApp).catch(function (e) {
      // 401 already shows the gate via api(); surface anything else.
      if (e.message !== 'unauthorized') {
        showGate(false);
        $('#gate-err').textContent = e.message;
        $('#gate-err').style.display = 'block';
      }
    });
  }
})();
</script>
</body>
</html>`;

export function serveDashboard(c: Context<{ Bindings: Env }>) {
  return c.html(DASHBOARD_HTML, 200, {
    'Cache-Control': 'no-store',
  });
}
