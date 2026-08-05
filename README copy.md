# Bombus P2P

A peer-to-peer port of [Bombus](https://github.com/HommelWater/Bombus), the
self-hostable bumblebee chat. There is **no server**: the whole app is a static
page, and every node is an equal peer.

## How it works

| Concern | Original (client-server) | This port (P2P) |
| --- | --- | --- |
| Identity | username + TOTP + sessions on the server | a Nostr keypair (`nsec`), generated in the browser |
| Transport | WebSocket to `server.py` | WebRTC data channels between browsers |
| Signaling | — | Nostr relays (ephemeral kind-25000 events, NIP-44 encrypted) via the `NostrP2P` library |
| Storage | SQLite on the server | **full replica in every browser** (IndexedDB) |
| Files | uploaded to the server | content-addressed (SHA-256), fetched from any peer that has a copy |
| Voice | server-relayed WebRTC mesh | WebRTC mesh, signaling routed through the data-channel mesh |

## Redundancy

1. **Full replication** — every node stores every channel, post and file it has
   ever seen. Any peer can serve any data to any other peer.
2. **Gossip flooding** — new posts/channels/files are broadcast with a
   seen-set + TTL, so data travels beyond direct neighbors and reaches the
   whole mesh even when it is not fully connected.
3. **Anti-entropy sync** — on every new connection (and every 2 minutes with a
   random peer) nodes exchange their replica state, so a node that was offline
   heals automatically when it returns.
4. **Content-addressed files** — when a post references `{file:hash:name}` and
   the local replica doesn't have the blob, it is requested from the mesh;
   whoever has a copy answers, and the requester becomes a new copy.
5. **Relayed directed messages** — voice-chat signaling and file chunks
   addressed to a specific peer are relayed through the mesh when there is no
   direct connection.

Verified end-to-end: two nodes connect via a Nostr relay, exchange posts in
both directions, a wiped node rejoins and receives full history from sync, a
~300 KB image posted by one node is fetched chunk-by-chunk and rendered by the
other, and two nodes in the same voice channel end up with a connected
WebRTC audio mesh (both receive the remote track).

## Running it

Serve the folder with any static file server and open it in two browsers:

```bash
cd p2p
python3 -m http.server 8080
```

1. Pick a display name; leave the key field empty to generate a fresh identity
   (or paste an existing `nsec…`/hex key to keep your identity).
2. Copy your `npub` from Settings and share it with a friend; add theirs with
   **Add Peer**. From then on, peer discovery is automatic (peers gossip their
   peer lists).
3. Chat, create channels, share files, or hop into voice with the 🎤 button.

All dependencies are vendored locally (`nostr-deps.js`) — no CDN or internet
access is needed to load the app itself; only the Nostr relays need to be
reachable for peers to find each other.

Public relays are used by default (`relay.damus.io`, `nos.lol`,
`relay.nostr.band`). To use your own relay (recommended for a private swarm),
set `localStorage.nostr_p2p_relays = '["wss://your.relay"]'` before loading,
or pass `relays` in the `NostrP2P` options.

## Admin & moderation

The **founder** is simply the first peer anyone ever adds: when you add
someone's npub while the group has no founder, they become it; when someone
connects to you and you never added anyone, you are it. Founder claims from
hello/sync are adopted while founderless, and the lexicographically smallest
claim always wins — so if founder state ever diverges (a wiped device
re-founding itself), the group converges back to one founder automatically
instead of splitting into two permanent "admins".

Moderation mirrors the original server-based Bombus, with signatures instead
of a server: every action is only honored when signed by an admin (the
library verifies each message's schnorr signature, so `msg.sender` is
cryptographically authentic).

- **Make/Remove Admin** — the founder can promote others; admins can moderate
  too. The founder is untouchable.
- **Ban/Unban** — banned users' posts are dropped by every client (old posts
  stay in history); their own client refuses to send.
- **Restrict/Unrestrict** — restricted users can't join voice, and peers
  refuse to pair with them.
- **Create/Delete channels** — admin-only, as in the original.
- **Rename** — admins can rename any user.

Admins see a moderation menu when clicking a user in the Users list; roles
(👑 founder, ⭐ admin, 🚫 banned, 🔇 restricted) are shown next to names and
propagate via gossip + sync.

## Troubleshooting

The peer status line in Settings tells you what's going on:

- **"Not connected — add someone's npub below"** — you haven't added any peer
  yet. One side must add the other side's npub (not their own — the app warns
  if you paste your own). After that, connection takes up to ~30 s over public
  relays.
- **"Not connected — trying to reach N known peers…"** — the peer is known but
  the WebRTC link hasn't come up. Check that both sides are actually online
  and can reach the Nostr relays (corporate networks sometimes block `wss://`
  and/or UDP — the latter breaks WebRTC).
- **"Connected to N peers" but you can't see each other** — make sure you
  don't have the app open in two tabs with the same identity (the app shows a
  red banner if so): two tabs share one npub and peers can't tell them apart,
  which makes you invisible to each other.

If you run a private swarm, pointing everyone at one self-hosted relay
(`localStorage.nostr_p2p_relays`) makes joins much faster and more reliable
than the public defaults.

