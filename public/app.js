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
    
    // Load search control CSS
    if (!document.querySelector('link[href$="search-control.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'search-control.css';
      link.setAttribute('data-search-control', 'true');
      document.head.appendChild(link);
    }
    
    // Load and initialize search control
    if (typeof window.initSearchControl === 'undefined') {
      // Check if script is already being loaded or loaded using data attribute
      if (!document.querySelector('script[data-search-control="true"]')) {
        const script = document.createElement('script');
        script.src = 'search-control.js';
        script.setAttribute('data-search-control', 'true');
        script.onload = function() {
          if (typeof window.initSearchControl === 'function') {
            window.initSearchControl(map, { endpoint: '/v1/node' });
          }
        };
        document.head.appendChild(script);
      }
    } else {
      window.initSearchControl(map, { endpoint: '/v1/node' });
    }
  });

  map.on('error', (e) => {
    console.error('Map error', e);
  });
}

// Start
initMap();