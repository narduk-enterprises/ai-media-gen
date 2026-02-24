import fs from 'fs';
import { execSync } from 'child_process';

const smallFilesData = JSON.parse(fs.readFileSync('small-files.json', 'utf8'));
const smallFiles = new Map(smallFilesData.map(f => [f.key, f.size]));

// Fetch all completed media items from remote D1
console.log("Fetching all completed media items from D1...");
const d1Output = execSync(`npx wrangler d1 execute ai-media-gen-db --remote --json --command "SELECT id, generation_id, type, metadata, url FROM media_items WHERE status = 'complete' AND url IS NOT NULL"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

// Wrangler output sometimes has logs before the JSON array. Parse carefully.
const jsonStart = d1Output.indexOf('[');
const parsedD1 = JSON.parse(d1Output.slice(jsonStart));

const mediaItems = parsedD1[0].results;

const failedMedia = [];
for (const m of mediaItems) {
    let key = m.id;
    if (m.metadata) {
        try {
            const meta = JSON.parse(m.metadata);
            if (meta.originalR2Key) key = meta.originalR2Key;
        } catch(e){}
    }
    
    if (smallFiles.has(key)) {
        failedMedia.push({
            id: m.id,
            generation_id: m.generation_id,
            type: m.type,
            key: key,
            size: smallFiles.get(key)
        });
    }
}

fs.writeFileSync('failed_media.json', JSON.stringify(failedMedia, null, 2));
console.log(`Found ${failedMedia.length} small failed media files out of ${mediaItems.length} checked.`);
