// ==UserScript==
// @name               RainTube — Customization, Shorts, Statistics, Quality & Private Downloads
// @description        Privacy-first YouTube helper: OLED pure-black theme, Shorts blocking, local usage statistics, automatic quality targeting, and Piped/Invidious proxied downloads.
// @namespace          https://github.com/RyanIsAinmDom/RainTube
// @version            1.20.134
// @author             RyanIsAinmDom — Created by hand with robust AI assistance
// @license            MIT
// @updateURL          https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.user.js
// @icon               https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// @icon64             https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// @match              https://*.youtube.com/*
// @match              https://*.cnvmp3.com/*
// @exclude            https://www.youtube.com/live_chat*
// @exclude            https://studio.youtube.com/*

// GM v4 APIs.
// @grant              GM.getValue
// @grant              GM.setValue
// @grant              GM.openInTab
// @grant              GM.deleteValue
// @grant              GM.listValues
// @grant              GM.registerMenuCommand
// @grant              GM.xmlHttpRequest
// @grant              GM.getResourceUrl

// Fontsource web fonts. Use Fontsource's stable CDN proxy URLs rather than
// scoped npm package URLs; Greasemonkey fetches @resource entries while saving
// the script, and the proxy format avoids the scoped-package 400 errors some
// managers hit with encoded @fontsource-variable npm paths. Resources are
// downloaded once by the manager, then exposed through GM.getResourceUrl as
// extension-local URLs at runtime.
// @resource           rtFontDisplayLatin https://cdn.jsdelivr.net/fontsource/fonts/bricolage-grotesque:vf@5.2.8/latin-wght-normal.woff2
// @resource           rtFontUiLatin https://cdn.jsdelivr.net/fontsource/fonts/manrope:vf@5.2.8/latin-wght-normal.woff2
// @resource           rtFontMonoLatin https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@5.2.8/latin-wght-normal.woff2

// RainTube's YouTube/UI stylesheet is packaged as @resource. Script
// managers refresh resources when the userscript itself updates, so CSS
// changes should bump @version to force a clean resource download. Keep the
// local RainTube.youtube.css file in sync with this URL.
// @resource           rtYouTubeCss https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.youtube.css

// Core support APIs.
// @connect            raw.githubusercontent.com
// @connect            kavin.rocks
// @connect            invidious.io
// @connect            api.invidious.io

// Common Piped public-instance root domains. Metadata permissions only;
// the script still discovers instances dynamically.
// @connect            leptons.xyz
// @connect            nosebs.ru
// @connect            privacy.com.de
// @connect            adminforge.de
// @connect            piped.yt
// @connect            drgns.space
// @connect            owo.si
// @connect            ducks.party
// @connect            codespace.cz
// @connect            reallyaweso.me
// @connect            private.coffee
// @connect            darkness.services
// @connect            orangenet.cc
// @connect            tokhmi.xyz
// @connect            moomoo.me
// @connect            syncpundit.io

// Wildcard for instances we discover at runtime that aren't predictable here.
// @connect            *

// @run-at             document-idle
// @compatible         chrome   Tampermonkey 4+
// @compatible         firefox  Greasemonkey 4.11+ / Tampermonkey / Violentmonkey
// @compatible         edge     Tampermonkey 4+
// ==/UserScript==

'use strict';

/*
   RainTube V5.20.134

   Structure:
     - YouTube pages get the RainTube panel, Shorts blocking, quality
       targeting, and private Piped/Invidious downloads.
     - CnvMP3 pages only run the lightweight fallback autofill path.
     - State is persisted through GM.setValue, reset through GM.deleteValue, and validated defensively on load.
     - Network, probes, and blob downloads use strict GM4 GM.xmlHttpRequest.
*/

const HOST = location.hostname.toLowerCase();
const IS_YOUTUBE = /(^|\.)youtube\.com$/.test(HOST);
const IS_CNVMP3 = HOST === 'cnvmp3.com' || HOST.endsWith('.cnvmp3.com');

const CFG = Object.freeze({
    version: '5.20.134',
    instances: {
        // Piped's docs moved the public instance list to this markdown source;
        // parse it dynamically so we track the same list the project publishes.
        mdUrl: 'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md',
        invidiousJsonUrl: 'https://api.invidious.io/instances.json',
        cacheTtlMs: 30 * 60_000,
    },
    api: {
        // Streams responses are sub-second when healthy. 4s is enough to
        // tolerate a slow handshake without wasting the user's life.
        streamsTimeout: 4_000,
        // Discovery + meta requests can wait longer; they're called once.
        metaTimeout: 8_000,
        // Default timeout for one private blob request. Users can tune this
        // in Settings; keep the CFG value as the single fallback/default.
        downloadTimeout: 180_000,
        // How long a host stays dead after a hard failure (5xx, network).
        failureTtlMs: 8 * 60_000,
        // Bot/captcha responses warrant a longer cooldown.
        hardFailureTtlMs: 30 * 60_000,
        maxDynamicInstancesPerProvider: 60,
        // How many mirrors to race concurrently per round.
        batchProbeSize: 10,
        // Headers that make us look like the official Piped frontend.
        // Some instances require this; harmless on the rest.
        spoofedOrigin: 'https://piped.video',
        spoofedReferer: 'https://piped.video/',
    },
    dl: {
        fallbackName: 'CnvMP3',
        fallbackUrl: 'https://cnvmp3.com/v54',
    },
    storage: {
        shortsBlocker: 'rt_shorts_blocker_enabled',
        shortsOnVisit: 'rt_shorts_on_visit',
        shortsHideSidebar: 'rt_shorts_hide_sidebar',
        shortsHideHome: 'rt_shorts_hide_home',
        shortsHideSearch: 'rt_shorts_hide_search',
        shortsHideChannel: 'rt_shorts_hide_channel',
        shortsHideWatch: 'rt_shorts_hide_watch',
        oledTheme: 'rt_oled_theme_enabled',
        topbarTheme: 'rt_topbar_theme_enabled',
        quality: 'rt_quality_enabled',
        qualityMax: 'rt_quality_max',
        privateDownloads: 'rt_private_downloads_enabled',
        privateFallback: 'rt_private_fallback_enabled',
        privateProvider: 'rt_private_provider',
        privateDownloadTimeoutMs: 'rt_private_download_timeout_ms',
        // Statistics. Stored through GM.getValue/GM.setValue JSON strings so
        // the module stays compatible with Greasemonkey 4's Promise API.
        statsRange: 'rt_stats_range',
        statsEnabled: 'rt_stats_enabled',
        // Statistics display surface: collapsed draggable panel or above recommendations.
        statsDisplay: 'rt_stats_display',
        statsMetrics: 'rt_stats_metrics',
        statsBuckets: 'rt_stats_buckets',
        // General appearance/behavior.
        buttonPlacement: 'rt_button_placement',
        mainButtonVisible: 'rt_main_button_visible',
        toastDurationMs: 'rt_toast_duration_ms',
        toastPlacement: 'rt_toast_placement',
        rainQuantity: 'rt_rain_quantity',
        rainFpsCap: 'rt_rain_fps_cap',
        lightning: 'rt_lightning_enabled',
    },
});

const APP_FOOTER_TEXT = `RainTube · ${CFG.version} · MIT`;

async function readStoredValue(key, fallback) {
    try {
        return await GM.getValue(key, fallback);
    } catch (err) {
        console.warn('[RainTube] GM.getValue failed:', key, err);
        return fallback;
    }
}

async function save(key, value) {
    try {
        await GM.setValue(key, value);
    } catch (err) {
        console.warn('[RainTube] GM.setValue failed:', key, err);
    }
}

async function deleteStoredValue(key) {
    try {
        await GM.deleteValue(key);
    } catch (err) {
        console.warn('[RainTube] GM.deleteValue failed:', key, err);
    }
}

async function listStoredValues() {
    try {
        return await GM.listValues();
    } catch (err) {
        console.warn('[RainTube] GM.listValues failed:', err);
        return [];
    }
}

async function deleteRainTubeStorageExcept(keptKeys = []) {
    const keep = new Set(keptKeys);
    const keys = await listStoredValues();
    await Promise.all(keys
        .filter(key => key.startsWith('rt_') && !keep.has(key))
        .map(deleteStoredValue));
}

async function cleanupDeprecatedStorageKeys() {
    const valid = new Set(Object.values(CFG.storage));
    const keys = await listStoredValues();
    await Promise.all(keys
        .filter(key => key.startsWith('rt_') && !valid.has(key))
        .map(deleteStoredValue));
}

const QUALITY_LABEL = Object.freeze({
    highres: '8K', hd2880: '5K', hd2160: '4K', hd1440: '1440p',
    hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p',
    small: '240p', tiny: '144p',
});

// All YT levels, best → worst.
const QUALITY_ORDER = Object.freeze([
    'highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080',
    'hd720', 'large', 'medium', 'small', 'tiny',
]);

const QUALITY_HEIGHT = Object.freeze({
    highres: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
});

const QUALITY_HEIGHT_ENTRIES = Object.freeze(
    Object.entries(QUALITY_HEIGHT).map(([level, height]) => ({ level, height }))
);
const QUALITY_LEVEL_BY_HEIGHT = Object.freeze(
    Object.fromEntries(QUALITY_HEIGHT_ENTRIES.map(({ level, height }) => [height, level]))
);

function qualityHeight(level) {
    return QUALITY_HEIGHT[level] || QUALITY_HEIGHT.hd1080;
}

function qualityLevelFromHeight(height) {
    return QUALITY_LEVEL_BY_HEIGHT[height] || null;
}

function qualityLevelFromVideoHeight(height) {
    const raw = Math.round(Number(height) || 0);
    if (!raw) return null;
    const exact = qualityLevelFromHeight(raw);
    if (exact) return exact;

    // The media element can report slightly non-standard heights for cropped
    // videos. Snap to the closest known YouTube tier within a modest margin so
    // the panel can still show a meaningful current quality without touching
    // page-context player methods in standard Greasemonkey.
    let closest = null;
    for (const entry of QUALITY_HEIGHT_ENTRIES) {
        const diff = Math.abs(entry.height - raw);
        if (!closest || diff < closest.diff) closest = { level: entry.level, diff };
    }
    return closest && closest.diff <= 36 ? closest.level : `${raw}p`;
}

const YT_PLAYER_QUALITY_STORAGE = 'yt-player-quality';
const YT_PLAYER_QUALITY_BACKUP_STORAGE = 'yt-player-quality-backup';
const YT_PLAYER_QUALITY_TTL_MS = 30 * 24 * 60 * 60_000;
const QUALITY_READY_TIMEOUT_MS = 10_000;
const YT_MENUITEM_SELECTOR = '.ytp-menuitem, ytp-menuitem';

// NOTE: 1440p, 4K, 5K, and 8K are NOT gated by YouTube Premium. They are
// available to everyone when the source video has them. The only quality
// tier actually gated by Premium is "1080p Premium", a higher-bitrate
// 1080p variant at the same resolution. Standard Greasemonkey cannot safely
// query page-player metadata without crossing into permission-denied Xray
// wrappers, so RainTube skips Premium-labelled rows unless a future
// non-page-context signal can prove they are playable.

const SHORTS_ON_VISIT_ORDER = ['hide', 'redirect'];
const SHORTS_ON_VISIT_LABEL = {
    hide: 'Send to home',
    redirect: 'Open as video',
};

const PRIVATE_PROVIDER_ORDER = ['both', 'piped', 'invidious'];
const PRIVATE_PROVIDER_LABEL = {
    both: 'Both',
    piped: 'Piped',
    invidious: 'Invidious',
};

const TOAST_PLACEMENT_ORDER = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TOAST_PLACEMENT_LABEL = {
    'top-left': 'Top left',
    'top-right': 'Top right',
    'bottom-left': 'Bottom left',
    'bottom-right': 'Bottom right',
};
const TOAST_PLACEMENT_DEFAULT = 'bottom-right';
const BUTTON_PLACEMENT_ORDER = ['topbar', 'like'];
const BUTTON_PLACEMENT_LABEL = Object.freeze({
    topbar: 'Top bar',
    like: 'Under video',
});
const BUTTON_PLACEMENT_DEFAULT = 'topbar';

function readButtonPlacement(value) {
    // Older builds used this same setting as Show/Hide. Treat hidden/false
    // as default placement here; independent button visibility now controls
    // whether each button appears.
    if (value === 'hide' || value === false) return BUTTON_PLACEMENT_DEFAULT;
    return BUTTON_PLACEMENT_ORDER.includes(value) ? value : BUTTON_PLACEMENT_DEFAULT;
}

function readButtonVisible(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (value === 'show') return true;
    if (value === 'hide') return false;
    return !!fallback;
}

const TOAST_DURATION_DEFAULT_MS = 4200;
const TOAST_DURATION_MIN_MS = 1500;
const TOAST_DURATION_MAX_MS = 12000;
const RAIN_QUANTITY_ORDER = ['off', 'low', 'medium', 'high', 'ultra'];
const RAIN_QUANTITY_LABEL = {
    off: 'Off',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    ultra: 'Ultra',
};
const RAIN_QUANTITY_PARTICLE_SCALE = {
    off: 0,
    low: 0.38,
    medium: 0.58,
    high: 0.78,
    ultra: 1,
};
const RAIN_FPS_MIN = 30;
const RAIN_FPS_MAX = 120;
const RAIN_FPS_DEFAULT = 60;

// Single source of truth for the raw default value of every persisted
// setting. Used by loadRuntimeState (as the fallback when storage is empty
// or invalid) and by resetAllSettingsToDefaults (as the wipe target). Adding
// a new persisted setting means adding one entry here — every consumer reads
// from the same shape so the two stay in sync automatically.
const DEFAULT_SETTINGS = Object.freeze({
    shortsBlockerEnabled: true,
    shortsOnVisit: 'hide',
    shortsHideSidebar: true,
    shortsHideHome: true,
    shortsHideSearch: true,
    shortsHideChannel: true,
    shortsHideWatch: true,
    oledThemeEnabled: false,
    topbarThemeEnabled: false,
    qualityEnabled: true,
    qualityMax: 'hd1080',
    privateDownloadsEnabled: true,
    privateFallbackEnabled: true,
    privateProvider: 'both',
    privateDownloadTimeoutMs: CFG.api.downloadTimeout,
    buttonPlacement: BUTTON_PLACEMENT_DEFAULT,
    mainButtonVisible: true,
    toastDurationMs: TOAST_DURATION_DEFAULT_MS,
    toastPlacement: TOAST_PLACEMENT_DEFAULT,
    rainQuantity: 'ultra',
    rainFpsCap: RAIN_FPS_DEFAULT,
    lightningEnabled: true,
});

function readShortsOnVisit(value) {
    return SHORTS_ON_VISIT_ORDER.includes(value) ? value : 'hide';
}

function readPrivateProvider(value) {
    return PRIVATE_PROVIDER_ORDER.includes(value) ? value : 'both';
}

const PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS = 60_000;
const PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS = 10 * 60_000;
const PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS = 30_000;

function readPrivateDownloadTimeoutMs(value) {
    const raw = Math.round(Number(value));
    if (!Number.isFinite(raw)) return CFG.api.downloadTimeout;
    const stepped = Math.round(raw / PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS) * PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS;
    return Math.max(PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS,
        Math.min(PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS, stepped));
}

function formatPrivateDownloadTimeoutSeconds(value) {
    const sec = Math.max(1, Math.round(Number(value) || 0));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (!min) return `${rem}s`;
    return rem ? `${min}m ${rem}s` : `${min}m`;
}

const STATS_RANGE_ORDER = ['daily', 'monthly', 'yearly', 'alltime'];
const STATS_RANGE_LABEL = Object.freeze({
    daily: 'Today',
    monthly: 'This month',
    yearly: 'This year',
    alltime: 'All time',
});
const STATS_RANGE_HEADER = Object.freeze({
    daily: 'Today',
    monthly: 'This month',
    yearly: 'This year',
    alltime: 'All time',
});

const STATS_DISPLAY_ORDER = ['panel', 'inline'];
const STATS_DISPLAY_LABEL = Object.freeze({
    panel: 'Collapsed',
    inline: 'Always',
});

const STATS_METRICS_ORDER = [
    // Favorite channel is intentionally first in rendered cards; it is the
    // most personal rollup and should sit above the rest whenever enabled.
    'favoriteChannel', 'watchTime', 'videosWatched', 'shortsOpened',
    'shortsBlocked',
];
const STATS_METRIC_INFO = Object.freeze({
    watchTime: { label: 'Overall watch time', icon: 'clock' },
    videosWatched: { label: 'Videos opened', icon: 'play' },
    shortsOpened: { label: 'Shorts opened', icon: 'shortsOpen' },
    shortsBlocked: { label: 'Shorts blocked', icon: 'shorts' },
    favoriteChannel: { label: 'Favorite channel', icon: 'star' },
});
const STATS_METRICS_DEFAULTS = Object.freeze(STATS_METRICS_ORDER.reduce((acc, key) => {
    acc[key] = true;
    return acc;
}, {}));
const STATS_BUCKET_RETENTION_DAYS = 730;
const STATS_PERSIST_DEBOUNCE_MS = 2500;
const STATS_WATCH_TICK_MS = 1000;

function readStatsRange(value) {
    return STATS_RANGE_ORDER.includes(value) ? value : 'daily';
}

function readStatsEnabled(value) {
    return typeof value === 'boolean' ? value : true;
}

function readStatsDisplay(value) {
    return STATS_DISPLAY_ORDER.includes(value) ? value : 'panel';
}

function statsDisplayHasPanel(value) {
    return value === 'panel';
}

function statsDisplayHasInline(value) {
    return value === 'inline';
}

function getShortsVideoId(url = location.href) {
    try {
        const path = new URL(url, location.origin).pathname;
        const m = /^\/shorts\/([^/?#]{11})/.exec(path);
        return m ? m[1] : null;
    } catch {
        const m = String(url || '').match(/\/shorts\/([^/?#]{11})/);
        return m ? m[1] : null;
    }
}

function statsDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function sanitizeStatsMetrics(value) {
    const obj = parseJsonMaybe(value);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ...STATS_METRICS_DEFAULTS };
    }
    const out = { ...STATS_METRICS_DEFAULTS };
    for (const key of STATS_METRICS_ORDER) out[key] = obj[key] !== false;
    return out;
}

function sanitizeStatsAvatarUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw, location.origin);
        if (url.protocol !== 'https:') return '';
        return url.href.slice(0, 600);
    } catch {
        return '';
    }
}

function sanitizeStatsBuckets(value) {
    const obj = parseJsonMaybe(value);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};

    const out = {};
    for (const [date, raw] of Object.entries(obj)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

        const channelSec = {};
        const rawChannels = raw.channelSec || raw.channels || {};
        if (rawChannels && typeof rawChannels === 'object' && !Array.isArray(rawChannels)) {
            for (const [name, sec] of Object.entries(rawChannels)) {
                const cleanName = String(name || '').trim().slice(0, 100);
                const cleanSec = Math.max(0, Math.round(Number(sec) || 0));
                if (cleanName && cleanSec > 0) channelSec[cleanName] = cleanSec;
            }
        }

        const channelAvatar = {};
        const rawAvatars = raw.channelAvatar || {};
        if (rawAvatars && typeof rawAvatars === 'object' && !Array.isArray(rawAvatars)) {
            for (const [name, avatarUrl] of Object.entries(rawAvatars)) {
                const cleanName = String(name || '').trim().slice(0, 100);
                const cleanUrl = sanitizeStatsAvatarUrl(avatarUrl);
                if (cleanName && cleanUrl) channelAvatar[cleanName] = cleanUrl;
            }
        }

        out[date] = {
            shortsOpened: Math.max(0, Math.round(Number(raw.shortsOpened) || 0)),
            shortsBlocked: Math.max(0, Math.round(Number(raw.shortsBlocked) || 0)),
            watchSec: Math.max(0, Math.round(Number(raw.watchSec) || 0)),
            videosWatched: Math.max(0, Math.round(Number(raw.videosWatched) || 0)),
            channelSec,
            channelAvatar,
        };
    }
    return out;
}

function formatStatsCount(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    return n.toLocaleString();
}

function formatStatsDuration(totalSec) {
    const sec = Math.max(0, Math.round(Number(totalSec) || 0));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    const rem = min % 60;
    if (hr < 24) return rem ? `${hr}h ${rem}m` : `${hr}h`;
    const days = Math.floor(hr / 24);
    const remHr = hr % 24;
    return remHr ? `${days}d ${remHr}h` : `${days}d`;
}

function readEnumSetting(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function readToastPlacementSetting(value) {
    return TOAST_PLACEMENT_ORDER.includes(value) ? value : TOAST_PLACEMENT_DEFAULT;
}

function readRainQuantitySetting(value) {
    return RAIN_QUANTITY_ORDER.includes(value) ? value : 'ultra';
}

function readRainFpsCap(value) {
    const fps = Math.round(Number(value));
    if (!Number.isFinite(fps)) return RAIN_FPS_DEFAULT;
    return Math.max(RAIN_FPS_MIN, Math.min(RAIN_FPS_MAX, fps));
}

let S = null;

async function loadRuntimeState() {
    // Fan out every persisted-setting read in parallel. GM.getValue calls
    // are independent, so awaiting them sequentially serialises startup
    // for no reason; running them all at once drops total wall-time to
    // roughly the slowest single read. Fallbacks reference DEFAULT_SETTINGS
    // so adding a new setting only requires updating that constant.
    const [
        rawQualityMax,
        rawToastDurationMs,
        rawToastPlacement,
        rawRainQuantity,
        rawRainFpsCap,
        shortsBlockerEnabled,
        rawShortsOnVisit,
        shortsHideSidebar,
        shortsHideHome,
        shortsHideSearch,
        shortsHideChannel,
        shortsHideWatch,
        oledThemeEnabled,
        topbarThemeEnabled,
        qualityEnabled,
        privateDownloadsEnabled,
        privateFallbackEnabled,
        rawPrivateProvider,
        rawPrivateDownloadTimeoutMs,
        rawButtonPlacement,
        rawMainButtonVisible,
        lightningEnabled,
    ] = await Promise.all([
        readStoredValue(CFG.storage.qualityMax, DEFAULT_SETTINGS.qualityMax),
        readStoredValue(CFG.storage.toastDurationMs, DEFAULT_SETTINGS.toastDurationMs),
        readStoredValue(CFG.storage.toastPlacement, null),
        readStoredValue(CFG.storage.rainQuantity, DEFAULT_SETTINGS.rainQuantity),
        readStoredValue(CFG.storage.rainFpsCap, DEFAULT_SETTINGS.rainFpsCap),
        readStoredValue(CFG.storage.shortsBlocker, DEFAULT_SETTINGS.shortsBlockerEnabled),
        readStoredValue(CFG.storage.shortsOnVisit, DEFAULT_SETTINGS.shortsOnVisit),
        readStoredValue(CFG.storage.shortsHideSidebar, DEFAULT_SETTINGS.shortsHideSidebar),
        readStoredValue(CFG.storage.shortsHideHome, DEFAULT_SETTINGS.shortsHideHome),
        readStoredValue(CFG.storage.shortsHideSearch, DEFAULT_SETTINGS.shortsHideSearch),
        readStoredValue(CFG.storage.shortsHideChannel, DEFAULT_SETTINGS.shortsHideChannel),
        readStoredValue(CFG.storage.shortsHideWatch, DEFAULT_SETTINGS.shortsHideWatch),
        readStoredValue(CFG.storage.oledTheme, DEFAULT_SETTINGS.oledThemeEnabled),
        readStoredValue(CFG.storage.topbarTheme, DEFAULT_SETTINGS.topbarThemeEnabled),
        readStoredValue(CFG.storage.quality, DEFAULT_SETTINGS.qualityEnabled),
        readStoredValue(CFG.storage.privateDownloads, DEFAULT_SETTINGS.privateDownloadsEnabled),
        readStoredValue(CFG.storage.privateFallback, DEFAULT_SETTINGS.privateFallbackEnabled),
        readStoredValue(CFG.storage.privateProvider, DEFAULT_SETTINGS.privateProvider),
        readStoredValue(CFG.storage.privateDownloadTimeoutMs, DEFAULT_SETTINGS.privateDownloadTimeoutMs),
        readStoredValue(CFG.storage.buttonPlacement, DEFAULT_SETTINGS.buttonPlacement),
        readStoredValue(CFG.storage.mainButtonVisible, null),
        readStoredValue(CFG.storage.lightning, DEFAULT_SETTINGS.lightningEnabled),
    ]);

    const oldPlacementWasHidden = rawButtonPlacement === 'hide' || rawButtonPlacement === false;

    return {
        // ── Persisted settings ──
        shortsBlockerEnabled,
        shortsOnVisit: readShortsOnVisit(rawShortsOnVisit),
        // Per-surface toggles. The master toggle gates everything; each
        // per-surface toggle then enables or disables that specific area.
        // All default ON so the master toggle starts in a "blocks everywhere"
        // state matching the previous behaviour.
        shortsHideSidebar,
        shortsHideHome,
        shortsHideSearch,
        shortsHideChannel,
        shortsHideWatch,
        // OLED pure-black theme. Off by default — it's an opinionated
        // change that only makes sense when YouTube is already in dark mode.
        oledThemeEnabled,
        // RainTube-styled YouTube masthead. Off by default; when enabled it
        // deliberately keeps the top bar dark in every YouTube theme so the
        // rain/glow treatment has enough contrast.
        topbarThemeEnabled,
        qualityEnabled,
        qualityMax: readEnumSetting(rawQualityMax, QUALITY_ORDER, 'hd1080'),
        privateDownloadsEnabled,
        privateFallbackEnabled,
        privateProvider: readPrivateProvider(rawPrivateProvider),
        privateDownloadTimeoutMs: readPrivateDownloadTimeoutMs(rawPrivateDownloadTimeoutMs),
        // Toast dismiss duration in ms, clamped to TOAST_DURATION_{MIN,MAX}_MS.
        toastDurationMs: Math.max(TOAST_DURATION_MIN_MS, Math.min(TOAST_DURATION_MAX_MS,
            parseInt(rawToastDurationMs, 10) || TOAST_DURATION_DEFAULT_MS)),
        toastPlacement: readToastPlacementSetting(rawToastPlacement),
        buttonPlacement: readButtonPlacement(rawButtonPlacement),
        mainButtonVisible: readButtonVisible(rawMainButtonVisible, !oldPlacementWasHidden),
        rainQuantity: readRainQuantitySetting(rawRainQuantity),
        rainFpsCap: readRainFpsCap(rawRainFpsCap),
        lightningEnabled,

        // ── Page / navigation ──
        videoId: null,

        // ── Download runtime ──
        downloading: false,
        privateCancelRequested: false,

        // ── UI / DOM handles ──
        _lastAppliedQualityKey: null,
        _lastQualityTargetKey: null,
        _fab: null,
        _statsFab: null,
        _player: null,
        _video: null,
        _tooltip: null,
    };
}

const apiDeadUntil = new Map();
const instanceCache = {
    piped: { loadedAt: 0, values: null },
    invidious: { loadedAt: 0, values: null },
};

/* ── DOM helpers ─────────────────────────────────────────────────────────── */

function $player() {
    if (S._player && S._player.isConnected) return S._player;
    S._player = document.getElementById('movie_player')
        || document.querySelector('.html5-video-player');
    return S._player;
}

function $video() {
    if (S._video && S._video.isConnected) return S._video;
    const p = $player();
    S._video = (p && p.querySelector('video')) || document.querySelector('video');
    return S._video;
}

function mk(tag, cls, text, attrs) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.appendChild(document.createTextNode(text));
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'id') el.id = v;
            else el.setAttribute(k, v);
        }
    }
    return el;
}

function injectUserStyle(css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
}

const RT_YOUTUBE_CSS_RESOURCE = 'rtYouTubeCss';

async function readTextResource(resourceName) {
    const url = await GM.getResourceUrl(resourceName);
    const r = await gmRequest({
        method: 'GET',
        url,
        headers: { Accept: 'text/css, text/plain, */*' },
        responseType: 'text',
        timeout: CFG.api.metaTimeout,
    });

    if (!r.ok) {
        throw new Error(`RainTube resource ${resourceName} failed to load: ${r.status ? `HTTP ${r.status}` : (r.reason || 'network')}`);
    }
    if (!r.responseText?.trim()) throw new Error(`RainTube resource ${resourceName} loaded empty`);
    return r.responseText;
}

/* ── Font resources ──────────────────────────────────────────────────────── */

const RT_FONT_LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const RT_FONT_RESOURCES = Object.freeze([
    { resource: 'rtFontDisplayLatin', family: 'RainTube Display', weight: '200 800' },
    { resource: 'rtFontUiLatin', family: 'RainTube UI', weight: '200 800' },
    { resource: 'rtFontMonoLatin', family: 'RainTube Mono', weight: '100 800' },
]);

let rtStyleInjected = false;

function quoteCssString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function buildRainTubeFontCss() {
    // Resolve all resource URLs in parallel — they're independent local lookups
    // and serialising them adds 2 unnecessary async hops on managers where
    // GM.getResourceUrl genuinely round-trips.
    //
    // This is intentionally all-or-nothing. RainTube's panel typography is a
    // core part of the skin, and silently falling back to platform fonts makes
    // the UI look different across machines. If a manager cannot resolve one
    // of the packaged @resource fonts, startup should fail loudly instead of
    // rendering a close-enough-but-not-identical interface.
    //
    // The files are variable WOFF2 fonts. Standard Greasemonkey on Firefox
    // accepts the explicit `woff2-variations` descriptor here, so keep one
    // precise source descriptor and avoid a redundant plain-`woff2` fallback.
    const urls = await Promise.all(
        RT_FONT_RESOURCES.map(font => GM.getResourceUrl(font.resource))
    );

    return RT_FONT_RESOURCES.map((font, i) => `@font-face {
    font-family: '${quoteCssString(font.family)}';
    font-style: normal;
    font-weight: ${font.weight};
    src: url('${quoteCssString(urls[i])}') format('woff2-variations');
    unicode-range: ${RT_FONT_LATIN_RANGE};
}`).join('\n\n');
}

async function injectRainTubeStyles() {
    if (!IS_YOUTUBE || rtStyleInjected) return;
    rtStyleInjected = true;

    const [fontCss, youtubeCss] = await Promise.all([
        buildRainTubeFontCss(),
        readTextResource(RT_YOUTUBE_CSS_RESOURCE),
    ]);

    injectUserStyle([fontCss, youtubeCss].filter(Boolean).join('\n\n'));
}

