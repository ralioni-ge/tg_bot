import { getLinks, saveLinks, getCategories } from './storage.js';
import { getTelegramMetadata, detectTextLanguage } from './crawler.js';
import { renderLinksTable, updateHeaderFilterOptions, openModal, closeModal, escapeHtml } from './ui.js';
import { state } from './state.js';

function getSelectedElementsOrHalt() {
    const checkedBoxes = document.querySelectorAll('.link-checkbox:checked');
    if (checkedBoxes.length === 0) {
        alert('Action Cancelled: You must check/select at least one bookmark from the workspace list to proceed.');
        return null;
    }
    const links = getLinks();
    return Array.from(checkedBoxes).map(box => {
        const idx = parseInt(box.dataset.index, 10);
        return { globalIndex: idx, item: links[idx] };
    });
}

function showSyncLog(msg) {
    const consoleBox = document.getElementById('sync-console');
    if (!consoleBox) return;
    const time = new Date().toLocaleTimeString();
    consoleBox.innerHTML += `\n[${time}] ${msg}`;
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

function updateProgressBar(current, total) {
    const fill = document.getElementById('sync-progress-fill');
    const text = document.getElementById('sync-progress-text');
    const percent = document.getElementById('sync-progress-percent');

    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fill.style.width = `${pct}%`;
    text.textContent = `Processing: ${current}/${total}`;
    percent.textContent = `${pct}%`;
}

export async function executeSelectedMetricsSync() {
    const selected = getSelectedElementsOrHalt();
    if (!selected) return;

    const telegramItems = selected.filter(s => s.item.type === 'telegram');
    if (telegramItems.length === 0) {
        alert('Selected items do not contain public Telegram channels.');
        return;
    }

    document.getElementById('automation-title-display').textContent = "Updating Selected Metrics";
    openModal('modal-automation-container');
    showSyncLog(`Initiating metadata metrics updating on ${telegramItems.length} selected targets...`);
    
    let count = 0;
    const links = getLinks();

    for (let target of telegramItems) {
        count++;
        updateProgressBar(count, telegramItems.length);
        
        const username = target.item.base_link.split('t.me/')[1];
        if (!username || username.startsWith('c/')) continue;

        showSyncLog(`Querying details via MTProto for: @${username}`);
        const info = await getTelegramMetadata(username);
        
        if (info.ok) {
            links[target.globalIndex].subscribers = info.subscribers || links[target.globalIndex].subscribers;
            links[target.globalIndex].post_count = info.posts ? info.posts.length : links[target.globalIndex].post_count;
            links[target.globalIndex].status = 'alive';
            links[target.globalIndex].timestamp = Date.now();
            showSyncLog(`Success! Subscribers: ${info.subscribers}, Posts parsed: ${info.posts ? info.posts.length : 0}`);
        } else {
            links[target.globalIndex].status = 'dead';
            showSyncLog(`Access Failed for @${username}: ${info.description}`);
        }
        
        saveLinks(links);
        renderLinksTable();
        await new Promise(r => setTimeout(r, 400));
    }
    showSyncLog('✅ Selected metrics sync complete.');
    updateHeaderFilterOptions();
}

export async function executeSelectedRecencyVerify() {
    const selected = getSelectedElementsOrHalt();
    if (!selected) return;

    const telegramItems = selected.filter(s => s.item.type === 'telegram');
    if (telegramItems.length === 0) return alert('No Telegram entries found.');

    const inputDate = prompt("Check for updates since what date? (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
    if (!inputDate) return;

    const threshold = new Date(inputDate).getTime();
    if (isNaN(threshold)) return alert("Invalid date format entered.");

    document.getElementById('automation-title-display').textContent = "Checking Content Recency";
    openModal('modal-automation-container');
    showSyncLog(`Scanning ${telegramItems.length} checked elements for posts since ${inputDate}...`);

    let count = 0;
    const links = getLinks();

    for (let target of telegramItems) {
        count++;
        updateProgressBar(count, telegramItems.length);

        const username = target.item.base_link.split('t.me/')[1];
        if (!username || username.startsWith('c/')) continue;

        const info = await getTelegramMetadata(username);
        if (info.ok && info.posts && info.posts.length > 0) {
            const lastPostTime = Math.max(...info.posts.map(p => p.timestamp || 0));
            if (lastPostTime >= threshold) {
                showSyncLog(`[ACTIVE] @${username} has published posts after your threshold date.`);
                links[target.globalIndex].status = 'alive';
            } else {
                showSyncLog(`[STALE] @${username} has NO active publications since threshold.`);
                links[target.globalIndex].status = 'dead';
            }
        } else {
            showSyncLog(`[STALE/INACCESSIBLE] @${username} could not be analyzed.`);
            links[target.globalIndex].status = 'dead';
        }
        saveLinks(links);
        renderLinksTable();
        await new Promise(r => setTimeout(r, 400));
    }
    showSyncLog('✅ Recency scan task completed.');
}

export async function executeSelectedLanguageClassify() {
    const selected = getSelectedElementsOrHalt();
    if (!selected) return;

    const telegramItems = selected.filter(s => s.item.type === 'telegram');
    if (telegramItems.length === 0) return alert('No Telegram entries checked.');

    document.getElementById('automation-title-display').textContent = "Running Language Classifiers";
    openModal('modal-automation-container');
    showSyncLog(`Initializing language classification on ${telegramItems.length} selected components...`);

    let count = 0;
    const links = getLinks();

    for (let target of telegramItems) {
        count++;
        updateProgressBar(count, telegramItems.length);

        const username = target.item.base_link.split('t.me/')[1];
        if (!username || username.startsWith('c/')) continue;

        const info = await getTelegramMetadata(username);
        if (info.ok && info.posts && info.posts.length > 0) {
            const combinedText = info.posts.map(p => p.text).join(' ');
            const lang = detectTextLanguage(combinedText);
            links[target.globalIndex].language = lang;
            showSyncLog(`Channel @${username} language: ${lang}`);
        } else {
            showSyncLog(`Inaccessible/No posts for language classification on @${username}`);
        }
        saveLinks(links);
        renderLinksTable();
        updateHeaderFilterOptions();
        await new Promise(r => setTimeout(r, 400));
    }
    showSyncLog('✅ Language diagnostics completed.');
}

export async function executeSelectedDescriptionScrape() {
    const selected = getSelectedElementsOrHalt();
    if (!selected) return;

    const telegramItems = selected.filter(s => s.item.type === 'telegram');
    if (telegramItems.length === 0) return alert('No Telegram entries checked.');

    document.getElementById('automation-title-display').textContent = "Extracting Bios / Descriptions";
    openModal('modal-automation-container');
    showSyncLog(`Retrieving channel description contexts for ${telegramItems.length} targets...`);

    let count = 0;
    const links = getLinks();

    for (let target of telegramItems) {
        count++;
        updateProgressBar(count, telegramItems.length);

        const username = target.item.base_link.split('t.me/')[1];
        if (!username || username.startsWith('c/')) continue;

        const info = await getTelegramMetadata(username);
        if (info.ok) {
            links[target.globalIndex].description = info.description || 'No description found';
            showSyncLog(`Description captured for @${username}`);
        } else {
            showSyncLog(`Failed fetching bio details for @${username}`);
        }
        saveLinks(links);
        renderLinksTable();
        await new Promise(r => setTimeout(r, 400));
    }
    showSyncLog('✅ Biography scraping complete.');
}

export async function executeSelectedDiscoveryCrawl() {
    const selected = getSelectedElementsOrHalt();
    if (!selected) return;

    const telegramItems = selected.filter(s => s.item.type === 'telegram');
    if (telegramItems.length === 0) return alert('No Telegram elements checked.');

    const postsCountToCheck = parseInt(prompt("Verify forwarding sources across how many recent posts? (1-10):", "5"), 10);
    if (isNaN(postsCountToCheck) || postsCountToCheck < 1) return;

    document.getElementById('automation-title-display').textContent = "Scanning For Forwards";
    openModal('modal-automation-container');
    showSyncLog(`Checking forwarding attributes of the last ${postsCountToCheck} posts in ${telegramItems.length} checked channels...`);

    state.discoveredBuffer = [];
    let count = 0;
    const links = getLinks();

    for (let target of telegramItems) {
        count++;
        updateProgressBar(count, telegramItems.length);

        const username = target.item.base_link.split('t.me/')[1];
        if (!username || username.startsWith('c/')) continue;

        const info = await getTelegramMetadata(username);
        if (info.ok && info.posts) {
            const samplePosts = info.posts.slice(-postsCountToCheck);
            samplePosts.forEach(post => {
                if (post.forwardedFrom) {
                    const cleanHandle = post.forwardedFrom.replace(/https?:\/\/t\.me\//i, '').replace('@', '').split('/')[0];
                    if (cleanHandle && cleanHandle.toLowerCase() !== 'c') {
                        const formattedLink = `https://t.me/${cleanHandle}`;
                        
                        const existsLocally = links.some(l => l.base_link.toLowerCase() === formattedLink.toLowerCase());
                        const inBuffer = state.discoveredBuffer.some(d => d.handle.toLowerCase() === cleanHandle.toLowerCase());

                        if (!existsLocally && !inBuffer) {
                            state.discoveredBuffer.push({
                                handle: cleanHandle,
                                source: `@${username}`
                            });
                            showSyncLog(`Discovered new path: @${cleanHandle} (Forwarded by @${username})`);
                        }
                    }
                }
            });
        }
        await new Promise(r => setTimeout(r, 400));
    }

    closeModal('modal-automation-container');
    const discBody = document.getElementById('discovery-results-body');
    const discDropdown = document.getElementById('discovered-target-category');

    if (state.discoveredBuffer.length > 0) {
        discBody.innerHTML = '';
        const cats = getCategories();
        discDropdown.innerHTML = '';
        cats.forEach(c => {
            discDropdown.innerHTML += `<option value="${escapeHtml(c.path)}">${escapeHtml(c.path)}</option>`;
        });

        state.discoveredBuffer.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="discovered-checkbox" data-idx="${idx}" checked></td>
                <td><strong style="color:var(--primary);">@${escapeHtml(item.handle)}</strong></td>
                <td>Forwarded from ${escapeHtml(item.source)}</td>
            `;
            discBody.appendChild(tr);
        });
        openModal('modal-discovery-container');
    } else {
        alert('Discovery completed: Zero unrecognized forwarding tracks discovered.');
    }
}