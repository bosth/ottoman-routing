// src/main.js
// MapLibre entry + base node styling + search control

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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
  const buildBase = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE)
    ? import.meta.env.VITE_API_BASE
    : '';
  return (buildBase && buildBase !== '') ? buildBase.replace(/\/$/, '') :
    (window.__API_BASE__ ? String(window.__API_BASE__).replace(/\/$/, '') :
      ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'http://localhost:8080'
        : 'https://geo.jaxartes.net'));
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

  // Optional: keep a handle for debugging
  window._mlMap = map;

  map.on('load', async () => {


    // Add 3D terrain tiles
    map.addSource("terrain-source", {
      "type": "raster-dem",
      "url": "https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=O9wOLjIC6FtbZ5aGuxHA",
    });

    map.setTerrain({
      "source": "terrain-source",
      "exaggeration": 1.5
    });

    //Optional: Add hillshading
    // map.addLayer({
    //   "id": "hillshading",
    //   "source": "terrain-source",
    //   "type": "hillshade"
    // });

    const apiBase = resolveApiBase();

    let geojson = null;
    try {
      const res = await fetch(apiBase + '/v2/node', { cache: 'no-store' });
      if (res.ok) {
        geojson = await res.json();
      } else {
        console.warn('Failed to fetch /v2/node:', res.status, res.statusText);
      }
    } catch (err) {
      console.warn('Could not fetch /v2/node at startup:', err);
    }

    // If nodes loaded, add your new base node styling
    if (geojson && geojson.type === 'FeatureCollection') {
      // Base nodes source
      if (!map.getSource('nodes')) {
        map.addSource('nodes', {
          type: 'geojson',
          data: geojson
        });
      } else {
        map.getSource('nodes').setData(geojson);
      }

      // New: decluttered node symbols: tiny dot + text, no sprites
      if (!map.getLayer('nodes-symbol')) {
        map.addLayer({
          id: 'nodes-symbol',
          type: 'symbol',
          source: 'nodes',
          layout: {
            // this string is used only for placement; style via paint
            'text-field': '•',
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,

            // automatic decluttering:
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-padding': 2,

            'text-offset': [0, 0],
            'text-anchor': 'center',
            'visibility': 'visible'
          },
          paint: {
            // dot color
            'text-color': '#ff8800',
            'text-halo-color': '#000000',
            'text-halo-width': 1,

            // simple zoom-based visibility
            'text-opacity': [
              'step',
              ['zoom'],
              0,    // z < 6: hide
              6, 0.7,
              10, 1.0
            ]
          }
        });
      }

      // New: separate label layer for names, decluttered, above dots
      if (!map.getLayer('nodes-label')) {
        map.addLayer({
          id: 'nodes-label',
          type: 'symbol',
          source: 'nodes',
          layout: {
            'text-field': ['coalesce', ['get', 'name'], ['get', 'id']],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 14],
            'text-offset': [0, 1.0],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-padding': 2
          },
          paint: {
            'text-color': '#222',
            'text-halo-color': '#fff',
            'text-halo-width': 3,
            'text-opacity': [
              'step',
              ['zoom'],
              0,   // z < 8: hide labels
              8, 0.7,
              12, 1.0
            ]
          }
        });
      }
    }

    // Call the (old) bundled control: it uses opts.data for search,
    // but no longer restyles all nodes.
    try {
      await initSearchControl(map, { data: geojson, apiBase });
    } catch (err) {
      console.error('initSearchControl failed:', err);
    }
  });

  map.on('error', (e) => {
    try {
      if (e && e.error) {
        console.error('Map error:', e.error && e.error.message ? e.error.message : e.error);
      } else {
        console.error('Map error:', e);
      }
    } catch (err) {
      console.error('Map error (logging failure):', e, err);
    }
  });
}

initMap();