/* ── Video metadata ──────────────────────────────────────────────────────── */

const ID_RE = [
    /[?&]v=([^&#]{11})/,
    /shorts\/([^?&#]{11})/,
    /youtu\.be\/([^?&#]{11})/,
];

function getVideoId(url = location.href) {
    for (const re of ID_RE) {
        const m = url.match(re);
        if (m) return m[1];
    }
    return null;
}

const TITLE_SEL = [
    'ytd-watch-metadata h1 yt-formatted-string',
    '#title h1 yt-formatted-string',
    'h2 span.yt-core-attributed-string[role="text"]',
    '.title.ytd-video-primary-info-renderer',
];

const AUTHOR_SEL = [
    'ytd-watch-metadata #owner ytd-channel-name #text a',
    'ytd-watch-metadata #owner ytd-channel-name yt-formatted-string',
    '#owner ytd-channel-name #text a',
    '#owner #channel-name #text a',
    'ytd-video-owner-renderer ytd-channel-name a',
    'ytd-reel-video-renderer[is-active] h2 a',
    'ytd-reel-video-renderer[is-active] #channel-name',
    'meta[itemprop="author"][content]',
];

function getVideoTitle() {
    for (const sel of TITLE_SEL) {
        const t = document.querySelector(sel)?.textContent?.trim();
        if (t && t.length > 1) return t;
    }
    return document.title?.replace(/\s*[-|]\s*YouTube\s*$/i, '').trim() || '';
}

function getVideoAuthor() {
    for (const sel of AUTHOR_SEL) {
        const el = document.querySelector(sel);
        const t = (el?.getAttribute?.('content') || el?.textContent || '').trim();
        if (t && t.length > 1) return t;
    }
    return '';
}

/* ── Quality ─────────────────────────────────────────────────────────────── */

let qualityApplyInFlight = null;
let qualityRescheduleRequested = false;

function currentQualityTargetKey(target = S?.qualityMax) {
    const videoId = getVideoId();
    if (!videoId) return null;
    const quality = readEnumSetting(target, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    return `${videoId}|${quality}`;
}

function qualityTargetAlreadyHandled(target = S?.qualityMax) {
    const targetKey = currentQualityTargetKey(target);
    return !!targetKey && S?._lastQualityTargetKey === targetKey;
}

function qualitySelectionStillWanted(level) {
    const requested = readEnumSetting(level, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    const current = readEnumSetting(S?.qualityMax, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    return !!S?.qualityEnabled && requested === current;
}

function persistYouTubeQualityPreference(level) {
    const quality = readEnumSetting(level, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    const now = Date.now();

    try {
        const payload = JSON.stringify({
            data: quality,
            expiration: now + YT_PLAYER_QUALITY_TTL_MS,
            creation: now,
        });
        localStorage.setItem(YT_PLAYER_QUALITY_STORAGE, payload);
        localStorage.setItem(YT_PLAYER_QUALITY_BACKUP_STORAGE, payload);
    } catch {
        // Storage can be blocked. The visible menu path still applies quality
        // for the active player; persistence is only YouTube's own startup hint.
    }
}

function playerDomRoot() {
    return document.querySelector('#movie_player.html5-video-player')
        || document.getElementById('movie_player')
        || document.querySelector('.html5-video-player')
        || document;
}

function playerQuery(root, selector) {
    return root?.querySelector?.(selector) || null;
}

function playerQueryAll(root, selector) {
    return Array.from(root?.querySelectorAll?.(selector) || []);
}

function menuText(el) {
    return String(el?.textContent || el?.getAttribute?.('aria-label') || '')
        .replace(/\s+/g, ' ').trim();
}

function clickMenuElement(el) {
    if (!el) return false;
    try {
        el.click();
        return true;
    } catch {
        return false;
    }
}

function wakePlayerControls(root = playerDomRoot()) {
    try {
        const rect = root.getBoundingClientRect?.();
        if (!rect) return;
        root.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: rect.left + Math.max(1, rect.width / 2),
            clientY: rect.top + Math.max(1, rect.height / 2),
        }));
    } catch {}
}

function getQualitySettingsButton(root = playerDomRoot()) {
    const button = playerQuery(root, '.ytp-settings-button, ytp-settings-button');
    return button?.isConnected ? button : null;
}

function isSettingsMenuOpen(button) {
    return button?.getAttribute?.('aria-expanded') === 'true'
        || button?.ariaExpanded === 'true';
}

function getActiveSettingsPanel(root = playerDomRoot()) {
    return playerQuery(root, '.ytp-settings-menu .ytp-panel-menu, ytp-settings-menu .ytp-panel-menu');
}

function menuItemsFromPanel(panel) {
    if (!panel) return [];
    const direct = Array.from(panel.children || [])
        .filter(el => el.matches?.(YT_MENUITEM_SELECTOR));
    return direct.length ? direct : playerQueryAll(panel, YT_MENUITEM_SELECTOR);
}

function afterYouTubeMenuClick() {
    // YouTube's player menu usually updates synchronously, but yielding one
    // frame keeps us out of framework-internal timing details without adding a
    // second polling/timeout layer inside the already readiness-gated quality
    // path.
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function findQualityRootMenuItem(root = playerDomRoot()) {
    const items = menuItemsFromPanel(getActiveSettingsPanel(root));
    if (!items.length) return null;

    const labelledQuality = items.find(item => /\bquality\b/i.test(menuText(item)));
    if (labelledQuality) return labelledQuality;

    return items.find(item => {
        if (item.querySelector('.ytp-menuitem-toggle-checkbox')) return false;
        const content = menuText(item.querySelector('.ytp-menuitem-content') || item);
        return /\b(?:auto|\d{3,4}\s*p(?:\d+)?)\b/i.test(content);
    }) || null;
}

function parseQualityMenuOption(item) {
    const label = menuText(item.querySelector('.ytp-menuitem-label') || item);
    if (!label || /^auto\b/i.test(label)) return null;

    const match = /(\d{3,4})\s*p(?:\d+)?/i.exec(label);
    if (!match) return null;

    const height = parseInt(match[1], 10) || 0;
    if (!height) return null;

    const fullText = menuText(item);
    const isPremium = !!item.querySelector('.ytp-premium-label')
        || /\b(?:premium|enhanced\s+bitrate)\b/i.test(fullText);
    const disabled = item.matches('[disabled], [aria-disabled="true"]')
        || item.classList.contains('ytp-disabled')
        || item.getAttribute('aria-hidden') === 'true';

    return {
        item,
        height,
        level: qualityLevelFromHeight(height),
        isPremium,
        disabled,
        label: isPremium ? `${height}p Premium` : `${height}p`,
    };
}

function collectQualityMenuOptions(root = playerDomRoot()) {
    return playerQueryAll(root, '.ytp-quality-menu, ytp-quality-menu')
        .flatMap(qualityMenu => {
            const panel = playerQuery(qualityMenu, '.ytp-panel-menu') || qualityMenu;
            return menuItemsFromPanel(panel);
        })
        .map(parseQualityMenuOption)
        .filter(Boolean);
}

function pickQualityMenuOption(options, targetLevel) {
    const targetHeight = qualityHeight(targetLevel);
    let bestAtOrBelow = null;
    let lowest = null;

    for (const opt of options) {
        if (opt.disabled || opt.isPremium || opt.height <= 0) continue;
        if (!lowest || opt.height < lowest.height) lowest = opt;
        if (opt.height <= targetHeight && (!bestAtOrBelow || opt.height > bestAtOrBelow.height)) {
            bestAtOrBelow = opt;
        }
    }

    // If only higher qualities are exposed, choose the lowest standard manual
    // option instead of leaving the player on Auto.
    return bestAtOrBelow || lowest;
}

function closeQualityMenu(root, settingsButton) {
    const backButton = playerQuery(root,
        '.ytp-quality-menu .ytp-panel-header button, ytp-quality-menu .ytp-panel-header button');
    if (backButton) clickMenuElement(backButton);
    if (isSettingsMenuOpen(settingsButton)) clickMenuElement(settingsButton);
}

async function selectQualityFromYouTubeMenu(level, { silent = false } = {}) {
    if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };

    const root = playerDomRoot();
    wakePlayerControls(root);

    const settingsButton = getQualitySettingsButton(root);
    if (!settingsButton) return { ok: false, reason: 'settings-button-missing' };

    // Avoid hijacking YouTube's settings menu while the user is using it.
    if (isSettingsMenuOpen(settingsButton)) {
        return { ok: false, reason: 'settings-menu-already-open' };
    }

    try {
        if (!clickMenuElement(settingsButton)) {
            return { ok: false, reason: 'settings-button-click-failed' };
        }

        await afterYouTubeMenuClick();
        if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };
        if (!getActiveSettingsPanel(root)) return { ok: false, reason: 'settings-menu-did-not-open' };

        const qualityMenu = findQualityRootMenuItem(root);
        if (!qualityMenu) return { ok: false, reason: 'quality-row-missing' };
        if (!clickMenuElement(qualityMenu)) return { ok: false, reason: 'quality-row-click-failed' };

        await afterYouTubeMenuClick();
        if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };
        const options = collectQualityMenuOptions(root);
        if (!options.length) return { ok: false, reason: 'quality-options-missing' };

        const choice = pickQualityMenuOption(options, level);
        if (!choice) return { ok: false, reason: 'target-quality-unavailable' };
        if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };
        if (!clickMenuElement(choice.item)) return { ok: false, reason: 'quality-option-click-failed' };

        const applyKey = `${S.videoId || getVideoId() || ''}|${choice.level || choice.height}|standard`;
        const alreadyApplied = S._lastAppliedQualityKey === applyKey;
        S._lastAppliedQualityKey = applyKey;

        if (!alreadyApplied && !silent) {
            toast(`Quality · ${choice.label}`, 'quality');
        }
        return { ok: true, choice };
    } finally {
        closeQualityMenu(root, settingsButton);
    }
}

function applyBestQuality({ silent = false } = {}) {
    if (!S.qualityEnabled) return Promise.resolve(null);
    if (qualityApplyInFlight) {
        qualityRescheduleRequested = true;
        return qualityApplyInFlight;
    }

    qualityRescheduleRequested = false;
    qualityApplyInFlight = applyBestQualityFromMenu({ silent })
        .catch(err => {
            console.warn('[RainTube] Quality selection failed:', err);
            return null;
        })
        .finally(() => {
            qualityApplyInFlight = null;
            if (qualityRescheduleRequested) {
                qualityRescheduleRequested = false;
                scheduleQualityApply();
            }
        });

    return qualityApplyInFlight;
}

async function applyBestQualityFromMenu({ silent = false } = {}) {
    const target = readEnumSetting(S.qualityMax, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    const targetKey = currentQualityTargetKey(target);
    persistYouTubeQualityPreference(target);

    const result = await selectQualityFromYouTubeMenu(target, { silent });
    if (result?.ok) {
        if (targetKey) S._lastQualityTargetKey = targetKey;
        clearQualitySchedule();
    } else if (!['settings-menu-already-open', 'quality-no-longer-current'].includes(result?.reason)) {
        console.debug('[RainTube] Quality targeting skipped:', {
            videoId: S.videoId || getVideoId() || null,
            target,
            result,
        });
    }
    return result;
}

function readCurrentQuality() {
    return qualityLevelFromVideoHeight($video()?.videoHeight);
}

/* ── Generic helpers ────────────────────────────────────────────────────── */

const SAFE_NAME_RE = /[\\/:*?"<>|\x00-\x1f]/g;

function sanitizeFilename(s) {
    return (s || 'download').replace(SAFE_NAME_RE, '_')
        .replace(/\s+/g, ' ').trim().slice(0, 140) || 'download';
}

function parseJsonMaybe(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try { return JSON.parse(value); } catch { return null; }
}

function normalizeBaseUrl(raw) {
    const clean = String(raw || '').trim()
        .replace(/[),.;\]>"'`]+$/g, '').replace(/\/+$/g, '');
    if (!clean) return null;
    try {
        const u = new URL(clean);
        if (u.protocol !== 'https:') return null;
        return u.origin.replace(/\/+$/g, '');
    } catch { return null; }
}

function uniqUrls(urls) {
    const seen = new Set();
    const out = [];
    for (const raw of urls) {
        const url = normalizeBaseUrl(raw);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

function endpointKey(providerId, instance) { return `${providerId}:${instance}`; }
function isEndpointTemporarilyDead(providerId, instance) {
    return (apiDeadUntil.get(endpointKey(providerId, instance)) || 0) > Date.now();
}
function markEndpointDead(providerId, instance, ms = CFG.api.failureTtlMs) {
    apiDeadUntil.set(endpointKey(providerId, instance), Date.now() + ms);
}
function clearProviderFailures(providerId = null) {
    if (!providerId) {
        apiDeadUntil.clear();
        return;
    }
    for (const key of Array.from(apiDeadUntil.keys())) {
        if (key.startsWith(`${providerId}:`)) apiDeadUntil.delete(key);
    }
}

function normalizeHost(value) {
    try { return new URL(value).hostname; }
    catch { return String(value || '').replace(/^https?:\/\//, ''); }
}

function resolveMediaUrl(instance, url) {
    if (!url) return null;
    try {
        const raw = String(url).trim();
        const href = raw.startsWith('//')
            ? `https:${raw}`
            : (/^https?:\/\//i.test(raw) ? raw : new URL(raw, instance).href);
        const parsed = new URL(href);
        return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
        return null;
    }
}

function isDirectGoogleMediaUrl(url) {
    try {
        const raw = String(url || '').trim();
        const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
        const host = new URL(absolute).hostname.toLowerCase();
        return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
    } catch {
        return false;
    }
}

function isProbablyHls(url, stream) {
    const u = String(url || '').toLowerCase();
    const f = String(stream?.format || stream?.container || '').toLowerCase();
    const m = String(stream?.mimeType || stream?.type || '').toLowerCase();
    return u.includes('.m3u8') || f.includes('hls')
        || m.includes('mpegurl') || m.includes('x-mpegurl');
}

/**
 * Whether a stream represents the *original* audio language. Used to skip
 * auto-translated dubs YouTube serves by default. Returns true when the
 * stream has no language metadata at all (single-language video) so the
 * filter is a no-op on those.
 *
 * Piped exposes NewPipeExtractor's `audioTrackType` enum directly:
 *   ORIGINAL / DUBBED / DESCRIPTIVE / SECONDARY / AUTO_DUBBED
 * Invidious exposes YouTube's `audioTrack` object with an `audioIsDefault`
 * boolean (the original track is the default one).
 */
function isOriginalAudioTrack(stream) {
    if (!stream) return true;

    // Piped path.
    const trackType = stream.audioTrackType;
    if (typeof trackType === 'string') {
        return trackType.toUpperCase() === 'ORIGINAL';
    }

    // Invidious path.
    const track = stream.audioTrack;
    if (track && typeof track === 'object') {
        if (typeof track.audioIsDefault === 'boolean') return track.audioIsDefault;
        // Fallback for older Invidious payloads: the original track's id ends
        // in ".4"; dubs use .0/.1/etc.
        if (typeof track.id === 'string') return /\.4$/.test(track.id);
    }

    // No track metadata at all — treat as original (single-language video).
    return true;
}

function extFromMimeOrFormat(stream, mode) {
    // Piped documents audio as M4A/audio-mp4 and video as MPEG_4/video-mp4.
    // Invidious exposes the same practical split through `container`/`type`.
    // Keep this intentionally narrow: detect WebM when the provider says WebM;
    // otherwise use the normal YouTube download extension for the requested mode.
    const container = String(stream?.container || stream?.format || '').toLowerCase();
    const mimeType = String(stream?.mimeType || stream?.type || '').toLowerCase();
    const isWebm = container.includes('webm') || mimeType.includes('webm');

    if (mode === 'audio') return isWebm ? 'webm' : 'm4a';
    return isWebm ? 'webm' : 'mp4';
}

/**
 * Score an audio stream for ranking within a single provider's stream
 * list. The absolute units don't matter — sort order is what's used —
 * because we never mix streams across providers in the same comparison.
 *
 * Piped audio sets `bitrate: 0` and puts the value in `quality` as a
 * human label like "128 kbps". Invidious gives `bitrate` as a numeric
 * string in bps ("135033"). The first parseable integer from either
 * field is enough to rank correctly within either format.
 */
function streamAudioScore(stream) {
    return parseInt(stream?.bitrate, 10)
        || parseInt(stream?.quality, 10)
        || parseInt(stream?.audioQuality, 10)
        || 0;
}

/**
 * Score a video stream for ranking. Piped sets `height: 0` on most
 * streams and exposes the resolution in `quality` ("360p" / "720p").
 * Invidious normalisation precomputes `height` from `qualityLabel` /
 * `resolution`, so it's reliable on that side.
 */
function streamVideoScore(stream) {
    return parseInt(stream?.height, 10)
        || parseHeight(stream?.qualityLabel || stream?.quality
            || stream?.resolution || '');
}

function isUsablePrivateStream(stream, mode) {
    if (!stream?.url) return false;
    if (isDirectGoogleMediaUrl(stream.url)) return false;
    if (isProbablyHls(stream.url, stream)) return false;
    if (mode === 'audio') return isOriginalAudioTrack(stream);
    return stream.videoOnly !== true && streamVideoScore(stream) > 0;
}

/**
 * Human-readable quality label for the UI ("128 kbps", "720p"). Used in
 * the FAB busy state and toast text. Without formatting, Invidious's raw
 * adaptive-format bitrate (a bps integer like "135033") would leak into
 * the UI, which looks like a tracking number or download progress.
 */
function describeStreamQuality(stream, mode) {
    if (mode === 'audio') {
        // Piped audio already carries a human label: "128 kbps".
        const label = String(stream?.quality || '');
        if (/k?bps/i.test(label)) return label;

        // Invidious adaptive audio gives bps in stream.bitrate.
        const bps = parseInt(stream?.bitrate, 10);
        if (bps > 0) return `${Math.round(bps / 1000)} kbps`;
        return 'audio';
    }

    // Video — qualityLabel is the cleanest source ("720p" / "720p60") on
    // Invidious; Piped surfaces it in quality. Synthesise from height as
    // a last resort.
    const label = String(stream?.qualityLabel || stream?.quality || '');
    if (/^\d+p/i.test(label)) return label;
    const height = streamVideoScore(stream);
    return height > 0 ? `${height}p` : 'video';
}

/**
 * Detect bot/captcha walls in Piped error messages. These warrant a longer
 * cooldown because the instance won't recover by retrying soon.
 */
function isBotOrLoginFailure(text) {
    const s = String(text || '').toLowerCase();
    return s.includes('login_required') || s.includes('sign in to confirm')
        || s.includes('not a bot') || s.includes('po token') || s.includes('potoken')
        || s.includes('companion is starting') || s.includes('youtube probably temporarily blocked');
}

function formatBytes(n) {
    const v = Number(n || 0);
    if (v < 1024) return `${v.toFixed(0)} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
    return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec) { return `${formatBytes(bytesPerSec)}/s`; }

/* ── Per-session private-provider health ───────────────────────────────── */

function hasUsableStreams(data, mode) {
    if (!data) return false;
    const streams = mode === 'audio' ? data.audioStreams : data.videoStreams;
    return Array.isArray(streams) && streams.some(stream => isUsablePrivateStream(stream, mode));
}

function isPrivateCancelled() { return S.privateCancelRequested; }

/* ── Network with provider-friendly headers ─────────────────────────────── */

/** Default Piped headers. Some instances expect requests to resemble piped.video. */
const PIPED_HEADERS = Object.freeze({
    Accept: 'application/json',
    Origin: CFG.api.spoofedOrigin,
    Referer: CFG.api.spoofedReferer,
});
const INVIDIOUS_HEADERS = Object.freeze({ Accept: 'application/json' });

const PRIVATE_PROVIDER_INFO = Object.freeze({
    piped: {
        id: 'piped',
        label: 'Piped',
        headers: PIPED_HEADERS,
        loadInstances: getPipedInstances,
        streamUrl: (instance, videoId) => `${instance}/streams/${encodeURIComponent(videoId)}`,
        normalizeData: data => data,
    },
    invidious: {
        id: 'invidious',
        label: 'Invidious',
        headers: INVIDIOUS_HEADERS,
        loadInstances: getInvidiousInstances,
        streamUrl: (instance, videoId) => {
            const url = new URL(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`);
            url.searchParams.set('local', 'true');
            url.searchParams.set('region', 'US');
            return url.href;
        },
        normalizeData: normalizeInvidiousVideoData,
    },
});

function selectedPrivateProviders() {
    const choice = readPrivateProvider(S.privateProvider);
    return choice === 'both'
        ? [PRIVATE_PROVIDER_INFO.piped, PRIVATE_PROVIDER_INFO.invidious]
        : [PRIVATE_PROVIDER_INFO[choice] || PRIVATE_PROVIDER_INFO.piped];
}

/**
 * Strict GM4 request wrapper. Greasemonkey's GM.xmlHttpRequest does not expose
 * a portable abort handle, so cancellation is cooperative: callers set
 * S.privateCancelRequested and skip any further work once the current network
 * request finishes or times out.
 */
function gmRequest({ method = 'GET', url, headers = {}, responseType = 'text', timeout, onprogress }) {
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve({
                ok: false,
                status: null,
                reason: null,
                responseHeaders: '',
                response: null,
                responseText: '',
                finalUrl: url,
                ...result,
            });
        };
        const fail = reason => (r = {}) => finish({
            ok: false,
            status: Number.isFinite(r.status) ? r.status : null,
            reason,
            responseHeaders: String(r.responseHeaders || ''),
            response: r.response ?? null,
            responseText: r.responseText || '',
            finalUrl: r.finalUrl || url,
        });

        try {
            const details = {
                method,
                url,
                headers,
                responseType,
                timeout: timeout || CFG.api.metaTimeout,
                onload(r = {}) {
                    const status = Number.isFinite(r.status) ? r.status : null;
                    finish({
                        ok: status >= 200 && status < 300,
                        status,
                        responseHeaders: String(r.responseHeaders || ''),
                        response: r.response ?? null,
                        responseText: r.responseText || '',
                        finalUrl: r.finalUrl || url,
                    });
                },
                onerror: fail('network'),
                ontimeout: fail('timeout'),
                onabort: fail('abort'),
            };

            if (typeof onprogress === 'function') details.onprogress = onprogress;
            GM.xmlHttpRequest(details);
        } catch (err) {
            finish({ ok: false, reason: 'throw', error: err });
        }
    });
}

async function fetchJson(url, timeout) {
    const r = await gmRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        responseType: 'json',
        timeout,
    });

    const data = parseJsonMaybe(r.response || r.responseText);
    if (!r.ok) {
        return {
            ok: false,
            error: r.status ? `HTTP ${r.status}` : (r.reason || 'network'),
            status: r.status,
            data,
        };
    }
    return { ok: !!data, error: data ? null : 'bad-json', status: r.status, data };
}

async function fetchText(url, timeout) {
    const r = await gmRequest({
        method: 'GET',
        url,
        headers: { Accept: 'text/plain, application/json, */*' },
        responseType: 'text',
        timeout,
    });

    if (!r.ok) {
        return {
            ok: false,
            error: r.status ? `HTTP ${r.status}` : (r.reason || 'network'),
            status: r.status,
            text: '',
        };
    }
    return { ok: true, error: null, status: r.status, text: r.responseText || '' };
}

/* ── Parallel private-provider stream batch probe ────────────────────────── */

/**
 * Probe provider stream endpoints across one batch concurrently. Strict GM4
 * does not give us a portable abort handle, so the batch waits for every
 * mirror to return, fail, or time out. Every usable response is then handed
 * to the download job ordered by metadata response time.
 */
async function raceStreamsRequest(videoId, instances, mode, provider) {
    if (!instances.length) return { ok: false, provider, winners: [], failed: [] };

    const jobs = instances.map(async instance => {
        const startedAt = performance.now();
        const url = provider.streamUrl(instance, videoId);
        const r = await gmRequest({
            method: 'GET',
            url,
            headers: provider.headers,
            responseType: 'json',
            timeout: CFG.api.streamsTimeout,
        });

        if (isPrivateCancelled()) return { cancelled: true, instance };

        const raw = parseJsonMaybe(r.response || r.responseText);
        const data = raw ? provider.normalizeData(raw, instance) : null;
        const message = raw?.message || raw?.error || raw?.reason
            || data?.message || data?.error || data?.reason || null;

        if (r.ok && hasUsableStreams(data, mode)) {
            return {
                winner: true,
                provider,
                instance,
                data,
                responseMs: performance.now() - startedAt,
            };
        }

        let killHost = false;
        let hardKill = false;
        if (r.status >= 500 && r.status < 600) killHost = true;
        if (r.reason === 'network' || r.reason === 'timeout' || r.reason === 'throw') killHost = true;
        if (isBotOrLoginFailure(message)) { killHost = true; hardKill = true; }

        if (killHost) {
            markEndpointDead(provider.id, instance,
                hardKill ? CFG.api.hardFailureTtlMs : CFG.api.failureTtlMs);
        }

        return {
            provider: provider.id,
            instance,
            status: r.status,
            reason: data ? 'no-streams' : (r.reason || 'bad-response'),
            message,
            killedHost: killHost,
        };
    });

    const results = await Promise.all(jobs);
    if (isPrivateCancelled() || results.some(result => result.cancelled)) {
        return { ok: false, cancelled: true, provider, winners: [], failed: [] };
    }

    const winners = results
        .filter(result => result.winner)
        .map(({ winner, ...entry }) => entry)
        .sort((a, b) => a.responseMs - b.responseMs);
    // No need to filter cancelled — the early-return above bails if any are.
    const failed = results.filter(result => !result.winner);

    return { ok: winners.length > 0, provider, winners, failed };
}

/* ── Progress + download ────────────────────────────────────────────────── */

/** Look up the progress widget's elements; returns null if any are missing. */
function getProgressEls() {
    const wrap = document.getElementById('rt_progress');
    const fill = document.getElementById('rt_progress_fill');
    const pctEl = document.getElementById('rt_progress_pct');
    const labelEl = document.getElementById('rt_progress_label');
    const metaEl = document.getElementById('rt_progress_meta');
    if (!wrap || !fill || !pctEl || !labelEl || !metaEl) return null;
    return { wrap, fill, pctEl, labelEl, metaEl };
}

function setProgress(pct, label, meta, state = 'active') {
    const els = getProgressEls();
    if (!els) return;
    const { wrap, fill, pctEl, labelEl, metaEl } = els;

    const hasPercent = Number.isFinite(pct);
    const clamped = hasPercent ? Math.max(0, Math.min(100, pct)) : 0;
    wrap.classList.add('show');
    wrap.dataset.state = state;
    wrap.classList.toggle('indeterminate', !hasPercent);
    fill.style.width = hasPercent ? `${clamped}%` : '35%';
    pctEl.textContent = hasPercent ? `${clamped.toFixed(0)}%` : '—%';
    labelEl.textContent = label || 'Preparing…';
    metaEl.textContent = meta || '';
}

function resetProgress(delay = 0) {
    const run = () => {
        const els = getProgressEls();
        if (!els) return;
        const { wrap, fill, pctEl, labelEl, metaEl } = els;
        wrap.classList.remove('show', 'indeterminate');
        wrap.dataset.state = 'idle';
        fill.style.width = '0%';
        pctEl.textContent = '0%';
        labelEl.textContent = 'Ready';
        metaEl.textContent = '';
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
}

function setBtnBusy(btn, label) {
    if (!btn) return;
    btn.setAttribute('data-state', 'loading');
    btn.setAttribute('data-indeterminate', 'true');
    setProgress(NaN, label, 'Contacting private mirrors…', 'active');
}

function setBtnProgress(btn, pct, label) {
    if (!btn) return;
    btn.setAttribute('data-state', 'loading');
    if (Number.isFinite(pct)) btn.removeAttribute('data-indeterminate');
    else btn.setAttribute('data-indeterminate', 'true');
    setProgress(pct, 'Downloading privately', label, 'active');
}

function resetBtn(btn) {
    if (!btn) return;
    btn.removeAttribute('data-state');
    btn.removeAttribute('data-indeterminate');
}

function requestStopAfterCurrentRequest() {
    if (!S.downloading) { toast('No active private download', 'warn'); return; }
    S.privateCancelRequested = true;
    toast('Stopping after current request…', 'warn');
    setProgress(NaN, 'Stopping after current request…', 'The current GM4 request will complete or time out first.', 'active');
    uiSync();
}

function parseResponseHeaders(headers, fallbackSize = 0) {
    const text = String(headers || '');
    const crMatch = text.match(/Content-Range:\s*bytes\s+\d+-\d+\/(\d+|\*)/i);
    const clMatch = text.match(/Content-Length:\s*(\d+)/i);
    const ctMatch = text.match(/Content-Type:\s*([^\r\n;]+)/i);

    let total = 0;
    if (crMatch && crMatch[1] !== '*') total = parseInt(crMatch[1], 10) || 0;
    else if (clMatch) total = parseInt(clMatch[1], 10) || 0;
    if (!total && fallbackSize > 0) total = fallbackSize;

    const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : '';
    const isMedia = !contentType
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
        || contentType === 'application/octet-stream'
        || contentType === 'binary/octet-stream';

    return { total, contentType, isMedia };
}

/**
 * Probe a media URL before fetching it as a blob. HEAD avoids pulling the body
 * when the proxy exposes usable media headers. If HEAD is blocked or
 * inconclusive, a one-byte ranged GET is used as a stricter fallback and only
 * accepted when the server honors Range with 206 Partial Content.
 */
async function probeMediaUrl(url) {
    try {
        const head = await gmRequest({
            method: 'HEAD',
            url,
            headers: { Accept: 'video/*, audio/*, application/octet-stream, */*' },
            responseType: 'text',
            timeout: CFG.api.metaTimeout,
        });
        const headMeta = parseResponseHeaders(head.responseHeaders);
        const headLooksLikeMedia = !!headMeta.contentType && headMeta.isMedia;
        if (head.ok && headLooksLikeMedia && headMeta.total > 0) {
            return { ok: true, total: headMeta.total, status: head.status, contentType: headMeta.contentType };
        }

        const get = await gmRequest({
            method: 'GET',
            url,
            headers: { Range: 'bytes=0-0' },
            responseType: 'blob',
            timeout: CFG.api.metaTimeout,
        });
        const blobSize = get.response instanceof Blob ? get.response.size : 0;
        const getMeta = parseResponseHeaders(get.responseHeaders, blobSize);
        const ok = get.ok && get.status === 206 && getMeta.total > 0 && getMeta.isMedia;
        return {
            ok,
            total: getMeta.total,
            status: get.status,
            contentType: getMeta.contentType,
            reason: ok ? null : (get.reason || 'probe-rejected'),
        };
    } catch (err) {
        return { ok: false, total: 0, status: null, contentType: '', reason: 'throw', error: err };
    }
}

function triggerBlobDownload(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        // Keep the object URL alive long enough for the browser to claim the
        // download (sub-second on every tested platform). 5s is comfortably
        // conservative without pinning hundreds of MB of blob memory for a
        // full minute after the click.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    }
}

async function downloadUrlWithProgress(url, filename, btn, sourceLabel) {
    if (!url) return { ok: false, reason: 'missing-url' };

    const startedAt = performance.now();
    let lastLoaded = 0;
    let lastAt = startedAt;
    let bestRate = 0;
    let lastRate = 0;

    try {
        const response = await gmRequest({
            method: 'GET',
            url,
            // Preserve Invidious/Piped proxy behaviour that performs better
            // with an explicit open-ended range while still requesting the
            // whole resource.
            headers: { Range: 'bytes=0-' },
            responseType: 'blob',
            timeout: readPrivateDownloadTimeoutMs(S.privateDownloadTimeoutMs),
            onprogress(e) {
                const now = performance.now();
                const loaded = Number(e.loaded || 0);
                const total = Number(e.total || 0);
                const deltaBytes = Math.max(0, loaded - lastLoaded);
                const deltaSec = Math.max(0.001, (now - lastAt) / 1000);
                const instantRate = deltaBytes / deltaSec;
                const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
                const avgRate = loaded / elapsedSec;

                lastLoaded = loaded;
                lastAt = now;
                lastRate = instantRate || avgRate;
                bestRate = Math.max(bestRate, avgRate, instantRate);

                const lengthComputable = !!e.lengthComputable && total > 0;
                const pct = lengthComputable ? (loaded / total) * 100 : NaN;
                const label = lengthComputable
                    ? `${formatBytes(loaded)} / ${formatBytes(total)} · ${formatSpeed(lastRate)}`
                    : `${formatBytes(loaded)} · ${formatSpeed(lastRate)}`;
                setBtnProgress(btn, pct, label);

                if (S.privateCancelRequested) {
                    setProgress(pct, 'Stopping after current request…', label, 'active');
                }
            },
        });

        if (isPrivateCancelled()) {
            return { ok: false, reason: 'cancel', bestRate, lastRate, loaded: lastLoaded };
        }

        if (!response.ok) {
            return { ok: false, reason: response.reason || 'download-error', status: response.status };
        }

        const blob = response.response instanceof Blob ? response.response : null;
        if (!blob || blob.size <= 0) return { ok: false, reason: 'empty-blob' };

        const meta = parseResponseHeaders(response.responseHeaders, blob.size);
        if (!meta.isMedia) {
            return {
                ok: false,
                reason: 'non-media',
                status: response.status,
                contentType: meta.contentType,
            };
        }

        triggerBlobDownload(blob, filename);
        setProgress(100, 'Download complete',
            `${sourceLabel} · ${formatSpeed(bestRate || lastRate)}`, 'done');
        resetProgress(2400);
        return { ok: true, reason: 'done', bestRate };
    } catch (err) {
        console.warn('[RainTube] GM4 blob download failed:', { source: sourceLabel, url, filename, error: err });
        return { ok: false, reason: 'download-throw', error: err };
    }
}


function openConverterTab(videoId, format) {
    if (!videoId) { toast('⚠ Open a video first', 'warn'); return; }
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const wantedFormat = format === 'audio' ? 'mp3' : 'mp4';
    const fallback = new URL(CFG.dl.fallbackUrl);
    // Keep the autofill payload in the fragment so the browser does not send
    // the YouTube URL to CnvMP3 before the user chooses to submit the form.
    fallback.hash = new URLSearchParams({ rt_url: watchUrl, rt_format: wantedFormat }).toString();
    void GM.openInTab(fallback.href, false);
}

/* ── CnvMP3 autofill (rewritten) ────────────────────────────────────────── */

/*
   The CnvMP3 page has three dropdowns: Quality (video resolution), Bitrate
   (audio kbps), and "MP3 / MP4" (format). The autofill path only needs the
   visible YouTube URL field plus the format dropdown.

   The robust approach:
     1. Find every visible dropdown-icon.svg image on the page.
     2. Walk upward to the most plausible clickable wrapper, preferring real
        buttons, role=button, tabindex, aria-expanded, onclick, or cursor:pointer.
     3. Identify the format dropdown from nearby heading text rather than from
        option text, so the MP3 option and the "MP3 / MP4" label do not collide.
     4. Click the wrapper, then click the requested MP3/MP4 option when it is
        visible. Both directions are explicit because CnvMP3 may remember the
        user's previous selection.
*/

function getFallbackPayloadFromUrl() {
    const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    return {
        url: (hash.get('rt_url') || '').trim(),
        format: (hash.get('rt_format') || '').trim().toLowerCase(),
    };
}

function isValidYouTubeUrlForFallback(value) {
    const s = String(value || '').trim();
    try {
        const u = new URL(s);
        const host = u.hostname.toLowerCase();
        return host === 'youtu.be' || host.endsWith('.youtu.be')
            || host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch { return false; }
}

function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
        && style.visibility !== 'hidden' && style.display !== 'none'
        && Number(style.opacity || 1) !== 0;
}

function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizedText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Find the YouTube URL input. CnvMP3 has multiple inputs (one per supported
 * site); the visible YouTube one is what we want.
 */
function findCnvMp3UrlField() {
    const candidates = Array.from(document.querySelectorAll('input, textarea')).filter(el => {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
        const type = String(el.getAttribute('type') || '').toLowerCase();
        return isVisible(el) && !el.disabled && !el.readOnly
            && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'password'].includes(type);
    });

    const hintFor = el => [el.placeholder, el.name, el.id, el.className,
        el.getAttribute?.('aria-label')].filter(Boolean).join(' ').toLowerCase();

    // Prefer one whose placeholder/name/ARIA label mentions YouTube.
    const ytField = candidates.find(el => hintFor(el).includes('youtube'));
    if (ytField) return ytField;

    // Otherwise pick a URL/link/paste-looking input.
    const urlish = candidates.find(el => {
        const hint = hintFor(el);
        return hint.includes('url') || hint.includes('link') || hint.includes('paste');
    });
    return urlish || candidates[0] || null;
}

/**
 * For a given dropdown-icon image, find its clickable wrapper. Prefer actual
 * clickable ancestors, but keep a near-parent fallback for framework builds
 * that bind handlers to a plain wrapper.
 */
function findClickWrapperForIcon(iconImg) {
    let node = iconImg.parentElement;
    let fallback = null;

    for (let steps = 0; node && steps < 6; steps++, node = node.parentElement) {
        if (!isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 16) continue;

        if (!fallback && steps <= 2) fallback = node;

        const style = getComputedStyle(node);
        const role = String(node.getAttribute?.('role') || '').toLowerCase();
        const clickable = node.tagName === 'BUTTON'
            || role === 'button'
            || node.onclick
            || node.tabIndex >= 0
            || node.hasAttribute?.('aria-expanded')
            || style.cursor === 'pointer';

        if (clickable) return node;
    }

    return fallback || iconImg.parentElement;
}

/**
 * For a dropdown wrapper, identify which dropdown it controls. We do this
 * by looking at the previous element-sibling chain for a section heading
 * (Quality / Bitrate / MP3 / MP4).
 */
function dropdownKindFromText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (text === 'QUALITY') return 'quality';
    if (text === 'BITRATE') return 'bitrate';
    if (text === 'MP3 / MP4' || text === 'MP3/MP4' || text === 'FORMAT') return 'format';
    return null;
}

function identifyDropdownKind(wrapper) {
    for (let node = wrapper, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
        let prev = node.previousElementSibling;
        for (let steps = 0; prev && steps < 5; prev = prev.previousElementSibling, steps++) {
            const kind = dropdownKindFromText(normalizedText(prev));
            if (kind) return kind;
        }

        // Some framework builds wrap the heading and trigger in one section
        // instead of sibling nodes. Keep this narrow and require exactly one
        // heading kind so a compact container holding all dropdowns cannot
        // misidentify the format dropdown as Quality just because Quality is
        // mentioned earlier in the same text block.
        const text = normalizedText(node);
        if (text.length <= 90) {
            const hits = [];
            if (/\bQUALITY\b/i.test(text)) hits.push('quality');
            if (/\bBITRATE\b/i.test(text)) hits.push('bitrate');
            if (/\b(MP3\s*\/\s*MP4|FORMAT)\b/i.test(text)) hits.push('format');
            if (hits.length === 1) return hits[0];
        }
    }
    return null;
}

/** Locate the format dropdown trigger by finding all dropdown-icons and identifying. */
function findFormatDropdownTrigger() {
    const icons = Array.from(document.querySelectorAll('img'))
        .filter(img => /dropdown-icon\.svg/i.test(String(img.src || img.getAttribute('src') || '')))
        .filter(isVisible);

    for (const icon of icons) {
        const wrapper = findClickWrapperForIcon(icon);
        if (!wrapper) continue;
        if (identifyDropdownKind(wrapper) === 'format') return wrapper;
    }
    return null;
}

/**
 * After clicking the trigger, the option list becomes visible nearby. We
 * find it by scanning for visible elements whose normalized text equals the
 * target option name AND which are NOT the trigger we just clicked AND
 * which don't themselves contain a dropdown icon.
 */
function findOptionNear(trigger, optionText) {
    const target = String(optionText).toUpperCase();
    const container = trigger.parentElement || document.body;

    // Search near the trigger first, then the document body for portals.
    const roots = [];
    for (const root of [container, container.parentElement, document.body]) {
        if (root && !roots.includes(root)) roots.push(root);
    }

    for (const root of roots) {
        for (const el of root.querySelectorAll('*')) {
            if (el === trigger || trigger.contains(el) || el.contains(trigger)) continue;
            if (!isVisible(el)) continue;
            if (el.querySelector?.('img')) continue;
            if (normalizedText(el).toUpperCase() === target) return el;
        }
    }
    return null;
}

/**
 * Click the trigger, then wait for the desired option to appear and click it.
 * Uses HTMLElement.click() — that triggers more of the framework's click
 * pathways than synthesized PointerEvents.
 */
function openDropdownAndPick(trigger, optionText, timeoutMs = 1800) {
    return new Promise(resolve => {
        if (!trigger) { resolve(false); return; }

        // If the option is already visible (some pages show all options
        // statically), just click it.
        const existing = findOptionNear(trigger, optionText);
        if (existing) {
            try { existing.click(); } catch {}
            resolve(true);
            return;
        }

        // Open the dropdown, then immediately re-check in case the option was
        // rendered synchronously before the observer starts.
        try { trigger.click(); } catch {}

        const immediate = findOptionNear(trigger, optionText);
        if (immediate) {
            try { immediate.click(); } catch {}
            resolve(true);
            return;
        }

        let timer = null;
        const root = trigger.parentElement?.parentElement || document.body;

        const observer = new MutationObserver(() => {
            const opt = findOptionNear(trigger, optionText);
            if (opt) {
                observer.disconnect();
                if (timer) clearTimeout(timer);
                try { opt.click(); } catch {}
                resolve(true);
            }
        });
        observer.observe(root, {
            childList: true, subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'aria-hidden', 'aria-expanded', 'hidden'],
        });

        timer = setTimeout(() => {
            // One last synchronous attempt before giving up — in case the
            // observer missed the visibility transition.
            const lastChance = findOptionNear(trigger, optionText);
            observer.disconnect();
            if (lastChance) {
                try { lastChance.click(); } catch {}
                resolve(true);
            } else {
                resolve(false);
            }
        }, timeoutMs);
    });
}

