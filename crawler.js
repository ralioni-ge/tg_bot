export let client = null;

export function getClient() {
    return client;
}

const MTKRUTO_CDN_URLS = [
    "https://cdn.jsdelivr.net/npm/@mtkruto/browser/esm/mod.js",
    "https://esm.sh/@mtkruto/browser/esm/mod.js",
    "https://unpkg.com/@mtkruto/browser/esm/mod.js"
];

async function loadMtkrutoModule() {
    let lastError = null;
    for (const url of MTKRUTO_CDN_URLS) {
        try {
            return await import(/* webpackIgnore: true */ url);
        } catch (e) {
            console.warn(`Failed to load MTKruto client library from ${url}:`, e);
            lastError = e;
        }
    }
    throw new Error(
        `Could not load the Telegram client library from any CDN (jsDelivr, esm.sh, unpkg). ` +
        `This usually means these domains are blocked or unreachable on your network. ` +
        `Original error: ${lastError ? lastError.message : "unknown"}`
    );
}

export async function initClient(apiId, apiHash, relayUrl) {
    if (!client) {
        const mod = await loadMtkrutoModule();
        const { Client, StorageLocalStorage } = mod;

        const clientParams = {
            storage: new StorageLocalStorage("tg_userbot_session"),
            apiId: parseInt(apiId, 10),
            apiHash: apiHash
        };

        if (relayUrl && relayUrl.trim()) {
            clientParams.transportProvider = buildRelayTransportProvider(relayUrl.trim(), mod);
        }

        client = new Client(clientParams);
    }
    return client;
}

// Builds a transport that routes the MTProto WebSocket connection through a
// self-hosted WebSocket<->TCP relay instead of connecting directly to
// *.web.telegram.org. Useful when the default Telegram WebSocket hosts are
// reachable at the TCP/TLS level but MTProto traffic through them is being
// selectively dropped (DPI-based protocol filtering). The relay itself never
// needs to understand MTProto: it just forwards raw bytes to the real
// Telegram datacenter IP, so all the obfuscation/framing below is identical
// to the library's own default WebSocket transport.
function buildRelayTransportProvider(relayBaseUrl, mod) {
    const { ConnectionWebSocket, TransportIntermediate, getDcId, getDcIps } = mod;
    return ({ dc, isMedia }) => {
        const ip = getDcIps(dc, "ipv4")[0];
        const url = new URL(relayBaseUrl);
        url.searchParams.set("host", ip);
        url.searchParams.set("port", "443");
        const connection = new ConnectionWebSocket(url.toString());
        const dcId = getDcId(dc, isMedia);
        const transport = new TransportIntermediate(connection, { isObfuscated: true, dcId });
        return { connection, transport, dcId };
    };
}

export async function getTelegramMetadata(username) {
    if (!client) {
        return { ok: false, description: "MTProto client is not initialized or connected." };
    }
    
    const cleanUser = username.replace(/https?:\/\/t\.me\//i, '').replace('@', '').split('/')[0];

    try {
        const chat = await client.getChat(cleanUser);
        
        let posts = [];
        try {
            const history = await client.getHistory(cleanUser, { limit: 10 });
            posts = history.map(msg => ({
                text: msg.text || '',
                timestamp: msg.date * 1000, 
                forwardedFrom: msg.forwardFrom && msg.forwardFrom.chat ? msg.forwardFrom.chat.username : null
            }));
        } catch (e) {
            console.warn("Could not retrieve channel history: ", e);
        }

        return {
            ok: true,
            title: chat.title || cleanUser,
            description: chat.description || '',
            subscribers: chat.membersCount || 0,
            posts: posts,
            status: 'alive'
        };
    } catch (e) {
        return { ok: false, description: e.message };
    }
}

export function detectTextLanguage(text) {
    if (!text) return 'Unknown';
    const arabicPersianPattern = /[\u0600-\u06FF]/;
    const cyrillicPattern = /[\u0400-\u04FF]/;
    
    let scoreArFa = 0;
    let scoreCyr = 0;
    let textSample = text.slice(0, 1000);

    for (let char of textSample) {
        if (arabicPersianPattern.test(char)) scoreArFa++;
        else if (cyrillicPattern.test(char)) scoreCyr++;
    }

    if (scoreArFa > (textSample.length * 0.1)) return 'Arabic/Persian';
    if (scoreCyr > (textSample.length * 0.1)) return 'Cyrillic/Russian';
    return 'English/Latin';
}

export function analyzeUrl(url) {
    let base_link = url.trim();
    let type = "web";
    let chat_id = null;

    const privateMatch = url.match(/t\.me\/c\/([0-9]+)/i);
    const publicMatch = url.match(/t\.me\/([a-zA-Z0-9_]+)/i);

    if (privateMatch) {
        const rawId = privateMatch[1];
        type = "telegram";
        base_link = `https://t.me/c/${rawId}`;
        chat_id = `-100${rawId}`;
    } else if (publicMatch && publicMatch[1].toLowerCase() !== "c") {
        const username = publicMatch[1];
        type = "telegram";
        base_link = `https://t.me/${username}`;
    }
    return { base_link, type, chat_id };
}

export async function processBulkInput(text) {
    const matches = [...text.matchAll(/(https?:\/\/[^\s]+|t\.me\/[^\s]+|@[a-zA-Z0-9_]+)/g)];
    const results = [];

    for (const m of matches) {
        let raw = m[0];
        let url = raw;
        if (raw.startsWith("@")) {
            url = `https://t.me/${raw.slice(1)}`;
        } else if (!raw.startsWith("http")) {
            url = `https://${raw}`;
        }

        const parsed = analyzeUrl(url);
        let title = url;

        if (parsed.type === "telegram" && client) {
            try {
                const target = parsed.chat_id || `@${url.split('t.me/')[1]}`;
                const info = await client.getChat(target);
                if (info) {
                    title = info.title || title;
                }
            } catch (_) {}
        }

        results.push({
            original_link: url,
            base_link: parsed.base_link,
            title: title,
            chat_id: parsed.chat_id,
            type: parsed.type,
            group_link: null,
            status: 'alive',
            subscribers: 0,
            post_count: 0,
            language: 'Unknown',
            description: ''
        });
    }
    return results;
}