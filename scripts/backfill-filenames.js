#!/usr/bin/env node

/**
 * Backfill Script: Fetch Filenames from IPFS
 * 
 * This script fetches filenames from IPFS for all uploads that don't
 * have filenames in the database yet. It's especially useful for:
 * - Bridge uploads (which bypass our server)
 * - Historical uploads from before filename tracking was added
 * 
 * Usage:
 *   node scripts/backfill-filenames.js [--space-did <did>] [--dry-run] [--limit <num>]
 * 
 * Options:
 *   --space-did <did>  Only process uploads for a specific space
 *   --dry-run          Don't write to database, just show what would happen
 *   --limit <num>      Maximum number of uploads to process (default: all)
 *   --batch-size <num> Number of CIDs to process in parallel (default: 5)
 */

import { getAdminClient } from '../src/lib/adminClientManager.js';
import { getAdminSpaces } from '../src/lib/store.js';
import { setupDatabase, getDatabase } from '../src/lib/db.js';
import { getFilenameFromIPFS } from '../src/lib/ipfs.js';

// Parse command line arguments
const args = process.argv.slice(2);
let targetSpaceDid = null;
let dryRun = false;
let limit = null;
let batchSize = 5;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--space-did' && args[i + 1]) {
        targetSpaceDid = args[++i];
    } else if (args[i] === '--dry-run') {
        dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
        limit = parseInt(args[++i]);
    } else if (args[i] === '--batch-size' && args[i + 1]) {
        batchSize = parseInt(args[++i]);
    } else if (args[i] === '--help') {
        console.log(`
Usage: node scripts/backfill-filenames.js [options]

Options:
  --space-did <did>     Only process uploads for a specific space
  --dry-run             Don't write to database, just show what would happen
  --limit <num>         Maximum number of uploads to process (default: all)
  --batch-size <num>    Number of CIDs to process in parallel (default: 5)
  --help                Show this help message
        `);
        process.exit(0);
    }
}

// Initialize
console.log('🔧 Initializing database...');
await setupDatabase();
console.log('✅ Database initialized');


console.log('🚀 Filename Backfill Script');
console.log('='.repeat(60));
if (dryRun) console.log('⚠️  DRY RUN MODE - No changes will be written');
if (limit) console.log(`📊 Processing limit: ${limit} uploads`);
if (targetSpaceDid) console.log(`🎯 Target space: ${targetSpaceDid.substring(0, 30)}...`);
console.log(`📦 Batch size: ${batchSize} parallel requests`);
console.log('='.repeat(60));

// Get all admin spaces
const adminEmail = process.env.ADMIN_EMAIL || 'vincent@charlebois.info';

// Wait a moment for initialization to complete
await new Promise(resolve => setTimeout(resolve, 100));

const db = getDatabase();
const adminDidResult = db.prepare('SELECT did FROM did_email_mapping WHERE email = ?').get(adminEmail);
if (!adminDidResult) {
    console.error(`❌ No admin DID found for email: ${adminEmail}`);
    process.exit(1);
}
const adminDid = adminDidResult.did;
const spaces = getAdminSpaces(adminEmail);

console.log(`\n👤 Admin: ${adminEmail}`);
console.log(`📁 Spaces: ${spaces.length}`);

// Filter to target space if specified
const spacesToProcess = targetSpaceDid
    ? spaces.filter(s => s.did === targetSpaceDid)
    : spaces;

if (spacesToProcess.length === 0) {
    console.error(`❌ No spaces found to process`);
    process.exit(1);
}

console.log(`\n🔄 Processing ${spacesToProcess.length} space(s)...\n`);

let totalUploads = 0;
let totalProcessed = 0;
let totalSuccess = 0;
let totalFailed = 0;
let totalSkipped = 0;