async function trySetCnvMp3Format(format) {
    const wanted = format === 'mp4' ? 'MP4' : format === 'mp3' ? 'MP3' : null;
    if (!wanted) return false;

    for (let attempt = 0; attempt < 3; attempt++) {
        const trigger = findFormatDropdownTrigger();
        if (!trigger) {
            console.warn('[RainTube] CnvMP3 format dropdown trigger not found.');
            return false;
        }

        if (normalizedText(trigger).toUpperCase() === wanted) return true;

        if (await openDropdownAndPick(trigger, wanted, 1800)) return true;

        // Short rest before retrying — gives the page time to settle.
        await new Promise(r => setTimeout(r, 300));
    }

    console.warn(`[RainTube] CnvMP3 ${wanted} selection failed after 3 attempts.`);
    return false;
}

function waitForElement(finder, intervalMs = 200, maxAttempts = 100) {
    return new Promise(resolve => {
        let attempts = 0;
        const tick = () => {
            attempts++;
            const el = finder();
            if (el) { resolve(el); return; }
            if (attempts >= maxAttempts) { resolve(null); return; }
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

async function runCnvMp3Autofill() {
    const payload = getFallbackPayloadFromUrl();
    if (!payload.url || !isValidYouTubeUrlForFallback(payload.url)) return;

    const field = await waitForElement(findCnvMp3UrlField, 200, 100);
    if (!field) return;

    setNativeValue(field, payload.url);

    // Re-check after a beat in case the page revalidates and clears the value.
    setTimeout(() => {
        if (field.value !== payload.url) setNativeValue(field, payload.url);
    }, 300);

    if (payload.format === 'mp3' || payload.format === 'mp4') {
        // Wait briefly for the dropdown icons to be in the DOM, then set the
        // explicit format. This matters in both directions because CnvMP3 can
        // remember a previous MP4/MP3 selection between visits.
        await waitForElement(findFormatDropdownTrigger, 200, 50);
        await trySetCnvMp3Format(payload.format);
    }

    try { field.focus(); field.select?.(); } catch {}
}

/* ── Piped instance discovery (docs markdown source) ───────────────────── */

function isInstanceCacheFresh(cache) {
    return !!cache?.values?.length
        && (Date.now() - cache.loadedAt) < CFG.instances.cacheTtlMs;
}

function limitInstances(urls) {
    return uniqUrls(urls).slice(0, CFG.api.maxDynamicInstancesPerProvider);
}

function isPipedApiHost(url) {
    const host = normalizeHost(url).toLowerCase();
    return host.includes('pipedapi') || host.includes('piped-api') || host.includes('api-piped')
        || host === 'api.piped.yt' || host.startsWith('api.piped.');
}

async function loadInstancesFromMd() {
    const result = await fetchText(CFG.instances.mdUrl, CFG.api.metaTimeout);
    if (isPrivateCancelled()) return null;
    if (!result.ok || !result.text) return [];

    return limitInstances(
        (result.text.match(/https:\/\/[^\s)\]>"'`]+/gi) || [])
            .map(normalizeBaseUrl).filter(Boolean).filter(isPipedApiHost));
}

async function getPipedInstances() {
    const cache = instanceCache.piped;
    if (isInstanceCacheFresh(cache)) return cache.values;

    const values = await loadInstancesFromMd();
    if (values === null) return null; // cancelled
    if (!values?.length) {
        console.warn('[RainTube] Piped public instance source returned empty.');
        return [];
    }

    cache.loadedAt = Date.now();
    cache.values = values;
    console.info('[RainTube] Loaded Piped instances:', values.length);
    return values;
}

/* ── Private candidate selection (quality-aware) ────────────────────────── */

function isUsableInvidiousInstance(entry) {
    const meta = Array.isArray(entry) ? entry[1] : entry;
    if (!meta || meta.type !== 'https') return false;
    if (meta.api !== true) return false;
    if (!normalizeBaseUrl(meta.uri)) return false;
    if (meta.monitor?.down === true) return false;
    return true;
}

async function getInvidiousInstances() {
    const cache = instanceCache.invidious;
    if (isInstanceCacheFresh(cache)) return cache.values;

    const result = await fetchJson(CFG.instances.invidiousJsonUrl, CFG.api.metaTimeout);
    if (isPrivateCancelled()) return null;
    if (!result.ok || !Array.isArray(result.data)) return [];

    const apiInstances = [];
    for (const entry of result.data) {
        if (!isUsableInvidiousInstance(entry)) continue;
        const meta = entry[1] || {};
        const url = normalizeBaseUrl(meta.uri);
        if (url) apiInstances.push(url);
    }

    const values = limitInstances(apiInstances);
    if (!values.length) {
        console.warn('[RainTube] Invidious instance source returned empty.');
        return [];
    }

    cache.loadedAt = Date.now();
    cache.values = values;
    console.info('[RainTube] Loaded Invidious instances:', values.length);
    return values;
}

function parseHeight(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    const text = String(value);
    // YouTube qualityLabel format: "<height>p" or "<height>p<fps>" (e.g. "720p60").
    // The number directly before the literal "p" is the height; the trailing
    // framerate must not be treated as part of it.
    const qualityMatch = /(\d+)\s*p/i.exec(text);
    if (qualityMatch) {
        const n = parseInt(qualityMatch[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    // Resolution format: "WIDTHxHEIGHT" (e.g. "1280x720"). Take the height.
    const resMatch = /(\d+)\s*x\s*(\d+)/i.exec(text);
    if (resMatch) {
        const n = parseInt(resMatch[2], 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    // Fallback: first run of digits ("hd720" → 720, plain "720" → 720).
    const numMatch = /\d+/.exec(text);
    if (numMatch) {
        const n = parseInt(numMatch[0], 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function normalizeInvidiousVideoData(data, instance) {
    if (!data || typeof data !== 'object') return null;

    const mapStream = (stream, extra = {}) => ({
        ...stream,
        ...extra,
        url: resolveMediaUrl(instance, stream?.url),
        mimeType: stream?.type || stream?.mimeType,
        format: stream?.container || stream?.format,
        height: parseHeight(stream?.height || stream?.qualityLabel || stream?.resolution || stream?.quality),
        bitrate: parseInt(String(stream?.bitrate || '').replace(/[^\d]/g, ''), 10) || 0,
    });

    const formatStreams = Array.isArray(data.formatStreams) ? data.formatStreams : [];
    const adaptiveFormats = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
    const isAudio = stream => /audio\//i.test(String(stream?.type || stream?.mimeType || ''))
        || !!stream?.audioQuality || !!stream?.audioSampleRate;
    const isVideo = stream => /video\//i.test(String(stream?.type || stream?.mimeType || ''))
        || !!stream?.qualityLabel || !!stream?.resolution;

    return {
        ...data,
        title: data.title,
        videoStreams: formatStreams.map(stream => mapStream(stream, { videoOnly: false })),
        audioStreams: adaptiveFormats
            .filter(stream => isAudio(stream) && !isVideo(stream))
            .map(stream => mapStream(stream, { audioOnly: true })),
    };
}

function pickPrivateCandidates(data, mode) {
    const isAudio = mode === 'audio';
    const rawStreams = isAudio ? data?.audioStreams : data?.videoStreams;
    const streams = Array.isArray(rawStreams) ? rawStreams : [];
    const scoreOf = isAudio ? streamAudioScore : streamVideoScore;

    // The audio filter prefers the original-language track when YouTube has
    // attached auto-translated dubs; the helper short-circuits to true on
    // streams without language metadata, so single-language videos are
    // untouched.
    //
    // For audio, the picker returns the highest-bitrate streams: YouTube's
    // free tiers (48 / 128 / 160 kbps depending on the video) are similar
    // enough between providers that exposing a chooser is more confusing
    // than useful.
    //
    // For video, there is no quality choice: public proxied APIs only expose
    // muxed/progressive downloads here, so just pick the best usable stream
    // the provider offers.
    return streams
        .filter(stream => isUsablePrivateStream(stream, mode))
        .map(s => ({ stream: s, score: scoreOf(s) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(entry => entry.stream);
}

/* ── Private download job (provider orchestration) ──────────────────────── */

class PrivateDownloadJob {
    constructor(videoId, mode, btn) {
        this.videoId = videoId;
        this.mode = mode;
        this.btn = btn;
        this.providers = selectedPrivateProviders();
        this.diagnostics = [];
    }

    begin() {
        // Manual retries are real retries: wipe in-memory dead list so a
        // previous pass does not sentence us to instant fallback.
        clearProviderFailures();
        S.downloading = true;
        S.privateCancelRequested = false;
        uiSync();
    }

    cleanup() {
        S.downloading = false;
        S.privateCancelRequested = false;
        resetBtn(this.btn);
        uiSync();
    }

    isCancelled() {
        return isPrivateCancelled();
    }

    providerListLabel() {
        return this.providers.map(provider => provider.label).join(' + ');
    }

    async run() {
        this.begin();
        try {
            setBtnBusy(this.btn, 'loading instances…');
            toast(`Loading ${this.providerListLabel()} instances…`, 'dl');

            const result = await this.tryProviders();
            this.finish(result);
            return result;
        } catch (err) {
            console.warn('[RainTube] Private download failed unexpectedly:', err);
            this.finish('failed');
            return 'failed';
        } finally {
            this.cleanup();
        }
    }

    finish(result) {
        if (result === 'success') return;

        if (result === 'cancelled') {
            toast('Private download cancelled', 'warn');
            resetProgress(900);
            return;
        }

        if (S.privateFallbackEnabled) {
            toast(`Opening ${CFG.dl.fallbackName}…`, 'dl');
            openConverterTab(this.videoId, this.mode);
        } else {
            toast('Private download failed', 'warn');
        }

        resetProgress(1400);
    }

    async tryProviders() {
        for (const provider of this.providers) {
            if (this.isCancelled()) return 'cancelled';
            const result = await this.tryProvider(provider);
            if (result === 'success' || result === 'cancelled') return result;
        }

        console.warn('[RainTube] All private providers exhausted:', this.diagnostics);
        return 'failed';
    }

    async tryProvider(provider) {
        const allInstances = await provider.loadInstances();
        if (allInstances === null || this.isCancelled()) return 'cancelled';
        if (!allInstances?.length) {
            console.warn(`[RainTube] No ${provider.label} instances available.`);
            return 'failed';
        }

        const pool = this.buildInstancePool(provider.id, allInstances);
        const batchSize = CFG.api.batchProbeSize;
        let cursor = 0;

        while (cursor < pool.length) {
            if (this.isCancelled()) return 'cancelled';

            const batch = pool.slice(cursor, cursor + batchSize);
            cursor += batchSize;

            const result = await this.tryBatch(provider, batch);
            if (result === 'success' || result === 'cancelled') return result;
        }

        console.warn(`[RainTube] All ${provider.label} mirrors exhausted.`);
        return 'failed';
    }

    buildInstancePool(providerId, instances) {
        // Public proxy performance is highly volatile. RainTube intentionally
        // keeps no private mirror speed history; each page session starts from
        // freshly discovered provider order plus in-memory dead-host cooldowns.
        const ordered = [...instances];
        const livePool = ordered.filter(inst => !isEndpointTemporarilyDead(providerId, inst));
        if (livePool.length) return livePool;

        clearProviderFailures(providerId);
        return ordered;
    }

    async tryBatch(provider, batch) {
        const hostsLabel = batch.slice(0, 3).map(b => normalizeHost(b)).join(', ');
        const suffix = batch.length > 3 ? ` +${batch.length - 3}` : '';
        const mirrorLabel = batch.length === 1 ? 'mirror' : 'mirrors';
        setBtnBusy(this.btn,
            `${provider.label}: checking ${batch.length} ${mirrorLabel} · ${hostsLabel}${suffix}…`);

        const batchResult = await raceStreamsRequest(this.videoId, batch, this.mode, provider);
        if (batchResult.cancelled || this.isCancelled()) return 'cancelled';

        this.recordRaceFailures(batchResult.failed);
        if (!batchResult.ok || !batchResult.winners?.length) return 'retry';

        for (const winner of batchResult.winners) {
            if (this.isCancelled()) return 'cancelled';
            const result = await this.tryRaceWinner(provider, winner);
            if (result === 'success' || result === 'cancelled') return result;
        }

        // Every mirror in this batch either failed metadata probing or failed
        // its usable media candidates. Only now advance to the next batch.
        return 'retry';
    }

    recordRaceFailures(failed) {
        for (const fail of failed) {
            this.diagnostics.push({
                provider: fail.provider,
                instance: fail.instance,
                status: fail.status,
                reason: fail.reason,
                killed: fail.killedHost,
            });
        }
    }

    async tryRaceWinner(provider, race) {
        const candidates = pickPrivateCandidates(race.data, this.mode);
        if (!candidates.length) {
            console.warn('[RainTube] Batch mirror had no usable candidates:', race.instance);
            return 'retry';
        }

        const title = sanitizeFilename(race.data.title || getVideoTitle() || this.videoId);
        const host = normalizeHost(race.instance);

        for (const stream of candidates) {
            if (this.isCancelled()) return 'cancelled';

            const candidate = this.prepareCandidate(provider, race.instance, stream, title, host);
            if (!candidate) continue;

            const result = await this.tryCandidate(provider, race, candidate);
            if (result === 'success' || result === 'cancelled') return result;
        }

        // A metadata-good mirror can still expose stale or video-specific media
        // URLs. Do not mark the whole endpoint dead for this session unless the
        // metadata request itself failed in raceStreamsRequest().
        return 'retry';
    }

    prepareCandidate(provider, instance, stream, title, host) {
        const mediaUrl = resolveMediaUrl(instance, stream.url);
        if (!mediaUrl || isDirectGoogleMediaUrl(mediaUrl) || isProbablyHls(mediaUrl, stream)) return null;

        const quality = describeStreamQuality(stream, this.mode);
        return {
            mediaUrl,
            host,
            quality,
            filename: `${title}.${extFromMimeOrFormat(stream, this.mode)}`,
            sourceLabel: `${provider.label} · ${quality}`,
        };
    }

    async tryCandidate(provider, race, candidate) {
        setBtnBusy(this.btn, `checking · ${candidate.quality} · ${candidate.host}…`);

        // A probe before the blob download keeps dead URLs and HTML error
        // pages from being fetched all the way into memory and offered as
        // a saved file.
        const probe = await probeMediaUrl(candidate.mediaUrl);
        if (this.isCancelled()) return 'cancelled';
        if (!probe.ok) {
            console.warn(`[RainTube] ${provider.label} probe rejected candidate:`, {
                instance: race.instance,
                mode: this.mode,
                quality: candidate.quality,
                status: probe.status,
                total: probe.total,
                contentType: probe.contentType,
                reason: probe.reason || 'empty-or-non-media',
            });
            return 'failed';
        }

        setBtnBusy(this.btn, `starting · ${candidate.quality} · ${candidate.host}…`);
        toast(`Downloading via ${provider.label} · ${candidate.quality}`, 'dl');

        const result = await downloadUrlWithProgress(
            candidate.mediaUrl, candidate.filename, this.btn, candidate.sourceLabel);

        if (result.ok) {
            console.info(`[RainTube] ${provider.label} download succeeded:`, {
                instance: race.instance,
                mode: this.mode,
                quality: candidate.quality,
                bestRate: result.bestRate,
            });
            return 'success';
        }

        if (result.reason === 'cancel') {
            // 'cancel' from the downloader implies S.privateCancelRequested
            // is already set; the inner gmRequest only saw the cancel flag
            // because it was already true.
            return 'cancelled';
        }
        console.warn(`[RainTube] ${provider.label} candidate failed:`, {
            instance: race.instance,
            mode: this.mode,
            quality: candidate.quality,
            reason: result.reason,
        });
        return 'failed';
    }
}

/* ── Download entrypoint ────────────────────────────────────────────────── */

async function downloadViaPublicApisOrFallback(videoId, mode, btn) {
    if (!videoId) { toast('⚠ Open a video first', 'warn'); return; }
    if (S.downloading) { toast('Download already running…', 'warn'); return; }

    if (!S.privateDownloadsEnabled) {
        toast(`Opening ${CFG.dl.fallbackName}…`, 'dl');
        openConverterTab(videoId, mode);
        return;
    }

    return new PrivateDownloadJob(videoId, mode, btn).run();
}

/* ── Toasts (redesigned) ────────────────────────────────────────────────── */

/*
   Each toast is a stack item. We support multiple visible toasts (e.g. quality
   change + download warning within a second of each other), they stack from bottom up,
   each carries its own dismiss progress bar, and optional action button.

   The container re-parents into document.fullscreenElement when fullscreen
   so toasts stay visible above the YouTube player chrome.
*/

const TOAST_VIEWPORT_MARGIN = 12;
const TOAST_VIDEO_SIDE_INSET = 16;
// Keep the stack clear of YouTube's controls/seeker so timeline clicks pass through.
const TOAST_VIDEO_CONTROL_CLEARANCE = 78;
const TOAST_VARIANT_META = Object.freeze({
    shorts:     { label: 'Shorts', icon: 'shorts' },
    quality:    { label: 'Quality', icon: 'quality' },
    stats:      { label: 'Statistics', icon: 'chart' },
    dl:         { label: 'Download', icon: 'private' },
    warn:       { label: 'Heads up', icon: 'warn' },
    off:        { label: '', icon: 'general' },
    default:    { label: '', icon: 'general' },
});

function resolveToastMeta(variant, opts = {}) {
    const base = TOAST_VARIANT_META[variant] || TOAST_VARIANT_META.default;
    return {
        label: opts.label ?? base.label,
        icon: opts.icon || base.icon,
    };
}

function getToastAnchorRect() {
    const candidates = [$player(), $video()];
    for (const el of candidates) {
        if (!el?.isConnected || typeof el.getBoundingClientRect !== 'function') continue;
        const rect = el.getBoundingClientRect();
        const visible = rect.width >= 120 && rect.height >= 80
            && rect.right > 0 && rect.bottom > 0
            && rect.left < window.innerWidth && rect.top < window.innerHeight;
        if (visible) return rect;
    }
    return null;
}

function syncToastPosition(container = document.getElementById('rt_toasts')) {
    if (!container) return;
    // The container persists in the DOM even with no toasts. Skip the
    // getBoundingClientRect + style writes when it's empty — otherwise every
    // scroll/resize frame pays for a forced reflow with nothing to position.
    if (!container.firstElementChild) return;
    const placement = readToastPlacementSetting(S.toastPlacement);

    const rect = getToastAnchorRect();
    const estimatedWidth = Math.min(380, Math.max(250, window.innerWidth - TOAST_VIEWPORT_MARGIN * 2));
    const estimatedHeight = 88;
    const maxHorizontal = Math.max(TOAST_VIEWPORT_MARGIN,
        window.innerWidth - TOAST_VIEWPORT_MARGIN - estimatedWidth);
    const maxVertical = Math.max(TOAST_VIEWPORT_MARGIN,
        window.innerHeight - TOAST_VIEWPORT_MARGIN - estimatedHeight);
    const [vertical, horizontal] = placement.split('-');
    const isTop = vertical === 'top';
    const isLeft = horizontal === 'left';
    const x = rect
        ? (isLeft ? rect.left + TOAST_VIDEO_SIDE_INSET : window.innerWidth - rect.right + TOAST_VIDEO_SIDE_INSET)
        : TOAST_VIEWPORT_MARGIN;
    const y = rect
        ? (isTop ? rect.top + TOAST_VIDEO_SIDE_INSET : window.innerHeight - rect.bottom + TOAST_VIDEO_CONTROL_CLEARANCE)
        : TOAST_VIEWPORT_MARGIN;
    const safeX = rect
        ? Math.min(maxHorizontal, Math.max(TOAST_VIEWPORT_MARGIN, x))
        : TOAST_VIEWPORT_MARGIN;
    const safeY = rect
        ? Math.min(maxVertical, Math.max(TOAST_VIEWPORT_MARGIN, y))
        : TOAST_VIEWPORT_MARGIN;

    container.classList.toggle('rt-toast-video-anchored', !!rect);
    container.classList.toggle('rt-toast-top', isTop);
    container.classList.toggle('rt-toast-bottom', !isTop);
    container.classList.toggle('rt-toast-left', isLeft);
    container.classList.toggle('rt-toast-right', !isLeft);
    container.style.setProperty('--rt-toast-top', isTop ? `${Math.round(safeY)}px` : 'auto');
    container.style.setProperty('--rt-toast-bottom', isTop ? 'auto' : `${Math.round(safeY)}px`);
    container.style.setProperty('--rt-toast-left', isLeft ? `${Math.round(safeX)}px` : 'auto');
    container.style.setProperty('--rt-toast-right', isLeft ? 'auto' : `${Math.round(safeX)}px`);
}

let toastPositionRaf = 0;
function scheduleToastPositionSync() {
    if (toastPositionRaf) return;
    toastPositionRaf = requestAnimationFrame(() => {
        toastPositionRaf = 0;
        syncToastPosition();
    });
}

function currentScaleX(el) {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 1;
    try {
        const matrix = new DOMMatrixReadOnly(transform);
        return Number.isFinite(matrix.a) ? matrix.a : 1;
    } catch {
        return 1;
    }
}

function getToastParent() {
    // When YouTube enters fullscreen it picks an ancestor element (typically
    // #movie_player or its container). Parent the toasts into that element
    // so they layer over the fullscreen content; otherwise use document.body.
    return document.fullscreenElement || document.body;
}

function getToastContainer() {
    const target = getToastParent();

    let el = Array.from(target.children).find(child => child.id === 'rt_toasts');
    if (!el) {
        el = mk('div', null, null, { id: 'rt_toasts' });
        target.appendChild(el);
    }

    const all = Array.from(document.querySelectorAll('#rt_toasts'));
    for (const existing of all) {
        if (existing === el) continue;
        while (existing.firstChild) el.appendChild(existing.firstChild);
        existing.remove();
    }
    syncToastPosition(el);
    return el;
}

function reparentToastsForCurrentLayer() {
    getToastContainer();
}

if (IS_YOUTUBE) {
    document.addEventListener('fullscreenchange', reparentToastsForCurrentLayer, { passive: true });
    window.addEventListener('resize', scheduleToastPositionSync, { passive: true });
    window.addEventListener('scroll', scheduleToastPositionSync, { passive: true });
}

function toast(message, variant = 'default', opts = {}) {
    const container = getToastContainer();
    const el = mk('div', `rt-toast rt-v-${variant}`);
    const meta = resolveToastMeta(variant, opts);

    const iconWrap = mk('span', 'rt-toast-ico');
    const builder = RT_ICONS[meta.icon];
    if (typeof builder === 'function') iconWrap.appendChild(builder());
    else iconWrap.appendChild(RT_ICONS.general());
    el.appendChild(iconWrap);

    // Heading row (small variant label + close X)
    const main = mk('div', 'rt-toast-main');
    const header = mk('div', 'rt-toast-header');
    if (meta.label) {
        header.appendChild(mk('span', 'rt-toast-kind', meta.label));
    }
    header.appendChild(mk('span', 'rt-toast-msg', message));

    main.appendChild(header);

    // Optional action button (e.g. Undo).
    if (opts.action && opts.action.label && typeof opts.action.handler === 'function') {
        const btn = mk('button', 'rt-toast-action', opts.action.label, { type: 'button' });
        btn.addEventListener('click', () => {
            try { opts.action.handler(); } catch {}
            dismiss();
        });
        main.appendChild(btn);
    }
    el.appendChild(main);

    // Close button (always present)
    const close = mk('button', 'rt-toast-close', '×',
        { type: 'button', 'aria-label': 'Dismiss' });
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    // Dismiss progress bar
    const bar = mk('div', 'rt-toast-bar');
    el.appendChild(bar);

    container.appendChild(el);
    scheduleToastPositionSync();

    // Force reflow so the animation starts from 0.
    void el.offsetWidth;
    el.classList.add('show');

    const duration = opts.duration || S.toastDurationMs || TOAST_DURATION_DEFAULT_MS;
    bar.style.transition = `transform ${duration}ms linear`;
    bar.style.transform = 'scaleX(0)';

    let dismissed = false;
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(timer);
        el.classList.remove('show');
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 220);
    }

    // Pause-on-hover: freeze the bar at its current scaleX, cancel the timer.
    el.addEventListener('pointerenter', () => {
        if (dismissed) return;
        const scale = currentScaleX(bar);
        bar.style.transition = 'none';
        bar.style.transform = `scaleX(${scale})`;
        clearTimeout(timer);
    }, { passive: true });
    el.addEventListener('pointerleave', () => {
        if (dismissed) return;
        const scale = currentScaleX(bar);
        const remaining = Math.max(200, duration * scale);
        bar.style.transition = `transform ${remaining}ms linear`;
        bar.style.transform = 'scaleX(0)';
        timer = setTimeout(dismiss, remaining);
    }, { passive: true });

    let timer = setTimeout(dismiss, duration);
}

/* ── Tooltips ───────────────────────────────────────────────────────────── */

let _tooltipCleanupTimer = 0;
let _tooltipShowRaf = 0;
let _tooltipWindowEventsBound = false;

function getTooltip() {
    if (S._tooltip?.isConnected) return S._tooltip;
    S._tooltip = mk('div', null, null, { id: 'rt_tip' });
    document.body.appendChild(S._tooltip);
    return S._tooltip;
}

function clearTooltipShowCue() {
    if (_tooltipShowRaf) cancelAnimationFrame(_tooltipShowRaf);
    _tooltipShowRaf = 0;
}

function positionTooltip(anchor, tip) {
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const pad = 8;
    const placement = anchor.getAttribute('data-tip-place');
    let x = a.left - t.width - 10;
    let y = a.top + (a.height - t.height) / 2;
    if (placement === 'bottom') {
        x = a.left + (a.width - t.width) / 2;
        y = a.bottom + 10;
    } else if (x < pad) {
        x = a.right + 10;
    }
    if (x + t.width > window.innerWidth - pad) x = window.innerWidth - t.width - pad;
    if (y < pad) y = pad;
    if (y + t.height > window.innerHeight - pad) y = window.innerHeight - t.height - pad;
    tip.style.left = `${Math.max(pad, x)}px`;
    tip.style.top = `${Math.max(pad, y)}px`;
}

function showTooltip(anchor) {
    const text = anchor.getAttribute('data-tip');
    if (!text) return;
    const tip = getTooltip();
    if (_tooltipCleanupTimer) {
        clearTimeout(_tooltipCleanupTimer);
        _tooltipCleanupTimer = 0;
    }
    clearTooltipShowCue();
    const nativeStyle = anchor.getAttribute('data-tip-style') === 'native';
    tip.textContent = text;
    tip.classList.toggle('rt-tip-native', nativeStyle);
    tip.classList.toggle('rt-tip-rich', !nativeStyle);
    tip.classList.remove('show', 'rt-tip-hiding');
    positionTooltip(anchor, tip);
    void tip.offsetWidth;

    const reveal = () => {
        _tooltipShowRaf = 0;
        tip.classList.add('show');
    };
    _tooltipShowRaf = requestAnimationFrame(reveal);
}

function hideTooltip() {
    const tip = S._tooltip;
    if (!tip) return;
    clearTooltipShowCue();
    const nativeStyle = tip.classList.contains('rt-tip-native');
    const wasShown = tip.classList.contains('show');
    tip.classList.remove('show');
    if (_tooltipCleanupTimer) clearTimeout(_tooltipCleanupTimer);
    if (nativeStyle && wasShown) tip.classList.add('rt-tip-hiding');
    _tooltipCleanupTimer = setTimeout(() => {
        _tooltipCleanupTimer = 0;
        if (!tip.classList.contains('show')) {
            tip.classList.remove('rt-tip-native', 'rt-tip-rich', 'rt-tip-hiding');
        }
    }, nativeStyle ? 125 : 180);
}

function initTooltips(root = document) {
    const targets = root.matches?.('[data-tip]')
        ? [root, ...Array.from(root.querySelectorAll('[data-tip]'))]
        : Array.from(root.querySelectorAll('[data-tip]'));
    for (const el of targets) {
        if (el.dataset.tipBound === 'true') continue;
        el.dataset.tipBound = 'true';
        el.addEventListener('pointerenter', () => showTooltip(el), { passive: true });
        el.addEventListener('pointerleave', hideTooltip, { passive: true });
        el.addEventListener('focus', () => showTooltip(el));
        el.addEventListener('blur', hideTooltip);
    }
    if (!_tooltipWindowEventsBound) {
        _tooltipWindowEventsBound = true;
        window.addEventListener('scroll', hideTooltip, { passive: true });
        window.addEventListener('resize', hideTooltip, { passive: true });
    }
}

/* ── UI assembly ────────────────────────────────────────────────────────── */

/*
   Custom 24×24 marks. Each uses currentColor so parent classes can tint it.
   The feature icons stay geometric and small-screen friendly:
     - shorts: a vertical-phone "shorts" frame with a diagonal slash.
     - quality: a four-point sparkle.
     - private: a shield with a protected download arrow.
*/
function makeSvgIcon(pathData, opts = {}) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('rt-icon');
    if (opts.extraClass) svg.classList.add(opts.extraClass);
    // Build paths from an array of {d, fill, stroke, fillRule} objects.
    for (const layer of (Array.isArray(pathData) ? pathData : [pathData])) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', layer.d);
        if (layer.fill) path.setAttribute('fill', layer.fill);
        else path.setAttribute('fill', 'none');
        if (layer.stroke) path.setAttribute('stroke', layer.stroke);
        else path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', String(layer.strokeWidth || 1.8));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        if (layer.fillRule) path.setAttribute('fill-rule', layer.fillRule);
        svg.appendChild(path);
    }
    return svg;
}

/**
 * The RainTube brand mark. A raindrop containing a play-triangle cutout —
 * the drop reads as "rain," the inner triangle reads as "tube/video."
 * Single path with fill-rule:evenodd so the triangle is a true cutout
 * (transparent against the gradient backdrop).
 */
function makeRaintubeLogo(size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('rt-logo-svg');

    const path = document.createElementNS(ns, 'path');
    // Two subpaths:
    //   1. Raindrop outline (CW): apex at top, symmetric cubic bulges
    //      meeting at a rounded base.
    //   2. Play triangle (CCW): right-pointing, sits inside the drop's
    //      lower bulge. With fill-rule:evenodd the triangle is cut out.
    path.setAttribute('d', [
        // Drop
        'M12 2.2',
        'C 9 6.5, 4.5 11, 4.5 15',
        'A 7.5 7.5 0 0 0 19.5 15',
        'C 19.5 11, 15 6.5, 12 2.2',
        'Z',
        // Play triangle cutout (CCW)
        'M10 11.6',
        'L10 17',
        'L15 14.3',
        'Z',
    ].join(' '));
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('stroke', 'none');
    svg.appendChild(path);

    return svg;
}

/* ── Statistics (GM v4 storage, rewritten) ─────────────────────────────── */

const StatsStore = Object.freeze({
    getValue: readStoredValue,
    setValue: save,

    async getJson(key, fallback) {
        const raw = await readStoredValue(key, null);
        const parsed = parseJsonMaybe(raw);
        return parsed == null ? fallback : parsed;
    },

    setJson(key, value) {
        return save(key, JSON.stringify(value));
    },
});

const StatsTracker = (() => {
    const state = {
        loaded: false,
        enabled: true,
        range: 'daily',
        display: 'panel',
        metrics: { ...STATS_METRICS_DEFAULTS },
        buckets: {},
    };

    let dirty = false;
    let persistTimer = 0;
    let renderRaf = 0;
    let activeVideo = null;
    let watchTimer = 0;
    let lastWatchTickMs = 0;
    let currentChannelName = '';
    let currentChannelAvatar = '';
    let currentOpenKey = null;
    let attachRaf = 0;
    let inlineMountRaf = 0;
    let pendingOpen = null;
    const attachedVideos = new WeakSet();
    let inlineRetryTimers = [];
    let favoriteChannelIndex = 0;

    function clearInlineRetryTimers() {
        for (const timer of inlineRetryTimers) clearTimeout(timer);
        inlineRetryTimers = [];
    }

    const getRange = () => state.range;
    const getDisplay = () => state.display;
    const getEnabled = () => !!state.enabled;
    const isPanelEnabled = () => getEnabled() && statsDisplayHasPanel(state.display);
    const isInlineEnabled = () => getEnabled() && statsDisplayHasInline(state.display);
    const getMetrics = () => ({ ...state.metrics });

    function setMetric(key, value) {
        if (!STATS_METRICS_ORDER.includes(key)) return;
        state.metrics[key] = !!value;
        void StatsStore.setJson(CFG.storage.statsMetrics, state.metrics);
        applyVisibility();
    }

    function ensureBucket(date = statsDateKey()) {
        let bucket = state.buckets[date];
        if (!bucket) {
            bucket = state.buckets[date] = {
                shortsOpened: 0,
                shortsBlocked: 0,
                watchSec: 0,
                videosWatched: 0,
                channelSec: {},
                channelAvatar: {},
            };
        }
        // No defensive coercion needed here: sanitizeStatsBuckets validates
        // every field at load time, and every write site (recordShortsHidden,
        // recordOpen, tickWatchTime) starts from numeric values.
        return bucket;
    }

    function pruneBuckets() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - STATS_BUCKET_RETENTION_DAYS);
        const cutoffKey = statsDateKey(cutoff);
        for (const key of Object.keys(state.buckets)) {
            if (key < cutoffKey) delete state.buckets[key];
        }
    }

    function scheduleRender() {
        if (renderRaf) return;
        renderRaf = requestAnimationFrame(() => {
            renderRaf = 0;
            renderStatsPanelSlot();
            renderInlineCard();
        });
    }

    async function flush() {
        if (persistTimer) {
            clearTimeout(persistTimer);
            persistTimer = 0;
        }
        if (!dirty) return;
        dirty = false;
        pruneBuckets();
        await StatsStore.setJson(CFG.storage.statsBuckets, state.buckets);
    }

    function markDirty() {
        dirty = true;
        scheduleRender();
        if (!persistTimer) persistTimer = setTimeout(() => { void flush(); }, STATS_PERSIST_DEBOUNCE_MS);
    }

    function readChannelName() {
        return getVideoAuthor();
    }

    function readChannelAvatar() {
        const selectors = [
            'ytd-reel-video-renderer[is-active] #avatar img',
            'ytd-reel-video-renderer[is-active] yt-img-shadow#avatar img',
            'ytd-watch-metadata #owner #avatar img',
            'ytd-watch-metadata ytd-video-owner-renderer #avatar img',
            'ytd-watch-flexy ytd-video-owner-renderer #avatar img',
            'ytd-watch-flexy #owner #avatar img',
            '#owner #avatar img',
        ];
        for (const sel of selectors) {
            const img = document.querySelector(sel);
            const src = img?.currentSrc || img?.src || img?.getAttribute?.('src')
                || img?.getAttribute?.('data-thumb') || '';
            const clean = sanitizeStatsAvatarUrl(src);
            if (clean) return clean;
        }
        return '';
    }

    function recordShortsHidden(count) {
        if (!getEnabled()) return;
        const n = Math.max(0, Math.round(Number(count) || 0));
        if (!n || !state.loaded) return;
        const bucket = ensureBucket();
        bucket.shortsBlocked += n;
        markDirty();
    }

    function currentOpenFromRoute() {
        const shortsId = getShortsVideoId();
        if (shortsId) return { type: 'shorts', id: shortsId, key: `shorts:${shortsId}` };
        const videoId = getVideoId();
        if (videoId) return { type: 'video', id: videoId, key: `video:${videoId}` };
        return null;
    }

    function recordOpen(open = currentOpenFromRoute()) {
        if (!open?.id || !getEnabled()) return;
        if (!state.loaded) {
            pendingOpen = open;
            return;
        }

        const bucket = ensureBucket();
        if (open.type === 'shorts') bucket.shortsOpened += 1;
        else bucket.videosWatched += 1;
        markDirty();
    }

    function tickWatchTime() {
        if (!activeVideo || !lastWatchTickMs) return;
        const now = Date.now();
        const elapsed = (now - lastWatchTickMs) / 1000;
        lastWatchTickMs = now;
        if (!getEnabled()) return;
        if (document.hidden || activeVideo.paused || activeVideo.ended) return;
        // getVideoId() handles both /watch?v=... and /shorts/... URLs, so
        // Shorts and full videos contribute to the same overall watch-time total.
        if (!getVideoId()) return;

        const capped = Math.max(0, Math.min(elapsed, (STATS_WATCH_TICK_MS / 1000) + 1));
        if (capped <= 0) return;

        const bucket = ensureBucket();
        bucket.watchSec += capped;

        // Favorite channel is based on watched seconds, not opens. We only
        // re-query the DOM when we don't already have a name or avatar —
        // once metadata has been captured for the current video it doesn't
        // change, and avoiding the per-second querySelector sweep is a
        // meaningful saving across a long watch session.
        if (!currentChannelName) {
            const freshChannel = readChannelName();
            if (freshChannel) currentChannelName = freshChannel;
        }
        if (!currentChannelAvatar) {
            const freshAvatar = readChannelAvatar();
            if (freshAvatar) currentChannelAvatar = freshAvatar;
        }
        const channel = currentChannelName;
        if (channel) {
            bucket.channelSec[channel] = (bucket.channelSec[channel] || 0) + capped;
            if (currentChannelAvatar) bucket.channelAvatar[channel] = currentChannelAvatar;
        }
        markDirty();
    }

    function startWatch(video) {
        if (!getEnabled() || !video || document.hidden) return;
        if (activeVideo && activeVideo !== video) stopWatch(activeVideo);
        activeVideo = video;
        currentChannelName = readChannelName();
        currentChannelAvatar = readChannelAvatar();
        lastWatchTickMs = Date.now();
        if (!watchTimer) watchTimer = setInterval(tickWatchTime, STATS_WATCH_TICK_MS);
    }

    function stopWatch(video = activeVideo) {
        if (video && activeVideo && video !== activeVideo) return;
        if (watchTimer) {
            tickWatchTime();
            clearInterval(watchTimer);
            watchTimer = 0;
        }
        activeVideo = null;
        lastWatchTickMs = 0;
        currentChannelName = '';
        currentChannelAvatar = '';
    }

    function attachVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return;
        if (!attachedVideos.has(video)) {
            attachedVideos.add(video);
            const onPlay = () => startWatch(video);
            const onStop = () => stopWatch(video);
            video.addEventListener('play', onPlay, { passive: true });
            video.addEventListener('playing', onPlay, { passive: true });
            video.addEventListener('pause', onStop, { passive: true });
            video.addEventListener('ended', onStop, { passive: true });
            video.addEventListener('waiting', onStop, { passive: true });
            video.addEventListener('emptied', onStop, { passive: true });
        }
        if (!video.paused && !video.ended && !document.hidden) startWatch(video);
    }

    function attachCurrentVideo() {
        const video = document.querySelector('video.html5-main-video, video');
        if (video) attachVideo(video);
    }

    function scheduleAttachVideo(retry = false) {
        if (!attachRaf) {
            attachRaf = requestAnimationFrame(() => {
                attachRaf = 0;
                attachCurrentVideo();
            });
        }
        if (retry) {
            setTimeout(attachCurrentVideo, 650);
            setTimeout(attachCurrentVideo, 1800);
        }
    }

    function rangeKeyPrefix(range, now = new Date()) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        if (range === 'daily') return statsDateKey(now);
        if (range === 'monthly') return `${y}-${m}-`;
        if (range === 'yearly') return `${y}-`;
        return null;
    }

    function summary(range = state.range) {
        const cleanRange = readStatsRange(range);
        const prefix = rangeKeyPrefix(cleanRange);
        const keys = cleanRange === 'alltime'
            ? Object.keys(state.buckets)
            : cleanRange === 'daily'
                ? (state.buckets[prefix] ? [prefix] : [])
                : Object.keys(state.buckets).filter(key => key.startsWith(prefix));

        let shortsOpened = 0;
        let shortsBlocked = 0;
        let watchSec = 0;
        let videosWatched = 0;
        const channelSec = Object.create(null);
        const channelAvatar = Object.create(null);

        for (const key of keys) {
            const bucket = state.buckets[key];
            if (!bucket) continue;
            shortsOpened += Number(bucket.shortsOpened) || 0;
            shortsBlocked += Number(bucket.shortsBlocked) || 0;
            watchSec += Number(bucket.watchSec) || 0;
            videosWatched += Number(bucket.videosWatched) || 0;
            for (const [channel, sec] of Object.entries(bucket.channelSec || {})) {
                channelSec[channel] = (channelSec[channel] || 0) + (Number(sec) || 0);
            }
            // Avatars are sanitized at write (readChannelAvatar) and again
            // by sanitizeStatsBuckets at load, so they can be trusted here.
            for (const [channel, avatarUrl] of Object.entries(bucket.channelAvatar || {})) {
                if (channel && avatarUrl) channelAvatar[channel] = avatarUrl;
            }
        }

        const topFavoriteChannels = Object.entries(channelSec)
            .map(([name, sec]) => ({
                name,
                sec: Math.round(Number(sec) || 0),
                avatar: channelAvatar[name] || '',
            }))
            .filter(channel => channel.name && channel.sec > 0)
            .sort((a, b) => (b.sec - a.sec) || a.name.localeCompare(b.name))
            .slice(0, 5)
            .map((channel, index) => ({ ...channel, rank: index + 1 }));

        const favorite = topFavoriteChannels[0] || null;

        return {
            shortsOpened: Math.round(shortsOpened),
            shortsBlocked: Math.round(shortsBlocked),
            watchSec: Math.round(watchSec),
            videosWatched: Math.round(videosWatched),
            favoriteChannelName: favorite?.name || '',
            favoriteChannelAvatar: favorite?.avatar || '',
            favoriteChannelSec: favorite?.sec || 0,
            topFavoriteChannels,
        };
    }

    function isStatsUiNode(node) {
        if (!(node instanceof Element)) return false;
        return !!node.closest?.('#rt_inline_stats, #rt_stats_panel, #rt_panel, #rt_settings_root, #rt_toasts, #rt_tip');
    }

    function mutationTouchesOnlyRainTubeUi(record) {
        if (isStatsUiNode(record.target)) return true;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return !!nodes.length && nodes.every(node => {
            if (node instanceof Element) {
                return isStatsUiNode(node)
                    || node.matches?.('#rt_inline_stats, .rt-inline-stats, #rt_stats_panel, #rt_panel, #rt_settings_root, #rt_toasts, #rt_tip');
            }
            return true;
        });
    }

    function stopStatsSelectPropagation(event) {
        event.stopPropagation();
    }

    function metricDisplayFor(key, totals) {
        if (key === 'watchTime') {
            return {
                value: formatStatsDuration(totals.watchSec),
                sub: totals.watchSec > 0 ? 'videos + Shorts' : 'nothing yet',
            };
        }
        if (key === 'videosWatched') {
            return { value: formatStatsCount(totals.videosWatched), sub: 'opened' };
        }
        if (key === 'shortsOpened') {
            return { value: formatStatsCount(totals.shortsOpened), sub: 'opened' };
        }
        if (key === 'shortsBlocked') {
            return { value: formatStatsCount(totals.shortsBlocked), sub: 'blocked' };
        }
        // Unreachable in practice: both call sites filter favoriteChannel out
        // beforehand, and every other key in STATS_METRICS_ORDER is handled
        // above. If a new metric is ever added without a branch, the empty
        // result makes it visibly broken in the UI rather than silently zero.
        return { value: '', sub: '' };
    }

    function makeFavoriteChannelTrophy(rank) {
        if (rank < 1 || rank > 3) return null;
        const label = rank === 1 ? 'Gold trophy'
            : rank === 2 ? 'Silver trophy' : 'Copper trophy';
        const trophy = mk('span', `rt-stat-channel-rank rt-stat-channel-rank-${rank}`, null, { title: label });
        trophy.appendChild(RT_ICONS.trophy());
        return trophy;
    }

    function favoriteChannelsFromTotals(totals) {
        return Array.isArray(totals.topFavoriteChannels)
            ? totals.topFavoriteChannels.slice(0, 5) : [];
    }

    function favoriteChannelSignature(topChannels) {
        // The select options only expose rank + channel name. Watched seconds
        // update frequently while a video plays, so keep them out of the
        // signature to avoid needless option-list rebuilds.
        return topChannels.map(channel => [
            channel.rank, channel.name,
        ].join('\u001f')).join('\u001e');
    }

    function stopAndRefreshFavoriteSelect(event) {
        event.stopPropagation();
        scheduleRender();
    }

    function bindFavoriteChannelSelect(select, tile, topChannels) {
        for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'keyup']) {
            select[`on${type}`] = stopStatsSelectPropagation;
        }
        select.onchange = event => {
            event.stopPropagation();
            favoriteChannelIndex = Math.max(0, Math.min(
                parseInt(select.value, 10) || 0, Math.max(0, topChannels.length - 1)));
            renderFavoriteChannel(tile, topChannels, favoriteChannelIndex);
        };
        // Native select popups can temporarily hide their open state from JS.
        // We keep the node stable during interaction, then do one normal stats
        // refresh after focus leaves so option changes that were deferred while
        // the popup was open are applied without a timer-based lock.
        select.onblur = stopAndRefreshFavoriteSelect;
    }

    function syncFavoriteChannelSelect(tile, topChannels, selectedIndex) {
        const head = tile.querySelector('.rt-stat-head');
        if (!head) return;
        let select = head.querySelector('.rt-stat-channel-select');
        if (topChannels.length <= 1) {
            select?.remove();
            return;
        }

        if (!select) {
            select = mk('select', 'rt-stat-channel-select', null, { 'aria-label': 'Choose favorite channel' });
            head.appendChild(select);
        }

        const signature = favoriteChannelSignature(topChannels);
        const active = document.activeElement === select;
        if (!active && select.dataset.rtOptionsSignature !== signature) {
            select.replaceChildren();
            topChannels.forEach(channel => {
                const prefix = channel.rank === 1 ? '🏆 '
                    : channel.rank === 2 ? '🥈 '
                        : channel.rank === 3 ? '🥉 ' : '';
                select.appendChild(mk('option', null,
                    `${prefix}#${channel.rank} ${channel.name}`, { value: String(channel.rank - 1) }));
            });
            select.dataset.rtOptionsSignature = signature;
        }
        select.value = String(selectedIndex);
        bindFavoriteChannelSelect(select, tile, topChannels);
    }

    function renderFavoriteChannel(tile, topChannels, index) {
        const channel = topChannels[index] || null;
        const avatar = tile.querySelector('.rt-stat-channel-avatar');
        const channelRow = tile.querySelector('.rt-stat-channel-row');
        const channelSub = tile.querySelector('.rt-stat-tile-sub');
        if (!avatar || !channelRow || !channelSub) return;

        avatar.replaceChildren();
        if (channel?.avatar) {
            const img = mk('img', null, null, { src: channel.avatar, alt: '' });
            img.referrerPolicy = 'no-referrer';
            avatar.appendChild(img);
        } else {
            avatar.appendChild(RT_ICONS.star());
        }

        channelRow.replaceChildren();
        const trophy = channel ? makeFavoriteChannelTrophy(channel.rank) : null;
        if (trophy) channelRow.appendChild(trophy);
        channelRow.appendChild(mk('strong', 'rt-stat-tile-val rt-stat-channel-name', channel?.name || '—'));
        if (channel?.sec > 0) {
            channelRow.appendChild(mk('span', 'rt-stat-channel-time', `${formatStatsDuration(channel.sec)} watched`));
        }
        channelSub.textContent = channel?.sec
            ? `#${channel.rank} by watch time` : 'no data yet';
    }

    function syncFavoriteChannelTile(tile, totals) {
        const topChannels = favoriteChannelsFromTotals(totals);
        const selectedIndex = Math.max(0, Math.min(
            Number.isFinite(favoriteChannelIndex) ? favoriteChannelIndex : 0,
            Math.max(0, topChannels.length - 1)));
        favoriteChannelIndex = selectedIndex;
        syncFavoriteChannelSelect(tile, topChannels, selectedIndex);
        renderFavoriteChannel(tile, topChannels, selectedIndex);
    }

    function buildMetricTile(key, totals) {
        const info = STATS_METRIC_INFO[key];
        const tile = mk('div', `rt-stat-tile rt-stat-tile-${key}`);
        tile.dataset.metricKey = key;

        const head = mk('div', 'rt-stat-head');
        const ico = mk('span', 'rt-stat-ico');
        const iconFn = RT_ICONS[info.icon];
        if (typeof iconFn === 'function') ico.appendChild(iconFn());
        head.appendChild(ico);
        head.appendChild(mk('span', 'rt-stat-name', info.label));
        tile.appendChild(head);

        if (key === 'favoriteChannel') {
            const channelMain = mk('div', 'rt-stat-channel-main');
            const avatar = mk('span', 'rt-stat-channel-avatar');
            channelMain.appendChild(avatar);

            const channelCopy = mk('div', 'rt-stat-channel-copy');
            const channelRow = mk('div', 'rt-stat-channel-row');
            const channelSub = mk('span', 'rt-stat-tile-sub');
            channelCopy.appendChild(channelRow);
            channelCopy.appendChild(channelSub);
            channelMain.appendChild(channelCopy);

            tile.classList.add('rt-stat-tile-channel');
            tile.appendChild(channelMain);
            syncFavoriteChannelTile(tile, totals);
            return tile;
        }

        const { value, sub } = metricDisplayFor(key, totals);
        tile.appendChild(mk('strong', 'rt-stat-tile-val', value));
        tile.appendChild(mk('span', 'rt-stat-tile-sub', sub));
        return tile;
    }

    function patchMetricTile(tile, key, totals) {
        if (!tile || tile.dataset.metricKey !== key) return false;
        if (key === 'favoriteChannel') {
            syncFavoriteChannelTile(tile, totals);
            return true;
        }
        const valueEl = tile.querySelector('.rt-stat-tile-val');
        const subEl = tile.querySelector('.rt-stat-tile-sub');
        if (!valueEl || !subEl) return false;
        const { value, sub } = metricDisplayFor(key, totals);
        valueEl.textContent = value;
        subEl.textContent = sub;
        return true;
    }

    function patchStatsCard(card) {
        if (!card || !state.loaded || !getEnabled()) return false;
        const range = readStatsRange(state.range);
        const eyebrow = card.querySelector('.rt-stats-card-eyebrow');
        const title = card.querySelector('.rt-stats-card-title');
        if (!eyebrow || !title) return false;
        eyebrow.textContent = STATS_RANGE_HEADER[range] || 'Statistics';
        title.textContent = 'Your YouTube';

        const enabled = STATS_METRICS_ORDER.filter(key => state.metrics[key] !== false);
        if (!enabled.length) return false;
        const grid = card.querySelector('.rt-stat-grid');
        if (!grid) return false;
        // grid.children is an HTMLCollection — Elements only, no text nodes —
        // so no further filtering is needed.
        const tiles = Array.from(grid.children);
        if (tiles.length !== enabled.length) return false;
        for (let i = 0; i < enabled.length; i++) {
            if (tiles[i].dataset.metricKey !== enabled[i]) return false;
        }

        const totals = summary(range);
        for (let i = 0; i < enabled.length; i++) {
            if (!patchMetricTile(tiles[i], enabled[i], totals)) return false;
        }
        return true;
    }

    function buildStatsCardHead(eyebrow, title) {
        const head = mk('div', 'rt-stats-card-head');
        const logo = mk('span', 'rt-stats-card-logo');
        logo.appendChild(RT_ICONS.chart());
        head.appendChild(logo);

        const text = mk('div', 'rt-stats-card-heading');
        text.appendChild(mk('span', 'rt-stats-card-eyebrow', eyebrow));
        text.appendChild(mk('span', 'rt-stats-card-title', title));
        head.appendChild(text);
        return head;
    }

    function buildStatsCard() {
        if (!state.loaded) return null;
        if (!getEnabled()) return null;
        const range = readStatsRange(state.range);

        const card = mk('div', 'rt-stats-card');
        card.appendChild(buildStatsCardHead(STATS_RANGE_HEADER[range] || 'Statistics', 'Your YouTube'));

        const enabled = STATS_METRICS_ORDER.filter(key => state.metrics[key] !== false);
        if (!enabled.length) {
            card.appendChild(mk('div', 'rt-stats-empty', 'Stats are enabled, but every metric is hidden. Enable at least one metric in Statistics settings.'));
            return card;
        }

        const totals = summary(range);
        const grid = mk('div', 'rt-stat-grid');
        for (const key of enabled) grid.appendChild(buildMetricTile(key, totals));
        card.appendChild(grid);
        return card;
    }

    function buildStatsLoadingCard() {
        const card = mk('div', 'rt-stats-card');
        card.appendChild(buildStatsCardHead('Statistics', 'Your YouTube'));
        card.appendChild(mk('div', 'rt-stats-empty', 'Loading local statistics…'));
        return card;
    }

    function renderStatsPanelSlot() {
        const slot = document.getElementById('rt_stats_panel_slot');
        if (!slot) return;
        const canRenderPanel = isPanelEnabled();
        if (!canRenderPanel) {
            slot.replaceChildren();
            return;
        }

        let wrapper = slot.querySelector(':scope > .rt-inline-stats');
        if (!wrapper) {
            slot.replaceChildren();
            wrapper = mk('div', 'rt-inline-stats');
            slot.appendChild(wrapper);
        }

        const existingCard = wrapper.querySelector(':scope > .rt-stats-card');
        if (patchStatsCard(existingCard)) return;

        const card = state.loaded ? buildStatsCard() : buildStatsLoadingCard();
        if (!card) {
            wrapper.remove();
            return;
        }
        wrapper.replaceChildren(card);
    }

    function findInlineHost() {
        return document.querySelector('ytd-watch-flexy #secondary #secondary-inner')
            || document.querySelector('ytd-watch-flexy #secondary')
            || document.querySelector('#secondary');
    }

    function removeInlineCards(except = null) {
        for (const node of document.querySelectorAll('#rt_inline_stats, .rt-inline-stats')) {
            // The floating stats panel intentionally reuses the inline-card
            // class so both displays render identically; don't treat that copy
            // as a stale above-recommendations card.
            if (node.closest?.('#rt_stats_panel')) continue;
            if (node !== except) node.remove();
        }
    }

    function renderInlineCard() {
        const want = state.loaded && isInlineEnabled();
        if (!want) {
            removeInlineCards();
            return;
        }
        const host = findInlineHost();
        if (!host) return;

        let wrapper = document.getElementById('rt_inline_stats');
        if (!wrapper) {
            wrapper = mk('div', 'rt-inline-stats', null, { id: 'rt_inline_stats' });
        }
        // Either (a) we just created it and need to insert, or (b) it lives
        // elsewhere from a previous mount and needs moving, or (c) it's in
        // the right host but not at the top of the column.
        if (wrapper.parentElement !== host || host.firstElementChild !== wrapper) {
            host.insertBefore(wrapper, host.firstChild);
        }

        const existingCard = wrapper.querySelector(':scope > .rt-stats-card');
        if (patchStatsCard(existingCard)) {
            removeInlineCards(wrapper);
            return;
        }

        const card = buildStatsCard();
        if (!card) {
            removeInlineCards();
            return;
        }
        wrapper.replaceChildren(card);
        removeInlineCards(wrapper);
    }

    function scheduleInlineMount(retry = false) {
        if (!inlineMountRaf) {
            inlineMountRaf = requestAnimationFrame(() => {
                inlineMountRaf = 0;
                renderInlineCard();
            });
        }
        if (retry) {
            clearInlineRetryTimers();
            inlineRetryTimers = [250, 750, 1600, 3200].map(ms => setTimeout(renderInlineCard, ms));
        }
    }

    function syncStatsButtonVisibility() {
        const showPanel = isPanelEnabled();
        const fab = document.getElementById('rt_stats_fab');
        const panel = document.getElementById('rt_stats_panel');
        const panelShown = showPanel && !!panel?.classList.contains('show');
        if (fab) {
            setToolbarButtonHidden(fab, !showPanel);
            fab.classList.toggle('active', panelShown);
            fab.setAttribute('aria-expanded', panelShown ? 'true' : 'false');
        }
        if (!showPanel && panel) {
            panel.classList.remove('show');
            panel.setAttribute('aria-hidden', 'true');
            panel.classList.remove('rt-drag');
        }
        mountRainTubeButtons(S?._statsFab, S?._fab);
    }

    function applyVisibility() {
        syncStatsButtonVisibility();
        renderStatsPanelSlot();
        renderInlineCard();
        if (isInlineEnabled()) scheduleInlineMount(true);
        else clearInlineRetryTimers();
    }

    function syncSettingsControls() {
        const range = document.getElementById('rt_stats_range_select');
        if (range) range.value = state.range;
        const display = document.getElementById('rt_stats_display_select');
        if (display) display.value = state.display;
        for (const key of STATS_METRICS_ORDER) {
            const input = document.getElementById(`rt_stats_metric_${key}`);
            if (input) input.checked = state.metrics[key] !== false;
        }
    }

    async function load() {
        const [enabled, range, display, metrics, buckets] = await Promise.all([
            StatsStore.getValue(CFG.storage.statsEnabled, true),
            StatsStore.getValue(CFG.storage.statsRange, 'daily'),
            StatsStore.getValue(CFG.storage.statsDisplay, 'panel'),
            StatsStore.getJson(CFG.storage.statsMetrics, null),
            StatsStore.getJson(CFG.storage.statsBuckets, null),
        ]);
        state.enabled = readStatsEnabled(enabled);
        state.range = readStatsRange(range);
        state.display = readStatsDisplay(display);
        state.metrics = sanitizeStatsMetrics(metrics);
        state.buckets = sanitizeStatsBuckets(buckets);
        state.loaded = true;
        pruneBuckets();
        syncSettingsControls();
        applyVisibility();

        // If navigation fired before async stats loading completed, count the
        // captured route now. Otherwise run the normal navigation handler so
        // the current page is counted once without per-day ID caches.
        if (pendingOpen) {
            recordOpen(pendingOpen);
            pendingOpen = null;
        } else {
            onNavigate();
        }
        scheduleAttachVideo(true);
    }

    function onNavigate() {
        const open = currentOpenFromRoute();
        const openKey = open?.key || null;
        if (openKey !== currentOpenKey) {
            currentOpenKey = openKey;
            stopWatch();
            recordOpen(open);
        }
        scheduleAttachVideo(true);
        scheduleInlineMount(true);
        scheduleRender();
    }

    async function clearAll() {
        state.buckets = {};
        dirty = false;
        if (persistTimer) {
            clearTimeout(persistTimer);
            persistTimer = 0;
        }
        pendingOpen = null;
        await deleteStoredValue(CFG.storage.statsBuckets);
        scheduleRender();
    }

    function resetSettings() {
        state.enabled = true;
        state.range = 'daily';
        state.display = 'panel';
        state.metrics = { ...STATS_METRICS_DEFAULTS };
        syncSettingsControls();
        applyVisibility();
        scheduleAttachVideo(true);
    }

    function install() {
        if (!IS_YOUTUBE) return;
        void load();

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopWatch();
                void flush();
            } else {
                scheduleAttachVideo(true);
                scheduleRender();
            }
        }, { passive: true });
        window.addEventListener('pagehide', () => { void flush(); }, { passive: true });
        window.addEventListener('beforeunload', () => { void flush(); }, { passive: true });

        const observer = new MutationObserver(records => {
            if (!state.loaded || !isInlineEnabled()) return;
            if (records.length && records.every(mutationTouchesOnlyRainTubeUi)) return;
            scheduleInlineMount();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        // No subtree MutationObserver for video-element changes: yt-navigate-finish,
        // yt-page-data-updated, and visibilitychange already cover every legitimate
        // (re)attach scenario, and attachVideo is idempotent via attachedVideos.
    }

    async function setEnabled(value) {
        const enabled = !!value;
        if (!enabled) {
            pendingOpen = null;
            // Flush the final partial watch tick before flipping the master
            // switch off; tickWatchTime intentionally ignores disabled stats.
            stopWatch();
            state.enabled = false;
        } else {
            state.enabled = true;
            scheduleAttachVideo(true);
        }
        await StatsStore.setValue(CFG.storage.statsEnabled, state.enabled);
        applyVisibility();
        uiSync();
    }

    async function setRange(value) {
        state.range = readStatsRange(value);
        await StatsStore.setValue(CFG.storage.statsRange, state.range);
        applyVisibility();
        uiSync();
    }

    async function setDisplay(value) {
        state.display = readStatsDisplay(value);
        await StatsStore.setValue(CFG.storage.statsDisplay, state.display);
        syncSettingsControls();
        applyVisibility();
    }

    return Object.freeze({
        install,
        onNavigate,
        recordShortsHidden,
        recordOpen,
        renderStatsPanelSlot,
        renderInlineCard,
        applyVisibility,
        clearAll,
        resetSettings,
        setEnabled,
        setRange,
        setDisplay,
        setMetric,
        getRange,
        getDisplay,
        getEnabled,
        isPanelEnabled,
        isInlineEnabled,
        getMetrics,
        summary,
    });
})();

const RT_ICONS = {
    // Vertical "phone" frame (tall portrait rectangle, the visual shorthand
    // for the Shorts UI), a small play triangle inside, and a diagonal slash
    // through the whole thing to signal "blocked."
    shorts: () => makeSvgIcon([
        // Portrait frame rounded at the corners
        { d: 'M8 3.2 H16 A1.6 1.6 0 0 1 17.6 4.8 V19.2 A1.6 1.6 0 0 1 16 20.8 H8 A1.6 1.6 0 0 1 6.4 19.2 V4.8 A1.6 1.6 0 0 1 8 3.2 Z',
          strokeWidth: 1.7 },
        // Play triangle centered in the frame
        { d: 'M10.6 9 L14.4 12 L10.6 15 Z',
          fill: 'currentColor', stroke: 'none' },
        // Diagonal slash from upper-right to lower-left (the "blocked" mark)
        { d: 'M19.5 4.5 L4.5 19.5',
          strokeWidth: 2.2 },
    ]),

    // Portrait Shorts player with a play triangle and no blocking slash. Used
    // for "Shorts opened" so it does not visually collide with Shorts blocked.
    shortsOpen: () => makeSvgIcon([
        { d: 'M8 3.2 H16 A1.6 1.6 0 0 1 17.6 4.8 V19.2 A1.6 1.6 0 0 1 16 20.8 H8 A1.6 1.6 0 0 1 6.4 19.2 V4.8 A1.6 1.6 0 0 1 8 3.2 Z',
          strokeWidth: 1.7 },
        { d: 'M10.5 8.7 L14.8 12 L10.5 15.3 Z',
          fill: 'currentColor', stroke: 'none' },
        { d: 'M9.5 5.8 H14.5',
          strokeWidth: 1.4 },
        { d: 'M10 18.2 H14',
          strokeWidth: 1.4 },
    ]),

    // Circle with one half filled — a standard "theme / appearance" glyph
    // (the same metaphor most material-design libraries use for light/dark
    // theming and visual customization). Two-tone, instantly readable at
    // small sizes, doesn't look like any other icon in the set.
    customize: () => makeSvgIcon([
        // Outer circle outline
        { d: 'M12 3.5 A8.5 8.5 0 1 1 11.99 3.5 Z',
          strokeWidth: 1.8 },
        // Right half-disc, filled
        { d: 'M12 3.5 A8.5 8.5 0 0 1 12 20.5 Z',
          fill: 'currentColor', stroke: 'none' },
    ]),

    // Asymmetric four-point sparkle: tall vertical points, short horizontal
    // points, with a small center dot. Reads as "shine / quality."
    quality: () => makeSvgIcon([
        // Main four-point sparkle (diamond with concave sides via two paths)
        { d: 'M12 2.5 L13.6 10.4 L21.5 12 L13.6 13.6 L12 21.5 L10.4 13.6 L2.5 12 L10.4 10.4 Z',
          fill: 'currentColor', stroke: 'none' },
        // Small accent sparkle in the upper right corner
        { d: 'M18.5 4.5 L19 6.7 L21.2 7.2 L19 7.7 L18.5 9.9 L18 7.7 L15.8 7.2 L18 6.7 Z',
          fill: 'currentColor', stroke: 'none' },
    ]),

    // Shield outline with downward arrow inside — privacy + download.
    private: () => makeSvgIcon([
        // Shield outline
        { d: 'M12 3.2 L19.5 5.8 V12.4 C19.5 16.2 16.4 19.5 12 20.8 C7.6 19.5 4.5 16.2 4.5 12.4 V5.8 Z',
          strokeWidth: 1.7 },
        // Downward arrow shaft + V chevron
        { d: 'M12 7.5 V14.5 M8.5 11.5 L12 15 L15.5 11.5',
          strokeWidth: 2 },
    ]),

    // Rounded screen with a large play cut. More legible in the compact
    // download tile than the previous film-frame/sprocket mark.
    video: () => makeSvgIcon([
        { d: 'M4.8 6.6 H19.2 C20.2 6.6 21 7.4 21 8.4 V15.6 C21 16.6 20.2 17.4 19.2 17.4 H4.8 C3.8 17.4 3 16.6 3 15.6 V8.4 C3 7.4 3.8 6.6 4.8 6.6 Z',
          strokeWidth: 1.9 },
        { d: 'M10.2 9.2 L15.4 12 L10.2 14.8 Z',
          fill: 'currentColor', stroke: 'none' },
    ]),

    // Speaker body plus two strong waves. Reads faster than the older
    // concentric-arc source-dot mark at button size.
    audio: () => makeSvgIcon([
        { d: 'M4 9.7 H7.2 L11.3 6.6 V17.4 L7.2 14.3 H4 Z',
          fill: 'currentColor', stroke: 'none' },
        { d: 'M14.2 9.2 C15.1 10 15.6 10.9 15.6 12 C15.6 13.1 15.1 14 14.2 14.8',
          strokeWidth: 2 },
        { d: 'M16.8 6.8 C18.4 8.2 19.4 10 19.4 12 C19.4 14 18.4 15.8 16.8 17.2',
          strokeWidth: 2 },
    ]),

    // Three horizontal sliders at different positions, each with a small
    // knob — a "mixer/preferences" mark that signals tunable settings
    // without colliding with the gear glyph used elsewhere.
    general: () => makeSvgIcon([
        // Three horizontal tracks
        { d: 'M4 7.5 H20 M4 12 H20 M4 16.5 H20', strokeWidth: 1.6 },
        // Knobs (filled circles at varying positions)
        { d: 'M14 7.5 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
          fill: 'currentColor', stroke: 'currentColor', strokeWidth: 0 },
        { d: 'M8 12 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
          fill: 'currentColor', stroke: 'currentColor', strokeWidth: 0 },
        { d: 'M16 16.5 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
          fill: 'currentColor', stroke: 'currentColor', strokeWidth: 0 },
        // White dot in the center of each knob for the "tuning point"
        { d: 'M14 7.5 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0',
          fill: '#0d0d10', stroke: 'none' },
        { d: 'M8 12 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0',
          fill: '#0d0d10', stroke: 'none' },
        { d: 'M16 16.5 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0',
          fill: '#0d0d10', stroke: 'none' },
    ]),

    // Clock face for watch-time statistics.
    clock: () => makeSvgIcon([
        { d: 'M12 3.5 A8.5 8.5 0 1 1 11.99 3.5 Z', strokeWidth: 1.7 },
        { d: 'M12 12 L14 7', strokeWidth: 2 },
        { d: 'M12 12 L17 12', strokeWidth: 2 },
        { d: 'M12 12 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0', fill: 'currentColor', stroke: 'none' },
    ]),

    // Play triangle inside a rounded frame for opened videos.
    play: () => makeSvgIcon([
        { d: 'M5 4.5 H19 A1.5 1.5 0 0 1 20.5 6 V18 A1.5 1.5 0 0 1 19 19.5 H5 A1.5 1.5 0 0 1 3.5 18 V6 A1.5 1.5 0 0 1 5 4.5 Z', strokeWidth: 1.7 },
        { d: 'M10 8.5 L16 12 L10 15.5 Z', fill: 'currentColor', stroke: 'none' },
    ]),

    // Filled star for the top/favorite channel metric.
    star: () => makeSvgIcon([
        { d: 'M12 3.2 L14.5 9.5 L21.2 10 L16 14.3 L17.6 21 L12 17.2 L6.4 21 L8 14.3 L2.8 10 L9.5 9.5 Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1 },
    ]),

    // Trophy for ranked favorite channels.
    trophy: () => makeSvgIcon([
        { d: 'M8 4.5 H16 V7.2 C16 10.2 14.5 12.2 12 12.8 C9.5 12.2 8 10.2 8 7.2 Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.2 },
        { d: 'M8 6 H4.8 V7.5 C4.8 9.7 6.2 11 8.7 11.2', strokeWidth: 1.7 },
        { d: 'M16 6 H19.2 V7.5 C19.2 9.7 17.8 11 15.3 11.2', strokeWidth: 1.7 },
        { d: 'M12 12.8 V16.5', strokeWidth: 1.8 },
        { d: 'M8.6 19.5 H15.4', strokeWidth: 1.8 },
        { d: 'M10 16.5 H14 L14.9 19.5 H9.1 Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1 },
    ]),

    // Simple bars + trend line for local statistics.
    chart: () => makeSvgIcon([
        { d: 'M5 19.5 V10.5', strokeWidth: 2 },
        { d: 'M12 19.5 V5.5', strokeWidth: 2 },
        { d: 'M19 19.5 V13.5', strokeWidth: 2 },
        { d: 'M4.5 19.5 H20.5', strokeWidth: 1.6 },
        { d: 'M5 8.5 L10.5 6 L15 11 L20 8', strokeWidth: 1.7 },
    ]),

    // Soft warning triangle for generic "heads up" toasts.
    warn: () => makeSvgIcon([
        { d: 'M12 3.6 L21 19.2 H3 Z', strokeWidth: 1.8 },
        { d: 'M12 9.2 V13.2', strokeWidth: 2.1 },
        { d: 'M12 16.7 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
          fill: 'currentColor', stroke: 'none' },
    ]),
};

function buildToggleCard(iconKey, swId, name, stId, infoText) {
    const card = mk('div', `rt-tc rt-tc-${iconKey}`);
    const top = mk('div', 'rt-tc-top');

    const iconWrap = mk('span', 'rt-tc-ico');
    const builder = RT_ICONS[iconKey];
    if (typeof builder === 'function') iconWrap.appendChild(builder());
    else iconWrap.textContent = '◦'; // fallback if a typo'd key sneaks in
    top.appendChild(iconWrap);

    const sw = mk('button', 'rt-sw', null, {
        id: swId, type: 'button', role: 'switch', 'aria-checked': 'false',
    });
    sw.appendChild(mk('span', 'rt-thumb'));
    top.appendChild(sw);

    const bot = mk('div', 'rt-tc-bot');
    bot.appendChild(mk('span', 'rt-tc-name', name));
    bot.appendChild(mk('span', 'rt-tc-st', 'OFF', { id: stId }));

    card.appendChild(top);
    card.appendChild(bot);

    if (infoText) {
        const tools = mk('div', 'rt-card-tools');
        tools.appendChild(mk('button', 'rt-info', '?', {
            type: 'button', 'aria-label': infoText, 'data-tip': infoText,
        }));
        card.appendChild(tools);
    }

    return card;
}

function buildSettingPanel(id, title, icon, eyebrow) {
    const panel = mk('div', icon ? `rt-set rt-set-${icon}` : 'rt-set', null, { id });

    const head = mk('div', 'rt-set-head');
    if (icon) {
        const iconEl = mk('span', `rt-set-icon rt-set-icon-${icon}`);
        const builder = RT_ICONS[icon];
        if (typeof builder === 'function') iconEl.appendChild(builder());
        else iconEl.textContent = icon;
        head.appendChild(iconEl);
    }
    const heading = mk('div', 'rt-set-heading');
    if (eyebrow) heading.appendChild(mk('span', 'rt-set-eyebrow', eyebrow));
    heading.appendChild(mk('span', 'rt-set-title', title));
    head.appendChild(heading);
    panel.appendChild(head);

    return panel;
}

function buildFieldLabel(text, helpText, labelClass = 'rt-field-label') {
    const label = mk('span', labelClass || null, text);
    if (!helpText) return label;

    const wrap = mk('span', 'rt-field-label-wrap');
    wrap.appendChild(label);

    const help = mk('span', 'rt-info rt-field-help', '?', {
        role: 'button',
        tabindex: '0',
        'aria-label': helpText,
        'data-tip': helpText,
    });
    const stopLabelActivation = event => {
        event.preventDefault();
        event.stopPropagation();
    };
    help.addEventListener('pointerdown', stopLabelActivation);
    help.addEventListener('click', stopLabelActivation);
    help.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') stopLabelActivation(event);
    });
    wrap.appendChild(help);
    return wrap;
}

function buildCheckboxField({ inputId, text, checked, wide = false, helpText, onChange }) {
    const row = mk('label', wide ? 'rt-control-row rt-check rt-check-wide' : 'rt-control-row rt-check');
    const inputAttrs = { type: 'checkbox' };
    if (inputId) inputAttrs.id = inputId;
    const input = mk('input', null, null, inputAttrs);
    input.checked = !!checked;
    input.addEventListener('change', e => onChange?.(e.currentTarget.checked));
    row.appendChild(input);
    row.appendChild(helpText ? buildFieldLabel(text, helpText, 'rt-check-text') : mk('span', 'rt-check-text', text));
    return row;
}

function buildCheckboxGrid({ items }) {
    const grid = mk('div', 'rt-check-grid');
    for (const item of items) {
        grid.appendChild(buildCheckboxField({ ...item, wide: false }));
    }
    return grid;
}

function buildActionButton({ labelText, helpText, buttonText, buttonId, buttonClass, onClick }) {
    const row = mk('div', 'rt-control-row rt-action-row');
    const left = mk('div', 'rt-action-left');
    left.appendChild(buildFieldLabel(labelText, helpText));
    row.appendChild(left);
    const btn = mk('button', buttonClass ? `rt-action-btn ${buttonClass}` : 'rt-action-btn', buttonText || labelText, {
        id: buttonId, type: 'button',
    });
    btn.addEventListener('click', async () => {
        try {
            await onClick?.(btn);
        } catch (err) {
            console.warn('[RainTube] action button handler failed:', err);
        }
    });
    row.appendChild(btn);
    return row;
}

function buildDangerConfirm({ items = [], buttonText = 'Confirm Deletion', buttonId = 'rt_danger_confirm', onConfirm }) {
    const wrap = mk('div', 'rt-danger-confirm');
    const grid = mk('div', 'rt-check-grid rt-danger-check-grid');
    const inputs = [];
    const confirm = mk('button', 'rt-action-btn rt-action-btn-danger rt-confirm-delete', buttonText, {
        id: buttonId,
        type: 'button',
        disabled: 'disabled',
    });
    const update = () => { confirm.disabled = !inputs.some(input => input.checked); };

    for (const item of items) {
        const row = buildCheckboxField({
            inputId: item.inputId,
            text: item.text,
            checked: false,
            helpText: item.helpText,
            onChange: update,
        });
        const input = row.querySelector('input[type="checkbox"]');
        if (input) inputs.push(input);
        grid.appendChild(row);
    }

    confirm.addEventListener('click', async () => {
        const selected = inputs.filter(input => input.checked).map(input => input.id);
        if (!selected.length) return;
        confirm.disabled = true;
        try {
            await onConfirm?.(selected, confirm);
        } finally {
            for (const input of inputs) input.checked = false;
            update();
        }
    });

    wrap.appendChild(grid);
    const row = mk('div', 'rt-danger-confirm-row');
    row.appendChild(confirm);
    wrap.appendChild(row);
    return wrap;
}

function buildWarningCheckboxField({ noteText, noteIcon = '⚠', ...checkbox }) {
    const box = mk('div', 'rt-setting-warning-box');
    const row = buildCheckboxField({ ...checkbox, wide: true });
    box.appendChild(row);

    if (noteText) {
        const note = mk('div', 'rt-setting-warning-note');
        note.appendChild(mk('span', 'rt-setting-warning-ico', noteIcon));
        note.appendChild(mk('span', 'rt-setting-warning-text', noteText));
        box.appendChild(note);
    }

    return box;
}

function buildSettingControl(control) {
    if (control.type === 'slider') return buildSlider(control);
    if (control.type === 'select') return buildSelectField(control);
    if (control.type === 'checkbox') return buildCheckboxField(control);
    if (control.type === 'checkboxGrid') return buildCheckboxGrid(control);
    if (control.type === 'button') return buildActionButton(control);
    if (control.type === 'warningCheckbox') return buildWarningCheckboxField(control);
    if (control.type === 'dangerConfirm') return buildDangerConfirm(control);
    return null;
}

function buildSettingsSection(def) {
    const panel = buildSettingPanel(def.id, def.title, def.icon, def.eyebrow);
    if (def.hint) panel.appendChild(mk('div', 'rt-field-hint', def.hint));
    for (const control of def.controls || []) {
        const el = buildSettingControl(control);
        if (el) panel.appendChild(el);
    }
    return panel;
}

function createSettingsSections() {
    return {
        general: {
            id: 'rt_set_general',
            title: 'General',
            icon: 'general',
            eyebrow: 'Appearance',
            hint: 'Buttons, rain, lightning, and notifications.',
            controls: [
                {
                    type: 'slider',
                    labelText: 'Toast duration',
                    sliderId: 'rt_toast_duration_slider',
                    min: TOAST_DURATION_MIN_MS / 1000,
                    max: TOAST_DURATION_MAX_MS / 1000,
                    step: 0.5,
                    value: S.toastDurationMs / 1000,
                    valueRender: secs => `${secs.toFixed(1)}s`,
                    onChange: secs => {
                        const ms = Math.max(TOAST_DURATION_MIN_MS, Math.min(TOAST_DURATION_MAX_MS, Math.round(secs * 1000)));
                        S.toastDurationMs = ms;
                        save(CFG.storage.toastDurationMs, ms);
                    },
                },
                {
                    type: 'select',
                    labelText: 'Toast position',
                    selectId: 'rt_toast_position_select',
                    options: TOAST_PLACEMENT_ORDER.map(value => ({
                        value,
                        label: TOAST_PLACEMENT_LABEL[value],
                    })),
                    value: S.toastPlacement,
                    onChange: value => {
                        S.toastPlacement = readToastPlacementSetting(value);
                        save(CFG.storage.toastPlacement, S.toastPlacement);
                        scheduleToastPositionSync();
                    },
                },
                {
                    type: 'select',
                    labelText: 'Rain quantity',
                    selectId: 'rt_rain_quantity_select',
                    options: RAIN_QUANTITY_ORDER.map(value => ({
                        value,
                        label: RAIN_QUANTITY_LABEL[value],
                    })),
                    value: S.rainQuantity,
                    onChange: value => {
                        S.rainQuantity = readRainQuantitySetting(value);
                        save(CFG.storage.rainQuantity, S.rainQuantity);
                        const panelEl = document.getElementById('rt_panel');
                        if (panelEl) {
                            panelEl.classList.toggle('rt-rain-off', S.rainQuantity === 'off');
                            panelEl.__rtRainQuantityChanged?.();
                        }
                        TopbarTheme.syncRain();
                    },
                },
                {
                    type: 'slider',
                    labelText: 'Rain FPS cap',
                    helpText: 'Limits how often the rain animation redraws. Lower values may use less power.',
                    sliderId: 'rt_rain_fps_cap_slider',
                    min: RAIN_FPS_MIN,
                    max: RAIN_FPS_MAX,
                    step: 5,
                    value: S.rainFpsCap,
                    valueRender: fps => `${Math.round(fps)} fps`,
                    onChange: fps => {
                        S.rainFpsCap = readRainFpsCap(fps);
                        save(CFG.storage.rainFpsCap, S.rainFpsCap);
                        document.getElementById('rt_panel')?.__rtRainFpsChanged?.();
                        TopbarTheme.syncRain();
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_lightning_enabled',
                    text: 'Lightning effects',
                    checked: S.lightningEnabled,
                    wide: true,
                    onChange: checked => {
                        S.lightningEnabled = !!checked;
                        save(CFG.storage.lightning, S.lightningEnabled);
                        document.getElementById('rt_panel')?.__rtLightningChanged?.();
                        TopbarTheme.syncRain();
                    },
                },
                {
                    type: 'select',
                    labelText: 'Button placement',
                    helpText: 'Choose where RainTube buttons appear on YouTube.',
                    selectId: 'rt_button_placement_select',
                    options: BUTTON_PLACEMENT_ORDER.map(value => ({
                        value,
                        label: BUTTON_PLACEMENT_LABEL[value],
                    })),
                    value: S.buttonPlacement,
                    onChange: value => {
                        S.buttonPlacement = readButtonPlacement(value);
                        save(CFG.storage.buttonPlacement, S.buttonPlacement);
                        syncButtonPlacement();
                    },
                },
                {
                    type: 'warningCheckbox',
                    inputId: 'rt_main_button_visible',
                    text: 'Show main RainTube button',
                    helpText: "Shows the main RainTube button on YouTube. If you hide it, open RainTube from your userscript manager's menu command.",
                    checked: S.mainButtonVisible,
                    noteText: "Advanced option, don't toggle blindly.",
                    onChange: checked => {
                        S.mainButtonVisible = !!checked;
                        save(CFG.storage.mainButtonVisible, S.mainButtonVisible);
                        syncButtonPlacement();
                    },
                },
            ],
        },
        customization: {
            id: 'rt_set_customization',
            title: 'Customization',
            icon: 'customize',
            eyebrow: 'Theming',
            hint: 'Change how YouTube looks.',
            controls: [
                {
                    type: 'checkbox',
                    inputId: 'rt_oled_theme',
                    text: 'OLED pure-black theme',
                    helpText: "Makes YouTube dark mode pure black and turns off the player glow.",
                    checked: S.oledThemeEnabled,
                    wide: true,
                    onChange: checked => {
                        S.oledThemeEnabled = !!checked;
                        save(CFG.storage.oledTheme, S.oledThemeEnabled);
                        OledTheme.apply();
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_topbar_theme',
                    text: 'RainTube top bar',
                    helpText: "Styles YouTube's top bar with RainTube's dark glass, glow, and rain.",
                    checked: S.topbarThemeEnabled,
                    wide: true,
                    onChange: checked => {
                        S.topbarThemeEnabled = !!checked;
                        save(CFG.storage.topbarTheme, S.topbarThemeEnabled);
                        TopbarTheme.apply();
                    },
                },
            ],
        },
        shorts: {
            id: 'rt_set_shorts',
            title: 'Shorts',
            icon: 'shorts',
            eyebrow: 'Content filter',
            hint: 'Choose where Shorts are hidden.',
            controls: [
                {
                    type: 'checkboxGrid',
                    items: [
                        {
                            inputId: 'rt_shorts_hide_sidebar',
                            text: 'Sidebar',
                            checked: S.shortsHideSidebar,
                            onChange: checked => {
                                S.shortsHideSidebar = !!checked;
                                save(CFG.storage.shortsHideSidebar, S.shortsHideSidebar);
                                ShortsBlocker.apply();
                            },
                        },
                        {
                            inputId: 'rt_shorts_hide_home',
                            text: 'Home & feeds',
                            checked: S.shortsHideHome,
                            onChange: checked => {
                                S.shortsHideHome = !!checked;
                                save(CFG.storage.shortsHideHome, S.shortsHideHome);
                                ShortsBlocker.apply();
                            },
                        },
                        {
                            inputId: 'rt_shorts_hide_search',
                            text: 'Search results',
                            checked: S.shortsHideSearch,
                            onChange: checked => {
                                S.shortsHideSearch = !!checked;
                                save(CFG.storage.shortsHideSearch, S.shortsHideSearch);
                                ShortsBlocker.apply();
                            },
                        },
                        {
                            inputId: 'rt_shorts_hide_channel',
                            text: 'Channel tabs',
                            checked: S.shortsHideChannel,
                            onChange: checked => {
                                S.shortsHideChannel = !!checked;
                                save(CFG.storage.shortsHideChannel, S.shortsHideChannel);
                                ShortsBlocker.apply();
                            },
                        },
                        {
                            inputId: 'rt_shorts_hide_watch',
                            text: 'Watch suggestions',
                            checked: S.shortsHideWatch,
                            onChange: checked => {
                                S.shortsHideWatch = !!checked;
                                save(CFG.storage.shortsHideWatch, S.shortsHideWatch);
                                ShortsBlocker.apply();
                            },
                        },
                    ],
                },
                {
                    type: 'select',
                    labelText: 'Direct /shorts/ links',
                    selectId: 'rt_shorts_on_visit_select',
                    options: SHORTS_ON_VISIT_ORDER.map(value => ({
                        value,
                        label: SHORTS_ON_VISIT_LABEL[value],
                    })),
                    value: S.shortsOnVisit,
                    onChange: value => {
                        S.shortsOnVisit = readShortsOnVisit(value);
                        save(CFG.storage.shortsOnVisit, S.shortsOnVisit);
                    },
                },
            ],
        },
        statistics: {
            id: 'rt_set_statistics',
            title: 'Statistics',
            icon: 'chart',
            eyebrow: 'Local rollups',
            hint: 'Local watch summaries for time watched, opened videos, Shorts, and favorite channels.',
            controls: [
                {
                    type: 'select',
                    labelText: 'Time range',
                    helpText: 'Choose the time period shown in your stats. Turning Statistics off pauses tracking.',
                    selectId: 'rt_stats_range_select',
                    options: STATS_RANGE_ORDER.map(value => ({
                        value, label: STATS_RANGE_LABEL[value],
                    })),
                    value: StatsTracker.getRange(),
                    onChange: value => { void StatsTracker.setRange(value); },
                },
                {
                    type: 'select',
                    labelText: 'Show statistics',
                    helpText: 'Collapsed keeps statistics behind the Statistics button. Always shows them above recommendations.',
                    selectId: 'rt_stats_display_select',
                    options: STATS_DISPLAY_ORDER.map(value => ({
                        value, label: STATS_DISPLAY_LABEL[value],
                    })),
                    value: StatsTracker.getDisplay(),
                    onChange: value => { void StatsTracker.setDisplay(value); },
                },
                {
                    type: 'checkboxGrid',
                    items: STATS_METRICS_ORDER.map(key => ({
                        inputId: `rt_stats_metric_${key}`,
                        text: STATS_METRIC_INFO[key].label,
                        checked: StatsTracker.getMetrics()[key] !== false,
                        onChange: checked => StatsTracker.setMetric(key, checked),
                    })),
                },
            ],
        },
        quality: {
            id: 'rt_set_quality',
            title: 'Playback Quality',
            icon: 'quality',
            eyebrow: 'Targeting',
            hint: 'Choose the video quality RainTube should try to use.',
            controls: [
                {
                    type: 'select',
                    labelText: 'Target quality',
                    helpText: 'Uses this quality when available, otherwise chooses the closest lower standard option.',
                    selectId: 'rt_quality_max',
                    options: QUALITY_ORDER.map(q => ({ value: q, label: QUALITY_LABEL[q] || q })),
                    value: S.qualityMax,
                    onChange: value => {
                        S.qualityMax = value;
                        save(CFG.storage.qualityMax, S.qualityMax);
                        clearQualitySchedule();
                        S._lastAppliedQualityKey = null;
                        S._lastQualityTargetKey = null;
                        if (S.qualityEnabled) scheduleQualityApply();
                    },
                },
            ],
        },
        private: {
            id: 'rt_set_private',
            title: 'Private Downloads',
            icon: 'private',
            eyebrow: 'Proxy routing',
            hint: 'Download through privacy-friendly mirrors.',
            controls: [
                {
                    type: 'select',
                    labelText: 'Provider',
                    helpText: 'Choose which private mirrors RainTube tries. “Both” uses Piped and Invidious.',
                    selectId: 'rt_private_provider_select',
                    options: PRIVATE_PROVIDER_ORDER.map(value => ({
                        value,
                        label: PRIVATE_PROVIDER_LABEL[value],
                    })),
                    value: S.privateProvider,
                    onChange: value => {
                        S.privateProvider = readPrivateProvider(value);
                        save(CFG.storage.privateProvider, S.privateProvider);
                    },
                },
                {
                    type: 'slider',
                    labelText: 'Request timeout',
                    helpText: 'How long RainTube waits for one download mirror before trying another or failing. Lower values recover sooner; higher values help slow downloads finish.',
                    sliderId: 'rt_private_download_timeout_slider',
                    min: PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS / 1000,
                    max: PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS / 1000,
                    step: PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS / 1000,
                    value: S.privateDownloadTimeoutMs / 1000,
                    valueRender: formatPrivateDownloadTimeoutSeconds,
                    onChange: secs => {
                        const ms = readPrivateDownloadTimeoutMs(Math.round(secs * 1000));
                        S.privateDownloadTimeoutMs = ms;
                        save(CFG.storage.privateDownloadTimeoutMs, ms);
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_private_fallback',
                    text: 'Open CnvMP3 when private downloads fail',
                    helpText: 'Opens CnvMP3 with the current video link when private mirrors fail.',
                    checked: S.privateFallbackEnabled,
                    wide: true,
                    onChange: checked => {
                        S.privateFallbackEnabled = !!checked;
                        save(CFG.storage.privateFallback, S.privateFallbackEnabled);
                    },
                },
            ],
        },
        danger: {
            id: 'rt_set_danger',
            title: 'Danger Zone',
            icon: 'warn',
            eyebrow: 'Reset actions',
            hint: 'Clear saved data or restore defaults.',
            controls: [
                {
                    type: 'dangerConfirm',
                    buttonText: 'Confirm Deletion',
                    buttonId: 'rt_danger_confirm_delete',
                    items: [
                        {
                            inputId: 'rt_danger_clear_stats',
                            text: 'Clear all statistics',
                            helpText: 'Deletes local watch statistics only. Display settings stay the same.',
                        },
                        {
                            inputId: 'rt_danger_reset_settings',
                            text: 'Reset all settings',
                            helpText: 'Restores preferences to defaults. Statistics are kept unless you also clear them.',
                        },
                    ],
                    onConfirm: async selected => {
                        const clearStats = selected.includes('rt_danger_clear_stats');
                        const resetSettings = selected.includes('rt_danger_reset_settings');
                        if (clearStats) await StatsTracker.clearAll();
                        if (resetSettings) await resetAllSettingsToDefaults();

                        if (clearStats && resetSettings) {
                            toast('Statistics cleared and settings reset', 'off', { label: 'Danger Zone' });
                        } else if (clearStats) {
                            toast('Statistics cleared', 'off', { label: 'Statistics' });
                        } else if (resetSettings) {
                            toast('Settings reset to defaults', 'off', { label: 'Settings' });
                        }
                    },
                },
            ],
        },
    };
}

function syncSettingControlValue(id, value, { checked = null, input = false } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el instanceof HTMLInputElement) {
        if (checked !== null) el.checked = !!checked;
        else el.value = String(value);
        if (input) el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
        el.value = String(value);
    }
}

function syncAllSettingsControls() {
    syncSettingControlValue('rt_toast_duration_slider', S.toastDurationMs / 1000, { input: true });
    syncSettingControlValue('rt_toast_position_select', S.toastPlacement);
    syncSettingControlValue('rt_button_placement_select', S.buttonPlacement);
    syncSettingControlValue('rt_main_button_visible', null, { checked: S.mainButtonVisible });
    syncSettingControlValue('rt_rain_quantity_select', S.rainQuantity);
    syncSettingControlValue('rt_rain_fps_cap_slider', S.rainFpsCap, { input: true });
    syncSettingControlValue('rt_lightning_enabled', null, { checked: S.lightningEnabled });
    syncSettingControlValue('rt_oled_theme', null, { checked: S.oledThemeEnabled });
    syncSettingControlValue('rt_topbar_theme', null, { checked: S.topbarThemeEnabled });
    syncSettingControlValue('rt_shorts_hide_sidebar', null, { checked: S.shortsHideSidebar });
    syncSettingControlValue('rt_shorts_hide_home', null, { checked: S.shortsHideHome });
    syncSettingControlValue('rt_shorts_hide_search', null, { checked: S.shortsHideSearch });
    syncSettingControlValue('rt_shorts_hide_channel', null, { checked: S.shortsHideChannel });
    syncSettingControlValue('rt_shorts_hide_watch', null, { checked: S.shortsHideWatch });
    syncSettingControlValue('rt_shorts_on_visit_select', S.shortsOnVisit);
    syncSettingControlValue('rt_quality_max', S.qualityMax);
    syncSettingControlValue('rt_private_provider_select', S.privateProvider);
    syncSettingControlValue('rt_private_download_timeout_slider', S.privateDownloadTimeoutMs / 1000, { input: true });
    syncSettingControlValue('rt_private_fallback', null, { checked: S.privateFallbackEnabled });
}

async function resetAllSettingsToDefaults() {
    Object.assign(S, DEFAULT_SETTINGS, {
        _lastAppliedQualityKey: null,
        _lastQualityTargetKey: null,
    });

    await deleteRainTubeStorageExcept([CFG.storage.statsBuckets]);
    StatsTracker.resetSettings();

    clearProviderFailures();
    ShortsBlocker.apply();
    OledTheme.apply();
    TopbarTheme.apply();
    scheduleToastPositionSync();
    document.getElementById('rt_panel')?.__rtLightningChanged?.();
    syncAllSettingsControls();
    syncButtonPlacement();
    if (S.qualityEnabled) scheduleQualityApply();
    uiSync();
}

function buildSettingsSections() {
    const sections = createSettingsSections();
    return ['general', 'customization', 'shorts', 'statistics', 'quality', 'private', 'danger']
        .map(key => buildSettingsSection(sections[key]));
}

/**
 * Native range input with JS-rendered fill/thumb. The transparent input keeps
 * the real interaction; the visible layer lerps toward
 * `targetPct`. The native input stays interactive underneath — clicks,
 * drags, keyboard, focus all still work — but the visible thumb and
 * fill are decoupled from input.value, so they can glide.
 *
 * Layout (track wrap, position: relative):
 *   ┌────────────────────────────────────┐
 *   │ .rt-slider-input   (transparent thumb + track)  ←── interactive
 *   │ .rt-slider-track   (gray background bar)        ←── presentational
 *   │ .rt-slider-fill    (colored, width = displayedPct%)
 *   │ .rt-slider-thumb-custom (left = displayedPct%)
 *   └────────────────────────────────────┘
 */
function buildSlider({ labelText, helpText, sliderId, min, max, step, value, valueRender, onChange }) {
    const row = mk('div', 'rt-control-row rt-slider-row');

    const left = mk('div', 'rt-slider-left');
    left.appendChild(buildFieldLabel(labelText, helpText));
    const chip = mk('span', 'rt-slider-chip', valueRender(value));
    left.appendChild(chip);
    row.appendChild(left);

    const sliderWrap = mk('div', 'rt-slider-track-wrap');

    // Visual layer (below the input in z-stack, but visually on top because
    // the input's track is fully transparent). All three are pointer-events:
    // none so the input below still catches clicks/drags.
    const track = mk('div', 'rt-slider-track');
    const fill = mk('div', 'rt-slider-fill');
    const thumb = mk('div', 'rt-slider-thumb-custom');
    sliderWrap.appendChild(track);
    sliderWrap.appendChild(fill);
    sliderWrap.appendChild(thumb);

    // Interactive layer — the real input, painted transparent.
    const slider = mk('input', 'rt-slider-input', null, {
        id: sliderId, type: 'range',
        min: String(min), max: String(max), step: String(step),
        value: String(value),
    });
    sliderWrap.appendChild(slider);

    row.appendChild(sliderWrap);

    // ── Lerp state ─────────────────────────────────────────────────────
    const span = (max - min) || 1;
    const toPct = v => ((v - min) / span) * 100;
    let displayedPct = toPct(value);
    let targetPct = displayedPct;
    let rafHandle = null;

    const render = pct => {
        // Set both forms of the percentage so CSS calc() can produce an
        // inset-thumb position that matches the native input's interaction
        // zone. Native <input type=range> uses the convention where the
        // thumb's center moves from thumb_w/2 to track_w − thumb_w/2 —
        // never at the literal track edges. Our visible thumb must follow
        // the same convention or the click target diverges from the visible
        // position at extremes, making the slider feel hard to grab there.
        sliderWrap.style.setProperty('--rt-p', `${pct}%`);
        sliderWrap.style.setProperty('--rt-pf', String(pct / 100));
    };
    render(displayedPct);

    const tick = () => {
        const diff = targetPct - displayedPct;
        if (Math.abs(diff) < 0.12) {
            displayedPct = targetPct;
            render(displayedPct);
            rafHandle = null;
            return;
        }
        // ~25% per frame at 60fps = visible 80-130ms glide that catches
        // discrete jumps without feeling laggy on continuous drags (the
        // pointer is moving frame-by-frame, so the "lag" is invisible).
        displayedPct += diff * 0.25;
        render(displayedPct);
        rafHandle = requestAnimationFrame(tick);
    };

    const setTarget = pct => {
        targetPct = pct;
        if (!rafHandle) rafHandle = requestAnimationFrame(tick);
    };

    // ── Chip pulse on value-text change ────────────────────────────────
    let lastChipText = chip.textContent;
    const pulseChip = () => {
        chip.classList.remove('rt-chip-pulse');
        void chip.offsetWidth;
        chip.classList.add('rt-chip-pulse');
    };

    // ── Wire input events ──────────────────────────────────────────────
    slider.addEventListener('input', e => {
        const v = parseFloat(e.currentTarget.value);
        const next = valueRender(v);
        if (next !== lastChipText) {
            chip.textContent = next;
            lastChipText = next;
            pulseChip();
        }
        setTarget(toPct(v));
    });
    slider.addEventListener('change', e => {
        onChange?.(parseFloat(e.currentTarget.value), chip);
    });

    // ── Grabbing state for thumb styling ───────────────────────────────
    const onDown = () => {
        row.classList.add('rt-slider-grabbing');
    };
    const onUp = () => {
        row.classList.remove('rt-slider-grabbing');
    };
    slider.addEventListener('pointerdown', onDown, { passive: true });
    slider.addEventListener('pointerup', onUp, { passive: true });
    slider.addEventListener('pointercancel', onUp, { passive: true });
    slider.addEventListener('blur', onUp);

    return row;
}

function buildSelectField({ labelText, helpText, selectId, options, value, onChange }) {
    const row = mk('label', 'rt-control-row rt-field');
    row.appendChild(buildFieldLabel(labelText, helpText));

    const wrap = mk('span', 'rt-select-wrap');
    const select = mk('select', 'rt-select', null, { id: selectId });
    for (const optDef of options) {
        const opt = mk('option', null, optDef.label, { value: optDef.value });
        if (optDef.value === value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener('change', e => onChange?.(e.currentTarget.value));
    wrap.appendChild(select);
    row.appendChild(wrap);
    return row;
}

function buildDownloadBtn(variant, iconKey, primaryLabel, id) {
    const btn = mk('button', `rt-dl rt-dl-${variant}`, null, { id, type: 'button' });
    const iconWrap = mk('span', 'rt-dl-ico');
    const builder = RT_ICONS[iconKey];
    if (typeof builder === 'function') iconWrap.appendChild(builder());
    else iconWrap.textContent = iconKey || '◦';
    btn.appendChild(iconWrap);
    const txt = mk('span', 'rt-dl-txt');
    txt.appendChild(mk('span', 'rt-dl-p', primaryLabel));
    btn.appendChild(txt);
    return btn;
}

function buildControlButton(id, text, cls, label) {
    const btn = mk('button', `rt-ctrl ${cls || ''}`, text, {
        id, type: 'button', 'aria-label': label || text,
    });
    btn.disabled = true;
    return btn;
}

function buildProgress() {
    const wrap = mk('div', 'rt-progress', null, { id: 'rt_progress' });
    const top = mk('div', 'rt-progress-top');
    top.appendChild(mk('span', 'rt-progress-label', 'Ready', { id: 'rt_progress_label' }));
    top.appendChild(mk('span', 'rt-progress-pct', '0%', { id: 'rt_progress_pct' }));
    wrap.appendChild(top);
    const track = mk('div', 'rt-progress-track');
    track.appendChild(mk('div', 'rt-progress-fill', null, { id: 'rt_progress_fill' }));
    wrap.appendChild(track);
    wrap.appendChild(mk('div', 'rt-progress-meta', '', { id: 'rt_progress_meta' }));
    return wrap;
}

function initHeaderRain(canvas, panel, opts = {}) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !panel) return;

    const targetSelector = opts.targetSelector || '.rt-mark, .rt-hdr-btn';
    const targetKind = typeof opts.targetKind === 'function'
        ? opts.targetKind
        : el => (el.classList.contains('rt-mark') ? 'logo' : 'button');
    const shouldRun = typeof opts.shouldRun === 'function'
        ? opts.shouldRun
        : () => panel.classList.contains('show') && !panel.classList.contains('rt-rain-off');
    const lightningAllowed = opts.lightning !== false;
    const random = (min, max) => min + Math.random() * (max - min);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const RAIN_SIZE_SCALE = 1.12;
    const RAIN_SPEED_SCALE = 0.94;
    const BACKGROUND_DROP_DEPTH = 0.22;
    const BACKGROUND_DROP_SPEED_SCALE = 1.16;
    const WIND_RANGE = 8.4;
    const DROP_MIN_COUNT = 35;
    const DROP_MAX_COUNT = 58;
    const DROP_DENSITY_WIDTH = 7.3;
    const SURFACE_BEAD_COUNT = 4;
    const maxDropCount = Math.max(DROP_MIN_COUNT, Math.round(Number(opts.maxDrops) || DROP_MAX_COUNT));
    const surfaceBeadCount = Math.max(1, Math.round(Number(opts.surfaceBeadCount) || SURFACE_BEAD_COUNT));
    const UI_IMPACT_CHANCE = 0.46;
    const UI_IMPACT_TOP_DEPTH = 0.62;
    const UI_IMPACT_INSIDE_DEPTH = 0.78;
    const UI_IMPACT_COOLDOWN = 460;
    const LIGHTNING_FIRST_MIN_DELAY = 10000;
    const LIGHTNING_FIRST_MAX_DELAY = 22000;
    const LIGHTNING_MIN_DELAY = 22000;
    const LIGHTNING_MAX_DELAY = 52000;
    const FRAME_EPSILON_MS = 0.75;
    const state = {
        drops: [],
        beads: [],
        splashes: [],
        lightning: null,
        targets: [],
        targetHits: new WeakMap(),
        targetRefreshTs: 0,
        resizePending: true,
        nextLightningTs: 0,
        raf: null,
        lastTs: 0,
        nextFrameTs: 0,
        frameIntervalMs: 1000 / readRainFpsCap(S.rainFpsCap),
        width: 0,
        height: 0,
        dpr: 1,
        wind: random(-WIND_RANGE, WIND_RANGE),
        ambientFill: null,
    };

    const layout = {
        invalidateTargets() {
            state.targets = [];
            state.targetRefreshTs = 0;
        },

        requestResize() {
            state.resizePending = true;
        },

        resize() {
            state.resizePending = false;
            const rect = canvas.getBoundingClientRect();
            const width = Math.max(1, Math.round(canvas.clientWidth || rect.width));
            const height = Math.max(1, Math.round(canvas.clientHeight || rect.height));
            const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

            if (width === state.width && height === state.height && dpr === state.dpr) return false;

            state.width = width;
            state.height = height;
            state.dpr = dpr;
            state.ambientFill = null;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            particles.seed(true);
            layout.invalidateTargets();
            return true;
        },

        collectTargets(ts) {
            const now = typeof ts === 'number' ? ts : performance.now();
            if (state.targets.length && now - state.targetRefreshTs < 220) return state.targets;

            const canvasRect = canvas.getBoundingClientRect();
            state.targets = Array.from(panel.querySelectorAll(targetSelector))
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 1 || rect.height < 1) return null;
                    const kind = targetKind(el);
                    return {
                        el,
                        kind,
                        x: rect.left - canvasRect.left,
                        y: rect.top - canvasRect.top,
                        w: rect.width,
                        h: rect.height,
                        pad: kind === 'logo' ? 5 : 4,
                    };
                })
                .filter(Boolean);
            state.targetRefreshTs = now;
            return state.targets;
        },
    };

    const particles = {
        ensureCount(list, count) {
            while (list.length < count) list.push({});
            while (list.length > count) list.pop();
        },

        seed(initial = false) {
            const rainQuantity = readRainQuantitySetting(S.rainQuantity);
            const quantityScale = RAIN_QUANTITY_PARTICLE_SCALE[rainQuantity] ?? 1;
            const baseDrops = Math.round(Math.min(
                maxDropCount,
                Math.max(DROP_MIN_COUNT, state.width / DROP_DENSITY_WIDTH),
            ));
            const targetDrops = quantityScale <= 0 ? 0
                : Math.max(1, Math.round(baseDrops * quantityScale));
            const targetBeads = quantityScale <= 0 ? 0
                : Math.max(1, Math.round(surfaceBeadCount * quantityScale));

            particles.ensureCount(state.drops, targetDrops);
            particles.ensureCount(state.beads, targetBeads);
            for (const drop of state.drops) particles.resetDrop(drop, initial);
            for (const bead of state.beads) particles.resetBead(bead, initial);
        },

        resetDrop(drop, initial = false) {
            const depth = Math.random() ** 0.62;

            drop.depth = depth;
            drop.background = depth < BACKGROUND_DROP_DEPTH;
            drop.canHitSurface = depth > UI_IMPACT_TOP_DEPTH
                && Math.random() < UI_IMPACT_CHANCE;
            drop.x = random(-state.width * 0.15, state.width * 1.15);
            drop.y = initial
                ? random(-state.height * 0.1, state.height * 1.1)
                : random(-state.height * 0.75, -8);
            drop.vy = random(118, 248) * (0.54 + depth * 0.68)
                * RAIN_SPEED_SCALE
                * (drop.background ? BACKGROUND_DROP_SPEED_SCALE : 1);
            drop.vx = state.wind * (0.22 + depth * 0.48) + random(-9, 9);
            drop.len = random(5.5, 14) * (0.76 + depth * 0.72) * RAIN_SIZE_SCALE;
            drop.alpha = random(0.078, 0.25) * (0.8 + depth * 0.88);
            drop.width = random(0.5, 1.12) * (0.76 + depth * 0.68) * RAIN_SIZE_SCALE;
            drop.phase = random(0, Math.PI * 2);
            drop.freq = random(1.4, 3.4);
            drop.sway = random(-3.5, 3.5);
            drop.tailX = clamp(drop.vx / Math.max(1, drop.vy), -0.18, 0.18);
            drop.tailY = 1;
            drop.tailLen = drop.len * random(0.82, 1.08);
        },

        resetBead(bead, initial = false) {
            bead.x = random(state.width * 0.08, state.width * 0.92);
            bead.y = initial ? random(state.height * 0.12, state.height * 0.78)
                : random(-10, state.height * 0.25);
            bead.r = random(1.35, 3.15) * RAIN_SIZE_SCALE;
            bead.vx = state.wind * random(0.06, 0.18) + random(-0.7, 0.7);
            bead.vy = random(2.4, 8.5) * RAIN_SPEED_SCALE;
            bead.life = initial ? random(0.2, 1) : 0;
            bead.ttl = random(5.5, 10);
            bead.alpha = random(0.14, 0.30);
        },

        updateDrop(drop, dt, ts) {
            drop.prevX = drop.x;
            drop.prevY = drop.y;
            const sway = Math.sin(ts * 0.001 * drop.freq + drop.phase) * drop.sway;

            drop.x += (drop.vx + sway) * dt;
            drop.y += drop.vy * dt;
        },

        updateTrail(drop, prevX, prevY, dt) {
            const moveX = drop.x - prevX;
            const moveY = Math.max(0.01, drop.y - prevY);
            const moveLen = Math.hypot(moveX, moveY);
            if (moveLen <= 0.01) return;

            const maxLean = 0.14 + drop.depth * 0.12;
            const nextX = clamp(moveX / moveLen, -maxLean, maxLean);
            const nextY = Math.sqrt(Math.max(0.86, 1 - nextX * nextX));
            const follow = clamp(dt * 16, 0.14, 0.36);

            drop.tailX += (nextX - drop.tailX) * follow;
            drop.tailY += (nextY - drop.tailY) * follow;
            drop.tailLen += (drop.len * (0.88 + Math.min(1, moveLen / 4) * 0.18) - drop.tailLen) * follow;
        },

        escaped(drop) {
            return drop.y - drop.len > state.height + 18
                || drop.x < -state.width * 0.25
                || drop.x > state.width * 1.25;
        },

        updateBead(bead, dt) {
            bead.life += dt;
            bead.x += bead.vx * dt;
            bead.y += bead.vy * dt;
            if (bead.life > bead.ttl || bead.y > state.height + 8) particles.resetBead(bead, false);
        },

        addSplash(x, y, target, power = 1) {
            const count = target.kind === 'logo' ? 2 : 1;
            if (state.splashes.length > 24) state.splashes.splice(0, state.splashes.length - 24);

            for (let i = 0; i < count; i++) {
                state.splashes.push({
                    x: x + random(-1.2, 1.2),
                    y: y + random(-0.6, 0.6),
                    vx: random(-18, 18) * power,
                    vy: random(-28, -7) * power,
                    g: random(64, 110),
                    r: random(0.35, 0.9) * power * RAIN_SIZE_SCALE,
                    life: 0,
                    ttl: random(0.18, 0.38),
                    alpha: random(0.10, 0.24),
                });
            }
        },

        updateSplash(splash, dt) {
            splash.life += dt;
            if (splash.life / splash.ttl >= 1) return false;

            splash.x += splash.vx * dt;
            splash.y += splash.vy * dt;
            splash.vy += splash.g * dt;
            return true;
        },
    };

    const interaction = {
        markTarget(target, x, y, ts) {
            const lastHit = state.targetHits.get(target.el) ?? -Infinity;
            if (ts - lastHit < UI_IMPACT_COOLDOWN) return false;

            state.targetHits.set(target.el, ts);
            target.el.style.setProperty('--rt-rain-hit-x',
                `${clamp(((x - target.x) / target.w) * 100, 8, 92).toFixed(1)}%`);
            target.el.style.setProperty('--rt-rain-hit-y',
                `${clamp(((y - target.y) / target.h) * 100, 8, 92).toFixed(1)}%`);
            target.el.classList.remove('rt-rain-hit');
            void target.el.offsetWidth;
            target.el.classList.add('rt-rain-hit');

            window.setTimeout(() => {
                if (state.targetHits.get(target.el) === ts) target.el.classList.remove('rt-rain-hit');
            }, 380);

            return true;
        },

        maybeHit(drop, prevX, prevY, ts, targets) {
            if (!drop.canHitSurface) return false;

            for (const target of targets) {
                const topHit = prevY <= target.y + 1
                    && drop.y >= target.y - target.pad
                    && drop.x >= target.x - target.pad
                    && drop.x <= target.x + target.w + target.pad;
                const insideTarget = drop.x >= target.x - target.pad
                    && drop.x <= target.x + target.w + target.pad
                    && drop.y >= target.y - target.pad
                    && drop.y <= target.y + target.h + target.pad;
                const visibleHit = topHit
                    || (insideTarget && drop.depth > UI_IMPACT_INSIDE_DEPTH);

                if (!visibleHit) continue;

                const hitX = clamp((prevX + drop.x) / 2, target.x + 2, target.x + target.w - 2);
                const hitY = clamp(drop.y, target.y, target.y + target.h);
                if (!interaction.markTarget(target, hitX, hitY, ts)) continue;

                particles.addSplash(hitX, hitY, target, 0.48 + drop.depth * 0.34);
                particles.resetDrop(drop, false);
                return true;
            }
            return false;
        },
    };

    const lightning = {
        schedule(ts, immediate = false) {
            state.nextLightningTs = ts + (immediate
                ? random(LIGHTNING_FIRST_MIN_DELAY, LIGHTNING_FIRST_MAX_DELAY)
                : random(LIGHTNING_MIN_DELAY, LIGHTNING_MAX_DELAY));
        },

        maybeStrike(ts) {
            if (!lightningAllowed || !S.lightningEnabled) {
                state.lightning = null;
                state.nextLightningTs = 0;
                return;
            }
            if (!state.nextLightningTs) lightning.schedule(ts, true);
            if (ts < state.nextLightningTs || state.lightning) return;

            state.lightning = lightning.create(ts);
            lightning.schedule(ts);
        },

        create(ts) {
            const startX = random(state.width * 0.16, state.width * 0.84);
            const topY = -6;
            const bottomY = state.height + 6;
            const segments = Math.round(random(5, 8));
            const drift = state.wind * random(0.5, 1.3);
            const points = [{ x: startX, y: topY }];
            let x = startX;

            for (let i = 1; i <= segments; i++) {
                const pct = i / segments;
                const yJitter = i === segments ? 0 : random(-5, 5);
                x += random(-18, 18) + drift * 0.18;
                points.push({
                    x: clamp(x, state.width * 0.08, state.width * 0.92),
                    y: topY + (bottomY - topY) * pct + yJitter,
                });
            }

            const branches = points.slice(1, -1)
                .filter(() => Math.random() < 0.42)
                .map(point => {
                    const side = Math.random() < 0.5 ? -1 : 1;
                    const len = random(14, 34);
                    return [
                        point,
                        {
                            x: clamp(point.x + side * len, 4, state.width - 4),
                            y: clamp(point.y + random(6, 22), 2, state.height - 2),
                        },
                    ];
                });

            return {
                born: ts,
                ttl: random(260, 420),
                flash: random(0.10, 0.18),
                points,
                branches,
            };
        },
    };

    const render = {
        clear() {
            ctx.clearRect(0, 0, state.width, state.height);
        },

        ambient() {
            if (!state.ambientFill) {
                const glow = ctx.createLinearGradient(0, 0, state.width, state.height);
                glow.addColorStop(0, 'rgba(0, 168, 230, 0.045)');
                glow.addColorStop(0.45, 'rgba(94, 184, 224, 0.015)');
                glow.addColorStop(1, 'rgba(176, 138, 242, 0.035)');
                state.ambientFill = glow;
            }
            ctx.fillStyle = state.ambientFill;
            ctx.fillRect(0, 0, state.width, state.height);
        },

        lightning(ts) {
            const strike = state.lightning;
            if (!strike) return;

            const t = (ts - strike.born) / strike.ttl;
            if (t >= 1) {
                state.lightning = null;
                return;
            }

            const pulse = Math.max(0, 1 - t) * (0.72 + Math.sin(t * Math.PI * 7) * 0.28);
            const drawPath = points => {
                ctx.beginPath();
                points.forEach((point, index) => {
                    if (index) ctx.lineTo(point.x, point.y);
                    else ctx.moveTo(point.x, point.y);
                });
            };

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = `rgba(120, 198, 255, ${strike.flash * pulse})`;
            ctx.fillRect(0, 0, state.width, state.height);

            ctx.shadowColor = `rgba(112, 200, 255, ${pulse * 0.78})`;
            ctx.shadowBlur = 24;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            drawPath(strike.points);
            ctx.strokeStyle = `rgba(78, 168, 236, ${pulse * 0.46})`;
            ctx.lineWidth = 7;
            ctx.stroke();

            drawPath(strike.points);
            ctx.strokeStyle = `rgba(238, 249, 255, ${pulse * 0.86})`;
            ctx.lineWidth = 1.15;
            ctx.stroke();

            ctx.shadowBlur = 8;
            ctx.strokeStyle = `rgba(180, 230, 255, ${pulse * 0.58})`;
            ctx.lineWidth = 0.85;
            for (const branch of strike.branches) {
                drawPath(branch);
                ctx.stroke();
            }
            ctx.restore();
        },

        drop(drop) {
            const x2 = drop.x - drop.tailX * drop.tailLen;
            const y2 = drop.y - drop.tailY * drop.tailLen;

            if (drop.background) {
                ctx.fillStyle = `rgba(195, 235, 255, ${drop.alpha * 0.95})`;
                ctx.beginPath();
                ctx.ellipse(drop.x, drop.y, drop.width * 0.75,
                    Math.max(0.8, drop.width * 1.7), 0, 0, Math.PI * 2);
                ctx.fill();
                return;
            }

            const grad = ctx.createLinearGradient(x2, y2, drop.x, drop.y);
            grad.addColorStop(0, 'rgba(170, 225, 255, 0)');
            grad.addColorStop(0.58, `rgba(180, 232, 255, ${drop.alpha * 0.5})`);
            grad.addColorStop(1, `rgba(235, 250, 255, ${drop.alpha})`);

            ctx.strokeStyle = grad;
            ctx.lineWidth = drop.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(drop.x, drop.y);
            ctx.stroke();

            if (drop.depth > 0.68) {
                ctx.fillStyle = `rgba(255, 255, 255, ${drop.alpha * 0.46})`;
                ctx.beginPath();
                ctx.arc(drop.x, drop.y, Math.max(0.45, drop.width * 0.62), 0, Math.PI * 2);
                ctx.fill();
            }
        },

        bead(bead) {
            const fade = Math.sin(Math.min(1, bead.life / bead.ttl) * Math.PI);
            const alpha = bead.alpha * fade;
            if (alpha <= 0.002) return;

            ctx.save();
            ctx.shadowBlur = 7;
            ctx.shadowColor = `rgba(60, 180, 255, ${alpha * 0.7})`;
            ctx.fillStyle = `rgba(190, 235, 255, ${alpha * 0.62})`;
            ctx.beginPath();
            ctx.ellipse(bead.x, bead.y, bead.r * 0.78, bead.r, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.82})`;
            ctx.beginPath();
            ctx.arc(bead.x - bead.r * 0.22, bead.y - bead.r * 0.28,
                Math.max(0.45, bead.r * 0.22), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        splash(splash) {
            const t = splash.life / splash.ttl;
            const alpha = splash.alpha * (1 - t);

            ctx.fillStyle = `rgba(220, 246, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(splash.x, splash.y, Math.max(0.35, splash.r * (1 - t * 0.35)), 0, Math.PI * 2);
            ctx.fill();

            if (t < 0.55) {
                ctx.strokeStyle = `rgba(170, 228, 255, ${alpha * 0.55})`;
                ctx.lineWidth = 0.55;
                ctx.beginPath();
                ctx.moveTo(splash.x, splash.y);
                ctx.lineTo(splash.x - splash.vx * 0.035, splash.y - splash.vy * 0.025);
                ctx.stroke();
            }
        },
    };

    const lifecycle = {
        shouldRun() {
            return !document.hidden && shouldRun();
        },

        updateFrameInterval() {
            state.frameIntervalMs = 1000 / readRainFpsCap(S.rainFpsCap);
        },

        frame(ts) {
            if (!lifecycle.shouldRun()) {
                state.raf = null;
                state.lastTs = 0;
                state.nextFrameTs = 0;
                return;
            }

            const interval = state.frameIntervalMs;
            if (state.nextFrameTs && ts + FRAME_EPSILON_MS < state.nextFrameTs) {
                state.raf = requestAnimationFrame(lifecycle.frame);
                return;
            }
            if (!state.nextFrameTs || ts - state.nextFrameTs > interval * 2) {
                state.nextFrameTs = ts + interval;
            } else {
                state.nextFrameTs += interval;
            }

            if (state.resizePending) layout.resize();
            const dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000)
                : Math.min(0.05, interval / 1000);
            state.lastTs = ts;

            render.clear();
            render.ambient();
            lightning.maybeStrike(ts);
            render.lightning(ts);

            const activeTargets = layout.collectTargets(ts);

            for (const drop of state.drops) {
                particles.updateDrop(drop, dt, ts);
                if (interaction.maybeHit(drop, drop.prevX, drop.prevY, ts, activeTargets)) continue;
                if (particles.escaped(drop)) {
                    particles.resetDrop(drop, false);
                    continue;
                }
                particles.updateTrail(drop, drop.prevX, drop.prevY, dt);
                render.drop(drop);
            }

            for (const bead of state.beads) {
                particles.updateBead(bead, dt);
                render.bead(bead);
            }

            for (let i = state.splashes.length - 1; i >= 0; i--) {
                const splash = state.splashes[i];
                if (!particles.updateSplash(splash, dt)) {
                    state.splashes.splice(i, 1);
                    continue;
                }
                render.splash(splash);
            }

            state.raf = requestAnimationFrame(lifecycle.frame);
        },

        start() {
            if (state.raf || !lifecycle.shouldRun()) return;
            lifecycle.updateFrameInterval();
            layout.resize();
            state.raf = requestAnimationFrame(lifecycle.frame);
        },

        stop() {
            if (state.raf) cancelAnimationFrame(state.raf);
            state.raf = null;
            state.lastTs = 0;
            state.nextFrameTs = 0;
            state.resizePending = true;
            state.lightning = null;
            state.nextLightningTs = 0;
        },

        sync() {
            layout.invalidateTargets();
            if (lifecycle.shouldRun()) lifecycle.start();
            else lifecycle.stop();
        },
    };

    panel.__rtRainMoved = layout.invalidateTargets;
    panel.__rtRainQuantityChanged = () => {
        particles.seed(true);
        lifecycle.sync();
    };
    panel.__rtRainFpsChanged = () => {
        lifecycle.updateFrameInterval();
        state.lastTs = 0;
        state.nextFrameTs = 0;
        lifecycle.sync();
    };
    panel.__rtLightningChanged = () => {
        if (!S.lightningEnabled) {
            state.lightning = null;
            state.nextLightningTs = 0;
        }
        lifecycle.sync();
    };

    new MutationObserver(lifecycle.sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(layout.requestResize).observe(canvas);
    document.addEventListener('visibilitychange', lifecycle.sync, { passive: true });
    window.addEventListener('resize', layout.requestResize, { passive: true });
    layout.resize();
}

function buildPanel() {
    const statsFab = mk('button', 'rt-floating', null, {
        id: 'rt_stats_fab', type: 'button',
        'aria-label': 'Open RainTube statistics', 'aria-expanded': 'false',
        'data-tip': 'Statistics', 'data-tip-place': 'bottom', 'data-tip-style': 'native',
    });
    // Start hidden until StatsTracker loads the user's display preference.
    // setToolbarButtonHidden() keeps the hidden state deterministic even while
    // YouTube's masthead is hydrating and restyling moved button children.
    setToolbarButtonHidden(statsFab, true);
    const statsFabIcon = mk('span', 'rt-fab-icon');
    statsFabIcon.appendChild(RT_ICONS.chart());
    statsFab.appendChild(statsFabIcon);
    document.body.appendChild(statsFab);
    initTooltips(statsFab);

    const fab = mk('button', 'rt-floating', null, {
        id: 'rt_fab', type: 'button',
        'aria-label': 'Open RainTube', 'aria-expanded': 'false',
        'data-tip': 'RainTube', 'data-tip-place': 'bottom', 'data-tip-style': 'native',
    });
    setToolbarButtonHidden(fab, !readButtonVisible(S.mainButtonVisible, true));
    const fabIconWrap = mk('span', 'rt-fab-icon');
    fabIconWrap.appendChild(makeRaintubeLogo(22));
    fab.appendChild(fabIconWrap);
    document.body.appendChild(fab);
    initTooltips(fab);

    const statsPanel = mk('div', null, null, {
        id: 'rt_stats_panel', role: 'dialog', 'aria-hidden': 'true', 'aria-label': 'RainTube statistics',
    });
    const statsHdr = mk('header', 'rt-hdr rt-stats-menu-hdr', null, { id: 'rt_stats_drag' });
    const statsHdrLeft = mk('div', 'rt-hdr-l');
    const statsMark = mk('div', 'rt-mark rt-stats-menu-mark');
    statsMark.appendChild(RT_ICONS.chart());
    statsHdrLeft.appendChild(statsMark);
    const statsHdrText = mk('div', 'rt-stats-menu-title-wrap');
    statsHdrText.appendChild(mk('span', 'rt-stats-menu-eyebrow', 'RainTube'));
    statsHdrText.appendChild(mk('h2', 'rt-stats-menu-title', 'Statistics'));
    statsHdrLeft.appendChild(statsHdrText);
    const statsHdrRight = mk('div', 'rt-hdr-r');
    const statsCloseBtn = mk('button', 'rt-hdr-btn rt-close rt-stats-menu-close', null,
        { id: 'rt_stats_close', type: 'button', 'aria-label': 'Close statistics' });
    statsCloseBtn.appendChild(mk('span', 'rt-close-glyph', '×'));
    statsHdrRight.appendChild(statsCloseBtn);
    statsHdr.appendChild(statsHdrLeft);
    statsHdr.appendChild(statsHdrRight);
    statsPanel.appendChild(statsHdr);
    statsPanel.appendChild(mk('div', 'rt-stats-menu-body', null, { id: 'rt_stats_panel_slot' }));
    statsPanel.appendChild(mk('footer', 'rt-foot rt-stats-menu-foot', APP_FOOTER_TEXT));
    document.body.appendChild(statsPanel);

    const panel = mk('div', null, null, { id: 'rt_panel', role: 'dialog' });

    const hdr = mk('header', 'rt-hdr', null, { id: 'rt_drag' });

    // Rain animation layer: canvas keeps drops independent instead of moving
    // a tiled diagonal texture behind the header.
    const rain = mk('canvas', 'rt-rain-canvas', null, { 'aria-hidden': 'true' });
    hdr.appendChild(rain);

    const left = mk('div', 'rt-hdr-l');
    const mark = mk('div', 'rt-mark');
    mark.appendChild(makeRaintubeLogo(20));
    left.appendChild(mark);
    const text = mk('div', 'rt-hdr-text');
    text.appendChild(mk('h1', 'rt-hdr-title', 'RainTube'));
    text.appendChild(mk('p', 'rt-hdr-sub', 'Private · Quality · Quiet'));
    left.appendChild(text);
    const hdrRight = mk('div', 'rt-hdr-r');
    const settingsBtn = mk('button', 'rt-hdr-btn rt-hdr-settings', null, {
        id: 'rt_settings_open', type: 'button', 'aria-label': 'Open settings',
    });
    settingsBtn.appendChild(mk('span', 'rt-hdr-gear-icon', '⚙'));
    hdrRight.appendChild(settingsBtn);
    const closeBtn = mk('button', 'rt-hdr-btn rt-close', null,
        { id: 'rt_close', type: 'button', 'aria-label': 'Close RainTube' });
    closeBtn.appendChild(mk('span', 'rt-close-glyph', '×'));
    hdrRight.appendChild(closeBtn);
    hdr.appendChild(left);
    hdr.appendChild(hdrRight);
    panel.appendChild(hdr);


    const body = mk('div', 'rt-body');

    const card = mk('div', 'rt-card');
    const cardHead = mk('div', 'rt-card-head');
    const nowMeta = mk('div', 'rt-card-now-meta');
    nowMeta.appendChild(mk('span', 'rt-card-eyebrow', 'Now playing'));
    nowMeta.appendChild(mk('span', 'rt-card-id-sep', '·'));
    nowMeta.appendChild(mk('span', 'rt-card-author', '—', { id: 'rt_vid_author' }));
    cardHead.appendChild(nowMeta);
    card.appendChild(cardHead);
    card.appendChild(mk('p', 'rt-card-title', 'Open a video to start', { id: 'rt_title' }));
    const idRow = mk('div', 'rt-card-id');
    const idGroup = mk('div', 'rt-card-id-group');
    idGroup.appendChild(mk('span', 'rt-card-id-lbl', 'ID'));
    idGroup.appendChild(mk('code', null, '—', { id: 'rt_vid_id' }));
    const qualityGroup = mk('div', 'rt-card-id-group');
    qualityGroup.appendChild(mk('span', 'rt-card-id-lbl', 'Quality'));
    qualityGroup.appendChild(mk('code', null, '—', { id: 'rt_vid_quality' }));
    idRow.appendChild(idGroup);
    idRow.appendChild(mk('span', 'rt-card-id-divider', null, { 'aria-hidden': 'true' }));
    idRow.appendChild(qualityGroup);
    card.appendChild(idRow);
    body.appendChild(card);

    body.appendChild(mk('h2', 'rt-section', 'Download'));

    const downloadArea = mk('div', 'rt-download-area');
    const downloadLine = mk('div', 'rt-download-line');
    const dlRow = mk('div', 'rt-dl-row');
    dlRow.appendChild(buildDownloadBtn('video', 'video', 'Video', 'rt_dl_v'));
    dlRow.appendChild(buildDownloadBtn('audio', 'audio', 'Audio', 'rt_dl_a'));

    const controls = mk('div', 'rt-controls');
    controls.appendChild(buildControlButton('rt_dl_stop', '✕', 'rt-ctrl-cancel', 'Stop after current request'));

    downloadLine.appendChild(dlRow);
    downloadLine.appendChild(controls);
    downloadArea.appendChild(downloadLine);
    downloadArea.appendChild(buildProgress());
    body.appendChild(downloadArea);

    body.appendChild(mk('h2', 'rt-section', 'Features'));

    const toggles = mk('div', 'rt-toggles');
    toggles.appendChild(buildToggleCard('shorts', 'rt_sw_shorts', 'Shorts',
        'rt_sw_shorts_st',
        'Hides Shorts across YouTube.'));
    toggles.appendChild(buildToggleCard('quality', 'rt_sw_q', 'Quality',
        'rt_sw_q_st',
        'Sets playback to your target quality (or closest available).'));
    toggles.appendChild(buildToggleCard('private', 'rt_sw_private', 'Private',
        'rt_sw_private_st',
        'Downloads through privacy-friendly mirrors.'));
    toggles.appendChild(buildToggleCard('chart', 'rt_sw_stats', 'Statistics',
        'rt_sw_stats_st',
        'Tracks local watch summaries.'));
    body.appendChild(toggles);

    const note = mk('div', 'rt-note');
    note.appendChild(mk('span', 'rt-note-ico', '🛡'));
    note.appendChild(mk('span', null,
        'RainTube keeps YouTube cleaner, adds privacy-minded downloads, and gives the interface a little atmosphere. Your preferences stay local.'));
    body.appendChild(note);

    panel.appendChild(body);
    panel.appendChild(mk('footer', 'rt-foot', APP_FOOTER_TEXT));

    document.body.appendChild(panel);
    if (S.rainQuantity === 'off') panel.classList.add('rt-rain-off');
    initHeaderRain(rain, panel);
    initTooltips(panel);
    resetProgress();
    // Make sure the toast container exists.
    getToastContainer();

    // Build the master settings modal (hidden until opened).
    buildSettingsModal();

    return { panel, fab, statsFab, statsPanel };
}

function findYouTubeTopbarControls() {
    const selectors = [
        'ytd-masthead #end #buttons',
        'ytd-masthead #end',
        '#masthead #end #buttons',
        '#masthead #end',
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.isConnected) return el;
    }
    return null;
}

function directChildWithin(parent, node) {
    let el = node;
    while (el && el.parentElement !== parent) el = el.parentElement;
    return el?.parentElement === parent ? el : null;
}

function findYouTubeUploadControl(container) {
    const selectors = [
        '[aria-label*="Create" i]',
        '[title*="Create" i]',
        '[aria-label*="Upload" i]',
        '[title*="Upload" i]',
        'ytd-topbar-menu-button-renderer',
    ];

    for (const selector of selectors) {
        const match = container.querySelector(selector);
        const child = match && directChildWithin(container, match);
        if (child && child.id !== 'rt_fab' && child.id !== 'rt_stats_fab') return child;
    }
    return null;
}

function findYouTubeLikeActionSlot() {
    const hostSelectors = [
        'ytd-watch-metadata #top-level-buttons-computed',
        'ytd-watch-flexy #top-level-buttons-computed',
        '#top-level-buttons-computed',
    ];
    const likeSelectors = [
        'segmented-like-dislike-button-view-model',
        'like-button-view-model',
        'ytd-segmented-like-dislike-button-renderer',
        'ytd-toggle-button-renderer:first-child',
        'button[aria-label*="like" i]',
        'button[title*="like" i]',
    ];

    for (const hostSel of hostSelectors) {
        const host = document.querySelector(hostSel);
        if (!host?.isConnected) continue;

        for (const likeSel of likeSelectors) {
            const match = host.querySelector(likeSel);
            const child = match && directChildWithin(host, match);
            if (child && child.id !== 'rt_fab' && child.id !== 'rt_stats_fab') {
                return { row: host, before: child };
            }
        }
        return { row: host, before: host.firstElementChild || null };
    }
    return null;
}

function setToolbarButtonHidden(btn, hidden) {
    if (!btn) return;
    btn.hidden = !!hidden;
    // Keep an inline display guard in sync with the hidden attribute. YouTube's
    // chrome occasionally restyles moved button children during initial
    // hydration; the explicit inline value makes the hidden state deterministic
    // across those boot-time restyles.
    btn.style.display = hidden ? 'none' : '';
}

function clearButtonPlacementClasses(btn) {
    btn?.classList.remove('rt-topbar', 'rt-floating', 'rt-watch-action');
}

function parkHiddenToolbarButton(btn) {
    if (!btn || !btn.hidden) return;
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    clearButtonPlacementClasses(btn);
    btn.classList.add('rt-floating');
}

function syncButtonPlacement() {
    const fab = S?._fab || document.getElementById('rt_fab');
    const statsFab = S?._statsFab || document.getElementById('rt_stats_fab');
    if (fab) setToolbarButtonHidden(fab, !readButtonVisible(S?.mainButtonVisible, true));
    if (statsFab) setToolbarButtonHidden(statsFab, !StatsTracker.isPanelEnabled());
    mountRainTubeButtons(statsFab, fab);
}

function insertRainTubeButtons(row, before, buttons, placementClass) {
    let anchor = before || row.firstElementChild || null;
    for (let i = buttons.length - 1; i >= 0; i--) {
        const btn = buttons[i];
        if (btn.parentElement !== row || btn.nextElementSibling !== anchor) {
            row.insertBefore(btn, anchor);
        }
        btn.style.display = '';
        clearButtonPlacementClasses(btn);
        btn.classList.add(placementClass);
        anchor = btn;
    }
}

function parkUnavailablePlacementButton(btn) {
    if (!btn || btn.hidden) return;
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    clearButtonPlacementClasses(btn);
    btn.style.display = 'none';
}

function mountRainTubeButtons(statsFab, fab) {
    // Do not insert hidden RainTube buttons into YouTube chrome. Relying only
    // on [hidden] is fragile because YouTube can restyle slotted button
    // children during boot; parking hidden buttons in <body> keeps the page
    // chrome aligned with the user's display settings.
    parkHiddenToolbarButton(statsFab);
    parkHiddenToolbarButton(fab);

    const buttons = [
        statsFab && !statsFab.hidden ? statsFab : null,
        fab && !fab.hidden ? fab : null,
    ].filter(Boolean);
    if (!buttons.length) return;

    const placement = readButtonPlacement(S?.buttonPlacement);

    if (placement === 'like') {
        const slot = findYouTubeLikeActionSlot();
        if (slot?.row) {
            insertRainTubeButtons(slot.row, slot.before, buttons, 'rt-watch-action');
            return;
        }
        // The Like row only exists on watch pages. Until YouTube mounts it,
        // keep the buttons available for the next mount pass but visually
        // parked, rather than showing them somewhere the user did not choose.
        for (const btn of buttons) parkUnavailablePlacementButton(btn);
        return;
    }

    const row = findYouTubeTopbarControls();
    if (row) {
        const upload = findYouTubeUploadControl(row);
        insertRainTubeButtons(row, upload || row.firstElementChild || null, buttons, 'rt-topbar');
        return;
    }

    for (const btn of buttons) {
        if (btn.parentElement !== document.body) document.body.appendChild(btn);
        btn.style.display = '';
        clearButtonPlacementClasses(btn);
        btn.classList.add('rt-floating');
    }
}

/* ── UI sync ────────────────────────────────────────────────────────────── */

let _uiPending = false;
function uiSync() {
    if (_uiPending) return;
    _uiPending = true;
    requestAnimationFrame(() => {
        _uiPending = false;

        // Everything below updates elements inside #rt_panel. When the panel
        // is closed (and no settings modal / active download needs it), the
        // whole sweep — title/channel querySelector work, player quality
        // reads, and control-state syncing — is invisible work. Opening the
        // panel calls uiSync() directly, so skipping here is safe.
        const panelEl = document.getElementById('rt_panel');
        const panelOpen = panelEl?.classList.contains('show');
        if (!panelOpen && !isSettingsOpen() && !S.downloading) return;

        syncToggle('rt_sw_shorts', S.shortsBlockerEnabled);
        syncToggle('rt_sw_q', S.qualityEnabled);
        syncToggle('rt_sw_private', S.privateDownloadsEnabled);
        syncToggle('rt_sw_stats', StatsTracker.getEnabled());

        const vid = getVideoId();
        const title = document.getElementById('rt_title');
        if (title) {
            const t = vid ? (getVideoTitle() || 'Untitled') : 'Open a video to start';
            if (title.textContent !== t) title.textContent = t;
            title.classList.toggle('rt-card-empty', !vid);
        }
        const idEl = document.getElementById('rt_vid_id');
        if (idEl && idEl.textContent !== (vid || '—')) idEl.textContent = vid || '—';
        const authorEl = document.getElementById('rt_vid_author');
        if (authorEl) {
            const author = vid ? (getVideoAuthor() || 'Unknown channel') : 'No video';
            if (authorEl.textContent !== author) authorEl.textContent = author;
        }
        const qualityEl = document.getElementById('rt_vid_quality');
        if (qualityEl) {
            const cq = vid ? readCurrentQuality() : null;
            const text = cq ? (QUALITY_LABEL[cq] || cq) : '—';
            if (qualityEl.textContent !== text) qualityEl.textContent = text;
        }

        // Download button enabled state.
        for (const id of ['rt_dl_v', 'rt_dl_a']) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !vid || S.downloading;
        }

        const stop = document.getElementById('rt_dl_stop');
        if (stop) {
            stop.disabled = !S.downloading || S.privateCancelRequested;
            stop.classList.toggle('active', S.downloading && !S.privateCancelRequested);
            stop.title = S.privateCancelRequested ? 'Stopping after current request' : 'Stop after current request';
        }

        StatsTracker.renderStatsPanelSlot();
    });
}

function syncToggle(id, on) {
    const sw = document.getElementById(id);
    if (!sw) return;
    sw.classList.toggle('on', !!on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    const st = document.getElementById(`${id}_st`);
    if (st) st.textContent = on ? 'ON' : 'OFF';
    // Mirror the on/off state onto the parent toggle card so the icon
    // glow can be styled via .rt-tc.on without depending on :has() (which
    // some Tampermonkey/WebView contexts still lag on).
    const card = sw.closest('.rt-tc');
    if (card) card.classList.toggle('on', !!on);
}

/* ── Drag ───────────────────────────────────────────────────────────────── */

function initDrag(panel, fab, opts = {}) {
    const handle = opts.handleSelf ? panel : panel.querySelector(opts.handleSelector || '#rt_drag');
    if (!handle) return;

    const margin = 8;
    const fallbackW = opts.fallbackW || 360;
    const fallbackH = opts.fallbackH || 540;
    const viewport = () => {
        const vv = window.visualViewport;
        return {
            width: Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || fallbackW),
            height: Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || fallbackH),
        };
    };
    const panelSize = () => {
        const { width: vw, height: vh } = viewport();
        const rect = panel.getBoundingClientRect();
        return {
            width: Math.min(rect.width || panel.offsetWidth || fallbackW, Math.max(1, vw - margin * 2)),
            height: Math.min(rect.height || panel.offsetHeight || fallbackH, Math.max(1, vh - margin * 2)),
        };
    };

    let ox = Math.max(margin, window.innerWidth - fallbackW - 18);
    let oy = Math.max(margin, window.innerHeight - fallbackH - 90);
    let userMoved = false;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const snapToDevicePixel = value => {
        if (!opts.snapToDevicePixels) return value;
        const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
        return Math.round(value * dpr) / dpr;
    };
    const setPos = (x, y) => {
        const { width: vw, height: vh } = viewport();
        const { width: pw, height: ph } = panelSize();
        ox = snapToDevicePixel(clamp(x, margin, Math.max(margin, vw - pw - margin)));
        oy = snapToDevicePixel(clamp(y, margin, Math.max(margin, vh - ph - margin)));
        // Pixel-snapped 2D translation avoids the fuzzy text/rules that can
        // appear when a translucent card is composited at fractional pixels.
        panel.style.transform = opts.snapToDevicePixels
            ? `translate(${ox}px, ${oy}px)`
            : `translate3d(${ox}px,${oy}px,0)`;
        panel.__rtRainMoved?.();
    };

    const positionNearButton = (force = false) => {
        // Preserve manual placement, but still pull it back inside the
        // viewport after window snapping/resizing changes the available space.
        if (!force && userMoved) {
            setPos(ox, oy);
            return;
        }
        const { width: vw, height: vh } = viewport();
        const { width: pw, height: ph } = panelSize();
        const rect = (fab || S._fab)?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            setPos(vw - pw - 18, vh - ph - 90);
            return;
        }
        let x = rect.left;
        let y = rect.top - ph - 12;
        if (x + pw > vw - margin) x = vw - pw - margin;
        if (y < margin) y = rect.bottom + 12;
        if (y + ph > vh - margin) y = vh - ph - margin;
        setPos(x, y);
    };

    panel.__rtPositionNearButton = positionNearButton;
    positionNearButton(true);

    let dragging = false, pid = null, ix = 0, iy = 0, raf = false;

    handle.addEventListener('pointerdown', e => {
        if (e.target instanceof Element
            && e.target.closest('button, input, select, textarea, a, [role="button"], [data-no-drag]')) return;
        dragging = true; userMoved = true; pid = e.pointerId;
        ix = e.clientX - ox; iy = e.clientY - oy;
        panel.classList.add('rt-drag');
        try { handle.setPointerCapture(pid); } catch {}
    }, { passive: true });

    handle.addEventListener('pointermove', e => {
        if (!dragging || e.pointerId !== pid || raf) return;
        raf = true;
        requestAnimationFrame(() => {
            setPos(e.clientX - ix, e.clientY - iy);
            raf = false;
        });
    }, { passive: true });

    const end = e => {
        if (e.pointerId !== pid) return;
        dragging = false;
        panel.classList.remove('rt-drag');
        try { handle.releasePointerCapture(pid); } catch {}
        pid = null;
    };
    handle.addEventListener('pointerup', end, { passive: true });
    handle.addEventListener('pointercancel', end, { passive: true });

    let resizeRaf = 0;
    let resizeTimer = 0;
    const schedulePositionSync = () => {
        if (!resizeRaf) {
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                positionNearButton(false);
            });
        }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => positionNearButton(false), 90);
    };
    window.addEventListener('resize', schedulePositionSync, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePositionSync, { passive: true });
}

