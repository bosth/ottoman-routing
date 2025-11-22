// src/search-control.js (updated)
// - Labels changed to "Starting point" and "Destination" as requested.
// - Exports default initSearchControl(map, opts) and also attaches to window for compatibility.
import Fuse from 'fuse.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

function ensureHumanize() {
  if (typeof window.humanizeDuration === 'function') return Promise.resolve();
  return loadScript('https://cdn.jsdelivr.net/npm/humanize-duration@3.27.0').catch(err => {
    console.warn('Failed to load humanize-duration from CDN', err);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function resolveApiBase(opts) {
  if (opts && opts.apiBase) return String(opts.apiBase).replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, '');
  try {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8080';
  } catch (e) {}
  return 'https://geo.jaxartes.net';
}

function normalizeFeatures(features) {
  return (features || []).map(f => {
    const p = f.properties || {};
    const rawId = (f && f.id !== undefined && f.id !== null) ? f.id : (p.id ?? p.ID ?? '');
    const fid = (rawId === null || rawId === undefined) ? '' : String(rawId);
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: fid,
        name: p.name ?? p.title ?? '',
        rank: (p.rank !== undefined) ? Number(p.rank) : 9999,
                              ...p
      }
    };
  });
}

export default async function initSearchControl(map, opts = {}) {
  const apiBase = resolveApiBase(opts);
  const maxSuggestions = opts.maxSuggestions || 8;

  const existing = map.getContainer().querySelector('.map-search-container');
  let container = existing;
  if (!container) {
    container = document.createElement('div');
    container.className = 'map-search-container';
    container.style.position = 'absolute';
    container.style.top = '12px';
    container.style.left = '12px';
    container.style.zIndex = 1000;
    container.style.width = '420px';
    container.setAttribute('aria-live', 'polite');
    container.innerHTML = createContainerHTML();
    map.getContainer().appendChild(container);
  } else {
    container.innerHTML = createContainerHTML();
  }

  const sourceBox = container.querySelector('#mlSourceBox');
  const targetBox = container.querySelector('#mlTargetBox');
  const sourceSug = container.querySelector('#mlSourceSuggestions');
  const targetSug = container.querySelector('#mlTargetSuggestions');
  const statusEl = container.querySelector('#mlStatus');
  const clearBtn = container.querySelector('#mlClearBtn');
  const sidebar = container.querySelector('#mlSidebar');

  async function getDataOrFetchLocal() {
    if (opts && opts.data && opts.data.features && Array.isArray(opts.data.features)) return opts.data;
    const endpointPath = (opts && opts.endpoint) ? (opts.endpoint.startsWith('/') ? opts.endpoint : '/' + opts.endpoint) : '/v2/node';
    const endpoint = apiBase + endpointPath;
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.features)) throw new Error('Invalid GeoJSON from ' + endpoint);
    return data;
  }

  let geojson;
  try {
    geojson = await getDataOrFetchLocal();
  } catch (err) {
    console.error('Failed to load node data:', err);
    statusEl.textContent = 'Error loading points';
    return;
  }

  const allFeatures = normalizeFeatures(geojson.features || []);
  const nodesSourceData = { type: 'FeatureCollection', features: allFeatures };

  try {
    if (map.getSource('nodes-search')) {
      map.getSource('nodes-search').setData(nodesSourceData);
    } else {
      map.addSource('nodes-search', { type: 'geojson', data: nodesSourceData });
      map.addLayer({
        id: 'nodes-search-circle',
        type: 'circle',
        source: 'nodes-search',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'rank'], 1, 8, 50, 3],
          'circle-color': ['step', ['get', 'rank'], '#d9534f', 2, '#f0ad4e', 5, '#5bc0de', 10, '#6c757d'],
          'circle-opacity': 0.8,
          'circle-stroke-width': 0.6,
          'circle-stroke-color': '#222'
        }
      });
    }
  } catch (e) {
    console.warn('nodes layer issue:', e);
  }

  try {
    if (!map.getLayer('nodes-search-label')) {
      map.addLayer({
        id: 'nodes-search-label',
        type: 'symbol',
        source: 'nodes-search',
        layout: {
          'text-field': ['coalesce', ['get', 'name'], ['get', 'id']],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': '#222'
        }
      });
    }
  } catch (e) {
    console.warn('nodes label layer issue:', e);
  }

  const fuse = new Fuse(allFeatures, {
    keys: ['properties.name', 'properties.id'],
    threshold: 0.45,
    distance: 100,
    minMatchCharLength: 1,
    includeScore: true
  });

  const selectedEmpty = { type: 'FeatureCollection', features: [] };
  if (!map.getSource('search-selected')) {
    map.addSource('search-selected', { type: 'geojson', data: selectedEmpty });
    map.addLayer({
      id: 'search-selected-circle',
      type: 'circle',
      source: 'search-selected',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'rank'], 1, 10, 50, 6],
        'circle-color': [
          'match',
          ['get', 'role'],
          'source', '#1976d2',
          'target', '#d32f2f',
          '#888'
        ],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: 'search-selected-label',
      type: 'symbol',
      source: 'search-selected',
      layout: {
        'text-field': ['coalesce', ['get', 'shortLabel'], ['get', 'name'], ['get', 'id']],
        'text-size': 12,
        'text-offset': [0, 1.2]
      },
      paint: { 'text-color': '#222' }
    });
  }

  if (!map.getSource('search-route')) {
    map.addSource('search-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'search-route-line',
      type: 'line',
      source: 'search-route',
      paint: { 'line-color': '#1a73e8', 'line-width': 4, 'line-opacity': 0.9 }
    });
  }

  const selected = { source: null, target: null };
  const state = {
    source: { input: sourceBox, suggestionsEl: sourceSug, lastResults: [], activeIndex: -1, debounce: null },
    target: { input: targetBox, suggestionsEl: targetSug, lastResults: [], activeIndex: -1, debounce: null }
  };

  let activeRole = null;

  const rankLabelMap = {
    2: 'stop',
    3: 'dock',
    4: 'train station'
  };

  const modeSymbolMap = {
    'walk': 'directions_walk',
    'road': 'directions_walk',
    'chaussee': 'directions_walk',
    'connection': 'subway_walk',
    'transfer': 'subway_walk',
    'switch': 'subway_walk',
    'horse tramway': 'cable_car',
    'electric tramway': 'tram',
    'railway': 'train',
    'narrow-gauge railway': 'directions_railway_2',
    'ferry': 'directions_boat',
    'ship': 'anchor',
    'metro': 'funicular'
  };

  function renderSuggestionsForRole(role) {
    const st = state[role];
    const suggestionsEl = st.suggestionsEl;
    suggestionsEl.innerHTML = '';
    st.activeIndex = -1;
    const results = st.lastResults;
    if (!results || !results.length) return;

    results.slice(0, maxSuggestions).forEach((r, idx) => {
      const item = r.item || r;
      const rank = (item.properties && item.properties.rank) ? Number(item.properties.rank) : null;
      const showLabel = (rank !== null && rankLabelMap.hasOwnProperty(rank)) ? rankLabelMap[rank] : '';
      const row = document.createElement('div');
      row.className = 'suggestion';
      row.dataset.index = idx;
      row.innerHTML = `
      <div style="flex:1">
      <strong>${escapeHtml(item.properties.name || item.properties.id || '')}</strong>
      <div style="font-size:12px;color:#666">${escapeHtml(showLabel)}</div>
      </div>
      `;
      row.addEventListener('click', () => selectForRole(role, idx));
      suggestionsEl.appendChild(row);
    });

    const items = Array.from(suggestionsEl.querySelectorAll('.suggestion'));
    if (items.length) {
      st.activeIndex = 0;
      items.forEach((it, i) => it.classList.toggle('active', i === st.activeIndex));
      const activeEl = items[st.activeIndex];
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function searchForRole(role, q) {
    const st = state[role];
    if (!q) {
      st.suggestionsEl.innerHTML = '';
      st.lastResults = [];
      st.activeIndex = -1;
      return;
    }
    const raw = fuse.search(q);
    raw.sort((a, b) => {
      const sc = (a.score || 0) - (b.score || 0);
      if (sc !== 0) return sc;
      const ra = (a.item.properties.rank ?? 9999);
      const rb = (b.item.properties.rank ?? 9999);
      return ra - rb;
    });
    st.lastResults = raw;
    renderSuggestionsForRole(role);
  }

  function setSelectedFeature(role, feat) {
    if (!feat) selected[role] = null;
    else selected[role] = feat;

    const inp = state[role].input;
    if (selected[role]) inp.value = selected[role].properties.name || selected[role].properties.id || '';
    else inp.value = '';

    const feats = [];
    if (selected.source) feats.push({ type: 'Feature', geometry: selected.source.geometry, properties: { role: 'source', id: selected.source.properties.id, name: selected.source.properties.name, rank: selected.source.properties.rank, shortLabel: 'S' } });
    if (selected.target) feats.push({ type: 'Feature', geometry: selected.target.geometry, properties: { role: 'target', id: selected.target.properties.id, name: selected.target.properties.name, rank: selected.target.properties.rank, shortLabel: 'T' } });
    const fc = { type: 'FeatureCollection', features: feats };
    try {
      map.getSource('search-selected').setData(fc);
    } catch (e) {
      try { if (map.getLayer && map.getLayer('search-selected-circle')) map.removeLayer('search-selected-circle'); } catch (e2) {}
      try { if (map.getSource && map.getSource('search-selected')) map.removeSource('search-selected'); } catch (e2) {}
      map.addSource('search-selected', { type: 'geojson', data: fc });
    }
  }

  async function formatCostMinutes(mins) {
    await ensureHumanize();
    const md = (typeof window.humanizeDuration === 'function') ? window.humanizeDuration : null;
    if (!md) {
      const m = Number(mins) || 0;
      return `${m} min`;
    }
    const ms = (Number(mins) || 0) * 60000;
    return md(ms, { largest: 2, round: true, units: ['d', 'h', 'm'] });
  }

  async function updateSidebarForRoute(routeGeo) {
    if (!sidebar) return;
    if (!routeGeo || !Array.isArray(routeGeo.features) || routeGeo.features.length === 0) {
      sidebar.innerHTML = '';
      return;
    }
    await ensureHumanize();
    const rows = routeGeo.features.map((f, i) => {
      const p = f.properties || {};
      return {
        idx: i + 1,
        source: p.source ?? p.src ?? '',
        target: p.target ?? p.tgt ?? '',
        line: p.line ?? '',
        mode: p.mode ?? '',
        cost: p.cost ?? 0
      };
    });

    const firstSource = rows[0] ? rows[0].source : '';
    const lastTarget = rows[rows.length - 1] ? rows[rows.length - 1].target : '';
    const totalMins = rows.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);
    const totalHuman = await formatCostMinutes(totalMins);

    const summaryHtml = `<div class="ml-summary"><div class="ml-summary-left">${escapeHtml(String(firstSource))} 🢒 ${escapeHtml(String(lastTarget))}</div><div class="ml-summary-right">${escapeHtml(String(totalHuman))}</div></div>`;

    const modeSymbols = rows.map(r => {
      const modeKey = (String(r.mode || '')).toLowerCase();
      return modeSymbolMap.hasOwnProperty(modeKey) ? modeSymbolMap[modeKey] : '';
    }).filter(Boolean);

    const modeSymbolsHtml = modeSymbols.length
    ? `<div class="ml-mode-list">${modeSymbols.map((sym, i) => `<span class="material-symbols-outlined ml-icon-inline">${escapeHtml(sym)}</span>${i < modeSymbols.length - 1 ? '<span class="ml-arrow"> 🢒 </span>' : ''}`).join('')}</div>`
    : '';

    const html = rows.map(r => {
      const modeKey = (String(r.mode || '')).toLowerCase();
      const symbolName = modeSymbolMap.hasOwnProperty(modeKey) ? modeSymbolMap[modeKey] : '';
      const iconHtml = symbolName ? `<span class="material-symbols-outlined ml-icon">${escapeHtml(symbolName)}</span>` : '';
      return `<div class="ml-seg">
      <div class="ml-seg-row">${iconHtml}<strong>${escapeHtml(String(r.source))}</strong> 🢒 <strong>${escapeHtml(String(r.target))}</strong></div>
      <div class="ml-seg-meta">line: ${escapeHtml(String(r.line))} • mode: ${escapeHtml(String(r.mode))} • cost: <span class="ml-cost" data-cost="${escapeHtml(String(r.cost))}">${escapeHtml(String(r.cost))}</span></div>
      </div>`;
    }).join('');

    sidebar.innerHTML = `<div class="ml-sidebar-title">Route segments</div>${summaryHtml}${modeSymbolsHtml}${html}`;

    const costEls = sidebar.querySelectorAll('.ml-cost');
    await Promise.all(Array.from(costEls).map(async (el) => {
      const raw = el.getAttribute('data-cost');
      const human = await formatCostMinutes(raw);
      el.textContent = human;
    }));
  }

  async function fetchAndRenderRouteIfReady() {
    if (!selected.source || !selected.target) {
      try { map.getSource('search-route').setData({ type: 'FeatureCollection', features: [] }); } catch (e) {}
      await updateSidebarForRoute(null);
      return;
    }
    const sid = selected.source.properties.id;
    const tid = selected.target.properties.id;
    if (!sid || !tid) return;
    const url = `${apiBase}/v2/route?source=${encodeURIComponent(sid)}&target=${encodeURIComponent(tid)}&year=1914`;
    try {
      statusEl.textContent = 'Loading route…';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Route fetch failed: ' + res.status);
      const routeGeo = await res.json();
      if (!routeGeo || !Array.isArray(routeGeo.features)) throw new Error('Invalid route GeoJSON');
      try {
        map.getSource('search-route').setData(routeGeo);
      } catch (e) {
        try { if (map.getLayer && map.getLayer('search-route-line')) map.removeLayer('search-route-line'); } catch (e2) {}
        try { if (map.getSource && map.getSource('search-route')) map.removeSource('search-route'); } catch (e2) {}
        map.addSource('search-route', { type: 'geojson', data: routeGeo });
        map.addLayer({
          id: 'search-route-line',
          type: 'line',
          source: 'search-route',
          paint: { 'line-color': '#1a73e8', 'line-width': 4, 'line-opacity': 0.9 }
        });
      }

      (function fitBoundsForGeoJSON(gj) {
        if (!gj || !Array.isArray(gj.features) || gj.features.length === 0) return;
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        gj.features.forEach(f => {
          if (!f.geometry) return;
          if (f.geometry.type === 'LineString' || f.geometry.type === 'Point') {
            const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
            coords.forEach(([lng, lat]) => {
              if (lng < minLng) minLng = lng;
              if (lng > maxLng) maxLng = lng;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            });
          }
        });
        if (minLng === Infinity) return;
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 700 });
      })(routeGeo);

      await updateSidebarForRoute(routeGeo);

      statusEl.textContent = 'Route loaded';
    } catch (err) {
      console.error('Failed to fetch/render route:', err);
      statusEl.textContent = 'Error loading route';
      await updateSidebarForRoute(null);
    }
  }

  function selectForRole(role, index) {
    const st = state[role];
    const r = st.lastResults[index];
    if (!r) return;
    const feat = r.item || r;
    setSelectedFeature(role, feat);
    st.suggestionsEl.innerHTML = '';
    st.lastResults = [];
    st.activeIndex = -1;
    if (role === 'source') {
      setTimeout(() => { state.target.input.focus(); }, 0);
    } else {
      setTimeout(() => { state.target.input.focus(); }, 0);
    }
    fetchAndRenderRouteIfReady().catch(console.error);
  }

  Object.keys(state).forEach(role => {
    const st = state[role];

    st.input.addEventListener('focus', () => {
      activeRole = role;
      st.input.classList.add('active');
      const other = (role === 'source') ? state.target.input : state.source.input;
      other.classList.remove('active');
    });

    st.input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!container.contains(document.activeElement)) {
          activeRole = null;
          state.source.input.classList.remove('active');
          state.target.input.classList.remove('active');
        }
      }, 150);
    });

    st.input.addEventListener('click', () => {
      try { st.input.select(); } catch (e) {}
      try { st.input.focus(); } catch (e) {}
    });

    st.input.addEventListener('input', () => {
      if (st.debounce) clearTimeout(st.debounce);
      st.debounce = setTimeout(() => {
        const q = st.input.value.trim();
        searchForRole(role, q);
      }, 160);
    });

    st.input.addEventListener('keydown', (ev) => {
      const key = ev.key;
      if (key === 'Enter') {
        ev.preventDefault();
        if (st.activeIndex >= 0 && st.activeIndex < st.suggestionsEl.children.length) {
          selectForRole(role, st.activeIndex);
        } else if (st.lastResults && st.lastResults.length) {
          selectForRole(role, 0);
        }
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        ev.preventDefault();
        const items = Array.from(st.suggestionsEl.querySelectorAll('.suggestion'));
        if (!items.length) return;
        if (st.activeIndex === -1) st.activeIndex = 0;
        else st.activeIndex += (key === 'ArrowDown' ? 1 : -1);
        if (st.activeIndex < 0) st.activeIndex = items.length - 1;
        if (st.activeIndex >= items.length) st.activeIndex = 0;
        items.forEach((it, i) => it.classList.toggle('active', i === st.activeIndex));
        const activeEl = items[st.activeIndex];
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  document.addEventListener('click', (ev) => {
    if (!container.contains(ev.target)) {
      sourceSug.innerHTML = '';
      targetSug.innerHTML = '';
      state.source.lastResults = [];
      state.target.lastResults = [];
      state.source.activeIndex = -1;
      state.target.activeIndex = -1;
      activeRole = null;
      state.source.input.classList.remove('active');
      state.target.input.classList.remove('active');
    }
  });

  map.on('click', (ev) => {
    if (!activeRole) return;
    const features = map.queryRenderedFeatures(ev.point, { layers: ['nodes-search-circle', 'search-selected-circle'] });
    if (!features || !features.length) return;
    const f = features[0];
    const nodeId = (f.properties && (f.properties.id ?? f.properties.ID ?? f.id)) || '';
    const found = allFeatures.find(x => String(x.properties.id) === String(nodeId));
    const feat = found || { type: 'Feature', geometry: f.geometry, properties: { id: nodeId, name: (f.properties && f.properties.name) || '', rank: f.properties && f.properties.rank } };
    setSelectedFeature(activeRole, feat);
    state[activeRole].suggestionsEl.innerHTML = '';
    state[activeRole].lastResults = [];
    state[activeRole].activeIndex = -1;
    try { state[activeRole].input.focus(); } catch (e) {}
    fetchAndRenderRouteIfReady().catch(console.error);
  });

  clearBtn.addEventListener('click', () => {
    setSelectedFeature('source', null);
    setSelectedFeature('target', null);
    try { map.getSource('search-route').setData({ type: 'FeatureCollection', features: [] }); } catch (e) {}
    sourceSug.innerHTML = '';
    targetSug.innerHTML = '';
    state.source.lastResults = [];
    state.target.lastResults = [];
    statusEl.textContent = `${allFeatures.length} points loaded`;
    updateSidebarForRoute(null).catch(() => {});
  });

  statusEl.textContent = `${allFeatures.length} points loaded`;

  try {
    setTimeout(() => {
      sourceBox && sourceBox.focus && sourceBox.focus();
      try { sourceBox.select(); } catch (e) {}
      activeRole = 'source';
      sourceBox.classList.add('active');
    }, 0);
  } catch (e) {}

  return {
    setSource(idOrFeature) {
      if (!idOrFeature) return setSelectedFeature('source', null);
      if (typeof idOrFeature === 'string' || typeof idOrFeature === 'number') {
        const f = allFeatures.find(x => (x.properties.id == idOrFeature));
        if (f) setSelectedFeature('source', f);
      } else setSelectedFeature('source', idOrFeature);
    },
    setTarget(idOrFeature) {
      if (!idOrFeature) return setSelectedFeature('target', null);
      if (typeof idOrFeature === 'string' || typeof idOrFeature === 'number') {
        const f = allFeatures.find(x => (x.properties.id == idOrFeature));
        if (f) setSelectedFeature('target', f);
      } else setSelectedFeature('target', idOrFeature);
    },
    getSelected() { return { ...selected }; },
    getFeatures() { return allFeatures; }
  };
}

window.initSearchControl = initSearchControl;

function createContainerHTML() {
  return `
  <div class="search-rows">
  <div class="search-col">
  <label class="search-label">Starting point</label>
  <input id="mlSourceBox" class="ml-input" placeholder="Search starting point..." autocomplete="off" />
  <div class="suggestions" id="mlSourceSuggestions" role="listbox"></div>
  </div>
  <div class="search-col">
  <label class="search-label">Destination</label>
  <input id="mlTargetBox" class="ml-input" placeholder="Search destination..." autocomplete="off" />
  <div class="suggestions" id="mlTargetSuggestions" role="listbox"></div>
  </div>
  </div>
  <div class="controls">
  <div class="small-note" id="mlStatus">Loading points…</div>
  <div><button id="mlClearBtn" class="secondary">Clear</button></div>
  </div>
  <div id="mlSidebar" class="ml-sidebar" aria-live="polite"></div>
  `;
}
