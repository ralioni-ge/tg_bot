// Cloudflare Worker: WebSocket <-> TCP relay for MTProto traffic.
//
// WHY THIS EXISTS
// Some networks let a WebSocket connection open just fine but then silently
// drop the MTProto bytes flowing through it (deep packet inspection that
// fingerprints the protocol rather than blocking the destination outright).
// This Worker runs on Cloudflare's edge, which the filtering does not apply
// to. The browser opens a plain WSS connection to this Worker (indistinguishable
// from any other websocket traffic, and already served over Cloudflare's own
// TLS), and the Worker pipes the raw bytes on to the real Telegram datacenter
// over a genuine TCP socket using the Workers connect() API. It never parses
// or understands MTProto - it's a dumb byte pipe, which is exactly why it
// isn't fingerprintable the same way a direct MTProto connection is.
//
// SECURITY
// The allowlist below only permits connections to Telegram's own published
// datacenter IPs on port 443. This keeps the Worker from being abused as an
// open proxy to arbitrary destinations. Do not remove the allowlist.

import { connect } from "cloudflare:sockets";

// Telegram's official production datacenter IPv4 addresses.
// (Matches what @mtkruto/browser's getDcIps("ipv4") returns.)
const ALLOWED_TARGETS = new Set([
    "149.154.175.50",  // DC1
    "149.154.167.51",  // DC2
    "95.161.76.100",   // DC2 (alt)
    "149.154.175.100", // DC3
    "149.154.167.91",  // DC4
    "149.154.171.5",   // DC5
]);
const ALLOWED_PORT = 443;

export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname !== "/tcp") {
            return new Response("Not found", { status: 404 });
        }

        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
            return new Response("Expected a WebSocket upgrade request", { status: 426 });
        }

        const host = url.searchParams.get("host");
        const port = parseInt(url.searchParams.get("port") || "0", 10);

        if (!ALLOWED_TARGETS.has(host) || port !== ALLOWED_PORT) {
            return new Response("Target not allowed", { status: 403 });
        }

        let socket;
        try {
            socket = connect({ hostname: host, port });
        } catch (err) {
            return new Response(`TCP connect failed: ${err}`, { status: 502 });
        }

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        server.accept();

        const writer = socket.writable.getWriter();

        // TCP -> WebSocket
        (async () => {
            const reader = socket.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (server.readyState === WebSocket.READY_STATE_OPEN) {
                        server.send(value);
                    } else {
                        break;
                    }
                }
            } catch (err) {
                console.warn("TCP read loop ended:", err);
            } finally {
                try { server.close(); } catch (_) {}
            }
        })();

        // WebSocket -> TCP
        server.addEventListener("message", async (event) => {
            try {
                let data = event.data;
                if (data instanceof Blob) {
                    data = new Uint8Array(await data.arrayBuffer());
                } else if (data instanceof ArrayBuffer) {
                    data = new Uint8Array(data);
                } else if (typeof data === "string") {
                    return; // MTProto traffic is always binary; ignore stray text frames.
                }
                await writer.write(data);
            } catch (err) {
                console.warn("WebSocket -> TCP write failed:", err);
            }
        });

        const cleanup = () => {
            socket.close().catch(() => {});
        };
        server.addEventListener("close", cleanup);
        server.addEventListener("error", cleanup);

        return new Response(null, { status: 101, webSocket: client });
    },
};
