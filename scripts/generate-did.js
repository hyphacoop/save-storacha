import { generatePrincipal, exportPrincipal } from '../src/lib/signer.js';
import fs from 'fs/promises';
import path from 'path';

async function generateTestDid(outputFile) {
    try {
        // Generate a new principal
        const principal = await generatePrincipal();
        const exportedArchive = await exportPrincipal(principal);
        const archive = JSON.parse(exportedArchive);
        const did = archive.id;

        // Create the DID file
        const didData = {
            did,
            archive
        };

        // Generate filename if none provided
        if (!outputFile) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            outputFile = `did-${timestamp}.json`;
        }

        // Save to file
        const outputPath = path.join(process.cwd(), outputFile);
        await fs.writeFile(outputPath, JSON.stringify(didData, null, 2));
        
        console.log('Generated DID:', did);
        console.log('Saved to:', outputPath);
    } catch (error) {
        console.error('Failed to generate DID:', error);
        process.exit(1);
    }
}

// Get filename from command line args or use timestamped name
const outputFile = process.argv[2];
generateTestDid(outputFile); 