/* ── Master settings modal ──────────────────────────────────────────────── */

/**
 * Build the master settings dialog. Contains General plus the feature
 * sections (Customization, Shorts, Statistics, Playback Quality, Private
 * Downloads) inside a single scrollable surface. Hidden by default; opened
 * from the header gear button.
 */
function buildSettingsModal() {
    if (document.getElementById('rt_settings_root')) return;

    const root = mk('div', null, null, { id: 'rt_settings_root', 'aria-hidden': 'true' });

    const backdrop = mk('div', 'rt-settings-backdrop', null,
        { id: 'rt_settings_backdrop' });
    root.appendChild(backdrop);

    const modal = mk('div', 'rt-settings-modal', null, {
        id: 'rt_settings_modal', role: 'dialog',
        'aria-modal': 'true', 'aria-labelledby': 'rt_settings_title',
    });

    // Header
    const hdr = mk('header', 'rt-settings-hdr');
    const hdrL = mk('div', 'rt-settings-hdr-l');
    const settingsTile = mk('div', 'rt-settings-icon');
    settingsTile.appendChild(mk('span', 'rt-settings-icon-glyph', '⚙'));
    hdrL.appendChild(settingsTile);
    const titleWrap = mk('div', 'rt-settings-title-wrap');
    titleWrap.appendChild(mk('span', 'rt-settings-eyebrow', 'RainTube'));
    titleWrap.appendChild(mk('h2', 'rt-settings-title', 'Settings',
        { id: 'rt_settings_title' }));
    hdrL.appendChild(titleWrap);
    hdr.appendChild(hdrL);
    const settingsCloseBtn = mk('button', 'rt-settings-close', null, {
        id: 'rt_settings_close', type: 'button', 'aria-label': 'Close settings',
    });
    settingsCloseBtn.appendChild(mk('span', 'rt-close-glyph', '×'));
    hdr.appendChild(settingsCloseBtn);
    modal.appendChild(hdr);

    // Body: all sections, stacked
    const body = mk('div', 'rt-settings-body');
    for (const section of buildSettingsSections()) body.appendChild(section);
    modal.appendChild(body);

    // Footer (just version + done)
    const foot = mk('footer', 'rt-settings-foot');
    foot.appendChild(mk('span', 'rt-settings-foot-ver', `RainTube · ${CFG.version}`));
    const done = mk('button', 'rt-settings-done', 'Done',
        { id: 'rt_settings_done', type: 'button' });
    foot.appendChild(done);
    modal.appendChild(foot);

    root.appendChild(modal);
    document.body.appendChild(root);

    initTooltips(root);
}

