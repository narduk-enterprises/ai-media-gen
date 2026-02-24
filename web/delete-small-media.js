import fs from 'fs';
import { execSync } from 'child_process';

const failedMedia = JSON.parse(fs.readFileSync('failed_media.json', 'utf8'));

console.log(`Deleting ${failedMedia.length} small files and database rows...`);

for (const m of failedMedia) {
    console.log(`Deleting ${m.id} (R2 key: ${m.key}, size: ${m.size}b)...`);
    try {
      execSync(`npx wrangler r2 object delete ai-media-gen-media/${m.key} --remote`);
      execSync(`npx wrangler d1 execute ai-media-gen-db --remote --command "DELETE FROM media_items WHERE id = '${m.id}'"`);
    } catch(e) {
      console.error(`Failed to delete ${m.id}:`, e.message);
    }
}

// Clean up orphaned generations
console.log("Cleaning up orphaned generations...");
try {
  execSync(`npx wrangler d1 execute ai-media-gen-db --remote --command "DELETE FROM generations WHERE id NOT IN (SELECT DISTINCT generation_id FROM media_items)"`);
} catch(e) {
  console.error("Failed to cleanup generations:", e.message);
}

console.log("Cleanup complete!");
