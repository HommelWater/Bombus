// Bombus-P2P — peer-to-peer port of the original client-server Bombus chat.
//
// Architecture:
//   - No server. Identity is a Nostr keypair (nsec). Signaling runs through
//     Nostr relays, all chat traffic flows over WebRTC data channels.
//   - Every node holds a FULL replica of channels/posts/files (IndexedDB).
//   - Redundancy: (1) gossip flooding with a seen-set + TTL so data travels
//     beyond direct neighbors, (2) anti-entropy sync on every connect and
//     periodically, (3) content-addressed files fetchable from any peer that
//     has a copy, (4) directed messages relayed through the mesh when there
//     is no direct link.

import { NostrP2P } from './nostr-p2p.js';
import { store } from './store.js';
import { generateSecretKey, getPublicKey } from './nostr-deps.js';
import { nip19 } from './nostr-deps.js';
import { bytesToHex, hexToBytes } from './nostr-deps.js';

const GOSSIP_TTL = 4;              // hops a gossiped message may travel
const SEEN_MAX = 5000;             // seen-set size for dedup
const SYNC_INTERVAL = 120 * 1000;  // periodic anti-entropy
const FILE_CHUNK = 48 * 1024;      // keep base64+JSON+signature under the ~256KB data-channel message limit

// ---------------------------------------------------------------- state ----
const state = {
    p2p: null,
    self_npub: null,
    username: null,
    users: {},              // npub -> {npub, username, last_seen}
    channels: {},           // id -> {id, name, created_at}
    vc_channel_users: {},   // channel -> [npub]
    vc_last_seen: {},       // channel -> {npub: timestamp}
    vc_peers: {},           // npub -> RTCPeerConnection
    vc_ice_buffer: {},      // npub -> [candidates arrived before pc existed]
    vc_peer_audio: {},      // npub -> HTMLAudioElement
    seen: new Set(),        // gossip dedup
    founder_npub: null,     // group founder (first peer ever added by anyone)
    admins: new Set(),      // founder + users promoted by an admin
    user_status: {},        // npub -> {banned, restricted}
    added_manually: false,  // whether we ever added a peer ourselves
    fileRequests: new Set(),// hashes we've already requested
};
let current_text_channel = -1;
let current_voice_channel = -1;
let localStream = null;
const objectURLs = {};      // hash -> blob URL
const userVolumePrefs = JSON.parse(localStorage.getItem("userVolumePrefs") || "{}");
let masterVolume = parseFloat(localStorage.getItem("masterVolume") || "1.0");

// --------------------------------------------------------------- helpers ---
function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function isVisible(elem) {
    if (!elem) return false;
    const style = window.getComputedStyle(elem);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}
function toggleDiv(id, type = "block") {
    const div = document.getElementById(id);
    div.style.display = isVisible(div) ? 'none' : type;
}
function timeIntToString(time) {
    const date = new Date(time * 1000);
    const p = n => n.toString().padStart(2, '0');
    return `${p(date.getHours())}:${p(date.getMinutes())} ${p(date.getDate())}-${p(date.getMonth() + 1)}-${date.getFullYear()}`;
}
function shortNpub(npub) { return npub ? npub.slice(0, 12) + "…" : "?"; }

// -------------------------------------------------------------- gossip -----
function markSeen(mid) {
    if (state.seen.has(mid)) return false;
    state.seen.add(mid);
    if (state.seen.size > SEEN_MAX) {
        const it = state.seen.values();
        for (let i = 0; i < 1000; i++) state.seen.delete(it.next().value);
    }
    return true;
}

// Gossip to the whole mesh (flooding with TTL). Keeps original sender/signature
// so authorship stays verifiable no matter how many hops it travels.
function gossip(msg, except = []) {
    msg.mid = msg.mid || uid();
    msg.ttl = msg.ttl ?? GOSSIP_TTL;
    state.p2p.broadcast(msg, except);
}

// Directed message: direct if possible, otherwise relayed through the mesh.
function sendDirect(npub, msg) {
    msg.mid = msg.mid || uid();
    msg.ttl = msg.ttl ?? GOSSIP_TTL;
    msg.to = npub;
    if (state.p2p.isConnected(npub)) {
        try { state.p2p.send(npub, msg); return; } catch { /* fall through to relay */ }
    }
    state.p2p.broadcast(msg, []);
}

