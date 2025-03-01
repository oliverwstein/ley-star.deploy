// image-processor.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ImageProcessingOptions {
  losslessCompression?: boolean;  // Apply lossless compression to full.webp
  webQuality?: number;            // Quality for web.webp (0-100)
  thumbnailSize?: number;         // Size for thumbnail.webp (pixels)
  outputDir?: string;             // Directory to save output files (defaults to source file directory)
}

interface ProcessingResult {
  filePath: string;               // Path to the processed file
  originalSize: number;           // Original size in bytes
  newSize: number;                // New size in bytes
  dimensions: { width: number; height: number }; // Image dimensions
  compressionRate: number;        // Compression percentage
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Process a single WebP image, creating optimized versions:
 * - full.webp: Losslessly compressed version of the original
 * - web.webp: Lossy compressed version at original resolution
 * - thumbnail.webp: Resized smaller version
 * 
 * @param sourcePath Path to the input image file
 * @param options Processing options
 * @returns Object with results for each processed file
 */
export async function processImage(
  sourcePath: string, 
  options: ImageProcessingOptions = {}
): Promise<Record<string, ProcessingResult>> {
  const {
    losslessCompression = true,
    webQuality = 85,
    thumbnailSize = 300,
    outputDir = path.dirname(sourcePath)
  } = options;
  
  const results: Record<string, ProcessingResult> = {};
  
  try {
    // Check if source file exists
    await fs.access(sourcePath);
    
    // Get original file stats
    const originalStats = await fs.stat(sourcePath);
    const originalSize = originalStats.size;
    
    // Load the original image
    const imageBuffer = await fs.readFile(sourcePath);
    const metadata = await sharp(imageBuffer).metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error(`Could not determine dimensions of ${sourcePath}`);
    }
    
    const { width, height } = metadata;
    
    // Define output paths
    const fullWebpPath = path.join(outputDir, 'full.webp');
    const webPath = path.join(outputDir, 'web.webp');
    const thumbPath = path.join(outputDir, 'thumbnail.webp');
    
    // 1. Process full.webp with lossless compression if enabled
    if (losslessCompression) {
      const tempFullPath = path.join(outputDir, 'full.webp.tmp');
      
      await sharp(imageBuffer)
        .webp({ 
          lossless: true,
          effort: 6,  // Maximum compression effort (1-6)
          nearLossless: false
        })
        .toFile(tempFullPath);
      
      // Get new file size
      const newFullStats = await fs.stat(tempFullPath);
      const fullCompressedSize = newFullStats.size;
      
      // Only save if we achieved compression or if it's a different path than the source
      if (fullCompressedSize < originalSize || fullWebpPath !== sourcePath) {
        await fs.rename(tempFullPath, fullWebpPath);
        
        results['full.webp'] = {
          filePath: fullWebpPath,
          originalSize,
          newSize: fullCompressedSize,
          dimensions: { width, height },
          compressionRate: ((originalSize - fullCompressedSize) / originalSize) * 100
        };
      } else {
        // Delete the temp file if no compression benefit
        await fs.unlink(tempFullPath);
        
        results['full.webp'] = {
          filePath: sourcePath,  // Keep the original
          originalSize,
          newSize: originalSize,
          dimensions: { width, height },
          compressionRate: 0
        };
      }
    }
    
    // 2. Create web.webp with lossy compression but full resolution
    await sharp(imageBuffer)
      .webp({ 
        quality: webQuality,
        effort: 6  // Maximum compression effort
      })
      .toFile(webPath);
    
    const webStats = await fs.stat(webPath);
    results['web.webp'] = {
      filePath: webPath,
      originalSize,
      newSize: webStats.size,
      dimensions: { width, height },
      compressionRate: ((originalSize - webStats.size) / originalSize) * 100
    };
    
    // 3. Create thumbnail.webp (resized with aspect ratio preserved)
    // Calculate resize dimensions while preserving aspect ratio
    let thumbWidth, thumbHeight;
    
    if (width >= height) {
      thumbWidth = thumbnailSize;
      thumbHeight = Math.round((height / width) * thumbnailSize);
    } else {
      thumbWidth = Math.round((width / height) * thumbnailSize);
      thumbHeight = thumbnailSize;
    }
    
    await sharp(imageBuffer)
      .resize({
        width: thumbWidth,
        height: thumbHeight,
        fit: 'inside'
      })
      .webp({ 
        quality: 80,  // Lower quality for thumbnails is fine
        effort: 4     // Balance between speed and compression
      })
      .toFile(thumbPath);
    
    const thumbStats = await fs.stat(thumbPath);
    results['thumbnail.webp'] = {
      filePath: thumbPath,
      originalSize,
      newSize: thumbStats.size,
      dimensions: { width: thumbWidth, height: thumbHeight },
      compressionRate: ((originalSize - thumbStats.size) / originalSize) * 100
    };
    
    return results;
  } catch (error) {
    throw new Error(`Error processing image ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Format processing results into human-readable strings
 */
export function formatResults(results: Record<string, ProcessingResult>): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  for (const [key, result] of Object.entries(results)) {
    if (key === 'full.webp') {
      if (result.compressionRate > 0) {
        formatted[key] = `${formatBytes(result.originalSize)} → ${formatBytes(result.newSize)} (${Math.round(result.compressionRate)}% smaller)`;
      } else {
        formatted[key] = `${formatBytes(result.originalSize)} (no additional compression possible)`;
      }
    } else if (key === 'web.webp') {
      formatted[key] = `${formatBytes(result.newSize)} (${Math.round(result.compressionRate)}% smaller than original)`;
    } else if (key === 'thumbnail.webp') {
      formatted[key] = `${formatBytes(result.newSize)} (${result.dimensions.width}x${result.dimensions.height})`;
    }
  }
  
  return formatted;
}

// If run directly, process the image specified as argument
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Please provide an image path');
    process.exit(1);
  }
  
  const sourcePath = args[0];
  let outputDir = path.dirname(sourcePath);
  let webQuality = 85;
  let thumbnailSize = 300;
  
  // Parse command line arguments
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[i + 1];
      i++;
    } else if (args[i] === '--quality' || args[i] === '-q') {
      webQuality = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--size' || args[i] === '-s') {
      thumbnailSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx ts-node image-processor.ts <source-image> [options]

Options:
  --output, -o <dir>    Output directory (default: same as source)
  --quality, -q <num>   Web quality (0-100, default: 85)
  --size, -s <pixels>   Thumbnail size (pixels, default: 300)
  --help, -h            Show this help message
      `);
      process.exit(0);
    }
  }
  
  processImage(sourcePath, { 
    losslessCompression: true,
    webQuality,
    thumbnailSize,
    outputDir
  })
    .then(results => {
      console.log('Processing results:');
      for (const [file, result] of Object.entries(formatResults(results))) {
        console.log(`${file}: ${result}`);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}