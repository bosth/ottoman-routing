import humanizeDuration from 'humanize-duration';

export const transportModes = [
    'walk', 'road', 'chaussee', 'connection', 'transfer', 'switch',
'horse tramway', 'electric tramway', 'steam tramway', 'tramway', 'tram',
'railway', 'narrow-gauge railway', 'ferry', 'ship', 'metro', 'funicular'
];

// escapeHtml utility function
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

// modeSymbolMap contains mapping between mode and icon representation
export const modeSymbolMap = {
    walk: 'directions_walk',
    road: 'directions_walk',
    chaussee: 'directions_walk',
    connection: 'subway_walk',
    transfer: 'subway_walk',
    switch: 'subway_walk',
        'horse tramway': 'cable_car',
        'electric tramway': 'tram',
        railway: 'train',
        'narrow-gauge railway': 'directions_railway_2',
        'steam tramway': 'directions_railway_2',
        ferry: 'directions_boat',
        ship: 'anchor',
        metro: 'funicular',
};

// rankLabelMap contains mapping between rank and its textual representation
export const rankLabelMap = {
    9: 'vilâyet merkezi',
    8: 'sancak merkezi',
    7: 'kazâ merkezi',
    6: 'nâhiye merkezi',
    5: 'köy',
    4: 'station',
    3: 'dock',
    2: 'stop',
};

// formatCostMinutes formats a duration in minutes into a human-readable format
export function formatCostMinutes(mins) {
    const md = humanizeDuration;
    if (!md) {
        const m = Number(mins) || 0;
        return `${m} min`;
    }
    const ms = (Number(mins) || 0) * 60000;
    return md(ms, { largest: 2, round: true, units: ['d', 'h', 'm'] });
}


export function normalizeFeatures(features) {
    return (features || []).map(f => {
        const p = f.properties || {};
        const rawId = (f && f.id !== undefined && f.id !== null) ? f.id : (p.id ?? p.ID ?? '');
        const fid = (rawId === null || rawId === undefined) ? '' : String(rawId);
        return {
            type: 'Feature',
            geometry: f.geometry,
            properties: {
                id: fid,
                name: p.name ?? p.title ?? '',
                rank: (p.rank !== undefined) ? Number(p.rank) : 9999,
                                ...p
            }
        };
    });
}

export function resolveApiBase(opts) {
    if (opts && opts.apiBase) return String(opts.apiBase).replace(/\/$/, '');
    if (typeof window !== 'undefined' && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, '');
    try {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8080';
    } catch (e) {}
    return 'https://geo.jaxartes.net';
}


export function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