async function handleGossip(npub, msg) {
    if (!msg || typeof msg !== 'object' || !msg.type) return;
    if (msg.mid && !markSeen(msg.mid)) return; // already processed

    // Directed message for someone else: relay it onwards (mesh redundancy).
    if (msg.to && msg.to !== state.self_npub) {
        if (msg.ttl > 0) state.p2p.broadcast({ ...msg, ttl: msg.ttl - 1 }, [npub, msg.sender].filter(Boolean));
        return;
    }

    // Presence: any traffic counts as activity.
    touchUser(msg.sender || npub);

    switch (msg.type) {
        case 'hello': {
            await adoptFounder(msg.founder, msg.sender);
            if (msg.sender === state.self_npub) maybeAdoptSelfProfile({ npub: msg.sender, username: msg.username, pfp: msg.pfp });
            addKnownPeer(msg.sender);
            // putUser merges with the stored record (a missing pfp field never
            // erases a known one) – keep the merged result in memory too.
            state.users[msg.sender] = await store.putUser({ npub: msg.sender, username: msg.username, last_seen: Date.now(), pfp: msg.pfp });
            for (const p of (msg.peers || [])) addKnownPeer(p);
            setUserList();
            // Reply so the newcomer learns about us too.
            sendDirect(msg.sender, { type: 'profile', username: state.username, peers: knownPeers(), pfp: state.users[state.self_npub]?.pfp });
            break;
        }
        case 'profile': {
            await adoptFounder(msg.founder, msg.sender);
            if (msg.sender === state.self_npub) maybeAdoptSelfProfile({ npub: msg.sender, username: msg.username, pfp: msg.pfp });
            addKnownPeer(msg.sender);
            state.users[msg.sender] = await store.putUser({ npub: msg.sender, username: msg.username, last_seen: Date.now(), pfp: msg.pfp });
            for (const p of (msg.peers || [])) addKnownPeer(p);
            setUserList();
            break;
        }
        case 'peers': {
            for (const p of (msg.peers || [])) addKnownPeer(p);
            break;
        }
        case 'channel': {
            // Channel creation is an admin action once a founder exists.
            if (state.founder_npub && !isAdmin(msg.sender)) return;
            if (await store.putChannel(msg.channel)) {
                state.channels[msg.channel.id] = msg.channel;
                setChannelList();
                gossip({ ...msg, mid: msg.mid, ttl: msg.ttl - 1 }, [npub]); // flood on
            }
            break;
        }
        case 'channel_delete': {
            // Admin action: only honored when signed by an admin. The library
            // has already verified the message's schnorr signature, so
            // msg.sender is cryptographically the author.
            if (!isAdmin(msg.sender)) return;
            if (state.channels[msg.channel_id]) {
                await store.deleteChannel(msg.channel_id);
                delete state.channels[msg.channel_id];
                if (current_text_channel === msg.channel_id) setTextChannel(Object.keys(state.channels)[0] ?? -1);
                setChannelList();
                gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            }
            break;
        }
        case 'post': {
            if (state.user_status[msg.post.author]?.banned) return; // banned: ignore entirely
            if (await store.putPost(msg.post)) {
                if (msg.post.channel === current_text_channel) renderPosts([msg.post]);
                gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]); // flood on
            }
            break;
        }
        case 'sync_req': {
            // Anti-entropy: ship our replica (bounded) to the requester.
            sendDirect(msg.sender, {
                type: 'sync_res',
                channels: await store.getChannels(),
                posts: await store.latestPosts(300),
                files: await store.getFileMetas(),
                users: (await store.getUsers()).slice(-200),
                founder: state.founder_npub,
                admins: Array.from(state.admins),
                user_status: state.user_status,
            });
            break;
        }
        case 'sync_res': {
            await adoptFounder(msg.founder, msg.sender);
            let changedChannels = false, newPosts = [];
            for (const c of (msg.channels || [])) {
                if (await store.putChannel(c)) { state.channels[c.id] = c; changedChannels = true; }
            }
            for (const p of (msg.posts || [])) {
                if (await store.putPost(p)) newPosts.push(p);
            }
            for (const f of (msg.files || [])) await store.putFileMeta(f);
            for (const u of (msg.users || [])) {
                if (u.npub === state.self_npub) { maybeAdoptSelfProfile(u); continue; }
                const merged = await store.putUser(u);
                state.users[u.npub] = merged;
            }
            // Roles come from sync only if the sender is an admin we trust.
            if (isAdmin(msg.sender)) {
                for (const a of (msg.admins || [])) state.admins.add(a);
                state.user_status = { ...state.user_status, ...(msg.user_status || {}) };
                await store.setMeta('admins', Array.from(state.admins));
                await store.setMeta('user_status', state.user_status);
                updateAdminUI();
            }
            if (changedChannels) setChannelList();
            if (newPosts.length) renderPosts(newPosts.filter(p => p.channel === current_text_channel));
            setUserList();
            break;
        }
        case 'user_status': {
            // Moderation action: only honored when signed by an admin.
            if (!isAdmin(msg.sender)) return;
            if (await applyUserStatus(msg)) {
                setUserList();
                updateAdminUI();
                gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            }
            break;
        }
        case 'admin_pfp': {
            if (!isAdmin(msg.sender)) return;
            const u = await store.putUser({ npub: msg.target, pfp: msg.hash, last_seen: 0 });
            state.users[msg.target] = { ...state.users[msg.target], ...u, pfp: msg.hash };
            setUserList();
            hydrateAllPfps();
            gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            break;
        }
        case 'admin_rename': {
            if (!isAdmin(msg.sender)) return;
            const u = await store.putUser({ npub: msg.target, username: msg.username, last_seen: Date.now() });
            state.users[msg.target] = u;
            setUserList();
            gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            break;
        }
        case 'file_meta': {
            if (await store.putFileMeta(msg.file)) gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            break;
        }
        case 'file_req': {
            const f = await store.getFile(msg.hash);
            if (!f || !f.blob) return;
            const buf = await f.blob.arrayBuffer();
            const total = Math.ceil(buf.byteLength / FILE_CHUNK);
            for (let seq = 0; seq < total; seq++) {
                const chunk = buf.slice(seq * FILE_CHUNK, (seq + 1) * FILE_CHUNK);
                sendDirect(msg.sender, {
                    type: 'file_chunk', hash: msg.hash, seq, total,
                    name: f.name, size: f.size, channel: f.channel,
                    data: base64FromBuffer(chunk),
                });
            }
            break;
        }
        case 'file_chunk': {
            await receiveFileChunk(msg);
            break;
        }
        case 'vc_join': {
            const ust = state.user_status[msg.sender];
            if (ust?.banned || ust?.restricted) return; // no voice for banned/restricted
            if (!state.vc_channel_users[msg.channel]) state.vc_channel_users[msg.channel] = [];
            if (!state.vc_channel_users[msg.channel].includes(msg.sender)) {
                state.vc_channel_users[msg.channel].push(msg.sender);
            }
            if (!state.vc_last_seen[msg.channel]) state.vc_last_seen[msg.channel] = {};
            state.vc_last_seen[msg.channel][msg.sender] = Date.now();
            setVCUsers();
            // Someone joined a channel we're in – pair up (deterministic polarity).
            if (msg.channel === current_voice_channel) vc_maybeOffer(msg.sender);
            gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            break;
        }
        case 'vc_leave': {
            if (state.vc_channel_users[msg.channel]) {
                state.vc_channel_users[msg.channel] = state.vc_channel_users[msg.channel].filter(u => u !== msg.sender);
            }
            if (state.vc_last_seen[msg.channel]) delete state.vc_last_seen[msg.channel][msg.sender];
            vc_teardownPeer(msg.sender);
            setVCUsers();
            gossip({ ...msg, ttl: msg.ttl - 1 }, [npub]);
            break;
        }
        case 'vc_offer':     await vc_onOffer(msg.sender, msg.offer); break;
        case 'vc_answer':    await vc_onAnswer(msg.sender, msg.answer); break;
        case 'vc_candidate': await vc_onCandidate(msg.sender, msg.candidate); break;
    }

    // Peer-discovery messages get forwarded too, so the peer set converges.
    if (!msg.to && msg.ttl > 0 && ['hello', 'profile', 'peers'].includes(msg.type)) {
        gossip({ ...msg, ttl: msg.ttl - 1 }, [npub, msg.sender].filter(Boolean));
    }
}

function updatePeerStatus() {
    const el = document.getElementById('peer-status');
    if (!el || !state.p2p) return;
    const n = state.p2p.connections.size;
    const known = state.p2p.peers.size - 1;
    el.innerText = n > 0
        ? `Connected to ${n} peer${n > 1 ? 's' : ''} (${known} known)`
        : known > 0
            ? `Not connected — trying to reach ${known} known peer${known > 1 ? 's' : ''}…`
            : `Not connected — add someone's npub below to join the swarm`;
    if (!n && known) {
        // Nudge rotation: try connecting to known peers we haven't reached.
        for (const p of state.p2p.peers) {
            if (p !== state.self_npub && !state.p2p.connections.has(p)) {
                try { state.p2p.connect(p); } catch { /* rotation will retry */ }
                break; // one nudge per tick
            }
        }
    }
}

