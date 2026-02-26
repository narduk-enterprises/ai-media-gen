import * as fs from 'fs';

// 1. Grab URL of the target pod
const podUrl = 'https://n4sz812871f4jn-8188.proxy.runpod.net';

const baseJob = {
    prompt: "A beautiful cinematic shot of a futuristic city at sunset, neon lights reflecting in puddles, flying cars, 4k, masterpiece.",
    negative_prompt: "low quality, blurry, deformed, distorted",
    width: 512,
    height: 320,
    steps: 4, 
    model: 'wan22'
};

const fps = 24;
// Popular video lengths in seconds
const lengths = [1, 3, 5, 10, 15, 30];

async function checkHealth() {
  try {
     const res = await fetch(`${podUrl}/health`, { timeout: 10000 } as any);
     return await res.json();
  } catch (e) {
     return null;
  }
}

async function runTest(seconds: number) {
   const frames = seconds * fps + 1; // e.g. 5s = 121 frames
   console.log(`\n--- Submitting ${seconds}-Second Video (${frames} frames)... ---`);
   const startTime = Date.now();
   
   try {
     const res = await fetch(`${podUrl}/generate/text2video`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ...baseJob, frames, seed: Math.floor(Math.random() * 1000000) })
     });
     const jobInfo = await res.json();
     const jobId = jobInfo.job_id;
     console.log(`[${((Date.now() - startTime)/1000).toFixed(1)}s] Queued: ${jobId}`);
     
     while (true) {
        try {
           const sRes = await fetch(`${podUrl}/generate/status/${jobId}`);
           const sInfo = await sRes.json();
           const state = sInfo.status;
           const error = sInfo.error;
           
           const elapsed = (Date.now() - startTime) / 1000;
           console.log(`[${elapsed.toFixed(1)}s] Status: ${state}${error ? ` | Error: ${error}` : ''}`);
           
           if (state === 'completed') {
               console.log(`✅ Success! ${seconds}s video generated in ${elapsed.toFixed(1)} seconds.`);
               return elapsed;
           } else if (state === 'failed') {
               console.log(`❌ Failed! ${seconds}s video hit error after ${elapsed.toFixed(1)} seconds.`);
               console.log('Error Details:', error);
               return -1;
           }
        } catch (err) {
            console.log("Status fetch error", err);
        }
        await new Promise(r => setTimeout(r, 5000));
     }
   } catch (err) {
      console.log(`Failed to submit: ${err}`);
      return -1;
   }
}

async function main() {
   console.log(`Bypassing sync verify and connecting to ${podUrl}...`);
   
   const results: Record<string, string> = {};

   for (const sec of lengths) {
       const t = await runTest(sec);
       if (t > 0) {
           results[`${sec}s`] = `${t.toFixed(1)}s`;
       } else {
           results[`${sec}s`] = `FAILED`;
           console.log("Stopping further tests due to failure.");
           break;
       }
       // Brief pause between runs
       console.log("Resting 5 seconds before next length...");
       await new Promise(r => setTimeout(r, 5000));
   }
   
   console.log("\n=============================================");
   console.log(" FINAL BENCHMARK RESULTS (Wan2.2 on 80GB VRAM) ");
   console.log("=============================================");
   for (const [sec, time] of Object.entries(results)) {
       console.log(`${sec.padStart(4, ' ')} video : ${time}`);
   }
   console.log("=============================================\n");
}

main();
