const CACHE_NAME='recall-pwa-v7';
const APP_SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;event.respondWith(caches.match(req).then(cached=>{const network=fetch(req).then(response=>{if(response&&response.status===200&&response.type==='basic'){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));}return response;}).catch(()=>cached);return cached||network;}));});