function touchUser(npub) {
    if (!npub || npub === state.self_npub) return;
    const u = state.users[npub] || { npub, username: shortNpub(npub) };
    u.last_seen = Date.now();
    state.users[npub] = u;
    // Note: this updates the "last seen" bookkeeping only. The green dot is
    // rendered by setUserList and means DIRECTLY CONNECTED – any mesh-relayed
    // traffic touches last_seen, so it must not light the dot.
}

// ------------------------------------------------------------- founder -----
async function setFounder(npub) {
    if (!npub || state.founder_npub === npub) return;
    state.founder_npub = npub;
    state.admins.add(npub);
    await store.setMeta('founder', npub);
    await store.setMeta('admins', Array.from(state.admins));
    updateAdminUI();
}

// Founder convergence: adopt a claim when we have none, and always let the
// lexicographically smallest claim win. Self-founding can diverge (e.g. a
// wiped device re-founds itself while the swarm kept the old founder) — the
// smallest-npub rule makes every node converge to one founder again instead
// of splitting into two permanent "admins".
async function adoptFounder(npub, claimedBy = null) {
    if (!npub) return;
    if (!state.founder_npub || npub < state.founder_npub) {
        await setFounder(npub);
    }
}

function isAdmin(npub = state.self_npub) {
    return !!npub && (npub === state.founder_npub || state.admins.has(npub));
}

function myStatus() {
    return state.user_status[state.self_npub] || {};
}

function updateAdminUI() {
    const admin = isAdmin();
    const del = document.getElementById('delete-channel-button');
    if (del) del.style.display = admin ? 'block' : 'none';
    const add = document.getElementById('add-channel-button');
    if (add) add.style.display = admin ? 'block' : 'none';
    const badge = document.getElementById('admin-badge');
    if (badge) {
        badge.innerText = admin
            ? (state.self_npub === state.founder_npub ? 'You are the group admin (founder).' : 'You are a group admin.')
            : 'Group admin: ' + (state.founder_npub ? shortNpub(state.founder_npub) : 'none yet');
    }
}

// ---------------------------------------------------- profile pictures -----
// Profile pictures are content-addressed like any other file: the blob lives
// in the replica store and is fetched from peers on demand.
function pfpImg(npub, cls) {
    const hash = state.users[npub]?.pfp;
    if (hash) return `<img class="${cls}" data-pfp="${npub}" alt="">`;
    return `<img class="${cls}" src="./images/main.png" alt="">`;
}

async function hydratePfps(container) {
    for (const el of container.querySelectorAll('img[data-pfp]')) {
        const hash = state.users[el.dataset.pfp]?.pfp || "";
        // Skip only when this element already shows the current hash – a pfp
        // change must re-hydrate even previously-rendered images.
        if (el.dataset.pfpDone === hash) continue;
        if (!hash) {
            el.dataset.pfpDone = hash;
            el.src = './images/main.png';
            el.style.opacity = "";
            continue;
        }
        const url = await fileURL(hash);
        if (url) {
            el.dataset.pfpDone = hash;
            el.src = url;
            el.style.opacity = "";
        } else {
            // Not marked done: retried on the next hydrate once chunks arrive.
            el.style.opacity = "0.5";
            requestFile(hash);
        }
    }
}

function hydrateAllPfps() {
    hydratePfps(document);
    if (document.querySelector('#chat-window')) hydratePfps(document.querySelector('#chat-window'));
}

// Single hidden input drives both own-pfp and admin-pfp changes.
let pfpTarget = null;
function pickPfp(target) {
    pfpTarget = target;
    document.getElementById('pfp-input').click();
}

async function changePfp() {
    const file = document.getElementById('pfp-input').files[0];
    document.getElementById('pfp-input').value = "";
    if (!file || !file.type.startsWith('image/') || !pfpTarget) return;
    const hash = await hashFile(file);
    await store.putFile({ hash, name: file.name, size: file.size, channel: null, blob: file });
    gossip({ type: 'file_meta', file: { hash, name: file.name, size: file.size, channel: null } });
    objectURLs[hash] = URL.createObjectURL(file);
    if (pfpTarget === state.self_npub) {
        state.users[state.self_npub] = { ...state.users[state.self_npub], pfp: hash };
        await store.putUser(state.users[state.self_npub]);
        gossip({ type: 'profile', username: state.username, peers: knownPeers(), founder: state.founder_npub, pfp: hash });
    } else {
        // Admin action: set someone else's picture (signed).
        state.users[pfpTarget] = { ...state.users[pfpTarget], pfp: hash };
        await store.putUser({ npub: pfpTarget, pfp: hash, last_seen: 0 });
        gossip({ type: 'admin_pfp', target: pfpTarget, hash });
    }
    setUserList();
    setVCUsers();
    hydrateAllPfps();
}

// --------------------------------------------------------- moderation ------
async function applyUserStatus(msg) {
    const target = msg.target;
    if (!target || target === state.founder_npub) return false; // founder untouchable
    let changed = false;
    if (typeof msg.admin === 'boolean') {
        const has = state.admins.has(target);
        if (msg.admin && !has) { state.admins.add(target); changed = true; }
        if (!msg.admin && has) { state.admins.delete(target); changed = true; }
        if (changed) await store.setMeta('admins', Array.from(state.admins));
    }
    if (typeof msg.banned === 'boolean' || typeof msg.restricted === 'boolean') {
        const st = state.user_status[target] || {};
        if (typeof msg.banned === 'boolean') st.banned = msg.banned;
        if (typeof msg.restricted === 'boolean') st.restricted = msg.restricted;
        state.user_status[target] = st;
        await store.setMeta('user_status', state.user_status);
        changed = true;
    }
    return changed;
}

function modAction(target, fields) {
    gossip({ type: 'user_status', target, ...fields });
    applyUserStatus({ target, ...fields }).then(() => { setUserList(); updateAdminUI(); });
}

function adminRename(target) {
    const name = prompt('New display name for ' + (state.users[target]?.username || shortNpub(target)) + ':');
    if (!name || !name.trim()) return;
    gossip({ type: 'admin_rename', target, username: name.trim() });
    store.putUser({ npub: target, username: name.trim(), last_seen: Date.now() })
        .then(u => { state.users[target] = u; setUserList(); });
}

