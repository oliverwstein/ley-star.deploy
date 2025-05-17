const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const dotenv = require('dotenv');
const winston = require('winston');
const { ManuscriptSearch } = require('./index-search');

// Load environment variables
dotenv.config();

// Log essential environment variables for debugging
console.log('Environment variables:');
console.log(`GCS_BUCKET_NAME: ${process.env.GCS_BUCKET_NAME}`);
console.log(`GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'using default credentials'}`);
console.log(`GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT || 'using default project'}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`PORT: ${process.env.PORT || '8080 (default)'}`);

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

// Create Express router instead of app
const router = express.Router();

// Initialize Google Cloud Storage
let storage;
let bucketName;

// Cache for the manuscript index
let manuscriptIndexCache = null;
let indexLastFetched = null;
const INDEX_CACHE_TTL = 1000 * 60 * 60; // 1 hour in milliseconds
let searchInstance = null;

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
if (!bucketName) {
  logger.error('GCS_BUCKET_NAME is not set in environment variables');
  console.error('GCS_BUCKET_NAME is not set in environment variables');
  // Don't exit - process.exit(1);
}

// Function to fetch and cache the manuscript index
async function fetchManuscriptIndex() {
  if (manuscriptIndexCache && indexLastFetched && Date.now() - indexLastFetched < INDEX_CACHE_TTL) {
    logger.info('Using cached manuscript index');
    return manuscriptIndexCache;
  }
  
  try {
    logger.info('Fetching manuscript index from cloud storage');
    const indexPath = 'catalogue/search-index.json';
    const file = storage.bucket(bucketName).file(indexPath);
    
    const [exists] = await file.exists();
    if (!exists) {
      logger.error(`Index file not found at path: ${indexPath}`);
      manuscriptIndexCache = null; // Clear cache if file not found
      searchInstance = null;
      return null;
    }
    
    const [content] = await file.download();
    const indexData = JSON.parse(content.toString());
    
    // Cache the index
    manuscriptIndexCache = indexData;
    indexLastFetched = Date.now();
    
    // Initialize the search instance
    searchInstance = new ManuscriptSearch(indexData);
    
    logger.info(`Manuscript index fetched and cached with ${indexData.documents?.length || 0} documents. Version: ${indexData.metadata?.version}`);
    return indexData;
  } catch (error) {
    logger.error(`Error fetching manuscript index: ${error.message}`);
    manuscriptIndexCache = null; // Clear cache on error
    searchInstance = null;
    return null;
  }
}

// Initial fetch of the index when server starts
fetchManuscriptIndex().catch(err => {
  logger.error(`Initial index fetch failed: ${err.message}`);
});

// Middleware for the router
router.use(cors());
router.use(express.json());
router.use(morgan('dev'));

// Add latency tracking middleware
router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Define a custom error handler
router.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ROUTES
// Root route for API
router.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'Ley-Star API',
    version: '1.0.0',
    endpoints: [
      '/health',
      '/manuscripts',
      '/manuscripts/:id',
      '/manuscripts/:id/pages',
      '/manuscripts/:id/pages/:pageId',
      '/manuscripts/:id/pages/:pageId/image',
      '/manuscripts/:id/pages/:pageId/thumbnail',
      '/manuscripts/:id/pages/:pageId/segmentation',
      '/manuscripts/:id/pages/:pageId/transcript',
      '/search',
      '/search/index'
    ]
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Bucket check endpoint for frontend
router.get('/bucket', async (req, res, next) => {
  try {
    if (!storage || !bucketName) {
      return res.status(500).json({ 
        status: 'error', 
        message: 'Storage or bucket name not properly initialized' 
      });
    }
    
    const [exists] = await storage.bucket(bucketName).exists();
    if (!exists) {
      return res.status(404).json({ 
        status: 'error', 
        message: `Bucket ${bucketName} not found` 
      });
    }
    
    res.status(200).json({ 
      status: 'ok', 
      bucket: bucketName 
    });
  } catch (error) {
    logger.error(`Bucket check error: ${error.message}`);
    next(error);
  }
});

// List all manuscripts
router.get('/manuscripts', async (req, res, next) => {
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
        // logger.info(`Found manuscript ID: ${match[1]} from file ${filePath}`); // Too verbose for production
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

// Get manuscript thumbnail (first page thumbnail)
router.get('/manuscripts/:id/thumbnail', async (req, res, next) => {
  const manuscriptId = req.params.id;
  
  try {
    logger.info(`Getting thumbnail for manuscript: ${manuscriptId}`);
    
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `catalogue/${manuscriptId}/pages/`
    });
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No pages found for this manuscript' });
    }
    
    const pageNums = new Set();
    files.forEach(file => {
      const match = file.name.match(/catalogue\/[^\/]+\/pages\/(\d{4})/);
      if (match && match[1]) {
        pageNums.add(parseInt(match[1], 10));
      }
    });
    
    if (pageNums.size === 0) {
      // Attempt to find any page if specific 4-digit pattern fails
      const anyPageMatch = files.find(f => f.name.includes('/thumbnail.webp'));
      if (anyPageMatch) {
        logger.warn(`Could not find 4-digit page for thumbnail of ${manuscriptId}, using first available thumbnail: ${anyPageMatch.name}`);
        const file = storage.bucket(bucketName).file(anyPageMatch.name);
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'public, max-age=86400');
        return file.createReadStream().on('error', (err) => next(err)).pipe(res);
      }
      return res.status(404).json({ error: 'No valid pages with thumbnails found for this manuscript' });
    }
    
    const firstPageNum = Math.min(...pageNums);
    const normalizedPageId = String(firstPageNum).padStart(4, '0');
    
    const imagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/thumbnail.webp`;
    const file = storage.bucket(bucketName).file(imagePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Thumbnail not found for first page' });
    }
    
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    file.createReadStream()
      .on('error', (err) => next(err))
      .pipe(res);
  } catch (error) {
    logger.error(`Error retrieving manuscript thumbnail: ${error.message}`);
    next(error);
  }
});

