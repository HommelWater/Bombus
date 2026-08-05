// Bombus-P2P local replica store (IndexedDB).
// Every node keeps a full replica of channels, posts and file blobs,
// which is what gives the network its redundancy: any peer can serve
// any piece of data it has ever seen.

const DB_NAME = "bombus-p2p";
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("channels")) {
                db.createObjectStore("channels", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains("posts")) {
                const posts = db.createObjectStore("posts", { keyPath: "id" });
                posts.createIndex("channel", "channel", { unique: false });
                posts.createIndex("created_at", "created_at", { unique: false });
            }
            if (!db.objectStoreNames.contains("files")) {
                db.createObjectStore("files", { keyPath: "hash" });
            }
            if (!db.objectStoreNames.contains("users")) {
                db.createObjectStore("users", { keyPath: "npub" });
            }
            if (!db.objectStoreNames.contains("meta")) {
                db.createObjectStore("meta", { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

let dbPromise = null;
function db() {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
}

function tx(store, mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
    }));
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export const store = {
    // --- channels ---
    async putChannel(channel) {
        const existing = await this.getChannel(channel.id);
        if (existing) return false; // idempotent insert
        await tx("channels", "readwrite", s => s.put(channel));
        return true;
    },
    async getChannel(id) {
        const d = await db();
        return reqToPromise(d.transaction("channels").objectStore("channels").get(id));
    },
    async getChannels() {
        const d = await db();
        const all = await reqToPromise(d.transaction("channels").objectStore("channels").getAll());
        return all.sort((a, b) => a.created_at - b.created_at);
    },
    async deleteChannel(id) {
        await tx("channels", "readwrite", s => s.delete(id));
        // also remove its posts
        const posts = await this.getPosts(id);
        const d = await db();
        const t = d.transaction("posts", "readwrite");
        for (const p of posts) t.objectStore("posts").delete(p.id);
        return new Promise(r => t.oncomplete = r);
    },

    // --- posts ---
    async putPost(post) {
        const d = await db();
        const existing = await reqToPromise(d.transaction("posts").objectStore("posts").get(post.id));
        if (existing) return false; // dedup: gossip may deliver the same post many times
        await tx("posts", "readwrite", s => s.put(post));
        return true;
    },
    async getPosts(channel_id = null, limit = 500) {
        const d = await db();
        let all;
        if (channel_id === null || channel_id === -1) {
            all = await reqToPromise(d.transaction("posts").objectStore("posts").getAll());
        } else {
            all = await reqToPromise(d.transaction("posts").objectStore("posts").index("channel").getAll(channel_id));
        }
        all.sort((a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1));
        return all.slice(-limit);
    },
    async searchPosts(query, limit = 200) {
        const all = await this.getPosts(null, 100000);
        const q = query.toLowerCase();
        return all.filter(p => (p.content || "").toLowerCase().includes(q)).slice(-limit);
    },
    async latestPosts(n = 300) {
        const all = await this.getPosts(null, n);
        return all;
    },

    // --- files (content-addressed blobs) ---
    async putFile(file) { // {hash, name, size, channel, blob}
        const d = await db();
        const existing = await reqToPromise(d.transaction("files").objectStore("files").get(file.hash));
        if (existing && existing.blob) return false;
        await tx("files", "readwrite", s => s.put(file));
        return true;
    },
    async putFileMeta(meta) { // metadata only, blob fetched later from whoever has it
        const d = await db();
        const existing = await reqToPromise(d.transaction("files").objectStore("files").get(meta.hash));
        if (existing) return false;
        await tx("files", "readwrite", s => s.put({ ...meta, blob: null }));
        return true;
    },
    async getFile(hash) {
        const d = await db();
        return reqToPromise(d.transaction("files").objectStore("files").get(hash));
    },
    async getFileMetas() {
        const d = await db();
        const all = await reqToPromise(d.transaction("files").objectStore("files").getAll());
        return all.map(({ blob, ...meta }) => meta);
    },

    // --- users (known identities) ---
    async putUser(user) { // {npub, username, last_seen, pfp}
        const d = await db();
        const existing = await reqToPromise(d.transaction("users").objectStore("users").get(user.npub));
        const clean = Object.fromEntries(Object.entries(user).filter(([, v]) => v !== undefined));
        const merged = { ...existing, ...clean, last_seen: Math.max(existing?.last_seen || 0, user.last_seen || 0) };
        await tx("users", "readwrite", s => s.put(merged));
        return merged;
    },
    async getUsers() {
        const d = await db();
        return reqToPromise(d.transaction("users").objectStore("users").getAll());
    },

    // --- meta key-value ---
    async setMeta(key, value) {
        await tx("meta", "readwrite", s => s.put({ key, value }));
    },
    async getMeta(key) {
        const d = await db();
        const row = await reqToPromise(d.transaction("meta").objectStore("meta").get(key));
        return row ? row.value : null;
    }
};
