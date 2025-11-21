// Initialize MapLibre map using terrain-style.json
function initMap() {
  if (typeof maplibregl === 'undefined') {
    console.error('MapLibre not loaded.');
    return;
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: 'terrain-style.json', // Load the style from the public folder
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

// Start
initMap();