import { analyzeUrl } from './crawler.js';
import { escapeHtml } from './ui.js';

export function parseNetscapeBookmarks(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const categories = [];
    const links = [];

    function traverse(element, currentPath) {
        const children = element.childNodes;
        for (let child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toUpperCase();
                if (tagName === 'DT') {
                    const h3 = child.querySelector(':scope > H3');
                    const a = child.querySelector(':scope > A');
                    
                    if (h3) {
                        const catName = h3.textContent.trim();
                        const newPath = currentPath ? `${currentPath}/${catName}` : catName;
                        
                        if (!categories.some(c => c.path === newPath)) {
                            categories.push({
                                path: newPath,
                                parent_path: currentPath || null
                            });
                        }
                        
                        const dl = child.querySelector(':scope + DL') || child.querySelector('DL');
                        if (dl) {
                            traverse(dl, newPath);
                        }
                    } else if (a) {
                        const title = a.textContent.trim();
                        const href = a.getAttribute('href');
                        const addDate = a.getAttribute('add_date');
                        const timestamp = addDate ? parseInt(addDate, 10) * 1000 : Date.now();
                        
                        if (href && currentPath) {
                            const parsed = analyzeUrl(href);

                            const subscribers = a.getAttribute('subscribers') ? parseInt(a.getAttribute('subscribers'), 10) : 0;
                            const post_count = a.getAttribute('post_count') ? parseInt(a.getAttribute('post_count'), 10) : 0;
                            const language = a.getAttribute('language') || 'Unknown';
                            const description = a.getAttribute('description') || '';
                            const status = a.getAttribute('status') || (title.includes('[DELETED]') ? 'dead' : 'alive');
                            const chat_id = a.getAttribute('chat_id') || parsed.chat_id;
                            const group_link = a.getAttribute('group_link') || null;
                            const position = a.getAttribute('position') ? parseInt(a.getAttribute('position'), 10) : links.length;

                            links.push({
                                category_path: currentPath,
                                title: title.replace(' [DELETED]', ''),
                                base_link: parsed.base_link,
                                original_link: href,
                                chat_id: chat_id,
                                type: parsed.type,
                                status: status,
                                group_link: group_link,
                                timestamp: timestamp,
                                subscribers: subscribers,
                                post_count: post_count,
                                language: language,
                                description: description,
                                position: position
                            });
                        }
                    }
                } else if (tagName === 'DL') {
                    traverse(child, currentPath);
                }
            }
        }
    }

    const topDl = doc.querySelector('DL');
    if (topDl) {
        traverse(topDl, '');
    }
    return { categories, links };
}

export function generateNetscapeHTML(categories, links, isDbBackup = false) {
    let tree = {};
    categories.forEach(cat => {
        let parts = cat.path.split('/').map(p => p.trim());
        let curr = tree;
        parts.forEach(p => {
            if (!curr[p]) {
                curr[p] = { __links: [], __children: {} };
            }
            curr = curr[p].__children;
        });
    });

    links.forEach(link => {
        let parts = link.category_path.split('/').map(p => p.trim());
        let curr = tree;
        for (let i = 0; i < parts.length; i++) {
            let p = parts[i];
            if (!curr[p]) {
                curr[p] = { __links: [], __children: {} };
            }
            if (i === parts.length - 1) {
                curr[p].__links.push(link);
            }
            curr = curr[p].__children;
        }
    });

    function renderTree(node, indent) {
        let html = '';
        for (let key in node) {
            html += `${indent}<DT><H3>${escapeHtml(key)}</H3>\n${indent}<DL><p>\n`;
            node[key].__links.forEach(link => {
                const addDate = Math.floor((link.timestamp || Date.now()) / 1000);
                let attrs = `HREF="${link.original_link}" ADD_DATE="${addDate}"`;
                
                if (isDbBackup) {
                    const sub = link.subscribers || 0;
                    const pc = link.post_count || 0;
                    const lang = escapeHtml(link.language || 'Unknown');
                    const desc = escapeHtml(link.description || '');
                    const status = escapeHtml(link.status || 'alive');
                    const chatId = escapeHtml(link.chat_id || '');
                    const groupLink = escapeHtml(link.group_link || '');
                    const pos = link.position !== undefined ? link.position : '';
                    attrs += ` SUBSCRIBERS="${sub}" POST_COUNT="${pc}" LANGUAGE="${lang}" DESCRIPTION="${desc}" STATUS="${status}" CHAT_ID="${chatId}" GROUP_LINK="${groupLink}" POSITION="${pos}"`;
                }

                const deadTag = (!isDbBackup && link.status === 'dead') ? ' [DELETED]' : '';
                html += `${indent}    <DT><A ${attrs}>${escapeHtml(link.title)}${deadTag}</A>\n`;
            });
            html += renderTree(node[key].__children, indent + '    ');
            html += `${indent}</DL><p>\n`;
        }
        return html;
    }

    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>My Telegram Archive</H1><DL><p>\n`;
    html += renderTree(tree, '    ');
    html += `</DL><p>`;
    return html;
}