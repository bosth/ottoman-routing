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

// Add full screen styles
const style = document.createElement('style');
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #app { width: 100%; height: 100%; overflow: hidden; }
  #map { width: 100%; height: 100%; }
`;
document.head.appendChild(style);

root.innerHTML = `
  <div id="map" aria-label="Map"></div>
`;

// Build-time API base (Vite injects import.meta.env.VITE_API_BASE from .env.* files)
// If VITE_API_BASE is not set at build time, we fall back to a runtime hostname check:
//  - if served from localhost -> http://localhost:8080
//  - otherwise -> https://geo.jaxartes.net
const buildTimeApiBase = import.meta.env.VITE_API_BASE;
const isLocalhostRuntime = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const runtimeFallback = isLocalhostRuntime ? 'http://localhost:8080' : 'https://geo.jaxartes.net';
const API_BASE = buildTimeApiBase || runtimeFallback;

// Initialize MapLibre map using terrain-style.json
function initMap() {
  if (!maplibregl) {
    console.error('MapLibre not loaded.');
    return;
  }

  // Determine the base URL for the style - need to handle both dev and production
  const baseUrl = import.meta.env.BASE_URL || '/';
  const styleUrl = `${baseUrl}terrain-style.json`;

  const map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: [29.0, 41.0], // Istanbul, Turkey - fitting for Ottoman routing theme
    zoom: 10
  });

  map.on('load', () => {
    console.log('Map loaded successfully');
  });

  map.on('error', (e) => {
    console.error('Map error', e);
  });
}

initMap();