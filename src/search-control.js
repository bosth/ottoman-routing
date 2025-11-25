// src/search-control.js
// Original search + routing UI/logic, modified to NOT restyle all nodes.
// It uses the nodes provided by main.js for base styling and only adds
// selection + route layers + UI.
// Now also adds a collapsible sidebar with a correctly positioned toggle button.

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
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&lt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
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

  // Create / reuse the fixed-position UI container
  const mapContainer = map.getContainer();
  const existing = mapContainer.querySelector('.map-search-container');
  let container = existing;
  if (!container) {
    container = document.createElement('div');
    container.className = 'map-search-container';
    container.style.position = 'absolute';
    container.style.top = '12px';
    container.style.left = '12px';
    container.style.zIndex = 1000;
    container.style.width = '340px'; // narrower sidebar; CSS also sets width, this is a fallback
    container.setAttribute('aria-live', 'polite');
    container.innerHTML = createContainerHTML();
    mapContainer.appendChild(container);
  } else {
    container.innerHTML = createContainerHTML();
  }

  const sourceBox = container.querySelector('#mlSourceBox');
  const targetBox = container.querySelector('#mlTargetBox');
  const sourceSug = container.querySelector('#mlSourceSuggestions');
  const targetSug = container.querySelector('#mlTargetSuggestions');
  const sidebar = container.querySelector('#mlSidebar');

  // ---- Collapse toggle button setup ----
  // We append the toggle to the map container so it can live fully outside the sidebar.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'ml-search-toggle';
  toggleBtn.setAttribute('aria-label', 'Toggle search sidebar');
  toggleBtn.textContent = '⟨'; // collapse arrow
  mapContainer.appendChild(toggleBtn);

  // Get clear buttons
const sourceClearBtn = container.querySelector('#mlSourceClear');
const targetClearBtn = container.querySelector('#mlTargetClear');

// Function to show/hide clear buttons based on input value
function updateClearButtonVisibility(role) {
  const st = state[role];
  const clearBtn = role === 'source' ? sourceClearBtn : targetClearBtn;
  if (! clearBtn) return;

  const hasValue = st.input.value. trim(). length > 0 || selected[role] !== null;
  clearBtn. style.display = hasValue ? 'flex' : 'none';
}

// Wire up clear button handlers
if (sourceClearBtn) {
  sourceClearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFeature('source', null);
    state.source.input.value = '';
    state.source.lastResults = [];
    state.source.suggestionsEl.innerHTML = '';
    updateClearButtonVisibility('source');
    fetchAndRenderRouteIfReady(). catch(console.error);
    // Focus back on input
    setTimeout(() => state.source.input.focus(), 0);
  });
}

