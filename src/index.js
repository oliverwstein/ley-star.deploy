const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const dotenv = require('dotenv');
const winston = require('winston');

// Load environment variables
dotenv.config();

// Log all environment variables for debugging
console.log('Environment variables:');
console.log(`GCS_BUCKET_NAME: ${process.env.GCS_BUCKET_NAME}`);
console.log(`GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
console.log(`GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}`);

// Create logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Google Cloud Storage
let storage;
let bucketName;
try {
  console.log("Initializing Google Cloud Storage...");
  
  // In Cloud Run, we use default credentials
  if (process.env.K_SERVICE) {
    console.log("Running in Cloud Run, using default credentials");
    storage = new Storage();
  } else {
    console.log("Running locally, using provided credentials");
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  }
  
  bucketName = process.env.GCS_BUCKET_NAME;
  console.log(`Using bucket: ${bucketName}`);
  
  if (!bucketName) {
    console.error('GCS_BUCKET_NAME is not set in environment variables');
    logger.error('GCS_BUCKET_NAME is not set in environment variables');
  }
} catch (error) {
  console.error(`Failed to initialize Google Cloud Storage: ${error.message}`);
  logger.error(`Failed to initialize Google Cloud Storage: ${error.message}`);
}

// Log bucket info for debugging
async function checkBucket() {
  try {
    if (!storage || !bucketName) {
      console.error("Storage or bucket name not initialized properly");
      return;
    }
    
    console.log(`Checking if bucket ${bucketName} exists...`);
    const [exists] = await storage.bucket(bucketName).exists();
    console.log(`Bucket ${bucketName} exists: ${exists}`);
    logger.info(`Bucket ${bucketName} exists: ${exists}`);
    
    if (exists) {
      const [files] = await storage.bucket(bucketName).getFiles({
        maxResults: 5
      });
      console.log(`First ${files.length} files in bucket:`);
      logger.info(`First 5 files in bucket:`);
      files.forEach(file => {
        console.log(` - ${file.name}`);
        logger.info(` - ${file.name}`);
      });
    }
  } catch (error) {
    console.error(`Error checking bucket: ${error.message}`);
    logger.error(`Error checking bucket: ${error.message}`);
  }
}

// Don't wait for bucket check to start server
checkBucket().catch(err => {
  console.error("Bucket check failed but continuing:", err);
});

// Allow server to start even if bucket name is missing
// We'll handle missing bucket in the API routes
if (!bucketName) {
  logger.error('GCS_BUCKET_NAME is not set in environment variables');
  console.error('GCS_BUCKET_NAME is not set in environment variables');
  // Don't exit - process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Add latency tracking middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Define a custom error handler
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ROUTES
// Health check endpoints - support both /health and /api/health
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// List all manuscripts
app.get('/api/manuscripts', async (req, res, next) => {
  try {
    logger.info(`Attempting to list files from bucket: ${bucketName}`);
    
    // Get all files without delimiter to ensure we see everything
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: 'catalogue/'
    });
    
    logger.info(`Found ${files.length} files with prefix 'catalogue/'`);
    
    const manuscriptDirs = new Set();
    
    // Extract unique manuscript IDs from path prefixes
    files.forEach(file => {
      const filePath = file.name;
      // Match manuscript ID pattern in the path
      const match = filePath.match(/catalogue\/([^\/]+)/);
      if (match && match[1]) {
        manuscriptDirs.add(match[1]);
        logger.info(`Found manuscript ID: ${match[1]} from file ${filePath}`);
      }
    });
    
    const manuscripts = Array.from(manuscriptDirs);
    logger.info(`Returning ${manuscripts.length} manuscripts`);
    
    res.json({
      manuscripts: manuscripts
    });
  } catch (error) {
    logger.error(`Error listing manuscripts: ${error.message}`);
    next(error);
  }
});

// Get manuscript metadata
app.get('/api/manuscripts/:id', async (req, res, next) => {
  const manuscriptId = req.params.id;
  
  try {
    const metadataPath = `catalogue/${manuscriptId}/standard_metadata.json`;
    const file = storage.bucket(bucketName).file(metadataPath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Manuscript not found' });
    }
    
    const [content] = await file.download();
    const metadata = JSON.parse(content.toString());
    
    res.json(metadata);
  } catch (error) {
    next(error);
  }
});

// List all pages for a manuscript
app.get('/api/manuscripts/:id/pages', async (req, res, next) => {
  const manuscriptId = req.params.id;
  
  try {
    logger.info(`Getting pages for manuscript: ${manuscriptId}`);
    
    // Get all files without using delimiter
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `catalogue/${manuscriptId}/pages/`
    });
    
    logger.info(`Found ${files.length} files in manuscript pages directory`);
    
    const pageDirectories = new Set();
    
    // Extract unique page directories
    files.forEach(file => {
      const filePath = file.name;
      logger.info(`Processing file for pages: ${filePath}`);
      
      // Match any page number pattern (4 digits)
      const match = filePath.match(/catalogue\/[^\/]+\/pages\/(\d{4})/);
      if (match && match[1]) {
        pageDirectories.add(match[1]);
        logger.info(`Found page: ${match[1]}`);
      }
    });
    
    // Convert to array and sort numerically (considering they're numeric strings)
    const sortedPages = Array.from(pageDirectories).sort((a, b) => {
      return parseInt(a, 10) - parseInt(b, 10);
    });
    
    logger.info(`Returning ${sortedPages.length} pages for manuscript ${manuscriptId}`);
    
    res.json({
      manuscript_id: manuscriptId,
      pages: sortedPages
    });
  } catch (error) {
    logger.error(`Error getting pages: ${error.message}`);
    next(error);
  }
});

// Helper function to normalize page ID to 4 digits
function normalizePageId(pageId) {
  // Remove any non-numeric characters
  const numericOnly = pageId.replace(/\D/g, '');
  // Pad with leading zeros to 4 digits
  return numericOnly.padStart(4, '0');
}

// Get page data
app.get('/api/manuscripts/:id/pages/:pageId', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    // Normalize the page ID to the proper 4-digit format
    const normalizedPageId = normalizePageId(rawPageId);
    logger.info(`Requested page: ${rawPageId}, normalized to: ${normalizedPageId}`);
    
    const basePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/`;
    
    // Check if page exists
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: basePath
    });
    
    if (files.length === 0) {
      logger.info(`Page not found: ${normalizedPageId} for manuscript ${manuscriptId}`);
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Collect available files for this page
    const availableFiles = files.map(file => path.basename(file.name));
    
    res.json({
      manuscript_id: manuscriptId,
      page_id: normalizedPageId,
      files: availableFiles
    });
  } catch (error) {
    logger.error(`Error retrieving page data: ${error.message}`);
    next(error);
  }
});

