/**
 * API Client for Backend Server
 * Replaces localStorage-based storage.js with REST API calls
 */

const API_BASE_URL = 'http://127.0.0.1:8000';

// ==================== Categories API ====================

export async function getCategories() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/categories`);
        if (!response.ok) throw new Error('Failed to fetch categories');
        return await response.json();
    } catch (error) {
        console.error('Error fetching categories:', error);
        // Fallback to defaults
        return [
            { id: 1, path: 'Education/Engineering', parent_path: 'Education' },
            { id: 2, path: 'Education/Languages', parent_path: 'Education' },
            { id: 3, path: 'News/Global', parent_path: 'News' }
        ];
    }
}

export async function createCategory(path, parent_path = null) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, parent_path })
        });
        if (!response.ok) throw new Error('Failed to create category');
        return await response.json();
    } catch (error) {
        console.error('Error creating category:', error);
        throw error;
    }
}

export async function deleteCategory(path) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/categories/${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete category');
        return await response.json();
    } catch (error) {
        console.error('Error deleting category:', error);
        throw error;
    }
}

// ==================== Links API ====================

export async function getLinks(categoryPath = null, filters = {}) {
    try {
        let url = `${API_BASE_URL}/api/links?`;
        if (categoryPath) url += `category_path=${encodeURIComponent(categoryPath)}&`;
        if (filters.status) url += `status=${filters.status}&`;
        if (filters.language) url += `language=${filters.language}&`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch links');
        return await response.json();
    } catch (error) {
        console.error('Error fetching links:', error);
        return [];
    }
}

export async function createLink(linkData) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(linkData)
        });
        if (!response.ok) throw new Error('Failed to create link');
        return await response.json();
    } catch (error) {
        console.error('Error creating link:', error);
        throw error;
    }
}

export async function updateLink(id, linkData) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/links/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(linkData)
        });
        if (!response.ok) throw new Error('Failed to update link');
        return await response.json();
    } catch (error) {
        console.error('Error updating link:', error);
        throw error;
    }
}

export async function deleteLink(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/links/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete link');
        return await response.json();
    } catch (error) {
        console.error('Error deleting link:', error);
        throw error;
    }
}

export async function bulkDeleteLinks(ids) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/links/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, action: 'delete' })
        });
        if (!response.ok) throw new Error('Failed to delete links');
        return await response.json();
    } catch (error) {
        console.error('Error bulk deleting links:', error);
        throw error;
    }
}

export async function bulkMoveLinks(ids, category_path) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/links/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, action: 'move', category_path })
        });
        if (!response.ok) throw new Error('Failed to move links');
        return await response.json();
    } catch (error) {
        console.error('Error bulk moving links:', error);
        throw error;
    }
}

// ==================== Bulk Import API ====================

export async function bulkImport(text, category_path, discover_groups = false) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/bulk_import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, category_path, discover_groups })
        });
        if (!response.ok) throw new Error('Failed to import');
        return await response.json();
    } catch (error) {
        console.error('Error bulk importing:', error);
        throw error;
    }
}

// ==================== Accounts API ====================

export async function getAccounts() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/accounts`);
        if (!response.ok) throw new Error('Failed to fetch accounts');
        return await response.json();
    } catch (error) {
        console.error('Error fetching accounts:', error);
        return [];
    }
}

export async function createAccount(label, phone) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, phone })
        });
        if (!response.ok) throw new Error('Failed to create account');
        return await response.json();
    } catch (error) {
        console.error('Error creating account:', error);
        throw error;
    }
}

export async function sendVerificationCode(account_id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/send_code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id })
        });
        if (!response.ok) throw new Error('Failed to send code');
        return await response.json();
    } catch (error) {
        console.error('Error sending verification code:', error);
        throw error;
    }
}

export async function verifyCode(account_id, code) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify_code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id, code })
        });
        if (!response.ok) throw new Error('Failed to verify code');
        return await response.json();
    } catch (error) {
        console.error('Error verifying code:', error);
        throw error;
    }
}

export async function verifyPassword(account_id, password) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify_password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id, password })
        });
        if (!response.ok) throw new Error('Failed to verify password');
        return await response.json();
    } catch (error) {
        console.error('Error verifying password:', error);
        throw error;
    }
}

export async function deleteAccount(account_id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/accounts/${account_id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete account');
        return await response.json();
    } catch (error) {
        console.error('Error deleting account:', error);
        throw error;
    }
}

// ==================== Automation API ====================

export async function startAutomationJob(job_type, account_id = null, link_ids = [], params = {}) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/automation/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_type, account_id, link_ids, params })
        });
        if (!response.ok) throw new Error('Failed to start job');
        return await response.json();
    } catch (error) {
        console.error('Error starting automation job:', error);
        throw error;
    }
}

export async function getJobStatus(job_id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/automation/jobs/${job_id}`);
        if (!response.ok) throw new Error('Failed to fetch job status');
        return await response.json();
    } catch (error) {
        console.error('Error fetching job status:', error);
        return null;
    }
}

export function connectToJobStream(job_id, onMessage, onClose) {
    const wsUrl = `ws://${API_BASE_URL.replace('http://', '')}/api/automation/stream/${job_id}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log(`Connected to job stream ${job_id}`);
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onMessage(data);
    };
    
    ws.onclose = () => {
        console.log(`Disconnected from job stream ${job_id}`);
        if (onClose) onClose();
    };
    
    ws.onerror = (error) => {
        console.error(`WebSocket error for job ${job_id}:`, error);
    };
    
    return ws;
}

// ==================== Export/Import API ====================

export async function exportBookmarks(format = 'netscape') {
    try {
        const response = await fetch(`${API_BASE_URL}/api/export?format=${format}`);
        if (!response.ok) throw new Error('Failed to export');
        return await response.text();
    } catch (error) {
        console.error('Error exporting bookmarks:', error);
        throw error;
    }
}

export async function exportDatabase() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/export_db`);
        if (!response.ok) throw new Error('Failed to export database');
        return await response.blob();
    } catch (error) {
        console.error('Error exporting database:', error);
        throw error;
    }
}

// ==================== Stats ====================

export async function getStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/stats`);
        if (!response.ok) throw new Error('Failed to fetch stats');
        return await response.json();
    } catch (error) {
        console.error('Error fetching stats:', error);
        return { categories: 0, links: 0 };
    }
}

export async function updateStats() {
    const stats = await getStats();
    const statCats = document.getElementById('stat-categories');
    const statLinks = document.getElementById('stat-links');
    if (statCats) statCats.textContent = `Categories: ${stats.categories}`;
    if (statLinks) statLinks.textContent = `Bookmarks: ${stats.links}`;
    return stats;
}