function isSettingsOpen() {
    const root = document.getElementById('rt_settings_root');
    return !!(root && root.classList.contains('show'));
}

function setSettingsOpen(open) {
    const root = document.getElementById('rt_settings_root');
    if (!root) return;
    const willOpen = !!open;
    const html = document.documentElement;

    if (willOpen) {
        // Save the page's existing overflow and lock it for the duration.
        // This prevents wheel/touch events from scrolling YouTube under
        // the modal — `overscroll-behavior: contain` on the modal body
        // handles chained scroll, but a small modal whose body doesn't
        // need to scroll wouldn't catch any scroll events otherwise.
        if (html.dataset.rtPrevOverflow === undefined) {
            html.dataset.rtPrevOverflow = html.style.overflow || '';
        }
        html.style.overflow = 'hidden';

        root.classList.add('show');
        root.setAttribute('aria-hidden', 'false');
        // Focus the modal's close button on open for keyboard users.
        setTimeout(() => document.getElementById('rt_settings_close')?.focus(), 50);
    } else {
        // Restore page scrolling exactly as it was.
        if (html.dataset.rtPrevOverflow !== undefined) {
            html.style.overflow = html.dataset.rtPrevOverflow;
            delete html.dataset.rtPrevOverflow;
        }

        root.classList.remove('show');
        root.setAttribute('aria-hidden', 'true');
        hideTooltip();
    }
}

