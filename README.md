# PEAK in the browser

[Open PEAK](https://rawcdn.githack.com/xXROCHETXx/peak-online/web-v4/site/index.html)

This repository publishes the browser client, not the native development tools. The link opens the game directly. The HTML host may display an initial confirmation before opening the page.

## Playing with friends

1. Wait for PEAK to load, edit your name if desired, and click **Create room** in the room panel. This starts the airport.
2. Share the **six-character room code** or use **Copy invite link**.
3. Friends open the same version of the page, enter the code, and click **Join room**. An invite link fills the code automatically.

Each room supports four players. Its host tab runs the room broker for that group and must remain open while playing. Creating a room does not turn that computer into a server for everyone visiting the page. No account, Photon App ID, native launcher, or public host URL is needed for these browser rooms.

Codes mix uppercase letters and digits, omitting I, O, 0, and 1 for readability. Player names default to local English adjective-and-animal combinations such as **Sleepy Capybara** or **Dramatic Goose**. Names are editable; **Randomize name** generates another one without calling an external service.

The microphone defaults to **PEAK controls** and **Lower latency**. Enable it in the panel and grant browser permission. The existing native voice codec and playback bridge are retained. Use headphones when testing two windows on one computer.

## Transport

PeerJS 1.5.5 and the public PeerJS Cloud service provide room discovery and WebRTC negotiation. Game and voice packets travel through WebRTC data channels to the room's host. Discovery therefore needs internet access even though the room broker runs in the host tab. The host closing the page ends the room; automatic host migration is not implemented.

The adapter preserves the native Photon GpBinaryV18 packets, room properties, cached game events, and separate voice room. Some network configurations may need a TURN relay; a successful connection on one network does not guarantee connectivity through every NAT or firewall. Legacy invitations containing an explicit `server` URL still use the earlier host-server route.

## Static publication and loading

Only `site/` is deployed. HTML is served through raw.githack; scripts and styles use pinned jsDelivr URLs. Version `web-v4` adds browser rooms and the English interface. Unchanged WASM, framework, voice pump, playback, and CSS URLs remain pinned to `web-v2` to reuse existing caches.

Original game data and level bundles are fetched from [wasmdotrip/Peak-Port](https://github.com/wasmdotrip/Peak-Port), pinned to `f1924c4fcd0099172f50f8d2a5273fda12fa1444`. The loader downloads four data parts concurrently, fetches the framework and compressed WASM in parallel, checks file lengths, and reuses complete files through Cache Storage when available. Interrupted attempts do not duplicate bytes. The initial client download is approximately 261 MB, followed by Unity startup; later level loads fetch additional bundles.

This follows the static-page/CDN arrangement used by the [original PEAK port](https://github.com/wasmdotrip/wasm.rip/blob/main/files/peak/PEAK.html) and [Dasher's ports](https://github.com/dashiellbenton/ports/blob/main/.github/workflows/static.yml).

The GitHub Pages workflow is retained, but its previous deployment was [blocked by an account billing lock](https://github.com/xXROCHETXx/peak-online/actions/runs/39722120348). The CDN link above is independent of that workflow.

## Validation

- 31 local checks cover the loader, invitations, room controls, random names/codes, broker routing, voice packets, reconnection, and connection cleanup.
- 18 protocol checks from the earlier local-server suite pass against the browser broker, including cached data, targeted events, actor properties, capacity, and the separate voice room.
- A live integration check with PeerJS Cloud and native WebRTC in Node passed room discovery, the Photon master/game handoff, joining, and bidirectional event routing. A 200 KB packet survived data-channel fragmentation byte for byte. Both endpoints ran on one computer.

These checks do not exercise Unity rendering or establish a complete two-computer game session. The unchanged game binary previously passed local movement and microphone tests; the new browser transport still needs a full in-game check between two computers.

## Credits

Original browser port by Dasher. PEAK by Aggro Crab and Landfall. See [third-party components and licenses](site/THIRD-PARTY.md), including the GPL-3.0-only room-broker source adaptation.
