const CACHE_NAME = "bombus-cache-v1";
const urlsToCache = [
  "/",
  "/app/index.html",
  "/app/styles.css",
  "/app/scripts.js",
  "/app/manifest.json",
  "/images/icons/192.png",
  "/images/icons/512.png"
];

self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", (event) => {
  console.log("[Service Worker] Activating...");
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const title = "New Message";
  const options = {
    body: data || "You have a new notification",
    icon: "/images/icons/192.png",
    data: data, 
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientsArr) => {
      const hadWindow = clientsArr.some((client) => {
        if (client.url === urlToOpen && "focus" in client) {
          client.focus();
          return true;
        }
        return false;
      });
      if (!hadWindow && clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});