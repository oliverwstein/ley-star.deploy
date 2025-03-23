/**
 * Manuscript Metadata Indexer for Google Cloud Storage and Elasticsearch 8.x
 * 
 * Configuration:
 * - Connects to Elasticsearch 8.x with security enabled
 * - Indexes metadata from Google Cloud Storage
 * - Supports vector embeddings for semantic search
 */

const { Client } = require('@elastic/elasticsearch');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');
const pipeline = promisify(require('stream').pipeline);
require('dotenv').config();

// --------------------------------
// CONFIGURATION
// --------------------------------

// Elasticsearch connection settings
const ES_HOST = 'http://192.168.1.17:9200';
const ES_USERNAME = 'elastic';
const ES_PASSWORD = 'o2Hzo=d9mmb2RnCAF_Cc';

// Google Cloud Storage bucket
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Use dummy embeddings for development (set to 'true' in .env)
const USE_DUMMY_EMBEDDINGS = process.env.USE_DUMMY_EMBEDDINGS === 'true';

// Force reindexing of all documents
const FORCE_REINDEX = process.argv.includes('--force');

// Other constants
const INDEX_NAME = 'manuscripts';
const TRACKING_INDEX_NAME = 'manuscript_tracking';
const BATCH_SIZE = 20;
const EMBEDDING_DIMENSIONS = 768;

// --------------------------------
// CLIENTS INITIALIZATION
// --------------------------------

// Initialize Elasticsearch client
console.log(`Connecting to Elasticsearch at: ${ES_HOST}`);
const esClient = new Client({
  node: ES_HOST,
  auth: {
    username: ES_USERNAME,
    password: ES_PASSWORD
  },
  // Longer timeout for index creation
  requestTimeout: 60000
});

// Initialize Google Cloud Storage
const storage = new Storage();

// --------------------------------
// INDEX CONFIGURATION
// --------------------------------

// Index settings and mappings
const INDEX_CONFIG = {
  settings: {
    analysis: {
      analyzer: {
        manuscript_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'asciifolding',
            'manuscript_synonyms',
            'manuscript_stemmer'
          ]
        }
      },
      filter: {
        manuscript_synonyms: {
          type: 'synonym',
          synonyms: [
            "letter, epistle, correspondence",
            "history, chronicle, account",
            "illumination, decoration, illustration",
            "pope, papal, pontiff, holy see"
          ]
        },
        manuscript_stemmer: {
          type: "stemmer",
          language: "english"
        }
      }
    },
    refresh_interval: '30s'
  },
  mappings: {
    properties: {
      // Core identifiers
      id: { type: 'keyword' },
      shelfmark: { type: 'keyword' },
      
      // Titles with intelligent handling
      title: { 
        type: 'text', 
        analyzer: 'manuscript_analyzer',
        fields: {
          keyword: { type: 'keyword' }
        }
      },
      alternative_titles: { type: 'text', analyzer: 'manuscript_analyzer' },
      all_titles: { type: 'text', analyzer: 'manuscript_analyzer' },
      
      // Authors
      authors: { 
        type: 'text',
        analyzer: 'manuscript_analyzer',
        fields: {
          keyword: { type: 'keyword' }
        }
      },
      
      // Repository and provenance
      repository: { 
        type: 'text',
        fields: { keyword: { type: 'keyword' } }
      },
      provenance: { type: 'text' },
      
      // Time period
      date_range: { type: 'integer_range' },
      century: { type: 'keyword' },
      
      // Language and location
      languages: { type: 'keyword' },
      origin_location: { 
        type: 'text',
        fields: { keyword: { type: 'keyword' } }
      },
      coordinates: { type: 'geo_point' },
      
      // Content fields
      contents_summary: { 
        type: 'text', 
        analyzer: 'manuscript_analyzer'
      },
      historical_context: { 
        type: 'text', 
        analyzer: 'manuscript_analyzer' 
      },
      
      // Physical description
      physical_description: {
        properties: {
          material: { type: 'keyword' },
          dimensions: { type: 'text' },
          condition: { type: 'text' },
          layout: {
            properties: {
              columns_per_page: { type: 'integer' },
              lines_per_page: { type: 'text' },
              ruling_pattern: { type: 'text' }
            }
          },
          script_type: { type: 'keyword' },
          decoration: {
            properties: {
              illuminations: { type: 'text' },
              artistic_style: { type: 'text' }
            }
          }
        }
      },
      
      // Categorization and filtering
      themes: { type: 'keyword' },
      scribes: { type: 'keyword' },
      
      // Computed fields
      material_type: { type: 'keyword' },
      has_illuminations: { type: 'boolean' },
      
      // Indexing metadata
      _indexing_metadata: {
        properties: {
          last_indexed: { type: 'date' },
          checksum: { type: 'keyword' },
          version: { type: 'integer' }
        }
      }
    }
  }
};

