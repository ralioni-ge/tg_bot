import { getCategories, getLinks, saveCategories, saveLinks } from './storage.js';
import { state } from './state.js';

export function escapeHtml(text) {
    if (!text) return "";
    return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function openModal(id) {
    document.getElementById(id).classList.add('active');
}

export function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

export function renderCategoryTree() {
    const categories = getCategories();
    const treeContainer = document.getElementById('category-tree');
    if (!treeContainer) return;
    
    treeContainer.innerHTML = '';
    let tree = {};
    categories.forEach(c => {
        const parts = c.path.split('/');
        let node = tree;
        parts.forEach((p, idx) => {
            const curPath = parts.slice(0, idx + 1).join('/');
            if (!node[p]) {
                node[p] = { __path: curPath, __children: {} };
            }
            node = node[p].__children;
        });
    });

    function renderDOMNode(node) {
        let html = '';
        for (const key in node) {
            const item = node[key];
            const hasChildren = Object.keys(item.__children).length > 0;
            const isSelected = item.__path === state.currentSelectedPath;
            
            html += `
                <div class="tree-item">
                    <div class="tree-item-content ${isSelected ? 'active' : ''}" onclick="selectPath('${escapeHtml(item.__path)}')">
                        <span>📁 ${escapeHtml(key)}</span>
                        <div class="tree-actions">
                            <button onclick="event.stopPropagation(); renameCategoryPrompt('${escapeHtml(item.__path)}')" class="btn btn-sm" title="Rename Folder">✏️</button>
                            <button onclick="event.stopPropagation(); addSubCategoryPrompt('${escapeHtml(item.__path)}')" class="btn btn-sm btn-success" title="Add Subfolder">➕</button>
                            <button onclick="event.stopPropagation(); deleteCategoryPrompt('${escapeHtml(item.__path)}')" class="btn btn-sm btn-danger" title="Delete Folder">🗑</button>
                        </div>
                    </div>
                    ${hasChildren ? `<div class="tree-children">${renderDOMNode(item.__children)}</div>` : ''}
                </div>
            `;
        }
        return html;
    }

    treeContainer.innerHTML = renderDOMNode(tree) || '<div class="help-text">No workspace directories created.</div>';
    updateBulkDropdown();
}

export function renderLinksTable() {
    const links = getLinks();
    const tableBody = document.getElementById('links-table-body');

    const filterTitle = document.getElementById('col-filter-title')?.value.toLowerCase() || '';
    const filterHandle = document.getElementById('col-filter-handle')?.value.toLowerCase() || '';
    const filterLang = document.getElementById('col-filter-lang')?.value || 'all';
    const filterSubs = parseInt(document.getElementById('col-filter-subs')?.value || '0', 10);
    const filterPosts = parseInt(document.getElementById('col-filter-posts')?.value || '0', 10);
    const filterFolder = document.getElementById('col-filter-folder')?.value || 'all';
    const filterStatus = document.getElementById('col-filter-status')?.value || 'all';

    if (!tableBody) return;
    tableBody.innerHTML = '';

    let filtered = links.map((l, idx) => ({ ...l, originalIndex: idx }));

    if (state.currentSelectedPath !== '') {
        filtered = filtered.filter(l => l.category_path === state.currentSelectedPath || l.category_path.startsWith(state.currentSelectedPath + '/'));
    }

    if (filterTitle) filtered = filtered.filter(l => l.title.toLowerCase().includes(filterTitle));
    if (filterHandle) filtered = filtered.filter(l => l.base_link.toLowerCase().includes(filterHandle));
    if (filterLang !== 'all') filtered = filtered.filter(l => l.language === filterLang);
    if (!isNaN(filterSubs) && filterSubs > 0) filtered = filtered.filter(l => (l.subscribers || 0) >= filterSubs);
    if (!isNaN(filterPosts) && filterPosts > 0) filtered = filtered.filter(l => (l.post_count || 0) >= filterPosts);
    if (filterFolder !== 'all') filtered = filtered.filter(l => l.category_path === filterFolder);
    if (filterStatus !== 'all') filtered = filtered.filter(l => l.status === filterStatus);

    filtered.sort((a, b) => {
        let valA, valB;
        const col = state.currentSort.col;

        if (col === 'name') {
            valA = a.title.toLowerCase();
            valB = b.title.toLowerCase();
            return state.currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (col === 'handle') {
            valA = a.base_link.toLowerCase();
            valB = b.base_link.toLowerCase();
            return state.currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (col === 'language') {
            valA = (a.language || 'unknown').toLowerCase();
            valB = (b.language || 'unknown').toLowerCase();
            return state.currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (col === 'subscribers') {
            valA = a.subscribers || 0;
            valB = b.subscribers || 0;
        } else if (col === 'posts') {
            valA = a.post_count || 0;
            valB = b.post_count || 0;
        } else if (col === 'folder') {
            valA = a.category_path.toLowerCase();
            valB = b.category_path.toLowerCase();
            return state.currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (col === 'status') {
            valA = a.status.toLowerCase();
            valB = b.status.toLowerCase();
            return state.currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            valA = a.position || 0;
            valB = b.position || 0;
        }

        if (state.currentSort.dir === 'asc') return valA > valB ? 1 : valA < valB ? -1 : 0;
        return valA < valB ? 1 : valA > valB ? -1 : 0;
    });

    filtered.forEach((link) => {
        const tr = document.createElement('tr');
        const langString = link.language && link.language !== 'Unknown' ? `🌐 ${link.language}` : '';
        const descTip = link.description ? `title="${escapeHtml(link.description)}"` : '';

        tr.innerHTML = `
            <td><input type="checkbox" class="link-checkbox" data-index="${link.originalIndex}" data-link="${escapeHtml(link.base_link)}" data-cat="${escapeHtml(link.category_path)}"></td>
            <td>
                <button onclick="changePosition(${link.originalIndex}, -1)" class="btn btn-sm" style="padding: 2px 4px;">▲</button>
                <button onclick="changePosition(${link.originalIndex}, 1)" class="btn btn-sm" style="padding: 2px 4px;">▼</button>
            </td>
            <td>
                <span class="text-bold" id="display-title-${link.originalIndex}" ${descTip}>${escapeHtml(link.title)}</span>
                <button onclick="editTitlePrompt(${link.originalIndex})" class="btn btn-sm" style="margin-left: 6px; padding: 1px 4px; border:none; background:transparent;">✏️</button>
            </td>
            <td><a href="${link.base_link}" target="_blank" class="badge badge-tg">${escapeHtml(link.base_link)}</a></td>
            <td>
                <div style="font-size: 0.72rem; color: var(--text-muted);">
                    ${langString} ${link.group_link ? '💬 Discussion' : ''}
                </div>
            </td>
            <td>${link.subscribers ? Number(link.subscribers).toLocaleString() : '0'}</td>
            <td>${link.post_count || '0'}</td>
            <td><span style="font-size: 0.75rem; font-weight:500;">${escapeHtml(link.category_path)}</span></td>
            <td><span class="badge badge-${link.status === 'alive' ? 'alive' : 'dead'}">${link.status === 'alive' ? 'Active' : 'Deactivated'}</span></td>
            <td>
                <button onclick="deleteLink(${link.originalIndex})" class="btn btn-sm btn-danger">Delete</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    updateSortIcons();
}

export function toggleSort(colName) {
    if (state.currentSort.col === colName) {
        state.currentSort.dir = state.currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.currentSort.col = colName;
        state.currentSort.dir = 'asc';
    }
    renderLinksTable();
}

export function updateSortIcons() {
    const cols = ['name', 'handle', 'language', 'subscribers', 'posts', 'folder', 'status'];
    cols.forEach(col => {
        const iconEl = document.getElementById(`sort-icon-${col}`);
        if (!iconEl) return;
        if (state.currentSort.col === col) {
            iconEl.textContent = state.currentSort.dir === 'asc' ? '▲' : '▼';
            iconEl.style.color = 'var(--primary)';
        } else {
            iconEl.textContent = '⇅';
            iconEl.style.color = 'var(--text-muted)';
        }
    });
}

export function updateBulkDropdown() {
    const cats = getCategories();
    const dropdowns = [
        document.getElementById('bulk-target-category'), 
        document.getElementById('single-target-category'),
        document.getElementById('bulk-move-select'),
        document.getElementById('discovered-target-category')
    ];
    dropdowns.forEach(dd => {
        if (!dd) return;
        dd.innerHTML = '<option value="">-- Choose Category Directory --</option>';
        cats.forEach(c => {
            dd.innerHTML += `<option value="${escapeHtml(c.path)}">${escapeHtml(c.path)}</option>`;
        });
    });
}

export function updateHeaderFilterOptions() {
    const links = getLinks();
    const langDropdown = document.getElementById('col-filter-lang');
    if (langDropdown) {
        const previousSelection = langDropdown.value;
        const languages = new Set();
        links.forEach(l => {
            if (l.language && l.language !== 'Unknown') languages.add(l.language);
        });
        langDropdown.innerHTML = '<option value="all">All</option>';
        languages.forEach(lang => {
            langDropdown.innerHTML += `<option value="${escapeHtml(lang)}">${escapeHtml(lang)}</option>`;
        });
        langDropdown.value = previousSelection;
        if (!langDropdown.value) langDropdown.value = 'all';
    }

    const folderDropdown = document.getElementById('col-filter-folder');
    if (folderDropdown) {
        const previousSelection = folderDropdown.value;
        const folders = new Set();
        links.forEach(l => {
            if (l.category_path) folders.add(l.category_path);
        });
        folderDropdown.innerHTML = '<option value="all">All</option>';
        folders.forEach(folder => {
            folderDropdown.innerHTML += `<option value="${escapeHtml(folder)}">${escapeHtml(folder)}</option>`;
        });
        folderDropdown.value = previousSelection;
        if (!folderDropdown.value) folderDropdown.value = 'all';
    }
}

// Global ESM hooks for UI triggers [1]
window.selectPath = (path) => {
    state.currentSelectedPath = path;
    const pathDisplay = document.getElementById('current-path-display');
    if (pathDisplay) pathDisplay.textContent = path || 'Root (All)';
    renderCategoryTree();
    renderLinksTable();
};

window.addSubCategoryPrompt = (parentPath) => {
    const name = prompt(`Enter subcategory name for directory "${parentPath}":`);
    if (name && name.trim()) {
        const cats = getCategories();
        const parts = `${parentPath}/${name.trim()}`.split('/');
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
};

window.renameCategoryPrompt = (path) => {
    const segment = path.split('/').pop();
    const newName = prompt(`Enter new name for directory "${segment}":`, segment);
    if (newName && newName.trim() && newName.trim() !== segment) {
        const cats = getCategories();
        const parts = path.split('/');
        parts[parts.length - 1] = newName.trim();
        const newPath = parts.join('/');

        cats.forEach(c => {
            if (c.path === path) {
                c.path = newPath;
            } else if (c.path.startsWith(path + '/')) {
                c.path = newPath + c.path.substring(path.length);
            }
            if (c.parent_path === path) {
                c.parent_path = newPath;
            } else if (c.parent_path && c.parent_path.startsWith(path + '/')) {
                c.parent_path = newPath + c.parent_path.substring(path.length);
            }
        });
        saveCategories(cats);

        const links = getLinks();
        links.forEach(l => {
            if (l.category_path === path) {
                l.category_path = newPath;
            } else if (l.category_path.startsWith(path + '/')) {
                l.category_path = newPath + l.category_path.substring(path.length);
            }
        });
        saveLinks(links);

        if (state.currentSelectedPath === path) {
            state.currentSelectedPath = newPath;
        }

        updateBulkDropdown();
        renderCategoryTree();
        renderLinksTable();
    }
};

window.deleteCategoryPrompt = (path) => {
    if (confirm(`Are you sure you want to delete directory "${path}" and all nested channels?`)) {
        let cats = getCategories();
        cats = cats.filter(c => c.path !== path && !c.path.startsWith(path + '/'));
        saveCategories(cats);

        let links = getLinks();
        links = links.filter(l => l.category_path !== path && !l.category_path.startsWith(path + '/'));
        saveLinks(links);

        updateBulkDropdown();
        updateHeaderFilterOptions();

        if (state.currentSelectedPath === path) state.currentSelectedPath = '';
        renderCategoryTree();
        renderLinksTable();
    }
};

window.deleteLink = (globalIndex) => {
    if (confirm("Remove this entry from archive?")) {
        const links = getLinks();
        links.splice(globalIndex, 1);
        saveLinks(links);
        renderLinksTable();
    }
};

window.editTitlePrompt = (globalIndex) => {
    const links = getLinks();
    const currentTitle = links[globalIndex].title;
    const newTitle = prompt("Update display name:", currentTitle);
    if (newTitle !== null) {
        links[globalIndex].title = newTitle.trim() || currentTitle;
        saveLinks(links);
        renderLinksTable();
    }
};

window.changePosition = (globalIndex, direction) => {
    const links = getLinks();
    const targetIdx = globalIndex + direction;
    if (targetIdx >= 0 && targetIdx < links.length) {
        const temp = links[globalIndex].position || globalIndex;
        links[globalIndex].position = links[targetIdx].position || targetIdx;
        links[targetIdx].position = temp;

        const tempObj = links[globalIndex];
        links[globalIndex] = links[targetIdx];
        links[targetIdx] = tempObj;

        saveLinks(links);
        renderLinksTable();
    }
};

window.toggleSort = toggleSort;
window.openModal = openModal;
window.closeModal = closeModal;