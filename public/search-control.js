/**
 * MapLibre-compatible floating search control with Fuse.js
 * Fetches GeoJSON nodes, provides fuzzy search, and supports source/target selection
 */

(function() {
  'use strict';

  // Global state
  let fuseInstance = null;
  let nodesData = [];
  let sourceMarker = null;
  let targetMarker = null;
  let mapInstance = null;
  let controlContainer = null;
  let suggestionsContainer = null;
  let searchInput = null;
  let activeSuggestionIndex = -1;
  let documentClickHandler = null;

  // Fuse.js version to match package.json
  const FUSE_VERSION = '6.6.2';
  
  // Marker colors
  const SOURCE_MARKER_COLOR = '#00ff00';
  const TARGET_MARKER_COLOR = '#ff0000';

  /**
   * Dynamically load Fuse.js from CDN if not already available
   */
  function loadFuse(callback) {
    if (window.Fuse) {
      callback(null, window.Fuse);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://cdn.jsdelivr.net/npm/fuse.js@${FUSE_VERSION}/dist/fuse.min.js`;
    script.onload = function() {
      callback(null, window.Fuse);
    };
    script.onerror = function() {
      callback(new Error('Failed to load Fuse.js'));
    };
    document.head.appendChild(script);
  }

  /**
   * Fetch GeoJSON nodes from endpoint
   */
  function fetchNodes(endpoint, callback) {
    fetch(endpoint)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch nodes: ' + response.statusText);
        }
        return response.json();
      })
      .then(geojson => {
        // Normalize features: extract id, name, rank
        const features = geojson.features || [];
        nodesData = features.map(feature => ({
          id: feature.properties.id,
          name: feature.properties.name || 'Unnamed',
          rank: feature.properties.rank || 999,
          coordinates: feature.geometry.coordinates
        }));
        callback(null, nodesData);
      })
      .catch(err => {
        callback(err);
      });
  }

  /**
   * Add or update GeoJSON source and layer for nodes
   */
  function addNodesLayer(map, features) {
    const sourceId = 'nodes-search';
    const layerId = 'nodes-search-circle';

    // Create GeoJSON from features
    const geojson = {
      type: 'FeatureCollection',
      features: features.map(node => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: node.coordinates
        },
        properties: {
          id: node.id,
          name: node.name,
          rank: node.rank
        }
      }))
    };

    // Add or update source
    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(geojson);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson
      });
    }

    // Add layer if not exists
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'rank'],
            0, 10,    // rank 0 = radius 10
            10, 8,    // rank 10 = radius 8
            50, 6,    // rank 50 = radius 6
            100, 4    // rank 100 = radius 4
          ],
          'circle-color': [
            'interpolate',
            ['linear'],
            ['get', 'rank'],
            0, '#ff0000',    // rank 0 = red
            10, '#ff6600',   // rank 10 = orange
            50, '#ffaa00',   // rank 50 = yellow-orange
            100, '#ffff00'   // rank 100 = yellow
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      });
    }
  }

  /**
   * Create the floating search control UI
   */
  function createControlUI(map) {
    const container = document.createElement('div');
    container.className = 'search-control';
    container.style.cssText = 'position: absolute; top: 10px; left: 10px; z-index: 1000;';

    const inputContainer = document.createElement('div');
    inputContainer.className = 'search-input-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search locations...';
    input.className = 'search-input';
    input.style.cssText = 'width: 300px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;';

    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear';
    clearButton.className = 'search-clear-button';
    clearButton.style.cssText = 'margin-left: 5px; padding: 10px 15px; border: 1px solid #ccc; border-radius: 4px; background: white; cursor: pointer; font-size: 14px;';
    clearButton.onclick = clearMarkers;

    inputContainer.appendChild(input);
    inputContainer.appendChild(clearButton);

    const suggestions = document.createElement('div');
    suggestions.className = 'search-suggestions';
    suggestions.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ccc; border-top: none; border-radius: 0 0 4px 4px; max-height: 300px; overflow-y: auto; margin-top: -1px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';

    container.appendChild(inputContainer);
    container.appendChild(suggestions);

    // Append to map container
    map.getContainer().appendChild(container);

    searchInput = input;
    suggestionsContainer = suggestions;
    controlContainer = container;

    return { input, suggestions, container };
  }

  /**
   * Show suggestions based on search query
   */
  function showSuggestions(query) {
    if (!query || query.length < 1) {
      suggestionsContainer.style.display = 'none';
      suggestionsContainer.innerHTML = '';
      activeSuggestionIndex = -1;
      return;
    }

    // Perform fuzzy search
    const results = fuseInstance.search(query, { limit: 10 });

    // Sort by score first, then by rank ascending (lower rank = more important)
    const sortedResults = results.sort((a, b) => {
      if (a.score === b.score) {
        return a.item.rank - b.item.rank;
      }
      return a.score - b.score;
    });

    if (sortedResults.length === 0) {
      suggestionsContainer.style.display = 'none';
      suggestionsContainer.innerHTML = '';
      activeSuggestionIndex = -1;
      return;
    }

    // Render suggestions
    suggestionsContainer.innerHTML = '';
    sortedResults.forEach((result, index) => {
      const item = result.item;
      const div = document.createElement('div');
      div.className = 'search-suggestion-item';
      div.style.cssText = 'padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;';
      div.textContent = `${item.name} (rank: ${item.rank})`;
      div.dataset.index = index;
      div.dataset.nodeId = item.id;
      div.dataset.nodeName = item.name;
      div.dataset.coordinates = JSON.stringify(item.coordinates);

      div.onmouseover = function() {
        highlightSuggestion(index);
      };

      div.onclick = function() {
        selectNode(item);
      };

      suggestionsContainer.appendChild(div);
    });

    suggestionsContainer.style.display = 'block';
    activeSuggestionIndex = -1;
  }

  /**
   * Highlight suggestion by index
   */
  function highlightSuggestion(index) {
    const items = suggestionsContainer.querySelectorAll('.search-suggestion-item');
    items.forEach((item, i) => {
      if (i === index) {
        item.style.backgroundColor = '#e8f4f8';
        activeSuggestionIndex = index;
      } else {
        item.style.backgroundColor = 'white';
      }
    });
  }

  /**
   * Handle keyboard navigation
   */
  function handleKeyboardNavigation(e) {
    const items = suggestionsContainer.querySelectorAll('.search-suggestion-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length === 0) return;
      activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
      highlightSuggestion(activeSuggestionIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      activeSuggestionIndex = activeSuggestionIndex <= 0 ? items.length - 1 : activeSuggestionIndex - 1;
      highlightSuggestion(activeSuggestionIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < items.length) {
        items[activeSuggestionIndex].click();
      } else if (items.length > 0) {
        // Select first suggestion if none is highlighted
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      suggestionsContainer.style.display = 'none';
      searchInput.blur();
    }
  }

  /**
   * Select a node and add marker
   */
  function selectNode(node) {
    if (!sourceMarker) {
      // First selection: set as source
      sourceMarker = new maplibregl.Marker({ color: SOURCE_MARKER_COLOR })
        .setLngLat(node.coordinates)
        .setPopup(new maplibregl.Popup().setHTML(`<strong>Source:</strong> ${node.name}`))
        .addTo(mapInstance);

      mapInstance.flyTo({
        center: node.coordinates,
        zoom: 14
      });

      console.log('Source set:', node.name);
    } else if (!targetMarker) {
      // Second selection: set as target
      targetMarker = new maplibregl.Marker({ color: TARGET_MARKER_COLOR })
        .setLngLat(node.coordinates)
        .setPopup(new maplibregl.Popup().setHTML(`<strong>Target:</strong> ${node.name}`))
        .addTo(mapInstance);

      // Fit map to show both markers
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend(sourceMarker.getLngLat());
      bounds.extend(targetMarker.getLngLat());

      mapInstance.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14
      });

      console.log('Target set:', node.name);
    } else {
      // Both already set, do nothing or reset
      console.log('Both source and target already set. Click Clear to reset.');
    }

    // Clear input and hide suggestions
    searchInput.value = '';
    suggestionsContainer.style.display = 'none';
    activeSuggestionIndex = -1;
  }

  /**
   * Clear markers
   */
  function clearMarkers() {
    if (sourceMarker) {
      sourceMarker.remove();
      sourceMarker = null;
    }
    if (targetMarker) {
      targetMarker.remove();
      targetMarker = null;
    }
    console.log('Markers cleared');
  }

  /**
   * Initialize search control
   */
  window.initSearchControl = function(map, options) {
    options = options || {};
    const endpoint = options.endpoint || '/v1/node';

    mapInstance = map;

    // Load Fuse.js
    loadFuse(function(err, Fuse) {
      if (err) {
        console.error('Error loading Fuse.js:', err);
        return;
      }

      // Fetch nodes
      fetchNodes(endpoint, function(err, nodes) {
        if (err) {
          console.error('Error fetching nodes:', err);
          return;
        }

        console.log(`Loaded ${nodes.length} nodes for search`);

        // Initialize Fuse
        fuseInstance = new Fuse(nodes, {
          keys: ['name', 'id'],
          threshold: 0.4,
          includeScore: true
        });

        // Add nodes layer to map
        addNodesLayer(map, nodes);

        // Create UI
        const ui = createControlUI(map);

        // Set up event listeners
        ui.input.addEventListener('input', function(e) {
          showSuggestions(e.target.value);
        });

        ui.input.addEventListener('keydown', handleKeyboardNavigation);

        // Hide suggestions when clicking outside
        // Remove old listener if exists to prevent duplicates
        if (documentClickHandler) {
          document.removeEventListener('click', documentClickHandler);
        }
        documentClickHandler = function(e) {
          if (!controlContainer.contains(e.target)) {
            suggestionsContainer.style.display = 'none';
          }
        };
        document.addEventListener('click', documentClickHandler);

        console.log('Search control initialized');
      });
    });
  };

})();
