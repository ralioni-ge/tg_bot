import { STORAGE_KEYS, getCategories, getLinks, saveCategories, saveLinks, updateStats, normalizeLinkIndexes } from './storage.js';
import { initClient, client, getClient, processBulkInput, analyzeUrl } from './crawler.js';
import { renderCategoryTree, renderLinksTable, updateBulkDropdown, updateHeaderFilterOptions, openModal, closeModal, escapeHtml } from './ui.js';
import { parseNetscapeBookmarks, generateNetscapeHTML } from './parser.js';
import { 
    executeSelectedMetricsSync, 
    executeSelectedRecencyVerify, 
    executeSelectedLanguageClassify, 
    executeSelectedDescriptionScrape, 
    executeSelectedDiscoveryCrawl
} from './automation.js';
import { state } from './state.js';

let phoneCodeResolver = null;
let password2FAResolver = null;

async function attemptAutoLogin() {
    const savedId = localStorage.getItem(STORAGE_KEYS.API_ID);
    const savedHash = localStorage.getItem(STORAGE_KEYS.API_HASH);
    
    if (savedId && savedHash) {
        document.getElementById('api-id').value = savedId;
        document.getElementById('api-hash').value = savedHash;
        document.getElementById('api-phone').value = localStorage.getItem(STORAGE_KEYS.API_PHONE) || '';
        const savedRelay = localStorage.getItem(STORAGE_KEYS.API_RELAY) || '';
        document.getElementById('api-relay').value = savedRelay;

        const authStatus = document.getElementById('auth-status');
        authStatus.textContent = "Status: Connecting to Telegram servers... ⏳";
        
        try {
            const clientInstance = await initClient(savedId, savedHash, savedRelay);
            await clientInstance.connect();
            
            const me = await clientInstance.getMe();
            if (me) {
                authStatus.textContent = `Status: Connected as @${me.username || me.firstName}`;
                document.getElementById('btn-logout-client').style.display = 'block';
                document.getElementById('btn-connect-client').textContent = 'Userbot Connected';
                document.getElementById('btn-connect-client').disabled = true;
            } else {
                authStatus.textContent = "Status: Disconnected";
            }
        } catch (_) {
            authStatus.textContent = "Status: Disconnected";
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    normalizeLinkIndexes();
    attemptAutoLogin();

    // Collapsible Category list
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            const drawer = document.getElementById('sidebar-drawer');
            drawer.classList.add('collapsed');
            document.getElementById('sidebar-expand').style.display = 'inline-flex';
        });
    }

    const sidebarExpand = document.getElementById('sidebar-expand');
    if (sidebarExpand) {
        sidebarExpand.addEventListener('click', () => {
            const drawer = document.getElementById('sidebar-drawer');
            drawer.classList.remove('collapsed');
            document.getElementById('sidebar-expand').style.display = 'none';
        });
    }

    // Dropdown triggers [1]
    document.querySelectorAll('.dropdown-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const parent = trigger.parentElement;
            const isOpen = parent.classList.contains('open');
            document.querySelectorAll('.dropdown').forEach(dd => dd.classList.remove('open'));
            if (!isOpen) {
                parent.classList.add('open');
            }
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown').forEach(dd => dd.classList.remove('open'));
    });

    document.querySelectorAll('.dropdown-content').forEach(content => {
        content.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });

    // MTProto Direct Login Hook
    const btnConnect = document.getElementById('btn-connect-client');
    if (btnConnect) {
        btnConnect.addEventListener('click', async () => {
            const apiId = document.getElementById('api-id').value.trim();
            const apiHash = document.getElementById('api-hash').value.trim();
            const apiPhone = document.getElementById('api-phone').value.trim();
            const apiRelay = document.getElementById('api-relay').value.trim();

            if (!apiId || !apiHash || !apiPhone) {
                return alert("API ID, API Hash, and Phone Number are required.");
            }

            localStorage.setItem(STORAGE_KEYS.API_ID, apiId);
            localStorage.setItem(STORAGE_KEYS.API_HASH, apiHash);
            localStorage.setItem(STORAGE_KEYS.API_PHONE, apiPhone);
            if (apiRelay) {
                localStorage.setItem(STORAGE_KEYS.API_RELAY, apiRelay);
            } else {
                localStorage.removeItem(STORAGE_KEYS.API_RELAY);
            }

            const authStatus = document.getElementById('auth-status');
            authStatus.textContent = apiRelay ? "Status: Initializing connection handshake via relay... ⏳" : "Status: Initializing connection handshake... ⏳";

            try {
                const clientInstance = await initClient(apiId, apiHash, apiRelay);
                
                await clientInstance.start({
                    phone: () => apiPhone,
                    code: () => new Promise(resolve => {
                        document.getElementById('auth-step-verification').style.display = 'block';
                        authStatus.textContent = "Status: Enter verification code.";
                        phoneCodeResolver = resolve;
                    }),
                    password: () => new Promise(resolve => {
                        document.getElementById('auth-step-2fa').style.display = 'block';
                        authStatus.textContent = "Status: Enter 2FA Password.";
                        password2FAResolver = resolve;
                    })
                });

                const me = await clientInstance.getMe();
                if (me) {
                    authStatus.textContent = `Status: Connected as @${me.username || me.firstName}`;
                    document.getElementById('btn-logout-client').style.display = 'block';
                    document.getElementById('btn-connect-client').textContent = 'Userbot Connected';
                    document.getElementById('btn-connect-client').disabled = true;
                    alert("Userbot Client successfully authenticated!");
                }
            } catch (e) {
                authStatus.textContent = `Error: ${e.message}`;
                alert(`Auth Error: ${e.message}`);
            }
        });
    }

    const btnSubmitCode = document.getElementById('btn-submit-code');
    if (btnSubmitCode) {
        btnSubmitCode.addEventListener('click', () => {
            const code = document.getElementById('auth-code').value.trim();
            if (!code) return alert("Code cannot be empty.");
            if (phoneCodeResolver) {
                phoneCodeResolver(code);
                document.getElementById('auth-step-verification').style.display = 'none';
            }
        });
    }

    const btnSubmit2fa = document.getElementById('btn-submit-2fa');
    if (btnSubmit2fa) {
        btnSubmit2fa.addEventListener('click', () => {
            const pwd = document.getElementById('auth-2fa').value.trim();
            if (!pwd) return alert("Password cannot be empty.");
            if (password2FAResolver) {
                password2FAResolver(pwd);
                document.getElementById('auth-step-2fa').style.display = 'none';
            }
        });
    }

    // Log-out process
    const btnLogout = document.getElementById('btn-logout-client');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm("Disconnect and clear your local MTProto session?")) {
                const clientInstance = getClient();
                if (clientInstance) {
                    try {
                        await clientInstance.logOut();
                    } catch (_) {}
                }
                localStorage.removeItem(STORAGE_KEYS.API_ID);
                localStorage.removeItem(STORAGE_KEYS.API_HASH);
                localStorage.removeItem(STORAGE_KEYS.API_PHONE);
                localStorage.removeItem(STORAGE_KEYS.API_RELAY);
                
                const indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
                if (indexedDB) {
                    try {
                        indexedDB.deleteDatabase("tg_userbot_session");
                    } catch (_) {}
                }
                
                alert("Successfully disconnected.");
                window.location.reload();
            }
        });
    }

    const addMainCatBtn = document.getElementById('btn-add-main-cat');
    if (addMainCatBtn) {
        addMainCatBtn.addEventListener('click', () => {
            const name = prompt('Enter new main category name:');
            if (name && name.trim()) {
                const cats = getCategories();
                const parts = name.trim().split('/');
                let current = "";
                for (const part of parts) {
                    current = current ? `${current}/${part}` : part;
                    const parent = current.includes('/') ? current.substring(0, current.lastIndexOf('/')) : null;
                    if (!cats.some(c => c.path === current)) {
                        cats.push({ path: current, parent_path: parent });
                    }
                }
                saveCategories(cats);
                updateBulkDropdown();
                updateHeaderFilterOptions();
                renderCategoryTree();
                renderLinksTable();
            }
        });
    }

    // File Backup Handlers [1]
    const fileImportEl = document.getElementById('file-import');
    if (fileImportEl) {
        fileImportEl.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                const { categories, links } = parseNetscapeBookmarks(evt.target.result);
                
                const currentCats = getCategories();
                categories.forEach(newCat => {
                    if (!currentCats.some(c => c.path === newCat.path)) currentCats.push(newCat);
                });

                const currentLinks = getLinks();
                links.forEach(newLink => {
                    if (!currentLinks.some(l => l.original_link === newLink.original_link && l.category_path === newLink.category_path)) {
                        currentLinks.push(newLink);
                    }
                });

                saveCategories(currentCats);
                saveLinks(currentLinks);
                normalizeLinkIndexes();
                
                renderCategoryTree();
                renderLinksTable();
                updateHeaderFilterOptions();
                alert('Import parsed successfully!');
            };
            reader.readAsText(file);
        });
    }

    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const html = generateNetscapeHTML(getCategories(), getLinks(), false);
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'archive_bookmarks.html';
            a.click();
        });
    }

    const exportDbBtn = document.getElementById('btn-export-db');
    if (exportDbBtn) {
        exportDbBtn.addEventListener('click', () => {
            const html = generateNetscapeHTML(getCategories(), getLinks(), true);
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'archive_database_backup.html';
            a.click();
        });
    }

    // Column Filters [1]
    const titleFilter = document.getElementById('col-filter-title');
    if (titleFilter) titleFilter.addEventListener('input', renderLinksTable);

    const handleFilter = document.getElementById('col-filter-handle');
    if (handleFilter) handleFilter.addEventListener('input', renderLinksTable);

    const subsFilter = document.getElementById('col-filter-subs');
    if (subsFilter) subsFilter.addEventListener('input', renderLinksTable);

    const postsFilter = document.getElementById('col-filter-posts');
    if (postsFilter) postsFilter.addEventListener('input', renderLinksTable);

    const langFilter = document.getElementById('col-filter-lang');
    if (langFilter) langFilter.addEventListener('change', renderLinksTable);

    const folderFilter = document.getElementById('col-filter-folder');
    if (folderFilter) folderFilter.addEventListener('change', renderLinksTable);

    const statusFilter = document.getElementById('col-filter-status');
    if (statusFilter) statusFilter.addEventListener('change', renderLinksTable);

    const selectAllLinks = document.getElementById('select-all-links');
    if (selectAllLinks) {
        selectAllLinks.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.link-checkbox').forEach(box => {
                box.checked = checked;
            });
        });
    }

    const bulkDeleteLinks = document.getElementById('btn-bulk-delete-links');
    if (bulkDeleteLinks) {
        bulkDeleteLinks.addEventListener('click', () => {
            const checkedBoxes = document.querySelectorAll('.link-checkbox:checked');
            if (checkedBoxes.length === 0) {
                alert('Action Cancelled: You must check/select at least one bookmark from the workspace list to proceed.');
                return;
            }
            if (confirm(`Delete the ${checkedBoxes.length} selected items?`)) {
                let links = getLinks();
                const targets = Array.from(checkedBoxes).map(box => ({
                    link: box.dataset.link,
                    cat: box.dataset.cat
                }));
                links = links.filter(l => !targets.some(t => t.link === l.base_link && t.cat === l.category_path));
                saveLinks(links);
                renderLinksTable();
                document.getElementById('select-all-links').checked = false;
            }
        });
    }

    const bulkMoveLinks = document.getElementById('btn-bulk-move-links');
    if (bulkMoveLinks) {
        bulkMoveLinks.addEventListener('click', () => {
            runBulkReposition(false);
        });
    }

    const bulkCopyLinks = document.getElementById('btn-bulk-copy-links');
    if (bulkCopyLinks) {
        bulkCopyLinks.addEventListener('click', () => {
            runBulkReposition(true);
        });
    }

    function runBulkReposition(isCopyAction) {
        const checkedBoxes = document.querySelectorAll('.link-checkbox:checked');
        if (checkedBoxes.length === 0) {
            alert('Action Cancelled: You must check/select at least one bookmark from the workspace list to proceed.');
            return;
        }

        const destination = document.getElementById('bulk-move-select').value;
        if (!destination) return alert('Choose directory destination.');

        let links = getLinks();
        if (isCopyAction) {
            Array.from(checkedBoxes).forEach(box => {
                const idx = parseInt(box.dataset.index, 10);
                const copyItem = { ...links[idx], category_path: destination, position: links.length };
                const alreadyExists = links.some(l => l.base_link === copyItem.base_link && l.category_path === destination);
                if (!alreadyExists) {
                    links.push(copyItem);
                }
            });
            alert('Element duplicate copies successfully generated.');
        } else {
            const targets = Array.from(checkedBoxes).map(box => parseInt(box.dataset.index, 10));
            links.forEach((l, idx) => {
                if (targets.includes(idx)) {
                    l.category_path = destination;
                }
            });
            alert('Elements relocated successfully.');
        }

        saveLinks(links);
        renderLinksTable();
        document.getElementById('select-all-links').checked = false;
    }

    const menuAddSingle = document.getElementById('menu-add-single');
    if (menuAddSingle) {
        menuAddSingle.addEventListener('click', () => {
            document.getElementById('single-input-link').value = '';
            openModal('modal-single-container');
        });
    }

    const menuAddBulk = document.getElementById('menu-add-bulk');
    if (menuAddBulk) {
        menuAddBulk.addEventListener('click', () => {
            document.getElementById('bulk-textarea').value = '';
            document.getElementById('bulk-preview-sub-box').style.display = 'none';
            openModal('modal-bulk-container');
        });
    }

    const saveSingleBtn = document.getElementById('btn-save-single');
    if (saveSingleBtn) {
        saveSingleBtn.addEventListener('click', () => {
            const urlInput = document.getElementById('single-input-link').value.trim();
            const targetCat = document.getElementById('single-target-category').value;

            if (!urlInput) return alert('Input url or username handle.');
            if (!targetCat) return alert('Select target category folder.');

            const parsed = analyzeUrl(urlInput);
            const links = getLinks();
            
            const exists = links.some(l => l.base_link === parsed.base_link && l.category_path === targetCat);
            if (exists) return alert('This bookmark is already registered in this category.');

            links.push({
                category_path: targetCat,
                title: urlInput,
                base_link: parsed.base_link,
                original_link: urlInput,
                chat_id: parsed.chat_id,
                type: parsed.type,
                status: 'alive',
                group_link: null,
                timestamp: Date.now(),
                subscribers: 0,
                post_count: 0,
                language: 'Unknown',
                description: '',
                position: links.length
            });

            saveLinks(links);
            renderLinksTable();
            closeModal('modal-single-container');
            alert('Bookmark successfully added!');
            updateHeaderFilterOptions();
        });
    }

    let parsedBulkItems = [];
    const analyzeBulkBtn = document.getElementById('btn-analyze-bulk');
    if (analyzeBulkBtn) {
        analyzeBulkBtn.addEventListener('click', async () => {
            const text = document.getElementById('bulk-textarea').value.trim();
            if (!text) return alert('Input text space is empty.');

            analyzeBulkBtn.textContent = 'Analyzing handles... ⏳';
            analyzeBulkBtn.disabled = true;

            try {
                parsedBulkItems = await processBulkInput(text);
                const previewBody = document.getElementById('bulk-preview-body');
                previewBody.innerHTML = '';

                if (parsedBulkItems.length === 0) {
                    alert('No handles parsed from inputs.');
                    document.getElementById('bulk-preview-sub-box').style.display = 'none';
                } else {
                    parsedBulkItems.forEach((item, idx) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td><input type="checkbox" class="bulk-checkbox" data-idx="${idx}" checked></td>
                            <td><strong>${escapeHtml(item.title)}</strong></td>
                            <td><span class="badge badge-web">${escapeHtml(item.base_link)}</span></td>
                            <td><span class="badge badge-${item.type}">${item.type === 'telegram' ? 'Telegram' : 'Web Link'}</span></td>
                        `;
                        previewBody.appendChild(tr);
                    });
                    document.getElementById('bulk-preview-sub-box').style.display = 'block';
                }
            } finally {
                analyzeBulkBtn.textContent = 'Analyze Inputs';
                analyzeBulkBtn.disabled = false;
            }
        });
    }

    const saveBulkBtn = document.getElementById('btn-save-bulk');
    if (saveBulkBtn) {
        saveBulkBtn.addEventListener('click', () => {
            const targetCat = document.getElementById('bulk-target-category').value;
            if (!targetCat) return alert('Specify destination category folder first.');

            const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
            if (checkedBoxes.length === 0) return alert('No preview items selected.');

            const links = getLinks();
            checkedBoxes.forEach(box => {
                const idx = parseInt(box.dataset.idx, 10);
                const item = parsedBulkItems[idx];
                
                const isDuplicate = links.some(l => l.base_link === item.base_link && l.category_path === targetCat);
                if (!isDuplicate) {
                    links.push({
                        category_path: targetCat,
                        title: item.title,
                        base_link: item.base_link,
                        original_link: item.original_link,
                        chat_id: item.chat_id,
                        type: item.type,
                        status: item.status,
                        group_link: item.group_link,
                        timestamp: Date.now(),
                        subscribers: 0,
                        post_count: 0,
                        language: 'Unknown',
                        description: '',
                        position: links.length
                    });
                }
            });

            saveLinks(links);
            renderLinksTable();
            closeModal('modal-bulk-container');
            alert('Bookmarks imported successfully!');
            updateHeaderFilterOptions();
        });
    }

    document.body.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'select-all-discovered') {
            const checked = e.target.checked;
            document.querySelectorAll('.discovered-checkbox').forEach(box => {
                box.checked = checked;
            });
        }
    });

    // Automation binders [1]
    document.getElementById('menu-sync-metrics').addEventListener('click', executeSelectedMetricsSync);
    document.getElementById('menu-check-recency').addEventListener('click', executeSelectedRecencyVerify);
    document.getElementById('menu-detect-languages').addEventListener('click', executeSelectedLanguageClassify);
    document.getElementById('menu-scrape-descriptions').addEventListener('click', executeSelectedDescriptionScrape);
    document.getElementById('menu-discover-channels').addEventListener('click', executeSelectedDiscoveryCrawl);

    // Initial loading sequences
    renderCategoryTree();
    renderLinksTable();
    updateBulkDropdown();
    updateHeaderFilterOptions();
    updateStats();
});