// Clicking a user as an admin opens moderation actions (like the original).
function showUserSettings(npub) {
    document.querySelectorAll('.user-settings').forEach(d => d.remove());
    if (!isAdmin() || npub === state.founder_npub || npub === state.self_npub) return;
    const div = document.getElementById('user-' + CSS.escape(npub));
    if (!div) return;
    const st = state.user_status[npub] || {};
    const isTargetAdmin = state.admins.has(npub);
    div.insertAdjacentHTML('beforeend', `
        <div class="user-settings">
            <div class="user-setting btn right" data-act="ban">${st.banned ? 'Unban' : 'Ban'}</div>
            <div class="user-setting btn right" data-act="restrict">${st.restricted ? 'Unrestrict' : 'Restrict'}</div>
            <div class="user-setting btn right" data-act="admin">${isTargetAdmin ? 'Remove Admin' : 'Make Admin'}</div>
            <div class="user-setting btn right" data-act="rename">Rename</div>
            <div class="user-setting btn right" data-act="pfp">Change Picture</div>
        </div>`);
    div.querySelectorAll('.user-setting').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = el.dataset.act;
            if (act === 'ban') modAction(npub, { banned: !st.banned });
            if (act === 'restrict') modAction(npub, { restricted: !st.restricted });
            if (act === 'admin') modAction(npub, { admin: !isTargetAdmin });
            if (act === 'rename') adminRename(npub);
            if (act === 'pfp') pickPfp(npub);
            document.querySelectorAll('.user-settings').forEach(d => d.remove());
        });
    });
}

// ------------------------------------------------------------ peer set -----
function knownPeers() {
    return Array.from(state.p2p.peers).filter(p => p !== state.self_npub);
}
async function addKnownPeer(npub) {
    if (!npub || npub === state.self_npub) return;
    if (!state.p2p.peers.has(npub)) state.p2p.addPeer(npub);
    // Persist even when already in the live set: the live set is rebuilt on
    // every start, and reopening the app can only reconnect to peers that
    // were saved.
    const peers = await store.getMeta('peers') || [];
    if (!peers.includes(npub)) {
        peers.push(npub);
        await store.setMeta('peers', peers.slice(-200));
    }
}

