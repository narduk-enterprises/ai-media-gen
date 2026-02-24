#!/usr/bin/env python3
"""Check video sizes via GET range request (first byte) to identify stubs."""
import urllib.request, json, sys, concurrent.futures

BASE = "https://ai-media-gen.narduk.workers.dev/api/media"

def check(vid_id):
    try:
        req = urllib.request.Request(f"{BASE}/{vid_id}")
        req.add_header("Range", "bytes=0-0")
        resp = urllib.request.urlopen(req, timeout=10)
        cr = resp.headers.get("Content-Range", "")
        # Content-Range: bytes 0-0/12345678
        if "/" in cr:
            total = int(cr.split("/")[-1])
        else:
            # No range support, do full download size check
            data = resp.read()
            total = len(data)
        return (vid_id, total)
    except Exception as e:
        # Fall back to full GET
        try:
            resp = urllib.request.urlopen(f"{BASE}/{vid_id}", timeout=15)
            data = resp.read()
            return (vid_id, len(data))
        except:
            return (vid_id, -1)

ids = [line.strip() for line in sys.stdin if line.strip()]
print(f"Checking {len(ids)} videos...", file=sys.stderr)

stubs = []
good = []
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    results = list(pool.map(check, ids))
    for vid_id, size in results:
        if 0 <= size < 1000:
            stubs.append(vid_id)
        else:
            good.append((vid_id, size))

print(f"Good: {len(good)}, Stubs: {len(stubs)}", file=sys.stderr)
if good:
    print(f"Sample good sizes: {[s for _,s in good[:3]]}", file=sys.stderr)
for s in stubs:
    print(s)
