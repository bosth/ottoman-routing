// Optional Express server to serve dist/ in production and to offer a /api proxy.
// Keep this if you want to serve the built site via Node (e.g., start script).
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

// Optional proxy middleware (only used if PROXY_API env var is set)
const useProxy = (process.env.PROXY_API === 'true' || process.env.PROXY_API === '1');
if (useProxy) {
  const { createProxyMiddleware } = require('http-proxy-middleware');
  const target = process.env.API_TARGET || 'https://geo.jaxartes.net';
  console.log(`Proxy enabled: forwarding /api -> ${target}`);
  app.use('/api', createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: target.startsWith('https'),
    pathRewrite: { '^/api': '' }
  }));
}

// Serve static built assets when in production (dist produced by `vite build`)
app.use(express.static(DIST_DIR));

// SPA fallback to index.html in dist
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'undefined'})`);
});