// scripts/upload-manuscript.ts
import { Storage } from '@google-cloud/storage';
import * as dotenv from 'dotenv';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import * as fs from 'fs/promises';
import * as path from 'path';
import { formatResults, processImage } from './image-processor.ts';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config();

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

interface UploadProgress {
  completed_manuscripts: string[];
  completed_files: Record<string, string[]>;  // manuscriptId -> completed files
  last_updated: string;
}

interface UploadOptions {
  sourcePath: string;
  manuscriptId: string;
  force?: boolean;  // Force re-upload even if marked as completed
  processImages?: boolean; // Process images before uploading
  webQuality?: number; // Quality for web.webp (0-100)
  thumbnailSize?: number; // Size for thumbnail in pixels
}

// File types to handle
const ALWAYS_UPLOAD = ['transcript.json', 'segmentation.json'];
const UPLOAD_IF_MISSING = ['full.webp', 'web.webp', 'thumbnail.webp'];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadProgress(): Promise<UploadProgress> {
  try {
    const content = await fs.readFile('upload_progress.json', 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      completed_manuscripts: [],
      completed_files: {},
      last_updated: new Date().toISOString()
    };
  }
}

async function saveProgress(progress: UploadProgress) {
  progress.last_updated = new Date().toISOString();
  await fs.writeFile('upload_progress.json', JSON.stringify(progress, null, 2));
}

async function uploadFileWithRetry(
  localPath: string, 
  bucketPath: string, 
  retryCount = 0
): Promise<boolean> {
  try {
    const bucket = storage.bucket(bucketName!);
    await bucket.upload(localPath, {
      destination: bucketPath,
      contentType: getContentType(localPath)
    });
    return true;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`\nRetrying upload of ${path.basename(localPath)} (attempt ${retryCount + 1})`);
      await sleep(RETRY_DELAY * (retryCount + 1));  // Exponential backoff
      return uploadFileWithRetry(localPath, bucketPath, retryCount + 1);
    }
    console.error(`\nFailed to upload ${localPath} after ${MAX_RETRIES} attempts:`, error);
    return false;
  }
}

function getContentType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

async function checkFileExists(bucket: any, filePath: string): Promise<boolean> {
  try {
    const [exists] = await bucket.file(filePath).exists();
    return exists;
  } catch (error) {
    console.error(`Error checking if file exists: ${filePath}`, error);
    return false;
  }
}