if (targetClearBtn) {
  targetClearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFeature('target', null);
    state.target.input.value = '';
    state.target.lastResults = [];
    state.target.suggestionsEl.innerHTML = '';
    updateClearButtonVisibility('target');
    fetchAndRenderRouteIfReady().catch(console.error);
    // Focus back on input
    setTimeout(() => state.target.input.focus(), 0);
  });
}

  function positionToggleExpanded() {
    // If collapsed, do not override fixed positioning
    if (container.classList.contains('ml-search-collapsed')) return;

    if (!sourceBox || !targetBox || !container.isConnected) return;

    const containerRect = container.getBoundingClientRect();
    const startRect = sourceBox.getBoundingClientRect();
    const destRect = targetBox.getBoundingClientRect();

    if (startRect.height === 0 || destRect.height === 0) return;

    // Vertical center between the top of the start input and the bottom of the target input
    const midY = (startRect.top + destRect.bottom) / 2;

    const sidebarRight = containerRect.right;

    const toggleRect = toggleBtn.getBoundingClientRect();
    const halfH = toggleRect.height / 2 || 22;

    toggleBtn.style.top = `${midY - halfH}px`;
    toggleBtn.style.left = `${sidebarRight}px`;
  }

  // Initial expanded position
  requestAnimationFrame(positionToggleExpanded);

  window.addEventListener('resize', () => {
    if (!container.classList.contains('ml-search-collapsed')) {
      positionToggleExpanded();
    }
  });

  toggleBtn.addEventListener('click', () => {
    const willCollapse = !container.classList.contains('ml-search-collapsed');

    if (willCollapse) {
      // Capture current vertical center in viewport coordinates
      const rect = toggleBtn.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const percent = (centerY / vh) * 100;
      document.documentElement.style.setProperty('--ml-search-toggle-top', `${percent}vh`);

      // Clear inline left/top so CSS fixed positioning fully controls it
      toggleBtn.style.top = '';
      toggleBtn.style.left = '';

      container.classList.add('ml-search-collapsed');
      toggleBtn.classList.add('ml-search-toggle-fixed');
      toggleBtn.textContent = '⟩'; // expand arrow
    } else {
      container.classList.remove('ml-search-collapsed');
      toggleBtn.classList.remove('ml-search-toggle-fixed');
      toggleBtn.textContent = '⟨';

      // Recompute expanded position from layout
      requestAnimationFrame(positionToggleExpanded);
    }
  });

  // ---- Existing search logic below (unchanged except for container width) ----

  async function getDataOrFetchLocal() {
    if (opts && opts.data && opts.data.features && Array.isArray(opts.data.features)) return opts.data;
    const endpointPath = (opts && opts.endpoint)
    ? (opts.endpoint.startsWith('/') ? opts.endpoint : '/' + opts.endpoint)
    : '/v2/node';
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
    return;
  }

  const allFeatures = normalizeFeatures(geojson.features || []);

  // NOTE: we do NOT add any global node styling here anymore.
  // main.js is responsible for base node styling (nodes / nodes-symbol / nodes-label).

  const fuse = new Fuse(allFeatures, {
    keys: ['properties.name', 'properties.id'],
    threshold: 0.45,
    distance: 100,
    minMatchCharLength: 1,
    ignoreDiacritics: true,
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
        // Slightly larger, fixed radius for explicit start/target,
        // otherwise fall back to rank-based size.
        'circle-radius': [
          'case',
          ['==', ['get', 'role'], 'source'], 8,
          ['==', ['get', 'role'], 'target'], 8,
          ['interpolate', ['linear'], ['get', 'rank'], 1, 10, 50, 6]
        ],
        // Start (source) = green, Target = red, others = gray.
        'circle-color': [
          'match',
          ['get', 'role'],
          'source', '#2e7d32',   // green for start node
          'target', '#d32f2f',   // red for target node
          '#888888'
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

  // Change cursor when in search state
  function updateMapCursor() {
    const mapCanvas = map.getCanvas();
    if (mapCanvas) {
      mapCanvas.style.cursor = activeRole ? 'crosshair' : '';
    }
  }

  const rankLabelMap = {
    9: 'vilâyet merkezi',
    8: 'sancak merkezi',
    7: 'kazâ merkezi',
    6: 'nâhiye merkezi',
    5: 'köy',
    4: 'station',
    3: 'dock',
    2: 'stop'
  };

  const modeSymbolMap = {
    walk: 'directions_walk',
    road: 'directions_walk',
    chaussee: 'directions_walk',
    connection: 'subway_walk',
    transfer: 'subway_walk',
    switch: 'subway_walk',
      'horse tramway': 'cable_car',
      'electric tramway': 'tram',
      railway: 'train',
      'narrow-gauge railway': 'directions_railway_2',
      ferry: 'directions_boat',
      ship: 'anchor',
      metro: 'funicular'
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
  if (! feat) selected[role] = null;
  else selected[role] = feat;

  const inp = state[role].input;
  if (selected[role]) inp.value = selected[role].properties.name || selected[role].properties.id || '';
  else inp.value = '';

    const feats = [];
    if (selected.source) feats.push({
      type: 'Feature',
      geometry: selected.source.geometry,
      properties: {
        role: 'source',
        id: selected.source.properties.id,
        name: selected.source.properties.name,
        shortLabel: selected.source.properties.shortLabel
      }
    });
    if (selected.target) feats.push({
      type: 'Feature',
      geometry: selected.target.geometry,
      properties: {
        role: 'target',
        id: selected.target.properties.id,
        name: selected.target.properties.name,
        shortLabel: selected.target.properties.shortLabel
      }
    });
    const fc = { type: 'FeatureCollection', features: feats };
    try {
      map.getSource('search-selected').setData(fc);
    } catch (e) {
      try { if (map.getLayer && map.getLayer('search-selected-circle')) map.removeLayer('search-selected-circle'); } catch (e2) {}
      try { if (map.getSource && map.getSource('search-selected')) map.removeSource('search-selected'); } catch (e2) {}
      map.addSource('search-selected', { type: 'geojson', data: fc });
    }
      updateClearButtonVisibility(role);

  }

  async function formatCostMinutes(mins) {
    await ensureHumanize();
    const md = (typeof window.humanizeDuration === 'function') ? window.humanizeDuration : null;
    if (!md) {
      const m = Number(mins) || 0;
      return `${m} min`;
    }
    const ms = (Number(mins) || 0) * 60000;
    return md(ms, { largest: 2, round: true, units: ['d', 'h', 'm'], largest: 2 });
  }

  // === Sidebar / route rendering (unchanged from repo) ===
  async function updateSidebarForRoute(routeGeo) {
    if (!sidebar) return;
    if (!routeGeo || !Array.isArray(routeGeo.features) || routeGeo.features.length === 0) {
      sidebar.innerHTML = '';
      try { container.classList.remove('ml-search-fixed'); } catch (e) {}
      return;
    }
    await ensureHumanize();

    const segs = routeGeo.features.map((f, i) => {
      const p = f.properties || {};
      return {
        idx: i,
        source: p.source ?? p.src ?? '',
        target: p.target ?? p.tgt ?? '',
        line: p.line ?? p.name ?? '',
        mode: (p.mode ?? '').toLowerCase(),
                                       cost: p.cost ?? 0,
                                       color: p.ml_sidebar_color || '#000000'
      };
    });

    if (!segs.length) {
      sidebar.innerHTML = '';
      try { container.classList.remove('ml-search-fixed'); } catch (e) {}
      return;
    }

    const nodes = [];
    nodes.push(segs[0].source);
    segs.forEach(s => nodes.push(s.target));

    const firstSource = nodes[0] || '';
    const lastTarget = nodes[nodes.length - 1] || '';

    const totalMins = segs.reduce((acc, s) => acc + (Number(s.cost) || 0), 0);
    const totalHuman = await formatCostMinutes(totalMins);
    const humanizedCosts = await Promise.all(segs.map(s => formatCostMinutes(s.cost)));

    try { container.classList.add('ml-search-fixed'); } catch (e) {}

    const summaryHtml = `
    <div class="ml-summary">
    <div class="ml-summary-left">${escapeHtml(String(firstSource))} 🢒 ${escapeHtml(String(lastTarget))}</div>
    <div class="ml-summary-right">${escapeHtml(String(totalHuman))}</div>
    </div>`;

    const modeSymbolMapLocal = modeSymbolMap;

    const steps = [];
    const isSwitchSeg = seg =>
    String(seg.line || '').toLowerCase() === 'switch' &&
    String(seg.source || '') === String(seg.target || '');

    steps.push({ kind: 'node', label: nodes[0] });

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const costHuman = humanizedCosts[i];
      const switchy = isSwitchSeg(seg);
      const feat = routeGeo.features[seg.idx];
      const rank = (feat && feat.properties && feat.properties.rank !== undefined)
      ? Number(feat.properties.rank)
      : null;

      steps.push({
        kind: 'segment',
        idx: seg.idx,
        line: seg.line,
        mode: seg.mode,
        color: seg.color,
        costHuman,
        isSwitch: switchy,
        source: seg.source,
        target: seg.target,
        rank: rank  // Add rank to segment steps
      });

      steps.push({
        kind: 'node',
        label: nodes[i + 1]
      });
    }

    // Replace the rows building section in updateSidebarForRoute:

    const rows = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.kind === 'node') {
        const next = steps[i + 1];
        const afterNext = steps[i + 2];

        if (
          next &&
          next.kind === 'segment' &&
          next.isSwitch === true &&
          afterNext &&
          afterNext.kind === 'node' &&
          String(afterNext.label) === String(step.label)
        ) {
          // This node has a switch - use the switch segment's rank
          rows.push({
            type: 'node',
            label: step.label,
            switchLine: next.line,
              switchCostHuman: next.costHuman,
                rank: next.rank  // Add the rank from the switch segment
          });
          i += 2;
          continue;
        }

        rows.push({
          type: 'node',
          label: step.label,
          switchLine: null,
            switchCostHuman: null,
              rank: null  // Will be determined from adjacent segment
        });
      } else if (step.kind === 'segment') {
        if (!step.isSwitch) {
          rows.push({
            type: 'segment',
            idx: step.idx,
            line: step.line,
            mode: step.mode,
            color: step.color,
            costHuman: step.costHuman,
            rank: step.rank  // Pass through the rank
          });
        }
      }
    }
    const flowRowsHtml = rows.map((row, rowIdx) => {
      if (row.type === 'node') {
        const label = escapeHtml(String(row.label || ''));

        // Determine rank for this node
        let rankLabel = '';

        // Check if this row already has a rank (from a switch)
        if (row.rank !== null && row.rank !== undefined) {
          const rank = Number(row.rank);
          if (!isNaN(rank) && rankLabelMap.hasOwnProperty(rank)) {
            rankLabel = `<span class="ml-node-rank"><em>${escapeHtml(rankLabelMap[rank])}</em></span>`;
          }
        } else if (rowIdx === rows.length - 1 && selected.target) {
          // Last node - get rank from target search box
          const rank = Number(selected.target.properties.rank);
          if (!isNaN(rank) && rankLabelMap.hasOwnProperty(rank)) {
            rankLabel = `<span class="ml-node-rank"><em>${escapeHtml(rankLabelMap[rank])}</em></span>`;
          }
        } else {
          // All other nodes - get rank from the segment that starts at this node
          // Count how many segments come AFTER this node position
          const segmentsAfterThisNode = rows.slice(rowIdx + 1).filter(r => r.type === 'segment').length;
          const totalSegments = rows.filter(r => r.type === 'segment').length;
          const segIdxForThisNode = totalSegments - segmentsAfterThisNode;

          if (segIdxForThisNode >= 0 && segIdxForThisNode < segs.length) {
            const seg = segs[segIdxForThisNode];
            const feat = routeGeo.features[seg.idx];
            if (feat && feat.properties && feat.properties.rank !== undefined) {
              const rank = Number(feat.properties.rank);
              if (!isNaN(rank) && rankLabelMap.hasOwnProperty(rank)) {
                rankLabel = `<span class="ml-node-rank"><em>${escapeHtml(rankLabelMap[rank])}</em></span>`;
              }
            }
          }
        }

        let nodeColor = '';
        if (rowIdx === 0) {
          // First node - green (source)
          nodeColor = 'style="background-color: #2e7d32; border-color: #2e7d32;"';
        } else if (rowIdx === rows.length - 1) {
          // Last node - red (target)
          nodeColor = 'style="background-color: #d32f2f; border-color: #d32f2f;"';
        }

        return `
        <div class="ml-flow-row ml-flow-row-node">
        <div class="ml-flow-left">
        <span class="ml-node" ${nodeColor}></span>
        </div>
        <div class="ml-flow-right ml-flow-right-node">
        <div class="ml-node-main">
        <span class="ml-node-label">${label}</span>${rankLabel}
        </div>
        </div>
        </div>`;
      }

      // Segment rendering stays the same...
      const segColor = String(row.color || '#000000');
      const modeKey = String(row.mode || '').toLowerCase();
      const symbolName = modeSymbolMapLocal.hasOwnProperty(modeKey)
      ? modeSymbolMapLocal[modeKey]
      : 'directions_walk';

      let connectorModeClass = '';
      if (modeKey === 'railway') connectorModeClass = 'railway';
      else if (modeKey === 'narrow-gauge railway') connectorModeClass = 'railway-narrow';
      else if (modeKey === 'ferry' || modeKey === 'ship') connectorModeClass = modeKey;
      else if (modeKey === 'connection' || modeKey === 'transfer') connectorModeClass = modeKey;

      const modeLabel = (modeKey === 'transfer')
      ? ''
      : escapeHtml(modeKey || '');

      return `
      <div class="ml-flow-row ml-flow-row-seg">
      <div class="ml-flow-left">
      <span class="ml-connector ${connectorModeClass}"
      style="color:${escapeHtml(segColor)}"></span>
      </div>
      <div class="ml-flow-right ml-flow-right-seg">
      <div class="ml-seg-line"
      data-idx="${row.idx}"
      role="button"
      tabindex="0">
      <div class="ml-seg-line-left" style="color:${escapeHtml(segColor)}">
      <span class="material-symbols-outlined ml-icon-inline" aria-hidden="true"
      style="color:${escapeHtml(segColor)}">
      ${escapeHtml(symbolName)}
      </span>
      <div class="ml-seg-line-text">
      <span class="ml-seg-line-name">${escapeHtml(String(row.line))}</span>
      <span class="ml-seg-line-mode">${modeLabel}</span>
      </div>
      </div>
      <span class="ml-seg-line-cost">${escapeHtml(String(row.costHuman))}</span>
      </div>
      </div>
      </div>`;
    }).join('');

    const flowHtml = `<div class="ml-flow">${flowRowsHtml}</div>`;

    sidebar.innerHTML = `${summaryHtml}<div class="ml-seg-list">${flowHtml}</div>`;

    const segLineEls = sidebar.querySelectorAll('.ml-seg-line');
    segLineEls.forEach(el => {
      const clickHandler = () => {
        const idx = Number(el.getAttribute('data-idx'));
        if (isNaN(idx)) return;
        const feat = routeGeo.features[idx];
        if (!feat) return;
        try { fitBoundsForGeoJSON({ type: 'FeatureCollection', features: [feat] }); } catch (e) {}
      };
      el.addEventListener('click', clickHandler);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clickHandler(); }
      });
    });
  }

  function fitBoundsForGeoJSON(gj, opts = {}) {
    if (!gj || !Array.isArray(gj.features) || gj.features.length === 0) return;

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    gj.features.forEach(f => {
      if (!f.geometry) return;
      const addPoint = ([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      };

        if (f.geometry.type === 'Point') {
          addPoint(f.geometry.coordinates);
        } else if (f.geometry.type === 'MultiPoint' || f.geometry.type === 'LineString') {
          (f.geometry.coordinates || []).forEach(addPoint);
        } else if (f.geometry.type === 'MultiLineString') {
          (f.geometry.coordinates || []).forEach(line => (line || []).forEach(addPoint));
        } else if (f.geometry.type === 'Polygon') {
          (f.geometry.coordinates || []).forEach(ring => (ring || []).forEach(addPoint));
        } else if (f.geometry.type === 'MultiPolygon') {
          (f.geometry.coordinates || []).forEach(poly =>
          (poly || []).forEach(ring => (ring || []).forEach(addPoint))
          );
        }
    });

    if (minLng === Infinity) return;

    const defaultPad = { top: 60, right: 60, bottom: 60, left: 60 };

    function computePaddingFromSidebar() {
      try {
        const mapEl = map.getContainer();
        const mapRect = mapEl.getBoundingClientRect();
        const ctrl = document.querySelector('.map-search-container');
        if (!ctrl) return defaultPad;

        const ctrlRect = ctrl.getBoundingClientRect();
        let leftOverlap = Math.max(0, Math.min(ctrlRect.right - mapRect.left, mapRect.width));
        const maxLeftPad = Math.floor(mapRect.width * 0.6);
        if (leftOverlap > maxLeftPad) leftOverlap = maxLeftPad;
        const margin = 8;
        const leftPad = Math.round(leftOverlap + margin);

        return {
          top: defaultPad.top,
          right: defaultPad.right,
          bottom: defaultPad.bottom,
          left: leftPad
        };
      } catch (e) {
        return defaultPad;
      }
    }

    const padding = opts.padding || computePaddingFromSidebar();

    // --- Compute target center and zoom manually (Mapbox-style) ---

    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;

    try {
      const mapCanvas = map.getCanvas ? map.getCanvas() : map.getContainer();
      const width = mapCanvas.clientWidth;
      const height = mapCanvas.clientHeight;
      if (!width || !height) throw new Error('Map size unavailable');

      // Effective width/height after padding
      const padLeft = padding.left || 0;
      const padRight = padding.right || 0;
      const padTop = padding.top || 0;
      const padBottom = padding.bottom || 0;

      const innerWidth = width - padLeft - padRight;
      const innerHeight = height - padTop - padBottom;
      if (innerWidth <= 0 || innerHeight <= 0) throw new Error('Inner size <= 0');

      // Web Mercator projection helpers (same math used internally)
      const R = 6378137;
      const MAX_LAT = 85.0511287798;

      function lngLatToWorld([lng, lat]) {
        const x = (lng + 180) / 360;
        const sin = Math.sin((Math.max(Math.min(MAX_LAT, lat), -MAX_LAT) * Math.PI) / 180);
        const y = 0.5 - (Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
        return [x, y]; // [0..1] in both axes at zoom 0, scaled later
      }

      const [minWX, minWY] = lngLatToWorld([minLng, minLat]);
      const [maxWX, maxWY] = lngLatToWorld([maxLng, maxLat]);

      const worldWidth = Math.abs(maxWX - minWX);
      const worldHeight = Math.abs(maxWY - minWY);

      if (worldWidth === 0 || worldHeight === 0) {
        // single point or degenerate; just ease to center with a fallback zoom
        map.easeTo({
          center: [centerLng, centerLat],
          zoom: (map.getZoom() || 10) - 1,
                   duration: 700
        });
        return;
      }

      // Zoom where worldWidth * 2^zoom ~= innerWidth (same for height)
      const zoomX = Math.log2(innerWidth / (worldWidth * 512));
      const zoomY = Math.log2(innerHeight / (worldHeight * 512));
      const targetZoomNatural = Math.min(zoomX, zoomY);

      // One level less than the "natural" fitBounds zoom
      const targetZoom = targetZoomNatural - 1;

      map.easeTo({
        center: [centerLng, centerLat],
        zoom: targetZoom,
        padding,            // still apply padding so it favors left side vs sidebar
        duration: 700
      });
    } catch (e) {
      // Fallback: center only, small zoom-out from current
      try {
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;
        map.easeTo({
          center: [centerLng, centerLat],
          zoom: (map.getZoom() || 10) - 1,
                   duration: 700
        });
      } catch (e2) {}
    }
  }

  function ensureRailPatterns() {
    try {
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
      try {
        if (map.getSource('search-route')) map.getSource('search-route').setData({ type: 'FeatureCollection', features: [] });
        if (map.getSource('search-route-ends')) map.getSource('search-route-ends').setData({ type: 'FeatureCollection', features: [] });
      } catch (e) {}
      await updateSidebarForRoute(null);
      return;
    }
    const sid = selected.source.properties.id;
    const tid = selected.target.properties.id;
    if (!sid || !tid) return;
    const url = `${apiBase}/v2/route?source=${encodeURIComponent(sid)}&target=${encodeURIComponent(tid)}&year=1914`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Route fetch failed: ' + res.status);
      const routeGeo = await res.json();
      window.__lastRouteGeo = routeGeo;
      if (!routeGeo || !Array.isArray(routeGeo.features)) throw new Error('Invalid route GeoJSON');

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
      tramKeys.forEach((k, i) => { lineColorMap[k] = shuffled[i % shuffled.length]; });
      routeGeo.features.forEach((f, idx) => {
        const props = f.properties || {};
        const mode = String((props.mode || '')).toLowerCase();
        props.ml_mode_lower = mode;
        if (mode.includes('tramway') || mode.includes('metro')) {
          const key = String(props.line || props.id || `__line_${idx}`);
          props.ml_color = lineColorMap[key] || shuffled[idx % shuffled.length];
        }

        let sidebarColor;
        if (mode === 'railway' || mode === 'narrow-gauge railway') {
          sidebarColor = '#000000';
        } else if (mode === 'ferry' || mode === 'ship') {
          sidebarColor = '#1a73e8';
        } else if (props.ml_color) {
          sidebarColor = props.ml_color;
        } else {
          sidebarColor = '#000000';
        }
        props.ml_sidebar_color = sidebarColor;

        f.properties = props;
      });

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

      const endPoints = [];
      routeGeo.features.forEach((f, idx) => {
        if (!f || !f.geometry) return;
        if (f.geometry.type === 'LineString') {
          const coords = f.geometry.coordinates;
          if (Array.isArray(coords) && coords.length > 0) {
            endPoints.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coords[0] },
              properties: { role: 'start', seg_idx: idx }
            });
            endPoints.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coords[coords.length - 1] },
              properties: { role: 'end', seg_idx: idx }
            });
          }
        } else if (f.geometry.type === 'MultiLineString') {
          const allCoords = f.geometry.coordinates.flat();
          if (Array.isArray(allCoords) && allCoords.length > 0) {
            endPoints.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: allCoords[0] },
              properties: { role: 'start', seg_idx: idx }
            });
            endPoints.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: allCoords[allCoords.length - 1] },
              properties: { role: 'end', seg_idx: idx }
            });
          }
        } else if (f.geometry.type === 'Point') {
          const c = f.geometry.coordinates;
          endPoints.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: c },
            properties: { role: 'start', seg_idx: idx }
          });
          endPoints.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: c },
            properties: { role: 'end', seg_idx: idx }
          });
        }
      });

      try {
        if (map.getSource('search-route-ends')) {
          map.getSource('search-route-ends').setData({ type: 'FeatureCollection', features: endPoints });
        } else {
          map.addSource('search-route-ends', { type: 'geojson', data: { type: 'FeatureCollection', features: endPoints } });
        }
      } catch (err) {
        console.warn('Failed to add/update search-route-ends source:', err);
      }

      try { if (map.getLayer('search-route-line-base')) map.removeLayer('search-route-line-base'); } catch (_) {}
      try { if (map.getLayer('search-route-road-outline')) map.removeLayer('search-route-road-outline'); } catch (_) {}
      try { if (map.getLayer('search-route-rail-symbol')) map.removeLayer('search-route-rail-symbol'); } catch (_) {}
      try { if (map.getLayer('search-route-rail-narrow-symbol')) map.removeLayer('search-route-rail-narrow-symbol'); } catch (_) {}
      try { if (map.getLayer('search-route-line-fallback')) map.removeLayer('search-route-line-fallback'); } catch (_) {}
      try { if (map.getLayer('search-route-ends-circle')) map.removeLayer('search-route-ends-circle'); } catch (_) {}

      let addedComplexLayers = false;
      try {
        // 1) Dark casing for road/chaussee (slightly wider)
        map.addLayer({
          id: 'search-route-road-outline',
          type: 'line',
          source: 'search-route',
          filter: ['in', ['get', 'ml_mode_lower'], ['literal', ['road', 'chaussee']]],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#000000',
            'line-width': 6,          // casing width
            'line-opacity': 0.9
          }
        }, 'nodes-label');             // still keep it below node labels

        // 2) Main colored line layer on top (including white roads)
        map.addLayer({
          id: 'search-route-line-base',
          type: 'line',
          source: 'search-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
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
              // slightly thinner than outline so border shows
              ['in', ['get', 'ml_mode_lower'], ['literal', ['road', 'chaussee']]], 4,
              ['in', ['get', 'ml_mode_lower'], ['literal', ['connection', 'transfer']]], 2,
              ['has', 'ml_color'], 4,
              4
            ],
            'line-dasharray': [
              'case',
              ['in', ['get', 'ml_mode_lower'], ['literal', ['connection', 'transfer']]], ['literal', [0, 4]],
              ['in', ['get', 'ml_mode_lower'], ['literal', ['ferry', 'ship', 'metro']]], ['literal', [4, 4]],
              ['literal', [1, 0]]
            ],
            'line-opacity': 0.95
          }
        }, 'nodes-label');

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
            paint: { 'icon-opacity': 1 }
          });
        } else {
          map.addLayer({
            id: 'search-route-rail-symbol',
            type: 'line',
            source: 'search-route',
            filter: ['==', ['get', 'ml_mode_lower'], 'railway'],
            layout: { 'line-join': 'round', 'line-cap': 'butt' },
            paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-dasharray': ['literal', [4, 4]], 'line-opacity': 1 }
          });
        }

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
            paint: { 'icon-opacity': 1 }
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

        if (map.getSource('search-route-ends')) {
          map.addLayer({
            id: 'search-route-ends-circle',
            type: 'circle',
            source: 'search-route-ends',
            paint: {
              'circle-color': '#ffffff',
              'circle-radius': 4,
              'circle-stroke-color': '#333',
              'circle-stroke-width': 0.5,
              'circle-opacity': 1
            }
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

      try { fitBoundsForGeoJSON(routeGeo); } catch (e) {}

      await updateSidebarForRoute(routeGeo);

    } catch (err) {
      console.error('Failed to fetch/render route:', err && err.message ? err.message : err);
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

    if (role === 'source' && !selected.target) {
      setTimeout(() => { state.target.input.focus(); }, 0);
    } else if (role === 'target' && !selected.source) {
      setTimeout(() => { state.source.input.focus(); }, 0);
    }

    fetchAndRenderRouteIfReady().catch(console.error);
  }

  ['source', 'target'].forEach(role => {
    const st = state[role];

    st.suggestionsEl.setAttribute('role', 'listbox');
    st.suggestionsEl.setAttribute('aria-expanded', 'false');

    st.input.addEventListener('focus', () => {
      activeRole = role;
      st.input.classList.add('active');
      const other = (role === 'source') ? state.target.input : state.source.input;
      other.classList.remove('active');
      updateMapCursor();
    });

    st.input.addEventListener('blur', () => {
      setTimeout(() => {
        const activeEl = document.activeElement;
        const isMapCanvas = activeEl && activeEl.classList && activeEl.classList.contains('maplibregl-canvas');

        if (!container.contains(activeEl) && !isMapCanvas) {
          activeRole = null;
          state.source.input.classList.remove('active');
          state.target.input.classList.remove('active');
          updateMapCursor();
        }
      }, 150);
    });

    st.input.addEventListener('click', () => {
      try { st.input.select(); } catch (e) {}
      try { st.input.focus(); } catch (e) {}
    });

st.input.addEventListener('input', () => {
  if (st. debounce) clearTimeout(st.debounce);
  st.debounce = setTimeout(() => {
    const q = st. input.value.trim();
    searchForRole(role, q);
  }, 160);
  updateClearButtonVisibility(role); // ADD THIS LINE
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

        // Clear active state after selection via keyboard
        if (selected.source && selected.target) {
          activeRole = null;
          state.source.input.classList.remove('active');
          state.target.input.classList.remove('active');
          updateMapCursor();
          st.input.blur(); // Remove focus to deactivate the input
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

  // IMPORTANT: click selection now uses your 'nodes-symbol' layer
  // IMPORTANT: click selection now uses your 'nodes-symbol' layer
  map.on('click', (ev) => {
    console.log('Map clicked, activeRole:', activeRole);
    if (!activeRole) {
      console.log('Returning early because activeRole is null');
      return;
    }

    // Convert click point to lng/lat
    const clickLngLat = ev.lngLat;

    // Find nearest feature within tolerance by distance calculation
    const clickTolerance = 0.006; // degrees (0.001 is roughly 100m at equator)

  let nearestFeature = null;
  let nearestDistance = Infinity;

  allFeatures.forEach(feat => {
    if (!feat.geometry || feat.geometry.type !== 'Point') return;

    const [lng, lat] = feat.geometry.coordinates;
    const dx = lng - clickLngLat.lng;
    const dy = lat - clickLngLat.lat;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < clickTolerance && dist < nearestDistance) {
      nearestDistance = dist;
      nearestFeature = feat;
    }
  });

  if (!nearestFeature) {
    console.log('No feature found near click');
    // Keep the search box focused and activeRole set so user can try again
    const currentInput = state[activeRole].input;
    setTimeout(() => {
      currentInput.focus();
      updateMapCursor();
    }, 0);
    return;
  }

  const nodeId = nearestFeature.properties.id;

  // Don't allow selecting the same node twice
  const otherRole = activeRole === 'source' ? 'target' : 'source';
  if (selected[otherRole] && String(selected[otherRole].properties.id) === String(nodeId)) {
    console.log('Cannot select the same node for both source and target');
    // Keep the search box focused and activeRole set so user can try again
    const currentInput = state[activeRole].input;
    setTimeout(() => {
      currentInput.focus();
      updateMapCursor();
    }, 0);
    return;
  }

  setSelectedFeature(activeRole, nearestFeature);
  const currentRole = activeRole;
  state[currentRole].suggestionsEl.innerHTML = '';
  state[currentRole].lastResults = [];
  state[currentRole].activeIndex = -1;

  if (activeRole === 'source' && !selected.target) {
    setTimeout(() => {
      state.target.input.focus();
      updateMapCursor();
    }, 0);
  } else if (activeRole === 'target' && !selected.source) {
    setTimeout(() => {
      state.source.input.focus();
      updateMapCursor();
    }, 0);
  } else {
    // If both are selected, clear activeRole and reset cursor
    activeRole = null;
    state.source.input.classList.remove('active');
    state.target.input.classList.remove('active');
    updateMapCursor();
  }

  state[currentRole].suggestionsEl.removeAttribute('aria-activedescendant');
  state[currentRole].suggestionsEl.setAttribute('aria-expanded', 'false');
  fetchAndRenderRouteIfReady().catch(console.error);
  });

  try {
    setTimeout(() => {
      sourceBox && sourceBox.focus && sourceBox.focus();
      try { sourceBox.select(); } catch (e) {}
      activeRole = 'source';
      sourceBox.classList.add('active');
      updateMapCursor();
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
  <div class="ml-input-wrapper">
    <input id="mlSourceBox" class="ml-input" placeholder="Search starting point..." autocomplete="off" />
    <button type="button" class="ml-input-clear" id="mlSourceClear" aria-label="Clear starting point" style="display:none;">×</button>
  </div>
  <div class="suggestions" id="mlSourceSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  <div class="search-col">
  <label class="search-label">Destination</label>
  <div class="ml-input-wrapper">
    <input id="mlTargetBox" class="ml-input" placeholder="Search destination..." autocomplete="off" />
    <button type="button" class="ml-input-clear" id="mlTargetClear" aria-label="Clear destination" style="display:none;">×</button>
  </div>
  <div class="suggestions" id="mlTargetSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  </div>
  <div id="mlSidebar" class="ml-sidebar" aria-live="polite"></div>
  `;
}
