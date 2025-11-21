// Entry (ESM) for Vite. Imports maplibre-gl and humanize-duration from node_modules
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import humanizeDuration from 'humanize-duration';

const root = document.getElementById('app') || (() => {
  const el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
  return el;
})();

root.innerHTML = `
  <header style="display:flex;align-items:center;gap:1rem;padding:1rem">
    <h1 style="margin:0">API + MapLibre (Vite) Demo</h1>
    <div style="color:#555">Frontend API base: <strong id="api-base" style="margin-left:.25rem"></strong></div>
  </header>

  <div style="padding:1rem">
    <div id="map" aria-label="Map" style="width:100%;height:420px;border-radius:6px;margin-bottom:1rem"></div>

    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:1rem">
      <label for="endpoint" style="color:#555">Endpoint:</label>
      <input id="endpoint" value="/" style="padding:.4rem;border-radius:4px;border:1px solid #ccc;width:60%" />
      <button id="fetchBtn" style="padding:.4rem .8rem;border-radius:6px">Fetch</button>
      <div id="map-info" style="color:#555;margin-left:1rem"></div>
    </div>

    <h2>Result</h2>
    <pre id="result" style="background:#f6f8fa;padding:1rem;border-radius:6px;white-space:pre-wrap;word-break:break-word">No request yet.</pre>
  </div>
`;

// Build-time API base (Vite injects import.meta.env.VITE_API_BASE from .env.* files)
// If VITE_API_BASE is not set at build time, we fall back to a runtime hostname check:
//  - if served from localhost -> http://localhost:8080
//  - otherwise -> https://geo.jaxartes.net
const buildTimeApiBase = import.meta.env.VITE_API_BASE;
const isLocalhostRuntime = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const runtimeFallback = isLocalhostRuntime ? 'http://localhost:8080' : 'https://geo.jaxartes.net';
const API_BASE = buildTimeApiBase || runtimeFallback;

document.getElementById('api-base').textContent = API_BASE;

const endpointInput = document.getElementById('endpoint');
const fetchBtn = document.getElementById('fetchBtn');
const resultEl = document.getElementById('result');
const mapInfoEl = document.getElementById('map-info');

// Initialize a simple MapLibre map using OpenStreetMap raster tiles (no API key).
function initMap() {
  if (!maplibregl) {
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

  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: [0, 20],
    zoom: 2
  });

  map.on('load', () => {
    const took = performance.now() - start;
    const human = humanizeDuration(took, { largest: 2, round: true });
    mapInfoEl.textContent = `Map loaded in ${human}`;
  });

  map.on('error', (e) => {
    console.error('Map error', e);
    mapInfoEl.textContent = 'Map error (see console)';
  });
}

// Fetch demo (calls API_BASE + endpoint)
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

initMap();