async function uploadManuscript(options: UploadOptions): Promise<boolean> {
  const { 
    sourcePath, 
    manuscriptId, 
    force = false, 
    processImages = false,
    webQuality = 85,
    thumbnailSize = 300
  } = options;
  
  const manuscriptPath = path.join(sourcePath, manuscriptId);
  
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME not set');
  }

  // Load progress from previous run if it exists
  const progress = await loadProgress();
  
  // Initialize progress tracking for this manuscript if needed
  if (!progress.completed_files) {
    progress.completed_files = {};
  }
  if (!progress.completed_files[manuscriptId]) {
    progress.completed_files[manuscriptId] = [];
  }

  // Verify manuscript directory exists
  try {
    await fs.access(manuscriptPath);
  } catch {
    console.error(`Manuscript directory not found: ${manuscriptPath}`);
    return false;
  }

  console.log(`Uploading manuscript: ${manuscriptId}`);
  if (processImages) {
    console.log(`Processing images with webQuality=${webQuality}, thumbnailSize=${thumbnailSize}`);
  }
  
  const bucket = storage.bucket(bucketName);
  
  // Upload standard_metadata.json if it exists
  const metadataPath = path.join(manuscriptPath, 'standard_metadata.json');
  try {
    await fs.access(metadataPath);
    const metadataBucketPath = `catalogue/${manuscriptId}/standard_metadata.json`;
    
    // Skip if already uploaded unless force flag is set
    if (force || !progress.completed_files[manuscriptId].includes(metadataBucketPath)) {
      console.log(`Uploading metadata file...`);
      const success = await uploadFileWithRetry(metadataPath, metadataBucketPath);
      if (success) {
        progress.completed_files[manuscriptId].push(metadataBucketPath);
        await saveProgress(progress);
      }
    } else {
      console.log(`Skipping metadata file (already uploaded)`);
    }
  } catch (error) {
    console.warn(`No standard_metadata.json found for ${manuscriptId}`);
  }
  
  // Process all pages in the manuscript
  const pagesDir = path.join(manuscriptPath, 'pages');
  try {
    await fs.access(pagesDir);
    
    const pageEntries = await fs.readdir(pagesDir, { withFileTypes: true });
    const pageDirs = pageEntries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
      
    console.log(`Found ${pageDirs.length} pages to process`);
    
    // Create a proper progress bar for tracking page uploads
    const pageBar = new cliProgress.SingleBar({
      format: `${colors.cyan('{bar}')} {percentage}% | {value}/{total} pages | Processing: {pageId}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    }, cliProgress.Presets.shades_classic);
    
    // Start the progress bar with total number of pages
    pageBar.start(pageDirs.length, 0, { pageId: 'Starting...' });
    
    let allSuccess = true;
    const failedPages: string[] = [];
    const imageSummary: Record<string, Record<string, string>> = {};
    
    // Process each page directory
    for (let i = 0; i < pageDirs.length; i++) {
      const pageId = pageDirs[i];
      const pagePath = path.join(pagesDir, pageId);
      
      // Update progress bar with current page ID
      pageBar.update(i, { pageId });
      
      // Initialize summary for this page
      imageSummary[pageId] = {};
      
      // Get all files in the page directory
      let pageFiles;
      try {
        pageFiles = await fs.readdir(pagePath);
      } catch (error) {
        console.error(`\nError reading page directory ${pageId}:`, error);
        allSuccess = false;
        failedPages.push(pageId);
        continue;
      }
      
      let pageSuccess = true;
      
      // Process images if needed
      if (processImages) {
        try {
          const inputImagePath = path.join(pagePath, 'full.webp');
          
          // Check if input image exists
          try {
            await fs.access(inputImagePath);
            
            // Process the image
            pageBar.update(i, { pageId: `${pageId} (processing images)` });
            const results = await processImage(inputImagePath, { 
              losslessCompression: true,
              webQuality,
              thumbnailSize,
              outputDir: pagePath // Save output files in the same page directory
            });
            
            // Store formatted results for summary
            imageSummary[pageId] = formatResults(results);
            
          } catch (error) {
            console.warn(`\nNo full.webp found for page ${pageId}, skipping image processing`);
          }
        } catch (error) {
          console.error(`\nError processing images for page ${pageId}:`, error);
          // Don't fail the page just because image processing failed
        }
        
        // Get updated file list after processing
        try {
          pageFiles = await fs.readdir(pagePath);
        } catch (error) {
          console.error(`\nError reading page directory ${pageId} after processing:`, error);
        }
      }
      
      // Process each file in the page
      for (const file of pageFiles) {
        // Skip files that are not in our lists
        if (!ALWAYS_UPLOAD.includes(file) && !UPLOAD_IF_MISSING.includes(file)) {
          continue;
        }
        
        const localFilePath = path.join(pagePath, file);
        const bucketFilePath = `catalogue/${manuscriptId}/pages/${pageId}/${file}`;
        
        // For UPLOAD_IF_MISSING files, check if they already exist in the bucket
        if (UPLOAD_IF_MISSING.includes(file)) {
          const fileExists = await checkFileExists(bucket, bucketFilePath);
          if (fileExists && !force) {
            // Skip this file as it already exists
            continue;
          }
        }
        
        // Skip if already uploaded and not forced unless it's an ALWAYS_UPLOAD file
        if (!force && !ALWAYS_UPLOAD.includes(file) && 
            progress.completed_files[manuscriptId].includes(bucketFilePath)) {
          continue;
        }
        
        // Update progress bar to show current file
        pageBar.update(i, { pageId: `${pageId} (uploading ${file})` });
        
        try {
          const success = await uploadFileWithRetry(localFilePath, bucketFilePath);
          if (success) {
            if (!progress.completed_files[manuscriptId].includes(bucketFilePath)) {
              progress.completed_files[manuscriptId].push(bucketFilePath);
            }
          } else {
            console.error(`\nFailed to upload ${file} for page ${pageId}`);
            pageSuccess = false;
          }
        } catch (error) {
          console.error(`\nError processing ${file} for page ${pageId}:`, error);
          pageSuccess = false;
        }
      }
      
      // If this page had any failures, record it
      if (!pageSuccess) {
        allSuccess = false;
        failedPages.push(pageId);
      }
      
      // Increment the progress bar
      pageBar.update(i + 1, { pageId: `Completed ${pageId}` });
      
      // Save progress after each page
      await saveProgress(progress);
    }
    
    // Stop the progress bar
    pageBar.stop();
    
    // Print image processing summary if we processed images
    if (processImages) {
      console.log('\nImage Processing Summary:');
      for (const [pageId, results] of Object.entries(imageSummary)) {
        if (Object.keys(results).length > 0) {
          console.log(`\nPage ${pageId}:`);
          for (const [file, result] of Object.entries(results)) {
            console.log(`  - ${file}: ${result}`);
          }
        }
      }
    }
    
    if (allSuccess) {
      console.log(`\nSuccessfully uploaded manuscript: ${manuscriptId}`);
      
      // If everything succeeded, mark manuscript as complete
      if (!progress.completed_manuscripts.includes(manuscriptId)) {
        progress.completed_manuscripts.push(manuscriptId);
        await saveProgress(progress);
      }
      
      return true;
    } else {
      console.log(`\nFailed to upload some pages for manuscript: ${manuscriptId}`);
      console.log(`Failed pages: ${failedPages.join(', ')}`);
      return false;
    }
    
  } catch (error) {
    console.error(`Failed to access pages directory for ${manuscriptId}:`, error);
    return false;
  }
}

// Parse command line arguments
function parseArgs(): UploadOptions {
  const args = process.argv.slice(2);
  const options: UploadOptions = {
    sourcePath: path.join(process.cwd(), 'data', 'catalogue'),
    manuscriptId: '',
    force: false,
    processImages: false,
    webQuality: 85,
    thumbnailSize: 300
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manuscript-id' || args[i] === '-m') {
      options.manuscriptId = args[i + 1];
      i++;
    } else if (args[i] === '--source' || args[i] === '-s') {
      options.sourcePath = args[i + 1];
      i++;
    } else if (args[i] === '--force' || args[i] === '-f') {
      options.force = true;
    } else if (args[i] === '--process-images' || args[i] === '-p') {
      options.processImages = true;
    } else if (args[i] === '--web-quality' || args[i] === '-q') {
      options.webQuality = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--thumbnail-size' || args[i] === '-t') {
      options.thumbnailSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx ts-node upload-manuscript.ts [options]

Options:
  --source, -s               Source directory path (default: ./data/catalogue)
  --manuscript-id, -m        Manuscript ID to upload (required)
  --force, -f                Force re-upload of already completed files
  --process-images, -p       Process images before uploading
  --web-quality, -q <num>    Quality for web.webp (0-100, default: 85)
  --thumbnail-size, -t <px>  Size for thumbnail images (pixels, default: 300)
  --help, -h                 Show this help message
      `);
      process.exit(0);
    } else {
      // If it's a manuscript ID provided without flag
      if (!args[i].startsWith('-') && !options.manuscriptId) {
        options.manuscriptId = args[i];
      }
    }
  }

  // Verify required parameters
  if (!options.manuscriptId) {
    console.error('Error: Manuscript ID is required');
    console.log('Use --help for usage information');
    process.exit(1);
  }

  return options;
}

// Main function
async function main() {
  try {
    const options = parseArgs();
    console.log(`Starting upload for manuscript: ${options.manuscriptId}`);
    console.log(`Source path: ${options.sourcePath}`);
    console.log(`Force upload: ${options.force ? 'Yes' : 'No'}`);
    console.log(`Process images: ${options.processImages ? 'Yes' : 'No'}`);
    
    const success = await uploadManuscript(options);
    
    if (success) {
      console.log(`Upload completed successfully for ${options.manuscriptId}`);
      process.exit(0);
    } else {
      console.error(`Upload failed for ${options.manuscriptId}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

// Export for use in other scripts
export { uploadManuscript };