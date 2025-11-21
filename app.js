// Frontend logic: choose API base URL depending on hostname, initialize MapLibre map,
// and use humanize-duration to display load time in a friendly way.
//
// Note: maplibregl and humanizeDuration are loaded as globals from CDN in index.html
// (maplibre-gl and humanize-duration are also added to package.json so you can
// switch to a bundler and import them from node_modules).

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalhost ? 'http://localhost:8080' : 'https://geo.jaxartes.net';

document.getElementById('api-base').textContent = API_BASE;

const endpointInput = document.getElementById('endpoint');
const fetchBtn = document.getElementById('fetchBtn');
const resultEl = document.getElementById('result');
const mapInfoEl = document.getElementById('map-info');

// Initialize a simple MapLibre map using OpenStreetMap raster tiles (no API key).
// This style object is a minimal MapLibre GL JS style with a raster tile source.
function initMap() {
  if (typeof maplibregl === 'undefined') {
    mapInfoEl.textContent = 'MapLibre not loaded.';
    return;
  }

  const start = performance.now();

  const style = {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-tiles-layer',
        type: 'raster',
        source: 'osm-tiles'
      }
    ]
  };

  // Create the map
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: [0, 20],
    zoom: 2
  });

  map.on('load', () => {
    const took = performance.now() - start;
    // humanizeDuration may be provided via CDN as humanizeDuration
    const human = (typeof humanizeDuration === 'function')
      ? humanizeDuration(took, { largest: 2, round: true })
      : `${Math.round(took)} ms`;
    mapInfoEl.textContent = `Map loaded in ${human}`;
  });

  // show errors if any
  map.on('error', (e) => {
    console.error('Map error', e);
    mapInfoEl.textContent = 'Map error (see console)';
  });
}

// Keep the legacy fetch demo from the previous app (calls API_BASE + endpoint)
fetchBtn.addEventListener('click', async () => {
  const rel = endpointInput.value || '/';
  let url;
  try {
    const normalizedRel = rel.startsWith('/') ? rel : '/' + rel;
    url = API_BASE + normalizedRel;
    resultEl.textContent = `Fetching ${url} ...`;
    const resp = await fetch(url, { mode: 'cors' });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await resp.json();
      resultEl.textContent = JSON.stringify({ status: resp.status, body: json }, null, 2);
    } else {
      const text = await resp.text();
      resultEl.textContent = JSON.stringify({ status: resp.status, body: text }, null, 2);
    }
  } catch (err) {
    resultEl.textContent = `Request to ${url} failed:\n${err.stack || err}`;
  }
});

// Start
initMap();