// ------------------------------------------------------------- lifecycle ---
async function startApp() {
    state.p2p = new NostrP2P(localStorage.getItem('bombus_sk'), {
        maxConnections: 8,
        open: true, // accept signaling from unknown peers so new nodes can join
        onConnect: async (npub) => {
            // Founderless and we never added anyone: this peer added us, so
            // we are the first node of the group — the founder.
            if (!state.founder_npub && !state.added_manually) {
                await setFounder(state.self_npub);
            }
            // Anyone we actually reach is worth remembering across restarts.
            addKnownPeer(npub);
            touchUser(npub);
            setUserList();
            // Announce ourselves + gossip our peer set, then anti-entropy sync.
            sendDirect(npub, { type: 'hello', username: state.username, peers: knownPeers(), founder: state.founder_npub, pfp: state.users[state.self_npub]?.pfp });
            sendDirect(npub, { type: 'sync_req' });
            // Re-announce voice channel membership so state converges.
            if (current_voice_channel !== -1) sendDirect(npub, { type: 'vc_join', channel: current_voice_channel });
        },
        onMessage: (npub, msg) => { handleGossip(npub, msg).catch(console.error); },
        onDisconnect: (npub) => {
            if (state.users[npub]) state.users[npub].last_seen = 0;
            vc_teardownPeer(npub);
            for (const [ch, users] of Object.entries(state.vc_channel_users)) {
                state.vc_channel_users[ch] = users.filter(u => u !== npub);
            }
            setUserList();
            setVCUsers();
        },
    });
    state.self_npub = state.p2p.npub;

    // Group founder: the node that started the group. Persisted locally and
    // adopted trust-on-first-use from sync/hello. Admin actions are only
    // honored when signed (and thus sent) by this npub.
    state.founder_npub = await store.getMeta('founder');
    state.admins = new Set(await store.getMeta('admins') || []);
    state.user_status = await store.getMeta('user_status') || {};
    state.added_manually = await store.getMeta('added_manually') || false;
    if (state.founder_npub) state.admins.add(state.founder_npub);

    // Restore known peers.
    const peers = await store.getMeta('peers') || [];
    for (const p of peers) state.p2p.addPeer(p);

    // Restore replicated state.
    for (const c of await store.getChannels()) state.channels[c.id] = c;
    if (Object.keys(state.channels).length === 0) {
        // Deterministic default channel so fresh nodes converge on it.
        const general = { id: 'general', name: 'general', created_at: 0 };
        await store.putChannel(general);
        state.channels['general'] = general;
    }
    for (const u of await store.getUsers()) state.users[u.npub] = u;
    // Merge, don't replace: keep the stored pfp (and any other saved fields).
    state.users[state.self_npub] = { ...state.users[state.self_npub], npub: state.self_npub, username: state.username, last_seen: Date.now() };
    await store.putUser(state.users[state.self_npub]);

    // Periodic anti-entropy with a random peer keeps replicas converging
    // even when membership churns (this is the core redundancy mechanism).
    setInterval(() => {
        const conns = Array.from(state.p2p.connections.keys());
        if (conns.length) sendDirect(conns[Math.floor(Math.random() * conns.length)], { type: 'sync_req' });
    }, SYNC_INTERVAL);

    // Profile heartbeat: user discovery self-heals even if the initial hello
    // was lost, and keeps the peer set converging across the mesh.
    setInterval(() => {
        if (state.p2p.connections.size) {
            gossip({ type: 'profile', username: state.username, peers: knownPeers(), founder: state.founder_npub, pfp: state.users[state.self_npub]?.pfp });
        }
        updatePeerStatus();
    }, 60 * 1000);
    updatePeerStatus();
    setInterval(updatePeerStatus, 5000);

    // Phones/background tabs: whenever the page comes back (tab switch, screen
    // unlock, bfcache restore, network change), re-establish everything
    // immediately instead of waiting for timers to notice.
    const resume = () => {
        if (!state.p2p) return;
        state.p2p.resume();
        updatePeerStatus();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    document.addEventListener('resume', resume); // Chrome page-freeze resume
    window.addEventListener('pageshow', (e) => { if (e.persisted) resume(); });
    window.addEventListener('online', resume);

    // Voice-channel heartbeat: keeps membership lists converging (join
    // messages can get lost), expires members that vanished without a leave,
    // and retries voice peer connections that never came up.
    setInterval(() => {
        if (current_voice_channel !== -1) {
            gossip({ type: 'vc_join', channel: current_voice_channel });
            if (!state.vc_last_seen[current_voice_channel]) state.vc_last_seen[current_voice_channel] = {};
            state.vc_last_seen[current_voice_channel][state.self_npub] = Date.now();
        }
        // Expire members that stopped heartbeating (crashed/closed without leave).
        for (const [ch, seen] of Object.entries(state.vc_last_seen)) {
            for (const [npub, ts] of Object.entries(seen)) {
                if (npub !== state.self_npub && Date.now() - ts > 45000) {
                    delete seen[npub];
                    if (state.vc_channel_users[ch]) {
                        state.vc_channel_users[ch] = state.vc_channel_users[ch].filter(u => u !== npub);
                    }
                    vc_teardownPeer(npub);
                    setVCUsers();
                }
            }
        }
        // Retry missing/failed voice connections (deterministic polarity).
        if (current_voice_channel !== -1) {
            for (const member of (state.vc_channel_users[current_voice_channel] || [])) {
                const pc = state.vc_peers[member];
                if (member !== state.self_npub && (!pc || pc.connectionState === 'failed')) {
                    if (pc) vc_teardownPeer(member);
                    vc_maybeOffer(member);
                }
            }
        }
    }, 15 * 1000);

    setChannelList();
    setUserList();
    setTextChannel('general');
    document.getElementById('my-npub').value = state.self_npub;
    document.getElementById('my-nsec').value = nip19.nsecEncode(hexToBytes(localStorage.getItem('bombus_sk')));
    updateAdminUI();
}

// ------------------------------------------------------------- channels ----
function setChannelList() {
    const channels = Object.values(state.channels).sort((a, b) => a.created_at - b.created_at);
    document.getElementById("channels").innerHTML = channels.map(channel => `
        <div id="channel-${channel.id}" class="channel" data-id="${channel.id}">
            <div class="channel-main" style="display: flex;">
                <div class="channel-name">${escapeHtml(channel.name)}</div>
                <div class="btn left channel-join-button">${current_voice_channel === channel.id ? "✖" : "🎤"}</div>
            </div>
            <div class="channel-users"></div>
        </div>`).join("");
    document.querySelectorAll(".channel").forEach(e => {
        e.addEventListener("click", () => setTextChannel(e.dataset.id));
        e.querySelector('.channel-join-button').addEventListener('click', (a) => {
            a.stopPropagation();
            setVoiceChannel(e.dataset.id);
        });
    });
    if (current_text_channel !== -1 && state.channels[current_text_channel]) {
        document.getElementById(`channel-${current_text_channel}`)?.style.setProperty("background", "var(--color-button-h)");
    }
    setVCUsers();
}

function toggleCreateChannelDiv() {
    const button = document.getElementById("add-channel-button");
    const subitem = document.getElementById("add-channel-subitem");
    if (!isVisible(subitem)) {
        subitem.style.display = "flex";
        button.style.display = "none";
    } else {
        if (state.founder_npub && !isAdmin()) {
            alert('Only group admins can create channels.');
            subitem.style.display = "none";
            button.style.display = "block";
            return;
        }
        const name = document.getElementById("channel-name").value.trim();
        if (name) {
            const channel = { id: uid(), name, created_at: Math.floor(Date.now() / 1000) };
            store.putChannel(channel).then(() => {
                state.channels[channel.id] = channel;
                setChannelList();
                gossip({ type: 'channel', channel });
            });
        }
        subitem.style.display = "none";
        button.style.display = "block";
    }
}

function toggleDeleteChannelDiv() {
    const button = document.getElementById("delete-channel-button");
    const subitem = document.getElementById("delete-channel-subitem");
    if (!isVisible(subitem)) {
        const select = document.getElementById('delete-channel-name');
        select.innerHTML = "";
        for (const [id, channel] of Object.entries(state.channels)) {
            if (id === 'general') continue;
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = channel.name;
            select.appendChild(opt);
        }
        subitem.style.display = "flex";
        button.style.display = "none";
    } else {
        if (!isAdmin()) {
            alert('Only the group admin (founder) can delete channels.');
            subitem.style.display = "none";
            button.style.display = "block";
            return;
        }
        const channel_id = document.getElementById("delete-channel-name").value;
        if (channel_id && state.channels[channel_id]) {
            store.deleteChannel(channel_id).then(() => {
                delete state.channels[channel_id];
                if (current_text_channel === channel_id) setTextChannel('general');
                setChannelList();
                gossip({ type: 'channel_delete', channel_id });
            });
        }
        subitem.style.display = "none";
        button.style.display = "block";
    }
}

// ---------------------------------------------------------------- posts ----
async function setTextChannel(channel_id) {
    if (current_text_channel === channel_id) return;
    current_text_channel = channel_id;
    document.querySelector('#chat-window').innerHTML = "";
    document.querySelectorAll('.channel').forEach(e => e.style.background = null);
    document.getElementById('chat-header-text').innerText =
        channel_id === -1 ? "Search" : (state.channels[channel_id]?.name || "Unknown");
    if (channel_id === -1) return;
    document.getElementById(`channel-${channel_id}`)?.style.setProperty("background", "var(--color-button-h)");
    renderPosts(await store.getPosts(channel_id));
}

function sendPost() {
    if (myStatus().banned) { alert('You are banned from this group.'); return; }
    const input = document.getElementById("user-input");
    const content = input.value.trim();
    if (content === "" || current_text_channel === -1) return;
    const post = {
        id: uid(),
        channel: current_text_channel,
        author: state.self_npub,
        content,
        created_at: Math.floor(Date.now() / 1000),
    };
    store.putPost(post).then(() => {
        renderPosts([post]);
        gossip({ type: 'post', post });
    });
    input.value = "";
}

async function search() {
    const query = document.getElementById("search-bar").value.trim();
    if (!query) return;
    current_text_channel = -1;
    document.querySelector('#chat-window').innerHTML = "";
    document.getElementById('chat-header-text').innerText = "Search";
    document.querySelectorAll('.channel').forEach(e => e.style.background = null);
    renderPosts(await store.searchPosts(query));
}

function escapeHtml(raw) {
    return (raw ?? "").toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatPostContent(raw) {
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);
    const videoExts = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']);
    return escapeHtml(raw).replace(
        /\{file:([a-f0-9]+):([^}]+)\}/gi,
        (_, hash, fname) => {
            const ext = fname.split('.').pop()?.toLowerCase();
            if (imageExts.has(ext)) return `<img class="media-upload" data-hash="${hash}" alt="${fname}" loading="eager">`;
            if (videoExts.has(ext)) return `<video class="media-upload" data-hash="${hash}" controls loading="eager"></video>`;
            return `<a class="file-link" data-hash="${hash}" download="${fname}">💾 ${fname}</a>`;
        });
}