let _menuCommandsRegistered = false;

function registerMenuCommands({ openPanel, openSettings }) {
    if (_menuCommandsRegistered) return;
    _menuCommandsRegistered = true;

    GM.registerMenuCommand('Open RainTube Panel', openPanel);
    GM.registerMenuCommand('Open RainTube Settings', openSettings);
}

function bindEvents(panel, fab, statsFab, statsPanel) {
    // Null-guarded listener binding. If buildPanel ever fails to inject an
    // element (CSP, a future refactor), this logs once instead of throwing
    // and killing the rest of boot().
    const on = (id, event, handler, opts) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler, opts);
        else console.warn(`[RainTube] bindEvents: #${id} not found`);
    };

    let open = false;
    let statsOpen = false;

    const setStatsOpen = value => {
        statsOpen = !!value && StatsTracker.isPanelEnabled();
        if (statsOpen) {
            // Render before positioning: the collapsed stats GUI uses the
            // same card renderer as the always-visible recommendations card.
            StatsTracker.renderStatsPanelSlot();
            statsPanel?.__rtPositionNearButton?.(false);
        } else {
            hideTooltip();
        }
        statsPanel?.classList.toggle('show', statsOpen);
        if (!statsOpen) statsPanel?.classList.remove('rt-drag');
        statsPanel?.setAttribute('aria-hidden', statsOpen ? 'false' : 'true');
        statsFab?.classList.toggle('active', statsOpen);
        statsFab?.setAttribute('aria-expanded', statsOpen ? 'true' : 'false');
        if (statsOpen) requestAnimationFrame(() => statsPanel?.__rtPositionNearButton?.(false));
    };

    const setOpen = value => {
        open = !!value;
        if (open) panel.__rtPositionNearButton?.(false);
        else hideTooltip();
        panel.classList.toggle('show', open);
        fab.classList.toggle('active', open);
        fab.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) uiSync();
    };

    registerMenuCommands({
        openPanel: () => setOpen(true),
        openSettings: () => setSettingsOpen(true),
    });

    statsFab?.addEventListener('click', () => {
        if (!StatsTracker.isPanelEnabled() && !statsOpen) return;
        hideTooltip();
        setStatsOpen(!statsPanel?.classList.contains('show'));
    });
    fab.addEventListener('click', () => {
        hideTooltip();
        setOpen(!open);
    });
    on('rt_close', 'click', () => setOpen(false));
    on('rt_stats_close', 'click', () => setStatsOpen(false));

    on('rt_dl_v', 'click', async e => {
        try {
            await downloadViaPublicApisOrFallback(getVideoId(), 'video', e.currentTarget);
        } catch (err) {
            console.warn('[RainTube] Video download handler failed:', err);
            toast('Video download failed', 'warn');
        }
    });
    on('rt_dl_a', 'click', async e => {
        try {
            await downloadViaPublicApisOrFallback(getVideoId(), 'audio', e.currentTarget);
        } catch (err) {
            console.warn('[RainTube] Audio download handler failed:', err);
            toast('Audio download failed', 'warn');
        }
    });

    on('rt_dl_stop', 'click', requestStopAfterCurrentRequest);

    // Master settings modal — opens from the header gear, closes from the
    // modal's own X button, "Done" button, backdrop click, or Escape.
    on('rt_settings_open', 'click', e => {
        e.stopPropagation();
        setSettingsOpen(true);
    });
    on('rt_settings_close', 'click', () => setSettingsOpen(false));
    on('rt_settings_done', 'click', () => setSettingsOpen(false));
    on('rt_settings_backdrop', 'click', () => setSettingsOpen(false));
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        // Innermost-first dismiss order: settings modal sits on top, then
        // stats panel, then the main RainTube panel.
        if (isSettingsOpen()) {
            e.stopPropagation();
            setSettingsOpen(false);
        } else if (statsPanel?.classList.contains('show')) {
            e.stopPropagation();
            setStatsOpen(false);
        } else if (open) {
            e.stopPropagation();
            setOpen(false);
        }
    });

    on('rt_sw_shorts', 'click', () => {
        S.shortsBlockerEnabled = !S.shortsBlockerEnabled;
        save(CFG.storage.shortsBlocker, S.shortsBlockerEnabled);
        ShortsBlocker.apply();
        uiSync();
        toast(S.shortsBlockerEnabled ? 'Shorts hidden' : 'Shorts shown',
              S.shortsBlockerEnabled ? 'shorts' : 'off',
              { icon: 'shorts', label: 'Shorts' });
    });

    on('rt_sw_q', 'click', () => {
        S.qualityEnabled = !S.qualityEnabled;
        save(CFG.storage.quality, S.qualityEnabled);
        // Toggling Quality back on: forget the last applied so a toast
        // confirms the freshly-applied level.
        if (S.qualityEnabled) {
            S._lastAppliedQualityKey = null;
            S._lastQualityTargetKey = null;
            scheduleQualityApply();
        } else {
            clearQualitySchedule();
            S._lastQualityTargetKey = null;
        }
        uiSync();
        toast(S.qualityEnabled ? 'Quality targeting on' : 'Quality targeting off',
              S.qualityEnabled ? 'quality' : 'off',
              { icon: 'quality', label: 'Quality' });
    });

    on('rt_sw_private', 'click', () => {
        S.privateDownloadsEnabled = !S.privateDownloadsEnabled;
        save(CFG.storage.privateDownloads, S.privateDownloadsEnabled);
        uiSync();
        toast(S.privateDownloadsEnabled ? 'Private downloads on' : 'Private downloads off',
              S.privateDownloadsEnabled ? 'dl' : 'off',
              { icon: 'private', label: 'Download' });
    });

    on('rt_sw_stats', 'click', async () => {
        const enabled = StatsTracker.getEnabled();
        try {
            await StatsTracker.setEnabled(!enabled);
            uiSync();
            toast(enabled ? 'Statistics tracking paused' : 'Statistics tracking on',
                  enabled ? 'off' : 'stats',
                  { icon: 'chart', label: 'Statistics' });
        } catch (err) {
            console.warn('[RainTube] Statistics toggle failed:', err);
            toast('Statistics toggle failed', 'warn');
        }
    });
}