// Tracking index config
const TRACKING_INDEX_CONFIG = {
  mappings: {
    properties: {
      file_path: { type: 'keyword' },
      last_indexed: { type: 'date' },
      checksum: { type: 'keyword' },
      last_modified: { type: 'date' },
      size: { type: 'long' }
    }
  }
};

// --------------------------------
// HELPER FUNCTIONS
// --------------------------------

/**
 * Generates a checksum for file content
 */
function generateChecksum(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Generate vector embeddings for text
 */
async function generateEmbedding(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }
  
  // Always use dummy embeddings since ELSER model may not be available
  // In a production environment, you would want to install the ELSER model
  // or use an external embedding service
  return new Array(EMBEDDING_DIMENSIONS).fill(0);
}

/**
 * Process manuscript metadata with intelligent handling
 */
async function processManuscriptMetadata(id, metadata, checksum) {
  console.log(`Processing metadata for manuscript: ${id}`);
  
  // Create processed document
  const processedDoc = {
    ...metadata,
    id: id,
    
    // Combine titles for unified search
    all_titles: [metadata.title].concat(metadata.alternative_titles || []),
    
    // Format date_range properly for integer_range type
    date_range: metadata.date_range ? {
      gte: metadata.date_range[0],
      lte: metadata.date_range[1] || metadata.date_range[0]
    } : undefined,
    
    // Add century field
    century: metadata.date_range ? 
      `${Math.floor(metadata.date_range[0] / 100) + 1}th Century` : 
      'Unknown',
    
    // Extract material type
    material_type: metadata.physical_description?.material || 'unknown',
    
    // Add boolean flag for illuminations
    has_illuminations: Boolean(
      metadata.physical_description?.decoration?.illuminations
    ),
    
    // Add indexing metadata
    _indexing_metadata: {
      last_indexed: new Date().toISOString(),
      checksum: checksum,
      version: 1
    }
  };
  
  // Handle coordinates
  if (Array.isArray(metadata.coordinates) && metadata.coordinates.length >= 2) {
    processedDoc.coordinates = {
      lat: metadata.coordinates[0],
      lon: metadata.coordinates[1]
    };
  }
  
  return processedDoc;
}

/**
 * Check if a file needs reindexing
 */
async function needsIndexing(file, trackingData) {
  // Always return true if force flag is set
  if (FORCE_REINDEX) {
    return true;
  }
  
  if (!trackingData) {
    return true;
  }
  
  // Get file metadata
  const [metadata] = await file.getMetadata();
  
  // Check if file has been modified
  if (new Date(metadata.updated) > new Date(trackingData.last_modified)) {
    return true;
  }
  
  // Check if file size has changed
  if (parseInt(metadata.size) !== trackingData.size) {
    return true;
  }
  
  return false;
}

/**
 * Bulk index documents
 */
async function bulkIndex(operations) {
  try {
    const bulkResponse = await esClient.bulk({ 
      body: operations,
      refresh: true
    });
    
    // Handle errors in response
    let hasErrors = false;
    
    if (bulkResponse.errors) {
      hasErrors = true;
      handleBulkErrors(bulkResponse.items, operations);
    }
    
    return !hasErrors;
  } catch (error) {
    console.error(`Bulk indexing error: ${error.message}`);
    return false;
  }
}

/**
 * Handle bulk indexing errors
 */