function renderPosts(posts) {
    if (!posts || !posts.length) return;
    const container = document.querySelector('#chat-window');
    const wasAtBottom = Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 30;
    const existing = new Set(Array.from(container.querySelectorAll('.chat-post')).map(w => w.dataset.postId));

    posts.sort((a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1));
    for (const post of posts) {
        if (existing.has(post.id)) continue;
        existing.add(post.id);

        const wrapper = document.createElement('div');
        wrapper.className = 'chat-post';
        wrapper.dataset.postId = post.id;
        wrapper.dataset.created = post.created_at;

        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'post-username';
        usernameDiv.innerHTML = pfpImg(post.author, 'post-user-icon');
        const userName = document.createTextNode(state.users[post.author]?.username || shortNpub(post.author));
        const dateDiv = document.createElement('div');
        dateDiv.className = 'post-date';
        dateDiv.textContent = timeIntToString(post.created_at);
        usernameDiv.append(userName, dateDiv);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'post-content-group';
        const newPost = document.createElement('div');
        newPost.className = 'post-content';
        newPost.innerHTML = formatPostContent(post.content);
        groupDiv.append(newPost);
        wrapper.append(usernameDiv, groupDiv);

        // Insert in chronological position.
        let inserted = false;
        for (const child of container.children) {
            if (Number(child.dataset.created) > post.created_at) {
                container.insertBefore(wrapper, child);
                inserted = true;
                break;
            }
        }
        if (!inserted) container.appendChild(wrapper);
    }
    hydrateMedia(container);
    hydratePfps(container);
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

// Resolve {file:hash:name} references: local blob if we replicate it,
// otherwise request it from the mesh (any peer holding a copy can serve it).
async function hydrateMedia(container) {
    for (const el of container.querySelectorAll('[data-hash]')) {
        if (el.dataset.hydrated) continue;
        el.dataset.hydrated = "1";
        const hash = el.dataset.hash;
        const url = await fileURL(hash);
        if (url) {
            if (el.tagName === 'A') el.href = url; else el.src = url;
        } else {
            el.style.opacity = "0.5";
            el.title = "Fetching from peers…";
            requestFile(hash);
        }
    }
}

async function fileURL(hash) {
    if (objectURLs[hash]) return objectURLs[hash];
    const f = await store.getFile(hash);
    if (f && f.blob) {
        objectURLs[hash] = URL.createObjectURL(f.blob);
        return objectURLs[hash];
    }
    return null;
}

function requestFile(hash) {
    if (state.fileRequests.has(hash)) return;
    state.fileRequests.add(hash);
    gossip({ type: 'file_req', hash });
}

// ------------------------------------------------------- file transfer -----
const incomingFiles = {}; // hash -> {chunks: [], total, name, size, channel}

async function newFiles() {
    const newFiles = document.getElementById('files-input').files;
    for (const f of newFiles) {
        const hash = await hashFile(f);
        const meta = { hash, name: f.name, size: f.size, channel: current_text_channel };
        await store.putFile({ ...meta, blob: f });
        gossip({ type: 'file_meta', file: meta });
        // Post a reference, like the original server did after upload.
        const post = {
            id: uid(), channel: current_text_channel, author: state.self_npub,
            content: `{file:${hash}:${f.name}}`, created_at: Math.floor(Date.now() / 1000),
        };
        await store.putPost(post);
        renderPosts([post]);
        gossip({ type: 'post', post });
    }
    document.getElementById('files-input').value = "";
}

async function receiveFileChunk(msg) {
    let inc = incomingFiles[msg.hash];
    if (!inc) {
        inc = incomingFiles[msg.hash] = { chunks: new Array(msg.total), received: 0, total: msg.total, name: msg.name, size: msg.size, channel: msg.channel };
    }
    if (!inc.chunks[msg.seq]) {
        inc.chunks[msg.seq] = base64ToBuffer(msg.data);
        inc.received++;
    }
    if (inc.received === inc.total) {
        const blob = new Blob(inc.chunks);
        delete incomingFiles[msg.hash];
        // Store the replica: this node can now serve the file to others.
        await store.putFile({ hash: msg.hash, name: inc.name, size: inc.size, channel: inc.channel, blob });
        objectURLs[msg.hash] = URL.createObjectURL(blob);
        state.fileRequests.delete(msg.hash);
        // Hydrate any elements waiting on this file.
        document.querySelectorAll(`[data-hash="${msg.hash}"]`).forEach(el => {
            if (el.tagName === 'A') el.href = objectURLs[msg.hash]; else el.src = objectURLs[msg.hash];
            el.style.opacity = "1";
            el.title = "";
        });
        hydrateAllPfps();
    }
}

async function hashFile(file) {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function base64FromBuffer(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}
function base64ToBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// ---------------------------------------------------------------- users ----
function setUserList() {
    const users = Object.values(state.users).sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    const online = new Set(state.p2p ? state.p2p.connections.keys() : []);
    document.getElementById("user-list").innerHTML = users.map(user => {
        // Green means a live, authenticated direct connection – nothing else.
        const isOnline = user.npub === state.self_npub || online.has(user.npub);
        const st = state.user_status[user.npub] || {};
        const role = user.npub === state.founder_npub ? "👑" : (state.admins.has(user.npub) ? "⭐" : "");
        const flags = `${st.banned ? " 🚫" : ""}${st.restricted ? " 🔇" : ""}`;
        return `<div id="user-${user.npub}" data-id="${user.npub}" class="sidebar-item user">
            <div class="user-info-row" style="display: flex;">
                ${pfpImg(user.npub, 'user-icon')}
                <div style="margin-top: auto; margin-bottom: auto;" title="${user.npub}">
                    ${role}${escapeHtml(user.username || shortNpub(user.npub))}${flags}${user.npub === state.self_npub ? " (you)" : ""}
                </div>
                <div class="user-activity" style="margin-left: auto; padding: 8px;">${isOnline ? "🟢" : "🔴"}</div>
            </div>
        </div>`;
    }).join("");
    hydratePfps(document.getElementById("user-list"));
    document.querySelectorAll('#user-list .user').forEach(el => {
        el.addEventListener('click', () => showUserSettings(el.dataset.id));
    });
}

function setUsername() {
    const name = document.getElementById("rename-username").value.trim();
    if (!name) return;
    state.username = name;
    localStorage.setItem('bombus_username', name);
    state.users[state.self_npub].username = name;
    store.putUser(state.users[state.self_npub]);
    gossip({ type: 'profile', username: name, peers: knownPeers(), pfp: state.users[state.self_npub]?.pfp });
    setUserList();
    document.getElementById("rename-user-subitem").style.display = "none";
    document.getElementById("rename-user").style.display = "block";
}

async function addPeerFromInput() {
    const input = document.getElementById("add-peer-input");
    const status = document.getElementById("add-peer-status");
    const npub = input.value.trim();
    try {
        const decoded = nip19.decode(npub);
        if (decoded.type !== 'npub') throw new Error('not an npub');
    } catch {
        status.innerText = "That doesn't look like a valid npub.";
        return;
    }
    if (npub === state.self_npub) {
        status.innerText = "That's your own npub — add the other person's, not yours.";
        return;
    }
    // Founderless + we add someone: the first peer ever added is the founder.
    if (!state.founder_npub) {
        await setFounder(npub);
        status.innerText = "Peer added — they are the group founder. Connecting…";
    } else {
        status.innerText = "Peer added — connecting…";
    }
    state.added_manually = true;
    store.setMeta('added_manually', true);
    addKnownPeer(npub);
    state.p2p.connect(npub);
    input.value = "";
}

// ---------------------------------------------------------------- voice ----
function setVoiceChannel(channel_id) {
    const ust = myStatus();
    if (ust.banned || ust.restricted) {
        alert(ust.banned ? 'You are banned from this group.' : 'You are restricted from voice chat.');
        return;
    }
    if (current_voice_channel !== -1) {
        gossip({ type: 'vc_leave', channel: current_voice_channel });
        if (state.vc_last_seen[current_voice_channel]) delete state.vc_last_seen[current_voice_channel][state.self_npub];
        vc_teardownAll();
        if (state.vc_channel_users[current_voice_channel]) {
            state.vc_channel_users[current_voice_channel] =
                state.vc_channel_users[current_voice_channel].filter(u => u !== state.self_npub);
        }
    }
    current_voice_channel = current_voice_channel === channel_id ? -1 : channel_id;
    if (current_voice_channel !== -1) {
        if (!state.vc_channel_users[channel_id]) state.vc_channel_users[channel_id] = [];
        const members = [...state.vc_channel_users[channel_id]];
        if (!members.includes(state.self_npub)) state.vc_channel_users[channel_id].push(state.self_npub);
        if (!state.vc_last_seen[channel_id]) state.vc_last_seen[channel_id] = {};
        state.vc_last_seen[channel_id][state.self_npub] = Date.now();
        gossip({ type: 'vc_join', channel: channel_id });
        // Pair up with everyone in the channel (deterministic polarity inside).
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            localStream = stream;
            for (const member of members) vc_maybeOffer(member);
        }).catch(err => {
            console.error('Microphone unavailable:', err);
            alert('Could not access your microphone: ' + err.message);
        });
    }
    setChannelList();
    setVCUsers();
}