// Get manuscript metadata
router.get('/manuscripts/:id', async (req, res, next) => {
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
router.get('/manuscripts/:id/pages', async (req, res, next) => {
  const manuscriptId = req.params.id;
  
  try {
    logger.info(`Getting pages for manuscript: ${manuscriptId}`);
    
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: `catalogue/${manuscriptId}/pages/`
    });
    
    // logger.info(`Found ${files.length} files in manuscript pages directory for ${manuscriptId}`);
    
    const pageDirectories = new Set();
    files.forEach(file => {
      const filePath = file.name;
      const match = filePath.match(/catalogue\/[^\/]+\/pages\/(\d{4})/);
      if (match && match[1]) {
        pageDirectories.add(match[1]);
      }
    });
    
    const sortedPages = Array.from(pageDirectories).sort((a, b) => {
      return parseInt(a, 10) - parseInt(b, 10);
    });
    
    logger.info(`Returning ${sortedPages.length} pages for manuscript ${manuscriptId}`);
    
    res.json({
      manuscript_id: manuscriptId,
      pages: sortedPages
    });
  } catch (error) {
    logger.error(`Error getting pages for ${manuscriptId}: ${error.message}`);
    next(error);
  }
});

// Helper function to normalize page ID to 4 digits
function normalizePageId(pageId) {
  const numericOnly = String(pageId).replace(/\D/g, '');
  return numericOnly.padStart(4, '0');
}