// Get page image (web size)
app.get('/api/manuscripts/:id/pages/:pageId/image', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    // Normalize the page ID
    const normalizedPageId = normalizePageId(rawPageId);
    
    const imagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/web.webp`;
    const file = storage.bucket(bucketName).file(imagePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    file.createReadStream()
      .on('error', (err) => next(err))
      .pipe(res);
  } catch (error) {
    logger.error(`Error retrieving image: ${error.message}`);
    next(error);
  }
});

// Get page thumbnail
app.get('/api/manuscripts/:id/pages/:pageId/thumbnail', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    // Normalize the page ID
    const normalizedPageId = normalizePageId(rawPageId);
    
    const imagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/thumbnail.webp`;
    const file = storage.bucket(bucketName).file(imagePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    file.createReadStream()
      .on('error', (err) => next(err))
      .pipe(res);
  } catch (error) {
    logger.error(`Error retrieving thumbnail: ${error.message}`);
    next(error);
  }
});

// Get segmentation data
app.get('/api/manuscripts/:id/pages/:pageId/segmentation', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    // Normalize the page ID
    const normalizedPageId = normalizePageId(rawPageId);
    
    const filePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/segmentation.json`;
    const file = storage.bucket(bucketName).file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Segmentation data not found' });
    }
    
    const [content] = await file.download();
    const segmentationData = JSON.parse(content.toString());
    
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.json(segmentationData);
  } catch (error) {
    logger.error(`Error retrieving segmentation data: ${error.message}`);
    next(error);
  }
});

// Get transcript data
app.get('/api/manuscripts/:id/pages/:pageId/transcript', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    // Normalize the page ID
    const normalizedPageId = normalizePageId(rawPageId);
    
    const filePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/transcript.json`;
    const file = storage.bucket(bucketName).file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Transcript data not found' });
    }
    
    const [content] = await file.download();
    const transcriptData = JSON.parse(content.toString());
    
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.json(transcriptData);
  } catch (error) {
    logger.error(`Error retrieving transcript data: ${error.message}`);
    next(error);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logger.info(`Server running on port ${PORT}`);
});

module.exports = app;