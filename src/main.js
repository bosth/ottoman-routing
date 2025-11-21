// Entry (ESM) for Vite. Imports maplibre-gl from node_modules
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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

// Initialize MapLibre map using terrain-style.json
function initMap() {
  if (!maplibregl) {
    console.error('MapLibre not loaded.');
    return;
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: 'terrain-style.json', // Served from public folder
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