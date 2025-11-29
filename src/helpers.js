import humanizeDuration from 'humanize-duration';

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