/* ── Runtime controllers ────────────────────────────────────────────────── */

/**
 * ShortsBlocker — hides YouTube Shorts everywhere using CSS gated by
 * per-surface body classes, and optionally redirects direct /shorts/<id>
 * visits.
 *
 * Why CSS and not DOM removal? YouTube is a single-page app that
 * constantly re-renders rich-grid items as the user scrolls or navigates.
 * A querySelector-based remover has to re-run on every mutation, and any
 * gap between mutation and removal lets a short flash on screen. A
 * stylesheet rule applies before paint, costs nothing per frame, and
 * survives every re-render automatically.
 *
 * Each surface (sidebar / home / search / channel / watch) gets its own
 * body class. apply() sets each class only when both the master toggle
 * AND that surface's toggle are on, so any combination is one classList
 * write per surface and the selectors stay simple — no compound gating
 * inside the CSS.
 */
const ShortsBlocker = (() => {
    const STYLE_ID = 'rt_shorts_blocker_style';

    // Each surface has a body class and a list of CSS selectors. When the
    // class is on body, those selectors hide.
    //
    // Page-context prefixes (ytd-search, ytd-watch-flexy) scope shared
    // components like ytd-reel-shelf-renderer to a specific page so the
    // same DOM type can be controlled by different toggles depending on
    // where it's rendered.
    const SURFACES = [
        {
            id: 'sidebar',
            stateKey: 'shortsHideSidebar',
            bodyClass: 'rt-shorts-hide-sidebar',
            selectors: [
                // Expanded sidebar Shorts entry, and the mini-nav icon.
                'ytd-guide-entry-renderer:has(a[title="Shorts"])',
                'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
            ],
        },
        {
            id: 'home',
            stateKey: 'shortsHideHome',
            bodyClass: 'rt-shorts-hide-home',
            selectors: [
                // Home page shorts shelf and its section wrapper.
                'ytd-rich-shelf-renderer[is-shorts]',
                'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
                // Subscriptions and other feeds: the reel shelf scoped to
                // ytd-browse so the watch-page version isn't caught here.
                'ytd-browse ytd-reel-shelf-renderer',
                // Individual shorts that appear in the home rich grid or
                // the legacy grid view.
                'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
                'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
                // Individual reel items in a shelf.
                'ytd-reel-item-renderer',
            ],
        },
        {
            id: 'search',
            stateKey: 'shortsHideSearch',
            bodyClass: 'rt-shorts-hide-search',
            selectors: [
                // Search results page: the reel shelf and individual
                // search-result rows that link to a short.
                'ytd-search ytd-reel-shelf-renderer',
                'ytd-search ytd-video-renderer:has(a[href*="/shorts/"])',
            ],
        },
        {
            id: 'channel',
            stateKey: 'shortsHideChannel',
            bodyClass: 'rt-shorts-hide-channel',
            selectors: [
                // The "Shorts" tab on a channel page.
                '[tab-title="Shorts"]',
            ],
        },
        {
            id: 'watch',
            stateKey: 'shortsHideWatch',
            bodyClass: 'rt-shorts-hide-watch',
            selectors: [
                // Watch-page up-next suggestions: the reel shelf and any
                // compact video that links to a short.
                'ytd-watch-flexy ytd-reel-shelf-renderer',
                'ytd-watch-flexy ytd-compact-video-renderer:has(a[href*="/shorts/"])',
            ],
        },
    ];

    let observer = null;
    let counterTimer = null;
    let pendingCount = 0;
    // Cache the combined selector for the currently-active surfaces. Rebuilt
    // by apply() whenever the master or any surface toggle changes, so the
    // hot tally path stays O(1) per node — one matches() and one
    // querySelectorAll() against the union selector instead of 13.
    let activeSelector = '';

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const blocks = SURFACES.map(surface => {
            const rules = surface.selectors
                .map(s => `body.${surface.bodyClass} ${s}`)
                .join(',\n');
            return `${rules} { display: none !important; }`;
        });
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = blocks.join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function apply() {
        if (!document.body) return;
        const master = !!S.shortsBlockerEnabled;
        const active = [];
        for (const surface of SURFACES) {
            const on = master && !!S[surface.stateKey];
            document.body.classList.toggle(surface.bodyClass, on);
            if (on) active.push(...surface.selectors);
        }
        // Cache as a single :is() expression so the tally path can match
        // against every currently-active surface in one querySelector call.
        // Empty when nothing is active — the observer short-circuits then.
        activeSelector = active.length ? `:is(${active.join(',')})` : '';
    }

    // Debounce hidden-Shorts statistics so a rich-grid render that hides
    // many Shorts at once produces one stats write instead of many.
    function bumpCounter(n) {
        pendingCount += n;
        if (counterTimer) return;
        counterTimer = setTimeout(() => {
            StatsTracker.recordShortsHidden(pendingCount);
            pendingCount = 0;
            counterTimer = null;
            uiSync();
        }, 300);
    }

    // Walk added nodes and count how many newly-matched shorts elements
    // appeared. The CSS rule already hides them; this just tallies them.
    function tallyAdditions(node) {
        if (!(node instanceof Element) || !activeSelector) return 0;
        let count = 0;
        try {
            if (node.matches(activeSelector)) count += 1;
            count += node.querySelectorAll(activeSelector).length;
        } catch { /* :has() unsupported on older engines — skip */ }
        return count;
    }

    function onNavigate() {
        if (!S.shortsBlockerEnabled) return;
        const m = /^\/shorts\/([^/?#]+)/.exec(location.pathname);
        if (!m) return;
        if (S.shortsOnVisit === 'redirect') {
            const watchUrl = `${location.origin}/watch?v=${encodeURIComponent(m[1])}`;
            location.replace(watchUrl);
        } else {
            location.replace(`${location.origin}/`);
        }
    }

    function install() {
        if (!IS_YOUTUBE) return;
        injectStyle();
        apply();

        // Observe for newly-added shorts elements to keep the stat tile
        // honest. The CSS rules hide them either way; this is cosmetic.
        if (!observer) {
            observer = new MutationObserver(mutations => {
                if (!S.shortsBlockerEnabled) return;
                let total = 0;
                for (const m of mutations) {
                    for (const node of m.addedNodes) total += tallyAdditions(node);
                }
                if (total) bumpCounter(total);
            });
            // Use documentElement as the root so the observer survives
            // any body re-rendering on SPA transitions.
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
        }

        // Handle direct /shorts/ visits.
        onNavigate();
    }

    return Object.freeze({ install, apply, onNavigate });
})();

/**
 * OledTheme — toggles `body.rt-oled` so the injected RainTube stylesheet
 * takes over YouTube's dark-mode background variables and pushes them to pure
 * black. Scoped to dark mode in the stylesheet itself, so the class on light
 * mode is a no-op.
 */
const OledTheme = (() => {
    const BODY_CLASS = 'rt-oled';

    function apply() {
        if (!document.body) return;
        document.body.classList.toggle(BODY_CLASS, !!S.oledThemeEnabled);
    }

    function install() {
        if (!IS_YOUTUBE) return;
        apply();
    }

    return Object.freeze({ install, apply });
})();

/**
 * TopbarTheme — gives YouTube's masthead the same dark RainTube atmosphere
 * as the panel: glassy black gradient, blue edge glow, and the shared canvas
 * rain engine. It is deliberately theme-agnostic; even on YouTube light mode
 * the masthead becomes dark because pale rain over a light top bar reads as
 * haze instead of weather.
 */
const TopbarTheme = (() => {
    const BODY_CLASS = 'rt-topbar-theme';
    const HOST_CLASS = 'rt-topbar-theme-host';
    const CANVAS_ID = 'rt_topbar_rain';
    const TARGET_SELECTOR = [
        '#guide-button',
        'ytd-topbar-logo-renderer',
        '#search-icon-legacy',
        '.ytSearchboxComponentSearchButton',
        '#voice-search-button',
        '#buttons button',
        '#end button',
        '#avatar-btn',
        '#rt_fab',
        '#rt_stats_fab',
    ].join(',');

    let host = null;
    let canvas = null;
    let lastRainSyncKey = '';

    function findMasthead() {
        return document.querySelector('ytd-masthead')
            || document.getElementById('masthead')
            || document.getElementById('masthead-container');
    }

    function topbarTargetKind(el) {
        return el.matches?.('ytd-topbar-logo-renderer') ? 'logo' : 'button';
    }

    function ensureCanvas(nextHost) {
        let el = document.getElementById(CANVAS_ID);
        if (el && el.parentElement !== nextHost) {
            el.remove();
            el = null;
        }
        if (!el) {
            el = mk('canvas', 'rt-rain-canvas rt-topbar-rain-canvas', null, {
                id: CANVAS_ID,
                'aria-hidden': 'true',
            });
            nextHost.insertBefore(el, nextHost.firstChild || null);
        }
        if (el.dataset.rtRainBound !== 'true') {
            initHeaderRain(el, nextHost, {
                targetSelector: TARGET_SELECTOR,
                targetKind: topbarTargetKind,
                // The panel header is narrow, so its default cap is modest.
                // The top bar spans the viewport; lift that cap so the same
                // per-pixel density formula scales across the wider surface.
                maxDrops: 280,
                surfaceBeadCount: 16,
                shouldRun: () => !!S?.topbarThemeEnabled
                    && nextHost.isConnected
                    && readRainQuantitySetting(S.rainQuantity) !== 'off',
            });
            el.dataset.rtRainBound = 'true';
        }
        return el;
    }

    function syncRain({ force = false } = {}) {
        const activeHost = host?.isConnected ? host : findMasthead();
        if (!activeHost) return;
        const rainQuantity = readRainQuantitySetting(S.rainQuantity);
        const rainOff = !!S?.topbarThemeEnabled && rainQuantity === 'off';
        const syncKey = [
            S?.topbarThemeEnabled ? '1' : '0',
            rainQuantity,
            readRainFpsCap(S.rainFpsCap),
            S?.lightningEnabled ? '1' : '0',
        ].join('|');

        activeHost.classList.toggle('rt-rain-off', rainOff);
        if (!force && syncKey === lastRainSyncKey) {
            activeHost.__rtRainMoved?.();
            return;
        }

        lastRainSyncKey = syncKey;
        activeHost.__rtRainQuantityChanged?.();
        activeHost.__rtRainFpsChanged?.();
        activeHost.__rtLightningChanged?.();
    }

    function apply() {
        if (!document.body) return;
        const enabled = !!S?.topbarThemeEnabled;
        document.body.classList.toggle(BODY_CLASS, enabled);

        const nextHost = findMasthead();
        if (!nextHost) return;

        const hostChanged = host !== nextHost;
        const enabledChanged = hostChanged || nextHost.classList.contains(HOST_CLASS) !== enabled;
        if (host && host !== nextHost) host.classList.remove(HOST_CLASS, 'rt-rain-off');
        host = nextHost;
        host.classList.toggle(HOST_CLASS, enabled);

        if (enabled) {
            canvas = ensureCanvas(host);
            canvas.hidden = false;
        } else if (canvas?.isConnected) {
            canvas.hidden = true;
        }
        syncRain({ force: hostChanged || enabledChanged });
    }

    function scheduleApply(delay = 0) {
        setTimeout(apply, delay);
    }

    function install() {
        if (!IS_YOUTUBE) return;
        apply();
        scheduleApply(600);
        scheduleApply(1800);
    }

    return Object.freeze({ install, apply, syncRain });
})();

const ChromeRuntime = (() => {
    let timer = null;
    let fab = null;

    const isPanelOpen = () => document.getElementById('rt_panel')?.classList.contains('show');

    const run = (force = false) => {
        if (document.hidden && !force) return;

        const currentFab = fab || S._fab;
        if (currentFab) mountRainTubeButtons(S._statsFab, currentFab);
        TopbarTheme.apply();

        // The panel gets an immediate sync on open. Between opens, avoid
        // repainting hidden counters and labels unless active work is visible.
        if (force || isPanelOpen() || isSettingsOpen() || S.downloading) uiSync();
    };

    const install = nextFab => {
        fab = nextFab || fab;
        if (!timer) {
            timer = setInterval(() => run(false), 5000);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) run(true);
            }, { passive: true });
        }
        run(true);
    };

    return Object.freeze({ install, run });
})();