// Get page data
router.get('/manuscripts/:id/pages/:pageId', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    const normalizedPageId = normalizePageId(rawPageId);
    // logger.info(`Requested page: ${rawPageId}, normalized to: ${normalizedPageId} for manuscript ${manuscriptId}`);
    
    const basePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/`;
    
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix: basePath
    });
    
    if (files.length === 0) {
      logger.info(`Page not found: ${normalizedPageId} for manuscript ${manuscriptId}`);
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const availableFiles = files.map(file => path.basename(file.name));
    
    res.json({
      manuscript_id: manuscriptId,
      page_id: normalizedPageId,
      files: availableFiles
    });
  } catch (error) {
    logger.error(`Error retrieving page data for ${manuscriptId}/${rawPageId}: ${error.message}`);
    next(error);
  }
});

// Get page image (full size, assuming full.webp is preferred)
router.get('/manuscripts/:id/pages/:pageId/image', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    const normalizedPageId = normalizePageId(rawPageId);
    const imagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/full.webp`; // Prefer full.webp
    const file = storage.bucket(bucketName).file(imagePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      // Fallback to web.webp if full.webp doesn't exist
      const fallbackImagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/web.webp`;
      const fallbackFile = storage.bucket(bucketName).file(fallbackImagePath);
      const [fallbackExists] = await fallbackFile.exists();
      if (!fallbackExists) {
        return res.status(404).json({ error: 'Image (full.webp or web.webp) not found' });
      }
      logger.warn(`Serving web.webp for ${manuscriptId}/${normalizedPageId} as full.webp not found.`);
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=86400');
      return fallbackFile.createReadStream().on('error', (err) => next(err)).pipe(res);
    }
    
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    file.createReadStream()
      .on('error', (err) => next(err))
      .pipe(res);
  } catch (error) {
    logger.error(`Error retrieving image for ${manuscriptId}/${rawPageId}: ${error.message}`);
    next(error);
  }
});

// Get page thumbnail
router.get('/manuscripts/:id/pages/:pageId/thumbnail', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    const normalizedPageId = normalizePageId(rawPageId);
    const imagePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/thumbnail.webp`;
    const file = storage.bucket(bucketName).file(imagePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    file.createReadStream()
      .on('error', (err) => next(err))
      .pipe(res);
  } catch (error) {
    logger.error(`Error retrieving thumbnail for ${manuscriptId}/${rawPageId}: ${error.message}`);
    next(error);
  }
});

