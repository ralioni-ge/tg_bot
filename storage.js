export const STORAGE_KEYS = {
    CATEGORIES: 'bookmarks_categories',
    LINKS: 'bookmarks_links',
    API_ID: 'bookmarks_api_id',
    API_HASH: 'bookmarks_api_hash',
    API_PHONE: 'bookmarks_api_phone',
    API_RELAY: 'bookmarks_api_relay'
};

export function getCategories() {
    const data = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
    if (!data) {
        const defaults = [
            { path: 'Education/Engineering', parent_path: 'Education' },
            { path: 'Education/Languages', parent_path: 'Education' },
            { path: 'News/Global', parent_path: 'News' }
        ];
        localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(defaults));
        return defaults;
    }
    return JSON.parse(data);
}

export function getLinks() {
    const data = localStorage.getItem(STORAGE_KEYS.LINKS);
    return data ? JSON.parse(data) : [];
}

export function saveCategories(categories) {
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
    updateStats();
}

export function saveLinks(links) {
    localStorage.setItem(STORAGE_KEYS.LINKS, JSON.stringify(links));
    updateStats();
}

export function updateStats() {
    const statCats = document.getElementById('stat-categories');
    const statLinks = document.getElementById('stat-links');
    if (statCats) statCats.textContent = `Categories: ${getCategories().length}`;
    if (statLinks) statLinks.textContent = `Bookmarks: ${getLinks().length}`;
}

export function normalizeLinkIndexes() {
    const links = getLinks();
    let updated = false;
    links.forEach((l, idx) => {
        if (l.position === undefined) {
            l.position = idx;
            updated = true;
        }
    });
    if (updated) {
        saveLinks(links);
    }
}