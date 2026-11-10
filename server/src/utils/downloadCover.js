import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { coverSource } from './coverSource.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const MANAGER_DB_PATH = path.join(DATA_DIR, 'jewelbox_manager.db');

/**
 * Get the covers directory for the active database
 * @returns {string|null} - Path to covers directory or null if no active database
 */
function getActiveCoversDir() {
  try {
    const managerDb = new Database(MANAGER_DB_PATH);
    const activeDb = managerDb.prepare('SELECT * FROM databases WHERE is_active = 1 LIMIT 1').get();
    managerDb.close();
    
    if (!activeDb) {
      console.error('[DownloadCover] No active database found');
      return null;
    }
    
    const dbFolder = path.dirname(activeDb.path);
    const coversDir = path.join(dbFolder, 'covers');
    
    // Ensure covers directory exists
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }
    
    return coversDir;
  } catch (err) {
    console.error('[DownloadCover] Error getting covers directory:', err);
    return null;
  }
}

/**
 * Download an image from a URL and save it locally
 * @param {string} imageUrl - URL of the image to download
 * @returns {Promise<string|null>} - Local URL path or null if failed
 */
export async function downloadCover(imageUrl) {
  if (!imageUrl) return null;

  try {
    console.log(`[DownloadCover] Downloading: ${imageUrl}`);
    
    // Add headers for Discogs and other external sites
    const headers = {
      'User-Agent': 'JewelBox-Music-Library/1.0',
    };
    
    // Add Discogs authentication if this is a Discogs URL
    if (coverSource(imageUrl) === 'Discogs') {
      let dKey = '', dSecret = '';
      try {
        const mDb = new Database(MANAGER_DB_PATH);
        const kr = mDb.prepare("SELECT value FROM settings WHERE key = 'discogs_key'").get();
        const sr = mDb.prepare("SELECT value FROM settings WHERE key = 'discogs_secret'").get();
        mDb.close();
        dKey = (kr?.value?.trim()) || process.env.DISCOGS_KEY || '';
        dSecret = (sr?.value?.trim()) || process.env.DISCOGS_SECRET || '';
      } catch {
        dKey = process.env.DISCOGS_KEY || '';
        dSecret = process.env.DISCOGS_SECRET || '';
      }
      if (dKey && dSecret) {
        headers['Authorization'] = `Discogs key=${dKey}, secret=${dSecret}`;
        console.log(`[DownloadCover] Using Discogs authentication for image`);
      }
    }
    
    const response = await fetch(imageUrl, { headers });
    if (!response.ok) {
      console.error(`[DownloadCover] HTTP ${response.status} for ${imageUrl}`);
      return null;
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      console.error(`[DownloadCover] Not an image: ${contentType} for ${imageUrl}`);
      return null;
    }

    // Get the image buffer
    const buffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(buffer);

    // Generate a unique filename using hash
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
    
    // Better extension detection from content type
    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';
    else if (contentType.includes('gif')) ext = '.gif';
    else ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    
    const fileHash = `${hash}${ext}`;
    
    // Get active database covers directory
    const coversDir = getActiveCoversDir();
    if (!coversDir) {
      console.error('[DownloadCover] Cannot save cover - no active database');
      return null;
    }
    
    const filePath = path.join(coversDir, fileHash);

    // Save the file
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`[DownloadCover] Saved to: ${filePath}`);

    // Return the local URL path (served by /covers/:filename route)
    return `/covers/${fileHash}`;
  } catch (err) {
    console.error(`[DownloadCover] Failed to download ${imageUrl}:`, err.message);
    return null;
  }
}
