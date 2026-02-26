---
description: How to interact with RunPod APIs efficiently
---

# RunPod Management

When deploying, checking, or benchmarking RunPod servers (GPU compute pods), **DO NOT** use browser cookie spoofing via `XMLHttpRequest` to hit the frontend Nuxt API routes. This often fails due to strict Cloudflare WAF or proxy blocking.

Instead, interface with RunPod directly using the secure token seamlessly injected into your environment:

## Step 1: Getting the Authorization Keys

The RunPod API Key is always securely available natively in the terminal environment variables.

1. Use `os.environ.get("RUNPOD_API_KEY")` in Python scripts.
2. Use `process.env.RUNPOD_API_KEY` in Node scripts.

## Step 2: Hitting the RunPod GraphQL/REST Endpoints

Communicate directly with `https://api.runpod.io/graphql` to spawn instances.
Since you have the key, construct API queries directly without concerning yourself with CORS or Browser limits.

Example Node:

```javascript
const res = await fetch('https://api.runpod.io/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
  },
  body: JSON.stringify({ query: '{ myself { pods { id name desiredStatus } } }' }),
});
```

## Step 3: Benchmarking Generative Endpoints

When testing endpoints directly on a provisioned Pod (like `/generate/text2video`), bypass frontend architectures. Use `https://[POD_ID]-8188.proxy.runpod.net` with the appropriate endpoints natively. Ensure that tests requesting large VRAM generations (e.g. Wan2.2 121 frames) appropriately verify that your selected target pod has the required 80GB VRAM hardware or else PyTorch will throw an Allocation Error during the KSampler loop.

**Critical Note for 80GB GPU Pods vs 48GB GPU Pods:**
If the pod possesses 80GB+ VRAM, you **must execute the jobs twice sequentially** to measure accurate generation speeds. The **first** run absorbs the model loading/swapping penalty, and the **second** run performs bare-metal sampling speed exclusively—as 80GB+ architecture safely retains the 14B High-Noise and 14B Low-Noise weights simultaneously without flushing!
