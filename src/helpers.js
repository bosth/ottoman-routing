// helpers.js
import humanizeDuration from 'humanize-duration';

export const isoCodeToName = {
    'ara' : 'Arabic',
    'ell' : 'Greek',
    'eng' : 'English',
    'fra' : 'French',
    'ota' : 'Ottoman',
    'tur' : 'Turkish',
}

// Integer mode value to named mode mapping from API
export const modeIntToName = {
    1: 'road',
    2: 'chaussee',
    3: 'ferry',
    4: 'metro',
    5: 'horse tramway',
    6: 'ship',
    7: 'electric tramway',
    8: 'railway',
    9: 'transfer',
    10: 'switch',
    11: 'connection',
    12: 'steam tramway',
    13: 'narrow-gauge railway'
};

// Array of named modes, generated automatically from above
export const transportModes = Object.values(modeIntToName);

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
    road: 'directions_walk',
    chaussee: 'directions_walk',
    ferry: 'directions_boat',
    metro: 'funicular',
    'horse tramway': 'cable_car',
    ship: 'anchor',
    'electric tramway': 'tram',
    railway: 'train',
    transfer: 'subway_walk',
    switch: 'subway_walk',
        connection: 'subway_walk',
        'steam tramway': 'directions_railway_2',
        'narrow-gauge railway': 'directions_railway_2'
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

export function wrapArabic(str) {
    if (!str) return str;
    // This regex matches the Arabic Unicode range you defined in CSS
    const arabicPattern = /([\u0600-\u06FF\u0750-\u077F\u0870-\u088E\u0890-\u0891\u0898-\u08E1\u08E3-\u08FF\u200C-\u200E\u2010-\u2011\u204F\u2E41\uFB50-\uFDFF\uFE70-\uFE74\uFE76-\uFEFC]+)/g;

    return String(str).replace(arabicPattern, '<span class="arabic-text">$1</span>');
}
