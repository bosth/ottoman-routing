// src/main.js - Vite entry (consolidated)
// - imports the bundled search control and CSS from src/
// - does NOT inject fonts (index.html is authoritative)
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Import control and css so Vite bundles them
import './search-control.css';
import initSearchControl from './search-control.js';

const root = document.getElementById('app') || (() => {
  const el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
  return el;
})();

const style = document.createElement('style');
style.textContent = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; overflow: hidden; }
#map { width: 100%; height: 100%; }
`;
document.head.appendChild(style);

root.innerHTML = `<div id="map" aria-label="Map"></div>`;

function resolveApiBase() {
  const buildBase = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ? import.meta.env.VITE_API_BASE : '';
  return (buildBase && buildBase !== '') ? buildBase.replace(/\/$/, '') :
  (window.__API_BASE__ ? String(window.__API_BASE__).replace(/\/$/, '') :
  ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:8080' : 'https://geo.jaxartes.net'));
}

function initMap() {
  if (!maplibregl) {
    console.error('MapLibre not loaded.');
    return;
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: 'terrain-style.json',
    center: [29.0, 41.0],
    zoom: 10
  });

  map.on('load', async () => {
    console.log('Map loaded successfully');

    const apiBase = resolveApiBase();

    // fetch nodes once and pass into control
    let geojson = null;
    try {
      const res = await fetch(apiBase + '/v2/node', { cache: 'no-store' });
      if (res.ok) geojson = await res.json();
    } catch (err) {
      console.warn('Could not fetch /v2/node at startup:', err);
    }

    // Call the bundled control directly (it was imported above)
    try {
      await initSearchControl(map, { data: geojson, apiBase });
    } catch (err) {
      console.error('initSearchControl failed:', err);
    }
  });

  map.on('error', (e) => {
    console.error('Map error', e);
  });
}

initMap();
