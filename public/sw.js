// Service Worker for Murage Hub PWA
// Cache name for versioning
const CACHE_NAME = "murage-hub-v1";

// Assets to cache on install (app shell)
const APP_SHELL_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.ico",
  "/favicon.svg",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
];

// Install event - cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open("murage-hub-v1")
      .then((cache) => {
        console.log("Service Worker: Caching app shell");
        return cache
          .addAll([
            "/",
            "/manifest.json",
            "/favicon.ico",
            "/favicon.svg",
            "/favicon-16x16.png",
            "/favicon-32x32.png",
            "/apple-touch-icon.png",
            "/android-chrome-192x192.png",
            "/android-chrome-512x512.png",
          ])
          .catch((err) => {
            console.warn("Service Worker: Some assets failed to cache", err);
          });
      })
      .then(() => self.skipWaiting()),
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== "murage-hub-v1") {
              console.log("Service Worker: Deleting old cache", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Network-first strategy for API calls (Supabase)
async function networkFirstStrategy(request) {
  const cache = await caches.open("murage-hub-v1");

  try {
    // Try network first
    const networkResponse = await fetch(request);

    // If successful, update cache and return
    if (networkResponse.ok) {
      const cache = await caches.open("murage-hub-v1");
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }

    // If network fails, fall back to cache
    throw new Error("Network response not ok");
  } catch (error) {
    // Network failed, try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // If no cache, return offline fallback for navigation requests
    if (request.mode === "navigate") {
      const cache = await caches.open("murage-hub-v1");
      const offlineResponse = await cache.match("/");
      if (offlineResponse) {
        return offlineResponse;
      }
    }

    // Fallback offline page
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

// Cache-first strategy for static assets
async function cacheFirstStrategy(request) {
  const cache = await caches.open("murage-hub-v1");
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  // Not in cache, fetch from network
  const networkResponse = await fetch(request);

  // Cache if successful
  if (networkResponse.ok) {
    const cache = await caches.open("murage-hub-v1");
    cache.put(request, networkResponse.clone());
  }

  return networkResponse;
}

// Main fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip non-HTTP(S) requests
  if (!request.url.startsWith("http")) {
    return;
  }

  // Check if it's a Supabase API call (network-first strategy)
  const isSupabaseCall = request.url.includes("supabase.co");

  // Check if it's a static asset (images, fonts, css, js)
  const isStaticAsset =
    request.destination === "image" ||
    request.destination === "font" ||
    request.destination === "style" ||
    request.destination === "script" ||
    request.url.match(/\.(png|jpg|jpeg|svg|webp|woff2?|ttf|css|js)(\?.*)?$/i);

  if (isSupabaseCall) {
    // Network-first for Supabase API calls
    event.respondWith(networkFirstStrategy(request));
  } else if (isStaticAsset) {
    // Cache-first for static assets
    event.respondWith(cacheFirstStrategy(request));
  } else {
    // Default: network first for everything else
    event.respondWith(networkFirstStrategy(request));
  }
});

// Handle install prompt for PWA install banner
let deferredPrompt = null;

self.addEventListener("beforeinstallprompt", (event) => {
  // Prevent default browser install prompt
  event.preventDefault();
  deferredPrompt = event;

  // Notify the main thread that install is available
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: "PWA_INSTALL_AVAILABLE",
        payload: { available: true },
      });
    });
  });
});

self.addEventListener("appinstalled", () => {
  console.log("PWA installed successfully");
  deferredPrompt = null;

  // Notify clients that install completed
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: "PWA_INSTALLED",
        payload: { installed: true },
      });
    });
  });
});

// Handle messages from main thread
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DISMISS_INSTALL_BANNER") {
    deferredPrompt = null;
  }

  if (event.data && event.data.type === "TRIGGER_INSTALL") {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === "accepted") {
          console.log("User accepted PWA install");
        } else {
          console.log("User dismissed PWA install");
        }
        deferredPrompt = null;
      });
    }
  }
});
