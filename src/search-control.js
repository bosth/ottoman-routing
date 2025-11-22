// src/search-control.js
// - Fixes railway rendering by using fixed-pixel symbol repeat fallback to guarantee
//   fixed-size squares regardless of zoom. Adds small canvas images and always uses
//   symbol layers with symbol-placement: 'line' + symbol-spacing so the squares do not scale.
// - Makes narrow-gauge visually distinct (smaller width + smaller square tile).
// - Zoom behavior:
//     * when a user selects a start/target, map eases to that point (zoom ~14)
//     * when a route is displayed, map.fitBounds to the route (padding 60)
// - Keeps the rest of the control behavior (suggestions, keyboard navigation, etc.)
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
    if (!results || !results.length) {
      suggestionsEl.removeAttribute('aria-activedescendant');
      suggestionsEl.setAttribute('aria-expanded', 'false');
      return;
    }

    results.slice(0, maxSuggestions).forEach((r, idx) => {
      const item = r.item || r;
      const rank = (item.properties && item.properties.rank) ? Number(item.properties.rank) : null;
      const showLabel = (rank !== null && rankLabelMap.hasOwnProperty(rank)) ? rankLabelMap[rank] : '';
      const row = document.createElement('div');
      row.className = 'suggestion';
      row.dataset.index = idx;
      row.id = `ml-${role}-suggestion-${idx}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
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
      items.forEach((it, i) => {
        const isActive = i === st.activeIndex;
        it.classList.toggle('active', isActive);
        it.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      const activeEl = items[st.activeIndex];
      if (activeEl) {
        suggestionsEl.setAttribute('aria-activedescendant', activeEl.id);
        suggestionsEl.setAttribute('aria-expanded', 'true');
        activeEl.scrollIntoView({ block: 'nearest' });
      } else {
        suggestionsEl.removeAttribute('aria-activedescendant');
        suggestionsEl.setAttribute('aria-expanded', 'false');
      }
    } else {
      suggestionsEl.removeAttribute('aria-activedescendant');
      suggestionsEl.setAttribute('aria-expanded', 'false');
    }
  }

  function searchForRole(role, q) {
    const st = state[role];
    if (!q) {
      st.suggestionsEl.innerHTML = '';
      st.lastResults = [];
      st.activeIndex = -1;
      st.suggestionsEl.removeAttribute('aria-activedescendant');
      st.suggestionsEl.setAttribute('aria-expanded', 'false');
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

    // Zoom to selected point (user requested)
    if (feat) {
      try {
        zoomToFeaturePoint(feat);
      } catch (e) {
        // ignore zoom failures
      }
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
        idx: i,
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

    // summary: left = first → last, right = total time (same line, right-justified)
    const summaryHtml = `<div class="ml-summary" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div class="ml-summary-left" style="font-weight:600">${escapeHtml(String(firstSource))} 🢒 ${escapeHtml(String(lastTarget))}</div>
    <div class="ml-summary-right" style="font-weight:600;color:#333">${escapeHtml(String(totalHuman))}</div>
    </div>`;

    // build segment "cards" with light styling; each card gets data-idx for click handling
    const html = rows.map(r => {
      const modeKey = (String(r.mode || '')).toLowerCase();
      const symbolName = modeSymbolMap.hasOwnProperty(modeKey) ? modeSymbolMap[modeKey] : '';
      const iconHtml = symbolName ? `<span class="material-symbols-outlined ml-icon" style="font-size:18px;color:#444;margin-right:6px">${escapeHtml(symbolName)}</span>` : '';
      return `<div class="ml-seg card" data-idx="${r.idx}" style="border:1px solid #e6e6e6;border-radius:8px;padding:10px;margin-bottom:8px;background:#fff;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
      <div class="ml-seg-row" style="display:flex;align-items:center;gap:8px;">
      ${iconHtml}<strong style="font-size:14px;color:#222">${escapeHtml(String(r.source))}</strong>
      <span style="margin:0 8px;color:#999">🢒</span>
      <strong style="font-size:14px;color:#222">${escapeHtml(String(r.target))}</strong>
      </div>
      <div class="ml-seg-meta" style="font-size:12px;color:#666;margin-top:8px">
      line: ${escapeHtml(String(r.line))} • mode: ${escapeHtml(String(r.mode))} • cost: <span class="ml-cost" data-cost="${escapeHtml(String(r.cost))}">${escapeHtml(String(r.cost))}</span>
      </div>
      </div>`;
    }).join('');

    // Note: removed the modeSymbolsHtml line (mode symbol row removed as requested)
    sidebar.innerHTML = `<div class="ml-sidebar-title">Route segments</div>${summaryHtml}${html}`;

    // attach click handlers to each card so clicking fits/zooms to that segment's geometry
    const segEls = sidebar.querySelectorAll('.ml-seg.card');
    segEls.forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-idx'));
        if (isNaN(idx)) return;
        const feat = routeGeo.features[idx];
        if (!feat) return;
        try {
          // use existing fitBoundsForGeoJSON helper to fit the map to this single segment
          fitBoundsForGeoJSON({ type: 'FeatureCollection', features: [feat] });
        } catch (e) {
          // ignore map errors
        }
      });
    });

    const costEls = sidebar.querySelectorAll('.ml-cost');
    await Promise.all(Array.from(costEls).map(async (el) => {
      const raw = el.getAttribute('data-cost');
      const human = await formatCostMinutes(raw);
      el.textContent = human;
    }));
  }

  // Compute bbox and fit map to bounds for the given GeoJSON (FeatureCollection)
  function fitBoundsForGeoJSON(gj) {
    if (!gj || !Array.isArray(gj.features) || gj.features.length === 0) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    gj.features.forEach(f => {
      if (!f.geometry) return;
      if (f.geometry.type === 'LineString' || f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint') {
        const coords = (f.geometry.type === 'Point') ? [f.geometry.coordinates] : (f.geometry.type === 'MultiPoint' ? f.geometry.coordinates : f.geometry.coordinates);
        coords.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });
      } else if (f.geometry.type === 'MultiLineString') {
        f.geometry.coordinates.forEach(line => line.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }));
      } else if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        const polys = (f.geometry.type === 'Polygon') ? f.geometry.coordinates : f.geometry.coordinates.flat();
        polys.forEach(ring => ring.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }));
      }
    });
    if (minLng === Infinity) return;
    try {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 700 });
    } catch (e) {
      // ignore fit failures
    }
  }

  // Create tiny pattern images to be used as icons for symbol-placement line repetition.
  // These icons will be repeated at fixed pixel spacing and therefore won't scale with zoom.
  function ensureRailPatterns() {
    try {
      // standard railway: 8x8 tile, white 4x4 square
      if (!map.hasImage || !map.hasImage('ml-rail-pattern')) {
        const size = 8;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        const sq = 4;
        const off = Math.floor((size - sq) / 2);
        ctx.fillRect(off, off, sq, sq);
        try { map.addImage('ml-rail-pattern', c, { pixelRatio: 1 }); } catch (e) { console.warn('addImage ml-rail-pattern failed', e); }
      }

      // narrow gauge: 6x6 tile, white 3x3 square
      if (!map.hasImage || !map.hasImage('ml-rail-narrow-pattern')) {
        const size2 = 6;
        const c2 = document.createElement('canvas');
        c2.width = size2;
        c2.height = size2;
        const ctx2 = c2.getContext('2d');
        ctx2.clearRect(0, 0, size2, size2);
        ctx2.fillStyle = '#ffffff';
        const sq2 = 3;
        const off2 = Math.floor((size2 - sq2) / 2);
        ctx2.fillRect(off2, off2, sq2, sq2);
        try { map.addImage('ml-rail-narrow-pattern', c2, { pixelRatio: 1 }); } catch (e) { console.warn('addImage ml-rail-narrow-pattern failed', e); }
      }
    } catch (err) {
      console.warn('Rail pattern creation failed:', err);
    }
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

      // annotate features for mode and tram color
      const palette = ['#1a73e8', '#d32f2f', '#2e7d32', '#fbc02d', '#6a1b9a', '#fb8c00', '#1e88e5', '#ec407a'];
      const tramKeys = [];
      routeGeo.features.forEach((f, idx) => {
        const mode = String((f.properties && f.properties.mode) || '').toLowerCase();
        if (mode.includes('tramway') || mode.includes('metro')) {
          const key = String((f.properties && (f.properties.line || f.properties.id)) || `__line_${idx}`);
          if (!tramKeys.includes(key)) tramKeys.push(key);
        }
      });
      function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
      const shuffled = shuffle(palette.slice());
      const lineColorMap = {};
      tramKeys.forEach((k, i) => {
        lineColorMap[k] = shuffled[i % shuffled.length];
      });
      routeGeo.features.forEach((f, idx) => {
        const props = f.properties || {};
        const mode = String((props.mode || '')).toLowerCase();
        props.ml_mode_lower = mode;
        if (mode.includes('tramway') || mode.includes('metro')) {
          const key = String(props.line || props.id || `__line_${idx}`);
          props.ml_color = lineColorMap[key] || shuffled[idx % shuffled.length];
        }
        f.properties = props;
      });

      // ensure tile icons exist
      ensureRailPatterns();

      try {
        if (map.getSource('search-route')) {
          map.getSource('search-route').setData(routeGeo);
        } else {
          map.addSource('search-route', { type: 'geojson', data: routeGeo });
        }
      } catch (err) {
        console.error('Failed to add/update search-route source:', err && err.message ? err.message : err);
        try { if (map.getLayer('search-route-line-fallback')) map.removeLayer('search-route-line-fallback'); } catch (_) {}
        try { if (map.getSource('search-route')) map.removeSource('search-route'); } catch (_) {}
        try { map.addSource('search-route', { type: 'geojson', data: routeGeo }); } catch (err2) {
          console.error('Fatal: could not add search-route source:', err2 && err2.message ? err2.message : err2);
          throw err2;
        }
      }

      // remove previous route layers
      try { if (map.getLayer('search-route-line-base')) map.removeLayer('search-route-line-base'); } catch (_) {}
      try { if (map.getLayer('search-route-rail-symbol')) map.removeLayer('search-route-rail-symbol'); } catch (_) {}
      try { if (map.getLayer('search-route-rail-narrow-symbol')) map.removeLayer('search-route-rail-narrow-symbol'); } catch (_) {}
      try { if (map.getLayer('search-route-line-fallback')) map.removeLayer('search-route-line-fallback'); } catch (_) {}

      let addedComplexLayers = false;
      try {
        // base line (all modes)
        map.addLayer({
          id: 'search-route-line-base',
          type: 'line',
          source: 'search-route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': [
              'coalesce',
              [
                'match',
                ['get', 'ml_mode_lower'],
                'connection', '#000000',
                'transfer', '#000000',
                'railway', '#000000',
                'narrow-gauge railway', '#000000',
                'road', '#ffffff',
                'chaussee', '#ffffff',
                'ferry', '#1a73e8',
                'ship', '#1a73e8',
                ['get', 'ml_color']
              ],
              '#1a73e8'
            ],
            'line-width': [
              'case',
              ['==', ['get', 'ml_mode_lower'], 'narrow-gauge railway'], 4.5,
              ['==', ['get', 'ml_mode_lower'], 'railway'], 6,
              ['in', ['get', 'ml_mode_lower'], ['literal', ['road', 'chaussee']]], 6,
              ['in', ['get', 'ml_mode_lower'], ['literal', ['connection', 'transfer']]], 2,
              ['has', 'ml_color'], 4,
              4
            ],
            'line-dasharray': [
              'case',
              ['in', ['get', 'ml_mode_lower'], ['literal', ['connection', 'transfer']]], ['literal', [0, 4]],
              ['in', ['get', 'ml_mode_lower'], ['literal', ['ferry', 'ship']]], ['literal', [4, 4]],
              ['literal', [1, 0]]
            ],
            'line-opacity': 0.95
          }
        });

        // Instead of relying on line-pattern (which can be inconsistent across styles),
        // render short fixed-size white squares by repeating a tiny white icon along the line
        // using a symbol layer set to symbol-placement: 'line'. Symbol layers render icons at
        // fixed pixel sizes, so they won't scale with zoom.

        // Standard railway symbol-repeat (8px spacing)
        if (map.hasImage && map.hasImage('ml-rail-pattern')) {
          map.addLayer({
            id: 'search-route-rail-symbol',
            type: 'symbol',
            source: 'search-route',
            filter: ['==', ['get', 'ml_mode_lower'], 'railway'],
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 8,
              'icon-image': 'ml-rail-pattern',
              'icon-size': 1,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            },
            paint: {
              'icon-opacity': 1
            }
          });
        } else {
          // fallback: dashed overlay (less ideal but avoids blank)
          map.addLayer({
            id: 'search-route-rail-symbol',
            type: 'line',
            source: 'search-route',
            filter: ['==', ['get', 'ml_mode_lower'], 'railway'],
            layout: { 'line-join': 'round', 'line-cap': 'butt' },
            paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-dasharray': ['literal', [4, 4]], 'line-opacity': 1 }
          });
        }

        // Narrow-gauge: smaller spacing and smaller icon
        if (map.hasImage && map.hasImage('ml-rail-narrow-pattern')) {
          map.addLayer({
            id: 'search-route-rail-narrow-symbol',
            type: 'symbol',
            source: 'search-route',
            filter: ['==', ['get', 'ml_mode_lower'], 'narrow-gauge railway'],
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 6,
              'icon-image': 'ml-rail-narrow-pattern',
              'icon-size': 1,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            },
            paint: {
              'icon-opacity': 1
            }
          });
        } else {
          map.addLayer({
            id: 'search-route-rail-narrow-symbol',
            type: 'line',
            source: 'search-route',
            filter: ['==', ['get', 'ml_mode_lower'], 'narrow-gauge railway'],
            layout: { 'line-join': 'round', 'line-cap': 'butt' },
            paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-dasharray': ['literal', [3, 3]], 'line-opacity': 1 }
          });
        }

        addedComplexLayers = true;
      } catch (err) {
        console.error('Adding complex route layers failed:', err && err.message ? err.message : err);
        addedComplexLayers = false;
      }

      if (!addedComplexLayers) {
        try {
          map.addLayer({
            id: 'search-route-line-fallback',
            type: 'line',
            source: 'search-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1a73e8', 'line-width': 4, 'line-opacity': 0.9 }
          });
        } catch (err) {
          console.error('Failed to add fallback route layer:', err && err.message ? err.message : err);
        }
      }

      // Zoom to the full route after rendering
      try {
        fitBoundsForGeoJSON(routeGeo);
      } catch (e) {
        // ignore
      }

      await updateSidebarForRoute(routeGeo);

      statusEl.textContent = 'Route loaded';
    } catch (err) {
      console.error('Failed to fetch/render route:', err && err.message ? err.message : err);
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
    st.suggestionsEl.removeAttribute('aria-activedescendant');
    st.suggestionsEl.setAttribute('aria-expanded', 'false');
    if (role === 'source') {
      setTimeout(() => { state.target.input.focus(); }, 0);
    } else {
      setTimeout(() => { state.target.input.focus(); }, 0);
    }
    fetchAndRenderRouteIfReady().catch(console.error);
  }

  Object.keys(state).forEach(role => {
    const st = state[role];

    st.suggestionsEl.setAttribute('role', 'listbox');
    st.suggestionsEl.setAttribute('aria-expanded', 'false');

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
        items.forEach((it, i) => {
          const isActive = i === st.activeIndex;
          it.classList.toggle('active', isActive);
          it.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        const activeEl = items[st.activeIndex];
        if (activeEl) {
          st.suggestionsEl.setAttribute('aria-activedescendant', activeEl.id);
          activeEl.scrollIntoView({ block: 'nearest' });
        } else {
          st.suggestionsEl.removeAttribute('aria-activedescendant');
        }
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
      sourceSug.removeAttribute('aria-activedescendant');
      targetSug.removeAttribute('aria-activedescendant');
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
    state[activeRole].suggestionsEl.removeAttribute('aria-activedescendant');
    state[activeRole].suggestionsEl.setAttribute('aria-expanded', 'false');
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
  <div class="suggestions" id="mlSourceSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  <div class="search-col">
  <label class="search-label">Destination</label>
  <input id="mlTargetBox" class="ml-input" placeholder="Search destination..." autocomplete="off" />
  <div class="suggestions" id="mlTargetSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  </div>
  <div class="controls">
  <div class="small-note" id="mlStatus">Loading points…</div>
  <div><button id="mlClearBtn" class="secondary">Clear</button></div>
  </div>
  <div id="mlSidebar" class="ml-sidebar" aria-live="polite"></div>
  `;
}