function handleBulkErrors(items, operations) {
  const erroredDocuments = [];
  
  items.forEach((action, i) => {
    const operation = Object.keys(action)[0];
    if (action[operation].error) {
      erroredDocuments.push({
        status: action[operation].status,
        error: action[operation].error,
        operation: operations[i*2],
        document_id: operations[i*2]._id
      });
    }
  });
  
  console.error(`Bulk indexing errors:`, erroredDocuments);
}

/**
 * Update tracking information
 */
async function updateTracking(filePath, metadata, checksum) {
  try {
    await esClient.index({
      index: TRACKING_INDEX_NAME,
      id: filePath,
      body: {
        file_path: filePath,
        last_indexed: new Date().toISOString(),
        checksum: checksum,
        last_modified: metadata.updated,
        size: parseInt(metadata.size)
      }
    });
  } catch (error) {
    console.error(`Error updating tracking for ${filePath}: ${error.message}`);
  }
}

/**
 * Get tracking data for a file
 */
async function getTrackingData(filePath) {
  try {
    const response = await esClient.get({
      index: TRACKING_INDEX_NAME,
      id: filePath
    });
    
    return response._source;
  } catch (error) {
    // Ignore 404 errors (index not found)
    if (error.meta?.statusCode !== 404 && error.statusCode !== 404) {
      console.warn(`Error fetching tracking data: ${error.message}`);
    }
    return null;
  }
}

/**
 * Ensure all required indexes exist
 */
async function ensureIndexes() {
  console.log('Checking if required indexes exist...');
  
  try {
    // Check main index
    const mainIndexExists = await esClient.indices.exists({ 
      index: INDEX_NAME 
    });
    
    if (!mainIndexExists) {
      console.log(`Creating index: ${INDEX_NAME}`);
      await esClient.indices.create({
        index: INDEX_NAME,
        body: INDEX_CONFIG
      });
      console.log(`Index ${INDEX_NAME} created successfully`);
    } else {
      console.log(`Index ${INDEX_NAME} already exists`);
    }
    
    // Check tracking index
    const trackingIndexExists = await esClient.indices.exists({ 
      index: TRACKING_INDEX_NAME 
    });
    
    if (!trackingIndexExists) {
      console.log(`Creating tracking index: ${TRACKING_INDEX_NAME}`);
      await esClient.indices.create({
        index: TRACKING_INDEX_NAME,
        body: TRACKING_INDEX_CONFIG
      });
      console.log(`Index ${TRACKING_INDEX_NAME} created successfully`);
    } else {
      console.log(`Index ${TRACKING_INDEX_NAME} already exists`);
    }
    
    return true;
  } catch (error) {
    console.error(`Error ensuring indexes: ${error.message}`);
    throw error;
  }
}

/**
 * Quick test for Elasticsearch connection
 */