## Not ported (by design)

- Push notifications (impossible without a server, as expected)
- TOTP/invite codes, admin moderation, profile-picture hosting, the search engine
- The browser extension

## UI

Same theme system and color schemes as the original (light/dark toggle kept),
unified flat controls (no border radius anywhere), responsive mobile layout
(sidebars collapse behind the ☰ menu, larger tap targets). Profile pictures
are back: set yours in Settings, shown in the user list, posts and voice
channels; blobs are content-addressed and fetched from peers like any file.
Admins can change anyone's picture from the user moderation menu.

## Mobile / phones

The app is installable (PWA manifest + service worker): on Android Chrome use
"Add to Home screen", on iOS Safari use Share → Add to Home Screen. It then
opens fullscreen like a native app and the shell loads even while offline.

Phones freeze background pages (screen lock, app switch), which kills timers
and half-kills WebRTC transports. The client handles this explicitly:

- `resume()` re-establishes the relay subscription, challenges every session
  with a ping (sessions that don't answer within a tick are dropped), and
  refills connections immediately.
- It is triggered by `visibilitychange`, the page-freeze `resume` event,
  `pageshow` (bfcache restore) and the `online` event (network switches).
- Worst case, the traffic-based liveness check (50s silence) and
  replace-on-offer reconnect everything anyway — reopening the site always
  gets you back into the swarm within seconds.

Moving the account to another device: Settings shows your **nsec** (masked,
with reveal/copy buttons). Log in with it on the new device and the account
profile (username, profile picture) is automatically restored from the
swarm's replica on the first sync. The nsec is the whole identity — keep it
secret. The layout also respects iPhone safe areas (notch / Dynamic Island /
home indicator) and disables rubber-band overscroll.

## Library fixes

`nostr-p2p.js` started as the original `NostrP2P` library and has since been
rewritten around a **single per-peer session state machine** (one `sessions`
map, `connecting` → `connected`), replacing the original dual pending/active
maps whose seams caused most of the connection bugs:

- messages are serialized before `channel.send` (and string payloads parsed so
  `sender`/`signature` stamping no longer throws in strict mode)
- auth events verify the schnorr signature + event id before a session is
  promoted to `connected`; `onConnect`/`onDisconnect` fire exactly once per
  session lifecycle
- **glare resolution** (both sides offering simultaneously) via deterministic
  npub ordering, per-peer serialized signal handling, and offer dedup by
  timestamp so redelivered signals can never tear down a healthy link
- a genuinely new offer **replaces** the existing session (the peer restarted
  or its pc died silently) instead of being ignored — this is what lets a
  reloaded/crashed client always get back in
- **liveness is measured by traffic, not ICE state**: sessions ping every 15s
  and any session silent for 50s is dropped, so ghost peers (dead but
  channel still reading `open`, common in throttled tabs) disappear within a
  minute instead of forever; transient ICE `disconnected` no longer kills
  healthy sessions either
- **fast reconnect**: handshakes time out after 15s and are retried almost
  immediately; offers older than the handshake timeout are ignored (relay
  replays can no longer break a fresh connection); an incomplete answering
  session is replaced by the peer's fresh offer instead of blocking it.
  Reopening both apps reconnects in seconds
- known peers are persisted on every successful connection, so reopening the
  app has someone to call
- the user-list 🟢 means *directly connected right now* — mesh-relayed
  traffic no longer lights it
- relay subscription is re-established periodically (initial subscribe can race
  the relay handshake), and the relay list is configurable
- `open` mode: nodes accept signaling from unknown peers so new members can
  join an existing swarm

## App-layer fixes (voice + files)

- **Voice chat was silently dead**: `vc_offer`/`vc_answer`/`vc_candidate`
  carried raw `RTCSessionDescription`/`RTCIceCandidate` objects, which have no
  enumerable properties — the payload-signature canonicalization therefore
  differed after the JSON round trip and every voice message was dropped on
  arrival. They are now serialized to plain JSON first.
- **Voice joins are race-free**: instead of "newcomer offers to whoever it
  happens to know", each pair uses deterministic polarity (larger npub offers),
  evaluated both on join and on every `vc_join` received, with glare handling
  and early-ICE buffering.
- **Files/images over ~190 KB never transferred**: 256 KB chunks became ~350 KB
  base64 messages, exceeding the RTCDataChannel max message size. Chunks are
  now 48 KB.
- Mic failures now surface a visible error instead of failing silently.
- **Voice membership is self-healing**: vc state used to be built only from
  one-shot `vc_join` messages, so a single lost message (reload, reconnect,
  slow relay) left the channel user list permanently inconsistent. Now
  membership is heartbeated every 15 s, members that stop heartbeating expire
  after 45 s, and missing/failed voice connections are retried every cycle.
- Module URLs are cache-busted so browsers pick up new builds.
- **Visibility + self-healing for discovery**: profile/peer gossip now
  heartbeats (a lost one-shot `hello` used to make a peer invisible forever),
  Settings shows live peer-connection status, adding your own npub is caught
  with a warning, and a red banner warns if the same identity is open in
  multiple tabs (which breaks P2P identity).