function vc_newPeerConnection(npub) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    state.vc_peers[npub] = pc;
    if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.volume = (userVolumePrefs[npub] ?? 1.0) * masterVolume;
        audio.play();
        state.vc_peer_audio[npub] = audio;
    };
    pc.onicecandidate = (event) => {
        if (event.candidate) sendDirect(npub, { type: 'vc_candidate', candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) vc_teardownPeer(npub);
    };
    return pc;
}

// The peer with the lexicographically larger npub initiates; the smaller one
// waits for the offer. Both sides compute the same rule, so exactly one offer
// is made per pair no matter who joins first.
function vc_maybeOffer(npub) {
    if (!npub || npub === state.self_npub) return;
    if (state.vc_peers[npub]) return;
    if (state.self_npub > npub) vc_createPeer(npub, true);
}

async function vc_createPeer(npub, initiator) {
    if (state.vc_peers[npub]) return;
    const pc = vc_newPeerConnection(npub);
    if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendDirect(npub, { type: 'vc_offer', offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    }
}

async function vc_onOffer(from, offer) {
    if (!localStream) {
        try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return; }
    }
    let pc = state.vc_peers[from];
    if (pc) {
        // Glare: we also offered. Larger npub keeps its offer; smaller yields.
        if (state.self_npub > from) return;
        vc_teardownPeer(from);
    }
    pc = vc_newPeerConnection(from);
    await pc.setRemoteDescription(offer);
    vc_flushIce(from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendDirect(from, { type: 'vc_answer', answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
}

async function vc_onAnswer(from, answer) {
    const pc = state.vc_peers[from];
    if (pc) {
        await pc.setRemoteDescription(answer);
        vc_flushIce(from);
    }
}

async function vc_onCandidate(from, candidate) {
    const pc = state.vc_peers[from];
    if (!pc || !pc.remoteDescription) {
        // Too early – buffer until the pc and remote description exist.
        (state.vc_ice_buffer[from] = state.vc_ice_buffer[from] || []).push(candidate);
        return;
    }
    try { await pc.addIceCandidate(candidate); } catch { /* stale */ }
}

function vc_flushIce(npub) {
    const pc = state.vc_peers[npub];
    const buf = state.vc_ice_buffer[npub] || [];
    if (!pc || !pc.remoteDescription || !buf.length) return;
    state.vc_ice_buffer[npub] = [];
    for (const c of buf) pc.addIceCandidate(c).catch(() => {});
}

function vc_teardownPeer(npub) {
    state.vc_peers[npub]?.close();
    delete state.vc_peers[npub];
    state.vc_peer_audio[npub]?.pause();
    delete state.vc_peer_audio[npub];
}

function vc_teardownAll() {
    for (const npub of Object.keys(state.vc_peers)) vc_teardownPeer(npub);
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
}

function setVCUsers() {
    document.querySelectorAll(".channel").forEach(e => {
        const vcUsers = state.vc_channel_users[e.dataset.id] || [];
        const channelUsers = e.querySelector('.channel-users');
        channelUsers.innerHTML = vcUsers.map(npub => `
            <div class="vc-user" data-id="${npub}" style="display:flex;">
                ${pfpImg(npub, 'vc-user-icon')}
                <div class="vc-user-info">
                    <div class="vc-user-username">${escapeHtml(state.users[npub]?.username || shortNpub(npub))}</div>
                    ${npub !== state.self_npub && vcUsers.includes(state.self_npub)
                        ? `<input type="range" min="1" max="100" value="${(userVolumePrefs[npub] ?? 1.0) * 100}" class="volume-slider">` : ``}
                </div>
            </div>`).join("");
        channelUsers.querySelectorAll('.vc-user').forEach(ue => {
            const slider = ue.querySelector('.volume-slider');
            if (slider) slider.addEventListener('change', (ev) => {
                const v = Math.min(Math.max(ev.target.value / 100, 0), 1);
                userVolumePrefs[ue.dataset.id] = v;
                if (state.vc_peer_audio[ue.dataset.id]) state.vc_peer_audio[ue.dataset.id].volume = v * masterVolume;
                localStorage.setItem("userVolumePrefs", JSON.stringify(userVolumePrefs));
            });
        });
    });
}

// ----------------------------------------------------------------- input ---
function handle_input_key(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        let el = e.target;
        while (el) {
            const button = el.querySelector("#send-button, #search-button, #add-channel-add-button, #rename-user-button, #add-peer-button");
            if (button) { button.click(); return; }
            el = el.parentElement;
        }
    }
}

// ------------------------------------------------------------------ boot ---
function load() {
    document.getElementById("main-image").addEventListener('click', () => setTextChannel('general'));
    document.getElementById("add-channel-button").addEventListener('click', toggleCreateChannelDiv);
    document.getElementById("add-channel-add-button").addEventListener("click", toggleCreateChannelDiv);
    document.getElementById("delete-channel-button").addEventListener('click', toggleDeleteChannelDiv);
    document.getElementById("delete-channel-delete-button").addEventListener("click", toggleDeleteChannelDiv);
    document.getElementById('send-button').addEventListener('click', sendPost);
    document.getElementById('search-button').addEventListener('click', search);
    document.addEventListener("keydown", handle_input_key);
    document.getElementById("rename-user").addEventListener('click', () => {
        toggleDiv('rename-user-subitem', 'flex');
        document.getElementById("rename-user").style.display = "none";
    });
    document.getElementById("rename-user-button").addEventListener('click', setUsername);
    document.getElementById("add-peer-button").addEventListener('click', addPeerFromInput);
    document.getElementById("copy-npub-button").addEventListener('click', () => {
        navigator.clipboard.writeText(state.self_npub);
    });
    document.getElementById("copy-nsec-button").addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('my-nsec').value);
    });
    document.getElementById("reveal-nsec-button").addEventListener('click', (e) => {
        const inp = document.getElementById('my-nsec');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        e.target.innerText = show ? 'Hide' : 'Show';
    });
    document.getElementById("sidebar-button").addEventListener('click', () => {
        toggleDiv('sidebar-l', 'inline-block');
        toggleDiv('sidebar-r', 'inline-block');
    });
    document.getElementById("settings-header").addEventListener('click', () => toggleDiv('settings-content'));
    document.getElementById("users-header").addEventListener('click', () => toggleDiv('user-list'));
    document.getElementById("channels-header").addEventListener('click', () => toggleDiv('channels'));
    document.getElementById("files-input").addEventListener('change', newFiles);
    document.getElementById("pfp-input").addEventListener('change', changePfp);
    document.getElementById("change-pfp-button").addEventListener('click', () => pickPfp(state.self_npub));
    const textarea = document.querySelector('#message-box textarea');
    textarea.addEventListener('input', function () {
        this.style.height = '1.5rem';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });
    // Refresh presence dots periodically.
    setInterval(setUserList, 60 * 1000);
}

