const express = require('express');
const path = require('path');
const fs = require('fs');

// Import API routes from src/api/index.js
const apiRoutes = require('./src/api/index');

// Create the main Express app
const app = express();
const PORT = process.env.PORT || 8080;

// Mount the API routes under /api
app.use('/api', apiRoutes);

// Health check endpoint at root level
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve static files from multiple locations
app.use(express.static(path.join(__dirname, 'static')));

// In production, serve the built frontend files
if (process.env.NODE_ENV === 'production') {
  console.log('Serving production frontend build...');
  app.use(express.static(path.join(__dirname, 'src/frontend/dist')));
} else {
  // In development, serve files from the public directory
  app.use(express.static(path.join(__dirname, 'src/frontend/public')));
}

// For SPA client-side routing, catch all non-API routes and serve the index.html
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/') || req.path === '/health') {
    return next();
  }
  
  // In production
  if (process.env.NODE_ENV === 'production') {
    try {
      // Send the built index.html
      res.sendFile(path.join(__dirname, 'src/frontend/dist/index.html'));
    } catch (e) {
      console.error('Error serving frontend:', e);
      res.status(500).send('Error serving the frontend application. Make sure to build the frontend with `npm run build`.');
    }
  } else {
    // In development, we'll return a placeholder that redirects to the dev server
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Leystar Development</title>
          <meta http-equiv="refresh" content="0;URL='http://localhost:5173/'" />
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          </style>
        </head>
        <body>
          <h1>Leystar API Server</h1>
          <p>The frontend is running on a separate development server.</p>
          <p>If you are not automatically redirected, <a href="http://localhost:5173/">click here to go to the frontend</a>.</p>
        </body>
      </html>
    `);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API is available at http://localhost:${PORT}/api`);
  
  if (process.env.NODE_ENV === 'production') {
    console.log(`Frontend is available at http://localhost:${PORT}`);
  } else {
    console.log('To run the frontend in development:');
    console.log('  cd src/frontend && npm run dev');
  }
});

module.exports = app;