/* ── Navigation ─────────────────────────────────────────────────────────── */

let _navTimer = null;
let _qualityScheduleId = 0;
let _qualityReadyCancel = null;

function clearQualitySchedule() {
    _qualityScheduleId++;
    if (_qualityReadyCancel) {
        _qualityReadyCancel();
        _qualityReadyCancel = null;
    }
}

function qualityControlsReady() {
    if (!getVideoId()) return false;
    const root = playerDomRoot();
    return !!getQualitySettingsButton(root);
}

function waitForQualityControlsReady(scheduleId, timeoutMs = QUALITY_READY_TIMEOUT_MS) {
    return new Promise(resolve => {
        let settled = false;
        let timer = null;
        let observer = null;

        const done = value => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            observer?.disconnect();
            if (_qualityReadyCancel === cancel) _qualityReadyCancel = null;
            resolve(value);
        };
        const cancel = () => done(false);
        const check = () => {
            try {
                if (scheduleId !== _qualityScheduleId) { done(false); return; }
                if (!S?.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) {
                    done(false);
                    return;
                }
                if (qualityControlsReady()) done(true);
            } catch {
                // YouTube can replace player subtrees during SPA navigation.
            }
        };

        _qualityReadyCancel = cancel;
        timer = setTimeout(() => done(false), timeoutMs);
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
        check();
    });
}

function scheduleQualityApply() {
    if (!S?.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) return;

    clearQualitySchedule();
    const scheduleId = _qualityScheduleId;
    // YouTube is a SPA, so route completion does not guarantee the player
    // controls are mounted. Wait for the specific control RainTube needs
    // instead of firing a timed retry ladder.
    void waitForQualityControlsReady(scheduleId).then(ready => {
        if (!ready || scheduleId !== _qualityScheduleId) return;
        if (!S.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) return;
        void applyBestQuality({ silent: false });
    });
}

function onNavigate() {
    clearTimeout(_navTimer);
    _navTimer = setTimeout(() => {
        const vid = getVideoId();

        // New video → reset per-video memos.
        S._player = null;
        S._video = null;

        if (vid !== S.videoId) {
            S._lastAppliedQualityKey = null;
            S._lastQualityTargetKey = null;
        }
        S.videoId = vid;

        // Cancel any pending quality readiness wait from the previous route;
        // YouTube can replace the player subtree several times during a fast SPA
        // navigation.
        clearQualitySchedule();

        if (vid && S.qualityEnabled) scheduleQualityApply();
        // Record the original route before the Shorts blocker can rewrite
        // /shorts/<id> to /watch?v=<id> or home. Shorts opens and normal
        // video opens are mutually exclusive; watch time remains shared.
        StatsTracker.onNavigate();
        ShortsBlocker.onNavigate();
        ChromeRuntime.run(true);
        uiSync();
    }, 500);
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function removeExistingRainTubeUi() {
    // Claim the visible UI from a clean slate on boot; persisted settings and
    // statistics remain untouched.
    for (const sel of ['#rt_panel', '#rt_fab', '#rt_stats_fab', '#rt_stats_panel', '#rt_settings_root', '#rt_toasts', '#rt_tip', '#rt_topbar_rain', '.rt-inline-stats']) {
        for (const node of document.querySelectorAll(sel)) node.remove();
    }
    document.body?.classList.remove('rt-topbar-theme');
    for (const node of document.querySelectorAll('.rt-topbar-theme-host')) {
        node.classList.remove('rt-topbar-theme-host', 'rt-rain-off');
    }
}

function boot() {
    removeExistingRainTubeUi();

    const { panel, fab, statsFab, statsPanel } = buildPanel();
    S._fab = fab;
    S._statsFab = statsFab;
    mountRainTubeButtons(statsFab, fab);
    initDrag(panel, fab);
    initDrag(statsPanel, statsFab, { handleSelector: '#rt_stats_drag', fallbackH: 380, snapToDevicePixels: true });
    bindEvents(panel, fab, statsFab, statsPanel);

    StatsTracker.install();
    // Capture a direct /shorts/<id> route before ShortsBlocker.install() can
    // immediately rewrite it to /watch or home on first load.
    StatsTracker.onNavigate();
    ShortsBlocker.install();
    OledTheme.install();
    TopbarTheme.install();
    ChromeRuntime.install(fab);
    window.addEventListener('yt-navigate-finish', onNavigate, { passive: true });
    window.addEventListener('yt-page-data-updated', onNavigate, { passive: true });
    window.addEventListener('yt-navigate-start', () => {
        clearQualitySchedule();
        S._player = null; S._video = null;
        hideTooltip();
    }, { passive: true });

    onNavigate();
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

/* ── Stylesheet resource ────────────────────────────────────────────────── */

// The YouTube/RainTube UI stylesheet lives in RainTube.youtube.css and is
// packaged as rtYouTubeCss. Bump @version whenever this resource changes so
// script managers refresh the cached copy. It is injected as a <style> tag so
// CSS application uses the same reliable path as the previous inline
// stylesheet.

/* ── Entry ──────────────────────────────────────────────────────────────── */

async function startRainTube() {
    if (IS_CNVMP3) {
        runCnvMp3Autofill();
        return;
    }

    if (!IS_YOUTUBE) return;

    await injectRainTubeStyles();
    await cleanupDeprecatedStorageKeys();
    S = await loadRuntimeState();
    boot();
}

startRainTube().catch(err => {
    console.error('[RainTube] Startup failed:', err);
});
