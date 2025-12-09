/**
 * IPFS Utilities
 * 
 * Utilities for fetching metadata from IPFS, including original filenames
 * from UnixFS directory structures.
 */

const IPFS_GATEWAYS = [
    'https://ipfs.io/ipfs',
    'https://dweb.link/ipfs',
    'https://w3s.link/ipfs',
];

const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 2;

/**
 * Fetch filename from IPFS by reading the UnixFS directory structure
 * 
 * When Storacha uploads files, they are wrapped in a UnixFS directory
 * with the original filename preserved in the Links metadata.
 * 
 * @param {string} cid - The content identifier
 * @param {object} options - Optional configuration
 * @param {string[]} options.gateways - Custom gateway list
 * @param {number} options.timeout - Fetch timeout in ms
 * @returns {Promise<{filename: string|null, contentType: string|null}>}
 */
export async function getFilenameFromIPFS(cid, options = {}) {
    const gateways = options.gateways || IPFS_GATEWAYS;
    const timeout = options.timeout || FETCH_TIMEOUT;
    
    console.log(`[IPFS] Fetching filename for CID: ${cid.substring(0, 20)}...`);
    
    for (const gateway of gateways) {
        try {
            const url = `${gateway}/${cid}?format=dag-json`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.log(`[IPFS] Gateway ${gateway} returned ${response.status}`);
                continue;
            }
            
            const data = await response.json();
            
            // Extract filename from UnixFS directory Links
            if (data.Links && Array.isArray(data.Links) && data.Links.length > 0) {
                const firstLink = data.Links[0];
                if (firstLink.Name) {
                    const filename = firstLink.Name;
                    console.log(`[IPFS] ✅ Found filename: "${filename}" via ${gateway}`);
                    
                    // Try to infer content type from extension
                    const contentType = inferContentType(filename);
                    
                    return { 
                        filename, 
                        contentType,
                        gateway
                    };
                }
            }
            
            console.log(`[IPFS] No filename found in Links for ${cid}`);
            return { filename: null, contentType: null, gateway };
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`[IPFS] Gateway ${gateway} timed out after ${timeout}ms`);
            } else {
                console.log(`[IPFS] Gateway ${gateway} error: ${error.message}`);
            }
            // Continue to next gateway
        }
    }
    
    console.log(`[IPFS] ❌ Failed to fetch filename from all gateways for ${cid}`);
    return { filename: null, contentType: null, gateway: null };
}

/**
 * Fetch filenames for multiple CIDs in parallel
 * 
 * @param {string[]} cids - Array of content identifiers
 * @param {object} options - Optional configuration
 * @returns {Promise<Map<string, {filename: string|null, contentType: string|null}>>}
 */
export async function getFilenamesFromIPFS(cids, options = {}) {
    console.log(`[IPFS] Fetching filenames for ${cids.length} CIDs...`);
    
    const results = await Promise.all(
        cids.map(cid => 
            getFilenameFromIPFS(cid, options)
                .then(result => ({ cid, ...result }))
                .catch(error => {
                    console.error(`[IPFS] Error fetching ${cid}:`, error);
                    return { cid, filename: null, contentType: null };
                })
        )
    );
    
    // Convert to Map for easy lookup
    const map = new Map();
    for (const result of results) {
        map.set(result.cid, {
            filename: result.filename,
            contentType: result.contentType
        });
    }
    
    const successCount = results.filter(r => r.filename).length;
    console.log(`[IPFS] ✅ Successfully fetched ${successCount}/${cids.length} filenames`);
    
    return map;
}

/**
 * Infer content type from filename extension
 * 
 * @param {string} filename - The filename
 * @returns {string|null} - MIME type or null
 */
function inferContentType(filename) {
    if (!filename) return null;
    
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const mimeTypes = {
        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',
        
        // Video
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',
        
        // Audio
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'flac': 'audio/flac',
        
        // Documents
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        
        // Text
        'txt': 'text/plain',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'text/javascript',
        'json': 'application/json',
        'xml': 'application/xml',
        'csv': 'text/csv',
        'md': 'text/markdown',
        
        // Archives
        'zip': 'application/zip',
        'tar': 'application/x-tar',
        'gz': 'application/gzip',
        '7z': 'application/x-7z-compressed',
        'rar': 'application/vnd.rar',
    };
    
    return mimeTypes[ext] || null;
}

/**
 * Check if IPFS content is accessible via any gateway
 * 
 * @param {string} cid - The content identifier
 * @param {object} options - Optional configuration
 * @returns {Promise<boolean>}
 */
export async function checkIPFSAccessibility(cid, options = {}) {
    const gateways = options.gateways || IPFS_GATEWAYS;
    const timeout = options.timeout || FETCH_TIMEOUT;
    
    for (const gateway of gateways) {
        try {
            const url = `${gateway}/${cid}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return true;
            }
        } catch (error) {
            // Continue to next gateway
        }
    }
    
    return false;
}