// ----------------------------------------------------------------- login ---
// Account restore: on a fresh device logged in with an existing identity
// (nsec), the swarm's record of our own profile (username, picture) is more
// authoritative than whatever was typed at login. Adopt the first self-record
// we see (via sync or via a profile/hello from our own npub on another
// device), then stop.
function maybeAdoptSelfProfile(u) {
    if (!state.account_sync_pending || !u || u.npub !== state.self_npub) return;
    state.account_sync_pending = false;
    localStorage.setItem('bombus_account_synced', '1');
    const clean = Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined));
    if (clean.username && clean.username !== state.username) {
        state.username = clean.username;
        localStorage.setItem('bombus_username', clean.username);
        const inp = document.getElementById('rename-username');
        if (inp) inp.value = clean.username;
    }
    state.users[state.self_npub] = { ...state.users[state.self_npub], ...clean, npub: state.self_npub, last_seen: Date.now() };
    store.putUser(state.users[state.self_npub]);
    setUserList();
    hydrateAllPfps();
}

function setupLogin() {
    const overlay = document.getElementById('login-overlay');
    const sk = localStorage.getItem('bombus_sk');
    const username = localStorage.getItem('bombus_username');
    if (sk && username) {
        overlay.remove();
        state.username = username;
        // Auto-login: keep looking for our swarm profile until adopted once.
        state.account_sync_pending = !localStorage.getItem('bombus_account_synced');
        startApp();
        return;
    }
    document.getElementById('login-button').addEventListener('click', () => {
        const name = document.getElementById('login-username').value.trim();
        if (!name) return;
        let key = document.getElementById('login-key').value.trim();
        try {
            if (!key) {
                key = bytesToHex(generateSecretKey());
            } else if (key.startsWith('nsec1')) {
                key = bytesToHex(nip19.decode(key).data);
            } else if (!/^[0-9a-f]{64}$/i.test(key)) {
                document.getElementById('login-error').innerText = "Key must be an nsec… or 64-char hex string.";
                return;
            }
            // Validate.
            getPublicKey(hexToBytes(key));
        } catch {
            document.getElementById('login-error').innerText = "Invalid key.";
            return;
        }
        localStorage.setItem('bombus_sk', key);
        localStorage.setItem('bombus_username', name);
        state.username = name;
        // Manual login: if this is an existing identity, its profile should
        // be restored from the swarm (see maybeAdoptSelfProfile).
        state.account_sync_pending = true;
        overlay.remove();
        startApp();
    });
}

// The same identity must not run in two tabs: both would announce the same
// npub, and peers can't tell them apart (messages dedup by author, signaling
// collides). Takeover protocol: every tab claims ownership via a heartbeat in
// localStorage; when a tab sees a DIFFERENT tab claiming with a timestamp
// newer than its own start time, it yields (disconnects) and shows a banner.
// A stale claim from before this tab started never triggers — so reloading
// the page does not false-positive against the old, dead tab.
function checkMultiTab() {
    const tabId = uid();
    const started = Date.now();
    const claim = () => localStorage.setItem('bombus_tab', JSON.stringify({ id: tabId, ts: Date.now() }));
    claim();
    setInterval(() => {
        let cur = null;
        try { cur = JSON.parse(localStorage.getItem('bombus_tab') || 'null'); } catch { /* ignore */ }
        const otherActive = cur && cur.id !== tabId && cur.ts >= started && Date.now() - cur.ts < 10000;
        if (otherActive) {
            if (!document.getElementById('tab-warning')) {
                try { state.p2p?.close(); } catch { /* ignore */ }
                const warn = document.createElement('div');
                warn.id = 'tab-warning';
                warn.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#a33;color:#fff;text-align:center;padding:8px;';
                warn.innerHTML = 'Bombus P2P is open in another tab with the same identity — this tab disconnected. <button id="tab-takeover" class="btn" style="min-height:0;padding:2px 10px;margin-left:8px;">Use this tab instead</button>';
                document.body.prepend(warn);
                document.getElementById('tab-takeover').addEventListener('click', () => { claim(); location.reload(); });
            }
        } else {
            document.getElementById('tab-warning')?.remove();
            claim();
        }
    }, 4000);
}

document.addEventListener('DOMContentLoaded', () => { load(); setupLogin(); checkMultiTab(); });
window.__state = state;