// Get segmentation data
router.get('/manuscripts/:id/pages/:pageId/segmentation', async (req, res, next) => {
    const { id: manuscriptId, pageId: rawPageId } = req.params;
    
    try {
      const normalizedPageId = normalizePageId(rawPageId);
      const filePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/segmentation.json`;
      const file = storage.bucket(bucketName).file(filePath);
      
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ error: 'Segmentation data not found' });
      }
      
      const [content] = await file.download();
      let segmentationData = JSON.parse(content.toString());
      
      // Optional: Pre-calculate bounding boxes (already in your code, kept for consistency)
      if (segmentationData.lines) {
        segmentationData.lines = segmentationData.lines.map(line => {
          if (line.boundary && line.boundary.length > 2) {
            const xs = line.boundary.map(point => point[0]);
            const ys = line.boundary.map(point => point[1]);
            line.bounds = {
              centerX: xs.reduce((sum, x) => sum + x, 0) / xs.length,
              centerY: ys.reduce((sum, y) => sum + y, 0) / ys.length
            };
          }
          return line;
        });
      }
      
      res.set('Cache-Control', 'public, max-age=86400');
      res.json(segmentationData);
    } catch (error) {
      logger.error(`Error retrieving segmentation data for ${manuscriptId}/${rawPageId}: ${error.message}`);
      next(error);
    }
  });

// Get transcript data
router.get('/manuscripts/:id/pages/:pageId/transcript', async (req, res, next) => {
  const { id: manuscriptId, pageId: rawPageId } = req.params;
  
  try {
    const normalizedPageId = normalizePageId(rawPageId);
    const filePath = `catalogue/${manuscriptId}/pages/${normalizedPageId}/transcript.json`;
    const file = storage.bucket(bucketName).file(filePath);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'Transcript data not found' });
    }
    
    const [content] = await file.download();
    const transcriptData = JSON.parse(content.toString());
    
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(transcriptData);
  } catch (error) {
    logger.error(`Error retrieving transcript data for ${manuscriptId}/${rawPageId}: ${error.message}`);
    next(error);
  }
});

// Get search index metadata
router.get('/search/index', async (req, res, next) => {
  try {
    const index = await fetchManuscriptIndex(); // Ensures index is loaded/refreshed if needed
    
    if (!index) {
      return res.status(500).json({ error: 'Failed to load search index' });
    }
    
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      metadata: index.metadata,
      facets: {
        languages: Object.keys(index.facets.languages || {}),
        material_keywords: Object.keys(index.facets.material_keywords || {}),
        script_keywords: Object.keys(index.facets.script_keywords || {}),
        repository: Object.keys(index.facets.repository || {}),
        transcription_status: Object.keys(index.facets.transcription_status || {})
      }
    });
  } catch (error) {
    logger.error(`Error retrieving search index metadata: ${error.message}`);
    next(error);
  }
});

// Search manuscripts endpoint
router.post('/search', async (req, res, next) => {
  try {
    if (!searchInstance) {
      const index = await fetchManuscriptIndex();
      if (!index || !searchInstance) {
        return res.status(500).json({ error: 'Search index not available or failed to load' });
      }
    }
    
    const searchQuery = req.body;
    
    if (!searchQuery || typeof searchQuery !== 'object') {
      return res.status(400).json({ error: 'Invalid search query format' });
    }
    
    const operations = [];
    
    if (searchQuery.text && searchQuery.text.query && String(searchQuery.text.query).trim() !== "") {
      operations.push(searchInstance.textSearch({
        fields: searchQuery.text.fields || ['title', 'shelfmark', 'authors', 'brief', 'origin_location', 'repository'],
        query: String(searchQuery.text.query).trim(),
        matchType: searchQuery.text.matchType || 'contains'
      }));
    }
    
    if (searchQuery.facets) {
      Object.entries(searchQuery.facets).forEach(([facetType, facetOptions]) => {
        if (typeof facetOptions === 'object') {
          if (facetOptions.include && Array.isArray(facetOptions.include.values) && facetOptions.include.values.length > 0) {
            operations.push(searchInstance.facetSearch({
              facetType: facetType,
              values: facetOptions.include.values,
              matchType: facetOptions.include.matchType || 'any'
            }));
          }
          if (facetOptions.exclude && Array.isArray(facetOptions.exclude.values) && facetOptions.exclude.values.length > 0) {
            operations.push(searchInstance.facetSearch({
              facetType: facetType,
              values: facetOptions.exclude.values,
              matchType: 'none' // 'none' effectively means "exclude these" from the current result set
            }));
          }
        } else if (Array.isArray(facetOptions.values) && facetOptions.values.length > 0) { // Backward compatibility
          operations.push(searchInstance.facetSearch({
            facetType: facetType,
            values: facetOptions.values,
            matchType: facetOptions.matchType || 'any'
          }));
        }
      });
    }
    
    if (searchQuery.dateRange) {
      operations.push(searchInstance.dateRangeSearch(searchQuery.dateRange));
    }
    
    const searchResults = searchInstance.search({
      operations,
      operator: searchQuery.operator || 'AND' // Default to AND if multiple operations
    });
    
    const page = parseInt(searchQuery.page || '1', 10);
    const limit = parseInt(searchQuery.limit || '20', 10);
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedItems = searchResults.items.slice(startIndex, endIndex);
    
    res.json({
      total: searchResults.total,
      page,
      limit,
      totalPages: Math.ceil(searchResults.total / limit),
      items: paginatedItems,
      facetCounts: searchResults.facetCounts
    });
  } catch (error) {
    logger.error(`Search error: ${error.message}`);
    next(error);
  }
});

// Export the router instead of starting the server
module.exports = router;