for (const space of spacesToProcess) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Space: ${space.name || 'Unnamed'}`);
    console.log(`   DID: ${space.did.substring(0, 40)}...`);
    console.log(`${'='.repeat(60)}`);
    
    try {
        // Get admin client for this space
        const client = await getAdminClient(adminEmail, adminDid);
        await client.setCurrentSpace(space.did);
        
        // List all uploads in this space
        console.log('\n📄 Fetching uploads from Storacha...');
        const allUploads = [];
        let cursor = '';
        
        while (true) {
            const result = await client.capability.upload.list({
                cursor: cursor || '',
                size: 100
            });
            
            const uploads = result?.results || [];
            allUploads.push(...uploads);
            
            console.log(`   Retrieved ${uploads.length} uploads (total: ${allUploads.length})`);
            
            if (!result?.before || uploads.length === 0) break;
            cursor = result.before;
            
            if (limit && allUploads.length >= limit) {
                allUploads.splice(limit);
                break;
            }
        }
        
        totalUploads += allUploads.length;
        console.log(`\n✅ Found ${allUploads.length} uploads`);
        
        // Check which ones need filenames
        const uploadsNeedingFilenames = [];
        for (const upload of allUploads) {
            const cid = upload.root?.toString() || upload.cid?.toString();
            
            // Check if we already have metadata
            const existing = db.prepare(`
                SELECT filename FROM uploads_metadata 
                WHERE cid = ? AND spaceDid = ?
            `).get(cid, space.did);
            
            if (!existing || !existing.filename) {
                uploadsNeedingFilenames.push({ cid, upload });
            }
        }
        
        console.log(`📝 Need to fetch filenames for: ${uploadsNeedingFilenames.length} uploads`);
        
        if (uploadsNeedingFilenames.length === 0) {
            console.log('✅ All uploads already have filenames!');
            continue;
        }
        
        // Process in batches
        console.log(`\n🔄 Fetching filenames from IPFS (batch size: ${batchSize})...\n`);
        
        for (let i = 0; i < uploadsNeedingFilenames.length; i += batchSize) {
            const batch = uploadsNeedingFilenames.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(uploadsNeedingFilenames.length / batchSize);
            
            console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} items):`);
            
            const promises = batch.map(async ({ cid, upload }) => {
                try {
                    const ipfsData = await getFilenameFromIPFS(cid, { timeout: 10000 });
                    
                    if (ipfsData.filename) {
                        console.log(`   ✅ ${cid.substring(0, 20)}... → ${ipfsData.filename}`);
                        
                        if (!dryRun) {
                            db.prepare(`
                                INSERT OR REPLACE INTO uploads_metadata 
                                (cid, filename, contentType, uploadedBy, spaceDid, uploadedAt, size)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                cid,
                                ipfsData.filename,
                                ipfsData.contentType || null,
                                adminDid, // Best guess
                                space.did,
                                new Date(upload.insertedAt).getTime(),
                                upload.size || 0
                            );
                        }
                        
                        totalSuccess++;
                        return { success: true, cid, filename: ipfsData.filename };
                    } else {
                        console.log(`   ⚠️  ${cid.substring(0, 20)}... → No filename found`);
                        totalSkipped++;
                        return { success: false, cid, reason: 'no filename' };
                    }
                } catch (error) {
                    console.log(`   ❌ ${cid.substring(0, 20)}... → Error: ${error.message}`);
                    totalFailed++;
                    return { success: false, cid, error: error.message };
                }
            });
            
            await Promise.all(promises);
            totalProcessed += batch.length;
            
            // Small delay between batches to avoid overwhelming IPFS gateways
            if (i + batchSize < uploadsNeedingFilenames.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
    } catch (error) {
        console.error(`\n❌ Error processing space: ${error.message}`);
        console.error(error.stack);
    }
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log('📊 BACKFILL SUMMARY');
console.log('='.repeat(60));
console.log(`📁 Spaces processed: ${spacesToProcess.length}`);
console.log(`📄 Total uploads found: ${totalUploads}`);
console.log(`🔄 Uploads processed: ${totalProcessed}`);
console.log(`✅ Filenames fetched: ${totalSuccess}`);
console.log(`⚠️  Skipped (no filename): ${totalSkipped}`);
console.log(`❌ Failed: ${totalFailed}`);
console.log('='.repeat(60));

if (dryRun) {
    console.log('\n⚠️  DRY RUN COMPLETE - No changes were written to database');
} else {
    console.log('\n✅ BACKFILL COMPLETE - All filenames cached in database');
}

process.exit(0);

