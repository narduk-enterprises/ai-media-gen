export default {
  async fetch(req, env) {
    if (new URL(req.url).pathname !== "/") return new Response("Not found", { status: 404 });
    
    let cursor;
    const files = [];
    do {
      const list = await env.MEDIA.list({ limit: 1000, cursor });
      for (const obj of list.objects) {
        if (obj.size < 200000) { // < 200KB usually means a failed video or missing data
          files.push({ key: obj.key, size: obj.size });
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    return new Response(JSON.stringify(files, null, 2), { headers: { 'content-type': 'application/json' } });
  }
}
