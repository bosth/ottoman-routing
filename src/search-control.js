// src/search-control.js
// Original search + routing UI/logic, modified to NOT restyle all nodes.
// It uses the nodes provided by main.js for base styling and only adds
// selection + route layers + UI.
// Now also adds a collapsible sidebar with a correctly positioned toggle button.

import Fuse from 'fuse.js';
import {
  escapeHtml,
  modeSymbolMap,
  rankLabelMap,
  formatCostMinutes,
    transportModes,
    normalizeFeatures,
    resolveApiBase,
    shuffle,
    modeIntToName,
    isoCodeToName,
    wrapArabic,
} from './helpers.js';

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
    if (!clearBtn) return;

    const hasValue = st.input.value.trim().length > 0 || selected[role] !== null;
    clearBtn.style.display = hasValue ? 'flex' : 'none';
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
      fetchAndRenderRouteIfReady().catch(console.error);
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

  const settingsBtn = container.querySelector('#mlSettingsBtn');
  const settingsPanel = container.querySelector('#mlSettingsPanel');

  // Add settings state to the state object (modify the existing state declaration around line 319)
  const selected = { source: null, target: null };
  const state = {
    source: { input: sourceBox, suggestionsEl: sourceSug, lastResults: [], activeIndex: -1, debounce: null, selectableIndices: [] },
    target: { input: targetBox, suggestionsEl: targetSug, lastResults: [], activeIndex: -1, debounce: null, selectableIndices: [] },
    settings: { year: 1914, allowedModes: {} }
  };

  // Cache for node lines data to avoid repeated fetches
  const nodeLinesCache = new Map();

  async function fetchNodeLines(nodeId) {
    if (!nodeId) return { names: [], lines: [] };

    if (nodeLinesCache. has(String(nodeId))) {
      return nodeLinesCache.get(String(nodeId));
    }

    try {
      const year = (state.settings && state.settings.year) ? Number(state.settings.year) : 1914;
      const url = `${apiBase}/v2/nodes/${encodeURIComponent(nodeId)}?year=${encodeURIComponent(year)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      const data = await res.json();

      // Try both formats: { result: { names, lines } } OR { names, lines } directly
      const result = (data && data.result) ? data.result : data;
      const names = Array. isArray(result?. names) ? result.names : [];
      const lines = Array.isArray(result?.lines) ? result.lines : [];

      const payload = { names, lines };
      nodeLinesCache.set(String(nodeId), payload);
      return payload;
    } catch (err) {
      console.warn('Failed to fetch lines for node', nodeId, err);
      const payload = { names: [], lines: [] };
      nodeLinesCache.set(String(nodeId), payload);
      return payload;
    }
  }

  // Helper function to render alternate names into the card (will create section if missing)
  // Updated to handle new names format: [{name, iso639, ...}]
  function updateAlternatesInCard(cardEl, namesFromApi) {

    if (!cardEl || ! Array.isArray(namesFromApi) || namesFromApi.length === 0) {
      return;
    }

    // Find or create alternates container
    let alternatesSection = cardEl.querySelector('.ml-node-card-alternates');

    if (! alternatesSection) {
      alternatesSection = document.createElement('div');
      alternatesSection.className = 'ml-node-card-alternates';
      alternatesSection.innerHTML = `<div class="ml-node-card-alternates-list"></div>`;
      // Insert before lines section if present, otherwise append
      const linesSec = cardEl.querySelector('.ml-node-card-lines');
      if (linesSec && linesSec.parentNode) linesSec.parentNode.insertBefore(alternatesSection, linesSec);
      else cardEl.querySelector('.ml-node-card-content').appendChild(alternatesSection);
    }

    const listEl = alternatesSection.querySelector('.ml-node-card-alternates-list') || document.createElement('div');
    listEl.className = 'ml-node-card-alternates-list';

    // Clear existing alternates and replace with API data (which has language codes)
    const seen = new Set();
    const items = [];

    namesFromApi.forEach((nameObj, idx) => {
      if (!nameObj) return;

      // Handle new object format: {name, iso639, ...}
      const name = nameObj.name ?  String(nameObj.name).trim() : '';
      const iso639 = nameObj.iso639 ? isoCodeToName[(nameObj.iso639).trim()] : '';

      if (!name) return;

      // Check for duplicates using the name only
      const nameLower = name.toLowerCase();
      if (seen.has(nameLower)) {
        return;
      }
      seen.add(nameLower);

      // Build display string: "Name (lang)" or just "Name" if no language code
      const displayText = iso639 ?  `${name} (${iso639})` : name;

      items.push(`<div class="ml-node-card-alternate">${wrapArabic(displayText)}</div>`);
    });

    // Replace all alternates with the API data
    listEl.innerHTML = items.join('');

    if (! alternatesSection.parentNode) {
      cardEl.querySelector('.ml-node-card-content').appendChild(alternatesSection);
    }
  }

  // Helper function to render lines into a card's lines container
  function renderNodeLines(linesContainer, lines) {
    if (!linesContainer) return;

    if (! lines || lines.length === 0) {
      linesContainer.innerHTML = '<div class="ml-node-card-lines-error">No lines found</div>';
      return;
    }

    const listHtml = lines.map(line => {
      const name = wrapArabic(String(line.name || 'Unknown'));
      const colour = String(line.colour || '#000000');
      const mode = escapeHtml(String(line.mode || ''));

      return `
      <div class="ml-node-card-line">
        <div class="ml-node-card-line-name" style="color: ${escapeHtml(colour)}">${name}</div>
        ${mode ? `<div class="ml-node-card-line-mode">${mode}</div>` : ''}
      </div>
      `;
    }).join('');

    linesContainer.innerHTML = `
      <div class="ml-node-card-lines-label">Lines</div>
      <div class="ml-node-card-lines-list">${listHtml}</div>
    `;
  }

  // Settings button handler and population function
  function populateSettingsPanel() {
    if (!settingsPanel) return;

    // Create grid container
    const grid = document.createElement('div');
    grid.className = 'ml-settings-grid';

    transportModes.forEach(mode => {
      const safeId = String(mode).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      const id = `mlMode_${safeId}`;
      const label = document.createElement('label');
      label.className = 'ml-settings-item';
      label.htmlFor = id;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = id;
      checkbox.checked = true;
      checkbox.dataset.mode = mode;
      checkbox.className = 'ml-mode-checkbox';

      // Initialize settings state
      state.settings.allowedModes[mode] = true;

      checkbox.addEventListener('change', () => {
        state.settings.allowedModes[mode] = checkbox.checked;
        // Recalculate route
        fetchAndRenderRouteIfReady().catch(console.error);
      });

      const span = document.createElement('span');
      span.className = 'ml-settings-item-label';
      span.textContent = mode;

      label.appendChild(checkbox);
      label.appendChild(span);
      grid.appendChild(label);
    });

    // Year slider row
    const sliderRow = document.createElement('div');
    sliderRow.className = 'ml-settings-slider-row';
    sliderRow.innerHTML = `
    <label for="mlYearSlider" class="ml-settings-slider-label">Year</label>
    <div class="ml-settings-slider-wrap">
    <input id="mlYearSlider" type="range" min="1860" max="1918" step="1" value="${state.settings.year}" />
    <span id="mlYearValue" class="ml-year-value">${state.settings.year}</span>
    </div>
    `;

    // Wire up slider
    const slider = sliderRow.querySelector('#mlYearSlider');
    const yearValue = sliderRow.querySelector('#mlYearValue');
    slider.addEventListener('input', () => {
      state.settings.year = Number(slider.value);
      yearValue.textContent = String(state.settings.year);
      // Recalculate route
      fetchAndRenderRouteIfReady().catch(console.error);
      nodeLinesCache.clear(); // clear cache since year affects it
    });

    // Append to panel
    settingsPanel.appendChild(grid);
    settingsPanel.appendChild(sliderRow);
  }

  // Settings button click handler
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = settingsPanel.style.display !== 'none';

      if (isOpen) {
        settingsPanel.style.display = 'none';
        settingsBtn.setAttribute('aria-expanded', 'false');
        container.classList.remove('ml-settings-open');
      } else {
        settingsPanel.style.display = 'block';
        settingsBtn.setAttribute('aria-expanded', 'true');
        container.classList.add('ml-settings-open');

        // Populate settings panel if not already done
        if (!settingsPanel.dataset.initialized) {
          populateSettingsPanel();
          settingsPanel.dataset.initialized = '1';
        }
      }
    });
  } else {
    console.warn('Settings button or panel not found', { settingsBtn, settingsPanel });
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
    : '/v2/nodes';
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
    threshold: 0.33,
    distance: 8,
    minMatchCharLength: 2,
    isCaseSensitive: false,
    ignoreDiacritics: true,
    includeScore: true,
    shouldSort: true,
    location: 0
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

  let activeRole = null;

  // Change cursor when in search state
  function updateMapCursor() {
    const mapCanvas = map.getCanvas();
    if (mapCanvas) {
      mapCanvas.style.cursor = activeRole ? 'crosshair' : '';
    }
  }

  // Replace the existing renderSuggestionsForRole function in src/search-control.js
  function renderSuggestionsForRole(role) {
    const st = state[role];
    const suggestionsEl = st.suggestionsEl;
    suggestionsEl.innerHTML = '';
    st.activeIndex = -1;
    st.selectableIndices = [];

    const results = st.lastResults;
    if (!results || ! results.length) {
      suggestionsEl.removeAttribute('aria-activedescendant');
      suggestionsEl.setAttribute('aria-expanded', 'false');
      return;
    }

    // Helper: get rank label string for properties
    function rankLabelForProps(props) {
      if (!props) return '';
      if (props.rank !== undefined && props.rank !== null) {
        if (typeof props.rank === 'number' && rankLabelMap.hasOwnProperty(props.rank)) {
          return String(rankLabelMap[props.rank]);
        }
        return String(props.rank);
      }
      return '';
    }

    // Helper: normalize name for comparison
    function normalizeName(name) {
      return String(name || '').toLowerCase().trim();
    }

    // Build a map of all results by their node ID for quick lookup
    const resultsByNodeId = new Map();
    results.forEach((r, resIndex) => {
      const item = r.item || r;
      const props = item.properties || {};
      const nodeId = props.id;
      if (nodeId !== undefined && nodeId !== null) {
        if (!resultsByNodeId.has(String(nodeId))) {
          resultsByNodeId.set(String(nodeId), { resIndex, item });
        }
      }
    });

    // Build cluster groups
    const clusterGroups = new Map();
    const standalone = [];
    const processedNodeIds = new Set();

    // First pass: identify cluster targets (IDs that are referenced by cluster property) from results
    const clusterTargets = new Set();
    results.forEach(r => {
      const item = r.item || r;
      const props = item.properties || {};
      const clusterId = props.cluster;
      if (clusterId !== null && clusterId !== undefined) {
        clusterTargets.add(String(clusterId));
      }
    });

    // Also check if any result node IS a cluster target (has other nodes pointing to it in allFeatures)
    const nodeIdsInResults = new Set();
    results.forEach(r => {
      const item = r.item || r;
      const props = item.properties || {};
      if (props.id !== undefined && props.id !== null) {
        nodeIdsInResults.add(String(props.id));
      }
    });

    // Find all nodes in allFeatures that point to nodes in our results
    allFeatures.forEach(f => {
      const props = f.properties || {};
      const clusterId = props.cluster;
      if (clusterId !== null && clusterId !== undefined) {
        if (nodeIdsInResults.has(String(clusterId))) {
          clusterTargets.add(String(clusterId));
        }
      }
    });

    // Second pass: group results
    results.forEach((r, resIndex) => {
      const item = r.item || r;
      const props = item.properties || {};
      const nodeId = String(props.id);
      const clusterId = props.cluster;

      if (processedNodeIds.has(nodeId)) return;
      processedNodeIds.add(nodeId);

      if (clusterId === null || clusterId === undefined) {
        // This node has no cluster - check if it's a cluster header
        if (clusterTargets.has(nodeId)) {
          if (! clusterGroups.has(nodeId)) {
            clusterGroups.set(nodeId, { header: { resIndex, item }, members: [] });
          } else {
            clusterGroups.get(nodeId).header = { resIndex, item };
          }
        } else {
          standalone.push({ resIndex, item });
        }
      } else {
        // This node belongs to a cluster
        const clusterIdStr = String(clusterId);
        if (!clusterGroups.has(clusterIdStr)) {
          clusterGroups.set(clusterIdStr, { header: null, members: [] });
        }
        clusterGroups.get(clusterIdStr).members.push({ resIndex, item });
      }
    });

    // For clusters where the header wasn't in results, try to find it from allFeatures
    // For clusters where the header wasn't in results, try to find it from allFeatures
    for (const [clusterId, group] of clusterGroups.entries()) {
      if (!group.header) {
        // FIX: Prefer the main node (with geometry) as the header
        let headerFeature = allFeatures.find(f =>
        f.properties &&
        String(f.properties.id) === clusterId &&
        f.geometry &&
        f.geometry.coordinates &&
        (f.geometry.type === 'Point' ? (f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0) : true)
        );

        // Fallback if no geometry node found, take any node with that ID
        if (!headerFeature) {
          headerFeature = allFeatures.find(f =>
          f.properties && String(f.properties.id) === clusterId
          );
        }

        if (headerFeature) {
          group.header = { resIndex: -1, item: headerFeature };
        }
      }
    }

    // For clusters, also pull in any members from allFeatures that weren't in results
    for (const [clusterId, group] of clusterGroups.entries()) {
      const existingMemberIds = new Set();
      if (group.header && group.header.item && group.header.item.properties) {
        existingMemberIds.add(String(group.header.item.properties.id));
      }
      group.members.forEach(m => {
        if (m.item && m.item.properties && m.item.properties.id !== undefined) {
          existingMemberIds.add(String(m.item.properties.id));
        }
      });

      // Find additional members from allFeatures
      allFeatures.forEach(f => {
        const props = f.properties || {};
        if (props.cluster !== null && props.cluster !== undefined && String(props.cluster) === clusterId) {
          const fId = String(props.id);
          if (!existingMemberIds.has(fId)) {
            existingMemberIds.add(fId);
            group.members.push({ resIndex: -1, item: f });
          }
        }
      });
    }

    // Render function for a selectable cluster member row
    function createMemberRow(resIndex, item, headerName, headerNodeId) {
      if (st.selectableIndices.length >= maxSuggestions) return null;

      const props = item.properties || {};
      const name = String(props.name || '').trim();
      const rankLabel = rankLabelForProps(props);
      const nameNorm = normalizeName(name);

      // Collect all names for nodes that share the HEADER's ID (the root node)
      const namesForHeaderId = new Set();
      if (headerNodeId !== undefined && headerNodeId !== null) {
        allFeatures.forEach(f => {
          if (f.properties && String(f.properties.id) === String(headerNodeId)) {
            const n = f.properties.name;
            if (n) {
              namesForHeaderId.add(normalizeName(n));
            }
          }
        });
      }

      // Check if current node's name matches ANY name from nodes sharing the header's ID
      const nameMatchesAnyHeaderName = namesForHeaderId.has(nameNorm);

      let displayText;
      if (nameMatchesAnyHeaderName || !name) {
        // Name matches one of the header's names or is empty - just show rank
        displayText = rankLabel || (props.id !== undefined ? String(props.id) : 'Unknown');
      } else {
        // Name is different - show "Name (rank)"
        displayText = rankLabel ? `${name} (${rankLabel})` : name;
      }

      const row = document.createElement('div');
      row.className = 'suggestion suggestion-member';

      // Store the actual resIndex, or if -1 (from allFeatures), we need to find or create an index
      let selectableIndex = resIndex;
      if (resIndex === -1) {
        // This item came from allFeatures, not from results - add it as a synthetic result
        const syntheticIndex = st.lastResults.length;
        st.lastResults.push({ item: item, score: 1 });
        selectableIndex = syntheticIndex;
      }

      row.dataset.index = selectableIndex;
      const optionId = `ml-${role}-suggestion-${st.selectableIndices.length}`;
      row.id = optionId;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');

      row.innerHTML = `<span class="suggestion-member-text">${escapeHtml(displayText)}</span>`;
      row.addEventListener('click', () => selectForRole(role, selectableIndex));

      st.selectableIndices.push(selectableIndex);
      return row;
    }

    // Render function for standalone (non-clustered) row - name bold, rank below in pale text
    function createStandaloneRow(resIndex, item) {
      if (st.selectableIndices.length >= maxSuggestions) return null;

      const props = item.properties || {};
      const name = String(props.name || '').trim();
      const rankLabel = rankLabelForProps(props);
      const displayName = name || (props.id !== undefined ? String(props.id) : 'Unknown');

      const row = document.createElement('div');
      row.className = 'suggestion suggestion-standalone';
      row.dataset.index = resIndex;
      const optionId = `ml-${role}-suggestion-${st.selectableIndices.length}`;
      row.id = optionId;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');

      let html = `<div class="suggestion-standalone-content">`;
      html += `<div class="suggestion-standalone-name">${escapeHtml(displayName)}</div>`;
      if (rankLabel) {
        html += `<div class="suggestion-standalone-rank">${escapeHtml(rankLabel)}</div>`;
      }
      html += `</div>`;

      row.innerHTML = html;
      row.addEventListener('click', () => selectForRole(role, resIndex));

      st.selectableIndices.push(resIndex);
      return row;
    }

    // Render cluster groups first (in order of first appearance in results)
    const renderedClusters = new Set();

    results.forEach((r) => {
      if (st.selectableIndices.length >= maxSuggestions) return;

      const item = r.item || r;
      const props = item.properties || {};
      const nodeId = String(props.id);
      const clusterId = props.cluster;

      // Determine which cluster this result belongs to
      let clusterKey = null;
      if (clusterId === null || clusterId === undefined) {
        if (clusterGroups.has(nodeId)) {
          clusterKey = nodeId;
        }
      } else {
        clusterKey = String(clusterId);
      }

      if (clusterKey && !renderedClusters.has(clusterKey)) {
        renderedClusters.add(clusterKey);
        const group = clusterGroups.get(clusterKey);
        if (! group) return;

        // Get header name and ID for comparison
        const headerProps = group.header ?  (group.header.item.properties || {}) : {};
        const headerName = String(headerProps.name || headerProps.id || 'Unknown').trim();
        const headerNodeId = headerProps.id;

        // Render header (non-selectable, bold)
        const headerRow = document.createElement('div');
        headerRow.className = 'suggestion-header';
        headerRow.innerHTML = `<strong>${escapeHtml(headerName)}</strong>`;
        suggestionsEl.appendChild(headerRow);

        // Render the header node as first selectable member
        if (group.header && group.header.resIndex >= 0) {
          const headerMemberRow = createMemberRow(group.header.resIndex, group.header.item, headerName, headerNodeId);
          if (headerMemberRow) {
            suggestionsEl.appendChild(headerMemberRow);
          }
        }

        // Render other member nodes
        group.members.forEach(member => {
          if (st.selectableIndices.length >= maxSuggestions) return;
          const memberRow = createMemberRow(member.resIndex, member.item, headerName, headerNodeId);
          if (memberRow) {
            suggestionsEl.appendChild(memberRow);
          }
        });
      }
    });

    // Render standalone nodes
    standalone.forEach(({ resIndex, item }) => {
      if (st.selectableIndices.length >= maxSuggestions) return;
      const row = createStandaloneRow(resIndex, item);
      if (row) {
        suggestionsEl.appendChild(row);
      }
    });

    // Activate the first selectable item if present
    const items = Array.from(suggestionsEl.querySelectorAll('.suggestion'));
    if (items.length) {
      st.activeIndex = 0;
      items.forEach((it, i) => {
        const isActive = i === st.activeIndex;
        it.classList.toggle('active', isActive);
        it.setAttribute('aria-selected', isActive ?  'true' : 'false');
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
      try {
        if (map.getLayer && map.getLayer('search-selected-circle')) map.removeLayer('search-selected-circle');
        if (map.getSource && map.getSource('search-selected')) map.removeSource('search-selected');
      } catch (e2) {}
      map.addSource('search-selected', { type: 'geojson', data: fc });
    }
    updateClearButtonVisibility(role);
  }

  // === Sidebar / route rendering (updated for v2 API) ===

  // Helper function to look up node by ID
  // Helper function to look up node by ID
  function getNodeById(nodeId) {
    if (!nodeId) return null;
    return allFeatures.find(f =>
    f.properties && String(f.properties.id) === String(nodeId)
    ) || null;
  }

  // Helper function to get node name from ID
  function getNodeName(nodeId) {
    const node = getNodeById(nodeId);
    if (node && node.properties) {
      return node.properties.name || node.properties.id || String(nodeId);
    }
    return String(nodeId);
  }

  // Helper function to get node rank from ID
  function getNodeRank(nodeId) {
    const node = getNodeById(nodeId);
    if (node && node.properties && node.properties.rank !== undefined) {
      return Number(node.properties.rank);
    }
    return null;
  }

  // Helper function to get the preferred node name for display
  // Priority: 1) User-entered name from search box, 2) Name from node with geometry
  function getPreferredNodeName(nodeId) {
    if (! nodeId) return String(nodeId);

    // Check if this node matches the selected source or target
    if (selected.source && String(selected.source.properties.id) === String(nodeId)) {
      return selected.source.properties.name || selected.source.properties.id || String(nodeId);
    }
    if (selected.target && String(selected.target.properties.id) === String(nodeId)) {
      return selected.target.properties.name || selected.target.properties.id || String(nodeId);
    }

    // Fall back to finding a node with geometry
    const nodeWithGeometry = allFeatures.find(f =>
    f.properties &&
    String(f.properties.id) === String(nodeId) &&
    f.geometry &&
    f.geometry.coordinates &&
    (f.geometry.type === 'Point' ?
    (f.geometry.coordinates[0] !== 0 || f.geometry.coordinates[1] !== 0) :
    true)
    );

    if (nodeWithGeometry && nodeWithGeometry.properties) {
      return nodeWithGeometry.properties.name || nodeWithGeometry.properties.id || String(nodeId);
    }

    // Final fallback: any node with this ID
    return getNodeName(nodeId);
  }

  // Helper function to get alternate names for a node ID
  // Returns an array of unique alternate names (excluding the primary name)
  function getNodeAlternateNames(nodeId, primaryName) {
    if (!nodeId) return [];

    const alternates = [];
    const seen = new Set();

    // Normalize primary name for comparison
    const primaryNormalized = String(primaryName || '').toLowerCase().trim();
    if (primaryNormalized) {
      seen.add(primaryNormalized);
    }

    // Find all features with matching ID
    allFeatures.forEach(f => {
      if (! f.properties || String(f.properties.id) !== String(nodeId)) return;

      const name = f.properties.name;
      if (! name) return;

      const nameNormalized = String(name).toLowerCase().trim();
      if (nameNormalized && !seen.has(nameNormalized)) {
        seen.add(nameNormalized);
        alternates.push(String(name)); // Use original casing
      }
    });

    return alternates;
  }

  async function updateSidebarForRoute(routeGeo) {
    if (!sidebar) return;
    if (!routeGeo || !Array.isArray(routeGeo.features) || routeGeo.features.length === 0) {
      sidebar.innerHTML = '';
      try { container.classList.remove('ml-search-fixed'); } catch (e) {}
      return;
    }

    const segs = routeGeo.features.map((f, i) => {
      const p = f.properties || {};
      return {
        idx: i,
        sourceId: p.source ?? p.src ?? '',
        targetId: p.target ?? p.tgt ?? '',
        source: getPreferredNodeName(p.source ?? p.src ?? ''),
                                       target: getPreferredNodeName(p.target ?? p.tgt ?? ''),
                                       line: p.line ?? p.name ?? '',
                                       modeInt: Number(p.mode),
                                       mode: modeIntToName[Number(p.mode)] ?? '',
                                       cost: p.cost ?? 0,
                                       color: p.ml_sidebar_color || '#000000'
      };
    });

    if (! segs.length) {
      sidebar.innerHTML = '';
      try { container.classList.remove('ml-search-fixed'); } catch (e) {}
      return;
    }

    // Build nodes array with IDs and resolved names
    const nodeIds = [];
    const nodes = [];
    nodeIds.push(segs[0].sourceId);
    nodes.push(segs[0].source);
    segs.forEach(s => {
      nodeIds.push(s.targetId);
      nodes.push(s.target);
    });

    const firstSource = nodes[0] || '';
    const lastTarget = nodes[nodes.length - 1] || '';

    const totalMins = segs.reduce((acc, s) => acc + (Number(s.cost) || 0), 0);
    const totalHuman = await formatCostMinutes(totalMins);
    const humanizedCosts = await Promise.all(segs.map(s => formatCostMinutes(s.cost)));

    try { container.classList.add('ml-search-fixed'); } catch (e) {}

    const summaryHtml = `
    <div class="ml-summary">
    <div class="ml-summary-left">${wrapArabic(firstSource)} 🢒 ${wrapArabic(lastTarget)}</div>
    <div class="ml-summary-right">${escapeHtml(String(totalHuman))}</div>
    </div>`;

    const steps = [];
    const isSwitchSeg = seg =>
    String(seg.line || '').toLowerCase() === 'switch' &&
    String(seg.sourceId || '') === String(seg.targetId || '');

    steps.push({ kind: 'node', label: nodes[0], nodeId: nodeIds[0] });

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const costHuman = humanizedCosts[i];
      const switchy = isSwitchSeg(seg);
      // Get rank from segment's source node (looked up from allFeatures)
      const rank = seg.sourceRank;

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
        sourceId: seg.sourceId,
        targetId: seg.targetId,
        rank: rank  // Use looked-up rank
      });

      steps.push({
        kind: 'node',
        label: nodes[i + 1],
        nodeId: nodeIds[i + 1]
      });
    }

    const rows = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prevSeg = segs[i - 1];

      // For the first segment, start with its source
      if (i === 0) {
        rows.push({
          type: 'node',
          label: seg.source,
          nodeId: seg.sourceId,
          rank: seg.sourceRank
        });
      }

      // Only add segment if it is NOT a switch (mode 10) AND NOT repeat source/target
      const isSwitch =
      Number(seg.modeInt) === 10 || seg.mode === "switch";
      const isRepeat = seg.sourceId === seg.targetId;
      if (!(isSwitch && isRepeat)) {
        rows.push({
          type: 'segment',
          idx: seg.idx,
          line: seg.line,
          mode: seg.mode,
          color: seg.color,
          costHuman: humanizedCosts[i],
          rank: seg.rank
        });
        // Only add node if it's the target (and not immediately after a switch)
        rows.push({
          type: 'node',
          label: seg.target,
          nodeId: seg.targetId,
          rank: seg.targetRank
        });
      }
      // else: skip switches (do NOT add segment, do NOT add node—the target will appear in next group)
    }

    const flowRowsHtml = rows.map((row, rowIdx) => {
      if (row.type === 'node') {
        const label = wrapArabic(String(row.label || ''));

        // Determine rank for this node - look it up from allFeatures using nodeId
        let nodeRank = row.rank;

        // If rank not already set, look it up
        if (nodeRank === null || nodeRank === undefined) {
          nodeRank = getNodeRank(row.nodeId);
        }

        // Get rank label text (for expanded view)
        const rankText = (nodeRank !== null && ! isNaN(nodeRank) && rankLabelMap.hasOwnProperty(nodeRank))
        ? rankLabelMap[nodeRank]
        : '';

        // Get alternate names for this node
        const alternateNames = getNodeAlternateNames(row.nodeId, row.label);

        // Determine node circle color
        let nodeStyle = '';
        if (rowIdx === 0) {
          // First node - green (source)
          nodeStyle = 'background-color: #2e7d32; border-color: #2e7d32;';
        } else if (rowIdx === rows.length - 1) {
          // Last node - red (target)
          nodeStyle = 'background-color: #d32f2f; border-color: #d32f2f;';
        }

        // Build rank HTML (hidden by default, shown when expanded)
        const rankHtml = rankText
        ? `<div class="ml-node-card-rank">${escapeHtml(rankText)}</div>`
        : '';

        // Build alternates HTML (hidden by default, shown when expanded)
        let alternatesHtml = '';
        if (alternateNames.length > 0) {
          const alternateItems = alternateNames
          .map(name => `<div class="ml-node-card-alternate">${escapeHtml(name)}</div>`)
          .join('');
          alternatesHtml = `
          <div class="ml-node-card-alternates">
          <div class="ml-node-card-alternates-list">
          ${alternateItems}
          </div>
          </div>`;
        }

        // Build lines HTML (hidden by default, shown when expanded, populated on first expand)
        const linesHtml = `
        <div class="ml-node-card-lines">
        <div class="ml-node-card-lines-loading">Loading lines...</div>
        </div>`;

        return `
        <div class="ml-flow-row ml-flow-row-node">
        <div class="ml-flow-left">
        <!-- Circle now rendered inside the card -->
        </div>
        <div class="ml-flow-right ml-flow-right-node">
        <div class="ml-node-card" tabindex="0" role="button" aria-expanded="false" data-node-id="${escapeHtml(String(row.nodeId || ''))}" data-lines-loaded="false">
        <span class="ml-node" style="${nodeStyle}"></span>
        <div class="ml-node-card-content">
        <div class="ml-node-card-name">${label}</div>
        ${rankHtml}
        ${alternatesHtml}
        ${linesHtml}
        </div>
        </div>
        </div>
        </div>`;
      }

      // ... existing code ...
      const segColor = String(row.color || '#000000');
      const modeName = row.mode; // Already canonical string
      const symbolName = modeSymbolMap[modeName] || 'directions_walk';

      // For connector style
      let connectorModeClass = '';
      let connectorStyleOverride = '';

      if (modeName === 'railway') connectorModeClass = 'railway';
      else if (modeName === 'narrow-gauge railway') connectorModeClass = 'railway-narrow';
      else if (modeName === 'ferry' || modeName === 'ship') connectorModeClass = modeName;
      else if (modeName === 'connection' || modeName === 'transfer') connectorModeClass = modeName;
      else if (modeName === 'road' || modeName === 'chaussee' || modeName === 'chausee') {
        // Cased line for road/chaussee
        // road = thinner (e.g. 4px), chaussee = thicker (e.g. 6px)
        const width = (modeName === 'road') ? '4px' : '6px';
        // Use background-color + black border to create the casing effect
        connectorStyleOverride = `background-color:${escapeHtml(segColor)}; border:1px solid #000; width:${width}; box-sizing:border-box;`;
      }

      const modeLabel = (modeName === 'transfer') ? '' : escapeHtml(modeName || '');

      // Use override if present, otherwise default to color property (for currentColor usage in CSS)
      const connectorStyle = connectorStyleOverride || `color:${escapeHtml(segColor)}`;

      return `
      <div class="ml-flow-row ml-flow-row-seg">
      <div class="ml-flow-left">
      <span class="ml-connector ${connectorModeClass}"
      style="${connectorStyle}"></span>
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
      </div>
      `;
    }).join('');

    const flowHtml = `<div class="ml-flow">${flowRowsHtml}</div>`;

    sidebar.innerHTML = `${summaryHtml}<div class="ml-seg-list">${flowHtml}</div>`;

    // Wire up node card click handlers for expand/collapse
    const nodeCardEls = sidebar.querySelectorAll('.ml-node-card');
    nodeCardEls.forEach(el => {
      const toggleExpand = async () => {
        const isExpanded = el.classList.toggle('expanded');
        el.setAttribute('aria-expanded', isExpanded ?  'true' : 'false');

        // Fetch lines & names on first expand
        if (isExpanded && el.dataset.linesLoaded === 'false') {
          const nodeId = el.dataset.nodeId;
          const linesContainer = el.querySelector('.ml-node-card-lines');

          if (nodeId && linesContainer) {
            el.dataset.linesLoaded = 'true'; // Mark as loading/loaded

            try {
              const payload = await fetchNodeLines(nodeId);
              renderNodeLines(linesContainer, payload.lines);
              // Update alternates from API names (if any)
              if (payload.names && payload.names.length) {
                updateAlternatesInCard(el, payload.names);
              }
            } catch (err) {
              linesContainer.innerHTML = '<div class="ml-node-card-lines-error">Failed to load lines</div>';
            }
          }
        }
      };

      el.addEventListener('click', toggleExpand);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleExpand();
        }
      });
    });

    // Wire up segment line click handlers (existing code)
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

        // Get image data instead of passing canvas directly
        const imageData = ctx.getImageData(0, 0, size, size);
        try {
          map.addImage('ml-rail-pattern', {
            width: size,
            height: size,
            data: imageData.data
          });
        } catch (e) {
          console.warn('addImage ml-rail-pattern failed', e);
        }
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

        // Get image data instead of passing canvas directly
        const imageData2 = ctx2.getImageData(0, 0, size2, size2);
        try {
          map.addImage('ml-rail-narrow-pattern', {
            width: size2,
            height: size2,
            data: imageData2.data
          });
        } catch (e) {
          console.warn('addImage ml-rail-narrow-pattern failed', e);
        }
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
    const year = (state.settings && state.settings.year) ?  Number(state.settings.year) : 1914;
    const url = `${apiBase}/v2/route?source=${encodeURIComponent(sid)}&target=${encodeURIComponent(tid)}&year=${encodeURIComponent(year)}`;

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

      const shuffled = shuffle(palette.slice());
      const lineColorMap = {};
      tramKeys.forEach((k, i) => { lineColorMap[k] = shuffled[i % shuffled.length]; });
      routeGeo.features.forEach((f, idx) => {
        const props = f.properties || {};
        // Map integer to canonical mode string
        const modeInt = Number(props.mode);
        const modeName = modeIntToName[modeInt] || '';
        props.ml_mode_int = modeInt;
        props.ml_mode_lower = modeName; // For map styling and sidebar
        let apiColour = props.colour;
        if (!apiColour || /^\s*$/.test(apiColour)) {
          apiColour = '#000000';
        }
        props.ml_color = apiColour;
        props.ml_sidebar_color = apiColour;
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
            'line-color': ['coalesce', ['get', 'ml_color'], '#000000'],
            'line-width': [
              'case',
              ['==', ['get', 'ml_mode_lower'], 'narrow-gauge railway'], 4.5,
              ['==', ['get', 'ml_mode_lower'], 'railway'], 6,
              ['in', ['get', 'ml_mode_lower'], ['literal', ['road', 'chaussee']]], 4,
              ['in', ['get', 'ml_mode_lower'], ['literal', ['connection', 'transfer']]], 2,
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
      if (st.debounce) clearTimeout(st.debounce);
      st.debounce = setTimeout(() => {
        const q = st.input.value.trim();
        searchForRole(role, q);
      }, 160);
      updateClearButtonVisibility(role); // ADD THIS LINE
    });

    st.input.addEventListener('keydown', (ev) => {
      const key = ev.key;
      if (key === 'Enter') {
        ev.preventDefault();
        if (st.activeIndex >= 0 && st.activeIndex < st.suggestionsEl.children.length) {
          // The activeIndex refers to the selectable .suggestion items within the list,
          // not group headers. We'll query selectable items and map to the underlying index.
          const items = Array.from(st.suggestionsEl.querySelectorAll('.suggestion'));
          if (items[st.activeIndex]) {
            const selIdx = Number(items[st.activeIndex].dataset.index);
            selectForRole(role, selIdx);
          }
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

  map.on('click', (ev) => {
    if (!activeRole) {
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
  <div class="ml-input-wrapper">
  <input id="mlSourceBox" class="ml-input" placeholder="Search starting point..." autocomplete="off" />
  <button type="button" class="ml-input-clear" id="mlSourceClear" aria-label="Clear starting point" style="display:none;">×</button>
  </div>
  <div class="suggestions" id="mlSourceSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  <div class="search-col">
  <div class="ml-input-wrapper">
  <input id="mlTargetBox" class="ml-input" placeholder="Search destination..." autocomplete="off" />
  <button type="button" class="ml-input-clear" id="mlTargetClear" aria-label="Clear destination" style="display:none;">×</button>
  </div>
  <div class="suggestions" id="mlTargetSuggestions" role="listbox" aria-expanded="false"></div>
  </div>
  <div class="ml-button-row">
  <button type="button" id="mlSettingsBtn" class="ml-icon-btn" aria-label="Settings" title="Settings" aria-expanded="false">⚙</button>
  </div>
  </div>
  <div id="mlSettingsPanel" class="ml-settings-panel" style="display:none;"></div>
  <div id="mlSidebar" class="ml-sidebar" aria-live="polite"></div>
  `;
}