async function quickConnectionTest() {
  try {
    console.log(`Testing connection to Elasticsearch at ${ES_HOST}...`);
    const info = await esClient.info();
    
    // Extract info from response
    const version = info.version?.number || 'unknown';
    const clusterName = info.cluster_name || 'unknown';
    
    console.log(`✅ Connected to Elasticsearch successfully!`);
    console.log(`Cluster: ${clusterName}, Version: ${version}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Elasticsearch connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Set up the ELSER model for semantic search
 */
async function setupElserModel() {
  try {
    console.log("Checking if ELSER model is already deployed...");
    try {
      const modelsResponse = await esClient.ml.getTrainedModels({ model_id: ".elser_model_1" });
      
      if (modelsResponse.trained_model_configs && modelsResponse.trained_model_configs.length > 0) {
        const model = modelsResponse.trained_model_configs[0];
        
        if (model.model_type === "elser") {
          // Check if model is already deployed
          if (model.deployment_stats && model.deployment_stats.state === "started") {
            console.log("ELSER model is already deployed and ready for use");
            return true;
          }
          
          // Deploy the model
          console.log("ELSER model exists but needs to be deployed. Deploying now...");
          await esClient.ml.startTrainedModelDeployment({ model_id: ".elser_model_1" });
          console.log("ELSER model deployment started");
          return true;
        }
      }
    } catch (err) {
      console.log("ELSER model not found. This is normal if you haven't installed it.");
      console.log("Will use standard search without semantic capabilities.");
    }
    
    // Always succeed even if model isn't found - just don't use semantic search
    return false;
  } catch (error) {
    console.warn(`Error setting up ELSER model: ${error.message}`);
    console.log("Will use standard search without semantic capabilities.");
    return false;
  }
}

// --------------------------------
// MAIN INDEXING FUNCTION
// --------------------------------

/**
 * Main indexing function
 */
async function indexManuscripts() {
  console.log('Starting manuscript indexing process...');
  
  try {
    // Validate bucket name
    if (!GCS_BUCKET_NAME) {
      throw new Error('GCS_BUCKET_NAME is not set. Please configure it in .env or environment variables.');
    }
    
    // Quick connection test
    const connected = await quickConnectionTest();
    if (!connected) {
      throw new Error(`Could not connect to Elasticsearch at ${ES_HOST}`);
    }
    
    // Create indexes if they don't exist
    await ensureIndexes();
    
    // Set up the ELSER model for semantic search
    await setupElserModel();
    
    // Validate bucket exists
    try {
      const [exists] = await storage.bucket(GCS_BUCKET_NAME).exists();
      if (!exists) {
        throw new Error(`Bucket '${GCS_BUCKET_NAME}' does not exist`);
      }
      console.log(`Using GCS bucket: ${GCS_BUCKET_NAME}`);
    } catch (error) {
      throw new Error(`Error accessing GCS bucket '${GCS_BUCKET_NAME}': ${error.message}`);
    }
    
    console.log('Looking for manuscript directories...');
    
    // Path to manuscripts in your bucket (adjust if needed)
    const cataloguePath = 'catalogue/';
    
    // List files from Google Cloud Storage
    const [files] = await storage.bucket(GCS_BUCKET_NAME).getFiles({
      prefix: cataloguePath
    });

    // Extract unique manuscript IDs
    const manuscriptSet = new Set();
    files.forEach(file => {
      const pathParts = file.name.split('/');
      if (pathParts.length > 1) {
        manuscriptSet.add(pathParts[1]);
      }
    });
    
    const manuscripts = Array.from(manuscriptSet);
    console.log(`Found ${manuscripts.length} manuscript directories`);

    // Get metadata files
    const metadataFiles = [];
    for (const manuscriptId of manuscripts) {
      const metadataPath = `${cataloguePath}${manuscriptId}/standard_metadata.json`;
      
      try {
        const [metadataExists] = await storage.bucket(GCS_BUCKET_NAME).file(metadataPath).exists();
        if (metadataExists) {
          metadataFiles.push({
            name: metadataPath,
            manuscriptId: manuscriptId
          });
        }
      } catch (error) {
        console.warn(`Error checking metadata file for ${manuscriptId}: ${error.message}`);
      }
    }
    
    console.log(`Found ${metadataFiles.length} manuscript metadata files`);
    
    // Process files in batches
    let batch = [];
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const fileInfo of metadataFiles) {
      const { name: filePath, manuscriptId } = fileInfo;
      
      try {
        // Get file object
        const file = storage.bucket(GCS_BUCKET_NAME).file(filePath);
        
        // Check if file needs indexing
        const trackingData = await getTrackingData(filePath);
        if (!trackingData) {
          console.log(`New file: ${filePath}`);
        }
        
        const shouldIndex = await needsIndexing(file, trackingData);
        if (!shouldIndex) {
          console.log(`Skipping unchanged file: ${filePath}`);
          skippedCount++;
          continue;
        }
        
        // Get file metadata
        const [metadata] = await file.getMetadata();
        
        // Create temp file path
        const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));
        
        // Download file
        await pipeline(
          file.createReadStream(),
          fs.createWriteStream(tempFilePath)
        );
        
        // Read content and calculate checksum
        const fileContent = fs.readFileSync(tempFilePath);
        const checksum = generateChecksum(fileContent);
        
        // Parse metadata
        let manuscriptData;
        try {
          manuscriptData = JSON.parse(fileContent.toString('utf8'));
        } catch (parseError) {
          console.error(`Error parsing JSON from ${filePath}:`, parseError);
          errorCount++;
          continue;
        }
        
        // Process metadata
        const processedDoc = await processManuscriptMetadata(
          manuscriptId, 
          manuscriptData,
          checksum
        );
        
        // Add to batch
        batch.push({
          index: { _index: INDEX_NAME, _id: manuscriptId }
        });
        batch.push(processedDoc);
        
        // Update tracking information
        await updateTracking(filePath, metadata, checksum);
        
        // Clean up temp file
        fs.unlinkSync(tempFilePath);
        
        // If batch is full, index it
        if (batch.length >= BATCH_SIZE * 2) {
          const success = await bulkIndex(batch);
          if (success) {
            processedCount += batch.length / 2;
            console.log(`Indexed ${processedCount} manuscripts...`);
          } else {
            errorCount += batch.length / 2;
            console.error(`Failed to index batch of ${batch.length / 2} manuscripts`);
          }
          batch = [];
        }
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        errorCount++;
      }
    }
    
    // Index any remaining documents
    if (batch.length > 0) {
      const success = await bulkIndex(batch);
      if (success) {
        processedCount += batch.length / 2;
      } else {
        errorCount += batch.length / 2;
      }
    }
    
    console.log(`
Indexing complete:
- Manuscripts indexed: ${processedCount}
- Manuscripts skipped: ${skippedCount}
- Errors encountered: ${errorCount}
    `);
    
    // Refresh index to make documents searchable
    await esClient.indices.refresh({ index: INDEX_NAME });
    console.log(`Index refreshed. Documents are now searchable.`);
    
    // Create an ingest pipeline for future indexing
    try {
      console.log("Creating text expansion pipeline for semantic search...");
      await esClient.ingest.putPipeline({
        id: "manuscript-semantic-pipeline",
        body: {
          description: "Pipeline for semantic search of manuscripts",
          processors: [
            {
              inference: {
                model_id: ".elser_model_1",
                target_field: "title.tokens",
                field_map: {
                  title: "text_field"
                },
                inference_config: {
                  text_expansion: {
                    results_field: "tokens"
                  }
                }
              }
            },
            {
              inference: {
                model_id: ".elser_model_1",
                target_field: "contents_summary.tokens",
                field_map: {
                  contents_summary: "text_field"
                },
                inference_config: {
                  text_expansion: {
                    results_field: "tokens"
                  }
                }
              }
            }
          ]
        }
      });
      console.log("Semantic search pipeline created successfully");
    } catch (error) {
      console.warn(`Could not create semantic search pipeline: ${error.message}`);
    }
    
    return processedCount;
  } catch (error) {
    console.error('Indexing failed:', error);
    throw error;
  }
}

// --------------------------------
// SEARCH FUNCTIONS
// --------------------------------

/**
 * Search manuscripts using keyword search
 */
async function searchManuscripts(query, options = {}) {
  try {
    const { size = 10 } = options;
    
    // Build the query
    const searchBody = {
      size,
      query: {
        bool: {
          should: [
            // Traditional text query
            {
              multi_match: {
                query,
                fields: ["title^2", "contents_summary", "historical_context", "all_titles"],
                fuzziness: "AUTO"
              }
            }
          ]
        }
      },
      highlight: {
        fields: {
          title: {},
          contents_summary: {}
        }
      }
    };
    
    // Execute the search
    const response = await esClient.search({
      index: INDEX_NAME,
      body: searchBody
    });
    
    return response;
  } catch (error) {
    console.error(`Search error: ${error.message}`);
    throw error;
  }
}

// --------------------------------
// RUN THE SCRIPT
// --------------------------------

if (require.main === module) {
  // Run indexer directly
  indexManuscripts()
    .then((count) => {
      console.log(`Indexing job completed successfully. Indexed ${count} manuscripts.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Indexing job failed:', error);
      process.exit(1);
    });
}

// Export functions for use in other modules
module.exports = {
  indexManuscripts,
  searchManuscripts,
  processManuscriptMetadata,
  generateEmbedding,
  quickConnectionTest
};