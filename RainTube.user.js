// ==UserScript==
// @name               RainTube — Customization, Shorts, Statistics, Quality & Private Downloads
// @description        Privacy-first YouTube helper: OLED pure-black theme, Shorts blocking, local usage statistics, automatic quality targeting, and Piped/Invidious proxied downloads.
// @namespace          https://github.com/RyanIsAinmDom/RainTube
// @version            1.20.257
// @author             RyanIsAinmDom — Created by hand with robust AI assistance
// @license            MIT
// @updateURL          https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.user.js
// @downloadURL        https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.user.js
// @icon               https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// @icon64             https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// @match              https://*.youtube.com/*
// @match              https://*.cnvmp3.com/*
// @exclude            https://www.youtube.com/live_chat*
// @exclude            https://studio.youtube.com/*
// @noframes

// GM v4 APIs.
// @grant              GM.getValue
// @grant              GM.setValue
// @grant              GM.openInTab
// @grant              GM.deleteValue
// @grant              GM.listValues
// @grant              GM.registerMenuCommand
// @grant              GM.xmlHttpRequest
// @grant              GM.getResourceUrl
// @grant              GM.notification

// Packaged fonts; startup intentionally fails if they cannot load.
// @resource           rtFontDisplayLatin https://cdn.jsdelivr.net/fontsource/fonts/bricolage-grotesque:vf@5.2.8/latin-wght-normal.woff2
// @resource           rtFontUiLatin https://cdn.jsdelivr.net/fontsource/fonts/manrope:vf@5.2.8/latin-wght-normal.woff2
// @resource           rtFontMonoLatin https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@5.2.8/latin-wght-normal.woff2

// Keep @version, CFG.version, and this rt= cache-bust in sync.
// @resource           rtYouTubeCss https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.youtube.css?rt=1.20.257

// Core support APIs.
// @connect            raw.githubusercontent.com
// @connect            api.invidious.io

// Common Piped public-instance root domains. Discovery still runs dynamically.
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

// Fallback for newly discovered instances.
// @connect            *

// @run-at             document-start
// @compatible         chrome   Tampermonkey 4+
// @compatible         firefox  Greasemonkey 4.11+ / Tampermonkey / Violentmonkey
// @compatible         edge     Tampermonkey 4+
// ==/UserScript==

'use strict';

const HOST = location.hostname.toLowerCase();
const IS_YOUTUBE = /(^|\.)youtube\.com$/.test(HOST);
const IS_CNVMP3 = HOST === 'cnvmp3.com' || HOST.endsWith('.cnvmp3.com');

const CFG = Object.freeze({
    version: '1.20.257',
    instances: {
        mdUrl: 'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md',
        invidiousJsonUrl: 'https://api.invidious.io/instances.json',
        cacheTtlMs: 30 * 60_000,
    },
    api: {
        streamsTimeout: 4_000,
        metaTimeout: 8_000,
        downloadTimeout: 180_000,
        failureTtlMs: 8 * 60_000,
        hardFailureTtlMs: 30 * 60_000,
        maxDynamicInstancesPerProvider: 60,
        batchProbeSize: 10,
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
        qualitySuperResolution: 'rt_quality_super_resolution_enabled',
        privateDownloads: 'rt_private_downloads_enabled',
        privateFallback: 'rt_private_fallback_enabled',
        privateProvider: 'rt_private_provider',
        privateDownloadTimeoutMs: 'rt_private_download_timeout_ms',
        statsEnabled: 'rt_stats_enabled',
        statsDisplay: 'rt_stats_display',
        statsMetrics: 'rt_stats_metrics',
        statsBuckets: 'rt_stats_buckets',
        buttonPlacement: 'rt_button_placement',
        mainButtonVisible: 'rt_main_button_visible',
        settingsButtonVisible: 'rt_settings_button_visible',
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

const QUALITY_LEVEL_BY_HEIGHT = Object.freeze(
    Object.fromEntries(Object.entries(QUALITY_HEIGHT).map(([level, height]) => [height, level]))
);

function qualityHeight(level) {
    return QUALITY_HEIGHT[level] || QUALITY_HEIGHT.hd1080;
}

function qualityLevelFromVideoHeight(height) {
    const raw = Math.round(Number(height) || 0);
    if (!raw) return null;
    const exact = QUALITY_LEVEL_BY_HEIGHT[raw] || null;
    if (exact) return exact;

    // Cropped videos can report slightly non-standard heights.
    let closest = null;
    for (const [level, value] of Object.entries(QUALITY_HEIGHT)) {
        const diff = Math.abs(value - raw);
        if (!closest || diff < closest.diff) closest = { level, diff };
    }
    return closest && closest.diff <= 36 ? closest.level : `${raw}p`;
}

const QUALITY_READY_TIMEOUT_MS = 10_000;
const YT_MENUITEM_SELECTOR = '.ytp-menuitem, ytp-menuitem';
const YT_SETTINGS_MENUITEM_SELECTOR = '.ytp-settings-menu[data-layer] .ytp-menuitem, ytp-settings-menu ytp-menuitem';
const QUALITY_ROW_START_RE = /^\s*(?:(?:\d{3,4})\s*p(?:\d+)?|[458]\s*k)(?!\d)/i;
const QUALITY_SUPER_RESOLUTION_RE = /super[\s-]*resolution/i;
const QUALITY_PREMIUM_RE = /premium|enhanced\s*bitrate/i;

// Premium is only a same-resolution enhanced-bitrate row. Super resolution is
// label-detected because YouTube can attach it to evolving height tiers.

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

// Raw persisted-setting defaults; load and reset both read this shape.
const DEFAULT_SETTINGS = Object.freeze({
    shortsBlockerEnabled: true,
    shortsOnVisit: 'redirect',
    shortsHideSidebar: true,
    shortsHideHome: true,
    shortsHideSearch: true,
    shortsHideChannel: true,
    shortsHideWatch: true,
    oledThemeEnabled: false,
    topbarThemeEnabled: false,
    qualityEnabled: true,
    qualityMax: 'hd1080',
    qualitySuperResolutionEnabled: false,
    privateDownloadsEnabled: true,
    privateFallbackEnabled: true,
    privateProvider: 'both',
    privateDownloadTimeoutMs: CFG.api.downloadTimeout,
    buttonPlacement: BUTTON_PLACEMENT_DEFAULT,
    mainButtonVisible: true,
    settingsButtonVisible: true,
    toastDurationMs: TOAST_DURATION_DEFAULT_MS,
    toastPlacement: TOAST_PLACEMENT_DEFAULT,
    rainQuantity: 'ultra',
    rainFpsCap: RAIN_FPS_DEFAULT,
    lightningEnabled: true,
});

function readShortsOnVisit(value) {
    return SHORTS_ON_VISIT_ORDER.includes(value) ? value : 'redirect';
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
    return Math.max(
        PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS,
        Math.min(PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS, stepped)
    );
}

function formatPrivateDownloadTimeoutSeconds(value) {
    const sec = Math.max(1, Math.round(Number(value) || 0));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (!min) return `${rem}s`;
    return rem ? `${min}m ${rem}s` : `${min}m`;
}

const STATS_RANGE_ORDER = ['daily', 'monthly', 'yearly', 'alltime'];
const STATS_SESSION_DEFAULT_RANGE = 'alltime';
const STATS_RANGE_LABEL = Object.freeze({
    daily: 'Today',
    monthly: 'This month',
    yearly: 'This year',
    alltime: 'All time',
});
const STATS_TITLE = 'Statistics';

const STATS_DISPLAY_ORDER = ['panel', 'inline'];
const STATS_DISPLAY_LABEL = Object.freeze({
    panel: 'Collapsed',
    inline: 'Always',
});

const STATS_METRICS_ORDER = [
    'favoriteChannel', 'watchTime', 'videosWatched', 'shortsOpened',
    'shortsBlocked',
];
const STATS_METRIC_INFO = Object.freeze({
    watchTime: { label: 'Watch time', icon: 'clock' },
    videosWatched: { label: 'Videos opened', icon: 'play' },
    shortsOpened: { label: 'Shorts opened', icon: 'shortsOpen' },
    shortsBlocked: { label: 'Shorts blocked', icon: 'shorts' },
    favoriteChannel: { label: 'Favorite channels', icon: 'star' },
});
const STATS_METRICS_DEFAULTS = Object.freeze(
    Object.fromEntries(STATS_METRICS_ORDER.map(key => [key, true]))
);
const STATS_BUCKET_RETENTION_DAYS = 730;
const STATS_PERSIST_DEBOUNCE_MS = 2500;
const STATS_WATCH_TICK_MS = 1000;

function readStatsRange(value) {
    return STATS_RANGE_ORDER.includes(value) ? value : 'daily';
}

function readStatsDisplay(value) {
    return STATS_DISPLAY_ORDER.includes(value) ? value : 'panel';
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
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...STATS_METRICS_DEFAULTS };
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
        qualitySuperResolutionEnabled,
        privateDownloadsEnabled,
        privateFallbackEnabled,
        rawPrivateProvider,
        rawPrivateDownloadTimeoutMs,
        rawButtonPlacement,
        rawMainButtonVisible,
        rawSettingsButtonVisible,
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
        readStoredValue(CFG.storage.qualitySuperResolution, DEFAULT_SETTINGS.qualitySuperResolutionEnabled),
        readStoredValue(CFG.storage.privateDownloads, DEFAULT_SETTINGS.privateDownloadsEnabled),
        readStoredValue(CFG.storage.privateFallback, DEFAULT_SETTINGS.privateFallbackEnabled),
        readStoredValue(CFG.storage.privateProvider, DEFAULT_SETTINGS.privateProvider),
        readStoredValue(CFG.storage.privateDownloadTimeoutMs, DEFAULT_SETTINGS.privateDownloadTimeoutMs),
        readStoredValue(CFG.storage.buttonPlacement, DEFAULT_SETTINGS.buttonPlacement),
        readStoredValue(CFG.storage.mainButtonVisible, null),
        readStoredValue(CFG.storage.settingsButtonVisible, null),
        readStoredValue(CFG.storage.lightning, DEFAULT_SETTINGS.lightningEnabled),
    ]);

    const oldPlacementWasHidden = rawButtonPlacement === 'hide' || rawButtonPlacement === false;

    return {
        shortsBlockerEnabled,
        shortsOnVisit: readShortsOnVisit(rawShortsOnVisit),
        shortsHideSidebar,
        shortsHideHome,
        shortsHideSearch,
        shortsHideChannel,
        shortsHideWatch,
        oledThemeEnabled,
        topbarThemeEnabled,
        qualityEnabled,
        qualityMax: readEnumSetting(rawQualityMax, QUALITY_ORDER, 'hd1080'),
        qualitySuperResolutionEnabled: typeof qualitySuperResolutionEnabled === 'boolean'
            ? qualitySuperResolutionEnabled : DEFAULT_SETTINGS.qualitySuperResolutionEnabled,
        privateDownloadsEnabled,
        privateFallbackEnabled,
        privateProvider: readPrivateProvider(rawPrivateProvider),
        privateDownloadTimeoutMs: readPrivateDownloadTimeoutMs(rawPrivateDownloadTimeoutMs),
        toastDurationMs: Math.max(
            TOAST_DURATION_MIN_MS,
            Math.min(TOAST_DURATION_MAX_MS, parseInt(rawToastDurationMs, 10) || TOAST_DURATION_DEFAULT_MS)
        ),
        toastPlacement: readToastPlacementSetting(rawToastPlacement),
        buttonPlacement: readButtonPlacement(rawButtonPlacement),
        mainButtonVisible: readButtonVisible(rawMainButtonVisible, !oldPlacementWasHidden),
        settingsButtonVisible: readButtonVisible(rawSettingsButtonVisible, true),
        rainQuantity: readRainQuantitySetting(rawRainQuantity),
        rainFpsCap: readRainFpsCap(rawRainFpsCap),
        lightningEnabled,

        videoId: null,
        downloading: false,
        privateCancelRequested: false,
        _lastQualityTargetKey: null,
        _lastKnownQuality: null,
        _fab: null,
        _statsFab: null,
        _settingsFab: null,
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

function appendChildren(parent, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
}

function replaceChildrenSafe(parent, children) {
    parent.replaceChildren();
    return appendChildren(parent, children);
}

function mk(tag, cls, text, attrs) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    appendChildren(el, text);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'id') el.id = v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k === 'props') Object.assign(el, v);
            else if (k === 'children') appendChildren(el, v);
            else el.setAttribute(k, v);
        }
    }
    return el;
}

// Carries the failing resource name + reason so an intentional all-or-nothing
// abort can surface a precise, actionable message instead of a bare throw.
class RainTubeResourceError extends Error {
    constructor(resource, reason, cause) {
        super(`RainTube resource "${resource}" ${reason}`);
        this.name = 'RainTubeResourceError';
        this.resource = resource;
        this.reason = reason;
        if (cause !== undefined) this.cause = cause;
    }
}

/* ── Font resources ──────────────────────────────────────────────────────── */

const RT_FONT_LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const RT_FONT_RESOURCES = Object.freeze([
    { resource: 'rtFontDisplayLatin', family: 'RainTube Display', weight: '200 800' },
    { resource: 'rtFontUiLatin', family: 'RainTube UI', weight: '200 800' },
    { resource: 'rtFontMonoLatin', family: 'RainTube Mono', weight: '100 800' },
]);

function quoteCssString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function buildRainTubeFontCss() {
    // All-or-nothing by design: a failed packaged font stops startup instead
    // of silently changing RainTube's look across platforms. Resolve each
    // resource individually so the abort can name the font that went missing.
    const urls = await Promise.all(RT_FONT_RESOURCES.map(async font => {
        try {
            const url = await GM.getResourceUrl(font.resource);
            if (!url) throw new Error('empty resource URL');
            return url;
        } catch (err) {
            throw new RainTubeResourceError(font.resource, 'unavailable', err);
        }
    }));

    return RT_FONT_RESOURCES.map((font, i) => `@font-face {
        font-family: '${quoteCssString(font.family)}';
        font-style: normal;
        font-weight: ${font.weight};
        src: url('${quoteCssString(urls[i])}') format('woff2-variations');
        unicode-range: ${RT_FONT_LATIN_RANGE};
    }`).join('\n\n');
}

async function injectRainTubeStyles() {
    if (!IS_YOUTUBE) return;

    // Read both CSS resources as TEXT, then inject as a <style> element. Two
    // paths that DON'T work on Greasemonkey and are deliberately avoided:
    //   • GM.xmlHttpRequest against the resource URL throws synchronously.
    //   • A <link href>/@import to the resource URL is blocked by YouTube's CSP
    //     style-src (it restricts where stylesheets LOAD from). An inline
    //     <style> element's own text isn't a network load, so it applies fine.
    // GM.getResourceUrl gives an opaque URL that fetch() reads as text.
    // (Font @font-face rules embed their own resource URLs in url(), which the
    // browser loads natively.)
    const [fontCss, youtubeCss] = await Promise.all([
        buildRainTubeFontCss(),
        readResourceCss('rtYouTubeCss'),
    ]);

    const style = document.createElement('style');
    style.id = 'rt-styles';
    style.textContent = `${fontCss}\n\n${youtubeCss}`;
    (document.head || document.documentElement).appendChild(style);
}

async function readResourceCss(resourceName) {
    let url;
    try {
        url = await GM.getResourceUrl(resourceName);
    } catch (err) {
        throw new RainTubeResourceError(resourceName, 'unavailable', err);
    }
    if (!url) throw new RainTubeResourceError(resourceName, 'unavailable');

    let css = '';
    try {
        const res = await fetch(url);
        if (res.ok) css = await res.text();
    } catch (err) {
        throw new RainTubeResourceError(resourceName, 'failed (fetch)', err);
    }

    if (!css.trim()) throw new RainTubeResourceError(resourceName, 'loaded empty');
    return css;
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
    const sr = S?.qualitySuperResolutionEnabled ? 'sr1' : 'sr0';
    return `${videoId}|${quality}|${sr}`;
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
    if (!el) return '';

    // Include ARIA/title text so newer quality badges stay detectable.
    const parts = [];
    const seen = new Set();
    const add = value => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        parts.push(text);
    };

    add(el.textContent);
    if (typeof el.getAttribute === 'function') {
        add(el.getAttribute('aria-label'));
        add(el.getAttribute('title'));
    }
    for (const textNode of Array.from(el.querySelectorAll?.(
        '.ytp-menuitem-label, .ytp-menuitem-content, .ytp-premium-label'
    ) || [])) {
        add(textNode.textContent);
    }
    for (const labelled of Array.from(el.querySelectorAll?.('[aria-label], [title]') || [])) {
        add(labelled.getAttribute('aria-label'));
        add(labelled.getAttribute('title'));
    }

    return parts.join(' ');
}

function parseQualityHeightFromText(text) {
    const normalized = String(text || '');
    const pMatch = /(\d{3,4})\s*p(?:\d+)?/i.exec(normalized);
    if (pMatch) return parseInt(pMatch[1], 10) || 0;

    const kMatch = /\b([458])\s*k\b/i.exec(normalized);
    if (!kMatch) return 0;
    return { 4: 2160, 5: 2880, 8: 4320 }[kMatch[1]] || 0;
}

function isManualQualityRowText(text) {
    return QUALITY_ROW_START_RE.test(String(text || ''));
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
        return /\bauto\b/i.test(content) || parseQualityHeightFromText(content) > 0;
    }) || null;
}

function parseQualityMenuOption(item) {
    const labelText = menuText(item.querySelector('.ytp-menuitem-label'));
    const fullText = menuText(item);
    const searchableText = [labelText, fullText].filter(Boolean).join(' ');
    if (!searchableText || /^auto\b/i.test(searchableText)) return null;
    if (!isManualQualityRowText(labelText) && !isManualQualityRowText(fullText)) return null;

    const height = parseQualityHeightFromText(searchableText);
    if (!height) return null;

    const hasPremiumBadgeClass = !!item.querySelector('.ytp-premium-label');
    const textSaysPremium = QUALITY_PREMIUM_RE.test(fullText);
    const isSuperResolution = QUALITY_SUPER_RESOLUTION_RE.test(fullText)
        || (hasPremiumBadgeClass && !textSaysPremium);
    const isPremium = !isSuperResolution && (hasPremiumBadgeClass || textSaysPremium);
    const disabled = item.matches('[disabled], [aria-disabled="true"]')
        || item.classList.contains('ytp-disabled')
        || item.getAttribute('aria-hidden') === 'true';
    const level = QUALITY_LEVEL_BY_HEIGHT[height] || null;
    const variant = isPremium ? 'Premium' : (isSuperResolution ? 'Super resolution' : '');
    const compactVariant = isPremium ? 'Premium' : (isSuperResolution ? 'SR' : '');
    const baseLabel = (level && QUALITY_LABEL[level]) || `${height}p`;

    return {
        item,
        height,
        level,
        isPremium,
        isSuperResolution,
        disabled,
        label: variant ? `${baseLabel} ${variant}` : baseLabel,
        compactLabel: compactVariant ? `${baseLabel} ${compactVariant}` : baseLabel,
    };
}

function collectQualityMenuOptions(root = playerDomRoot()) {
    return playerQueryAll(root, YT_SETTINGS_MENUITEM_SELECTOR)
        .map(parseQualityMenuOption)
        .filter(Boolean);
}

function setKnownQuality(choice, videoId = getVideoId()) {
    S._lastKnownQuality = choice && videoId ? {
        videoId,
        height: choice.height,
        label: choice.compactLabel || choice.label,
    } : null;
}

function clearQualityMemos() {
    setKnownQuality(null);
    S._lastQualityTargetKey = null;
}

function restartQualityTargeting({ enabled = S.qualityEnabled } = {}) {
    clearQualitySchedule();
    clearQualityMemos();
    if (enabled) scheduleQualityApply();
}

function pickQualityMenuOption(options, targetLevel, { includeSuperResolution = false } = {}) {
    const targetHeight = qualityHeight(targetLevel);
    const eligible = options.filter(opt => {
        if (opt.disabled || opt.isPremium || opt.height <= 0) return false;
        return includeSuperResolution || !opt.isSuperResolution;
    });

    // YouTube lists manual qualities best-first, including same-height variants.
    const bestAtOrBelow = eligible.find(opt => opt.height <= targetHeight);
    if (bestAtOrBelow) return bestAtOrBelow;

    return eligible[eligible.length - 1] || null;
}

function closeQualityMenu(root, settingsButton) {
    const backButton = playerQuery(
        root,
        '.ytp-settings-menu .ytp-panel-header button, ytp-settings-menu .ytp-panel-header button'
    );
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
    if (isSettingsMenuOpen(settingsButton)) return { ok: false, reason: 'settings-menu-already-open' };

    try {
        if (!clickMenuElement(settingsButton)) return { ok: false, reason: 'settings-button-click-failed' };

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

        const choice = pickQualityMenuOption(options, level, {
            includeSuperResolution: !!S.qualitySuperResolutionEnabled,
        });
        if (!choice) return { ok: false, reason: 'target-quality-unavailable' };
        if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };
        if (!clickMenuElement(choice.item)) return { ok: false, reason: 'quality-option-click-failed' };

        setKnownQuality(choice);
        if (!silent) toast(`Quality · ${choice.label}`, 'quality');
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

function readCurrentQualityLabel() {
    const videoId = getVideoId();
    if (!videoId) return null;

    const checked = collectQualityMenuOptions().find(({ item }) => item && (
        item.getAttribute?.('aria-checked') === 'true'
        || item.ariaChecked === 'true'
        || item.classList?.contains('ytp-menuitem-checked')
        || !!item.querySelector?.('[aria-checked="true"]')
    ));
    if (checked) setKnownQuality(checked, videoId);

    const rawHeight = Math.round(Number($video()?.videoHeight) || 0);
    const known = S._lastKnownQuality;
    if (known?.videoId === videoId && rawHeight && Math.abs(rawHeight - known.height) <= 36) return known.label;

    const level = qualityLevelFromVideoHeight(rawHeight);
    return level ? (QUALITY_LABEL[level] || level) : null;
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
        .replace(/[),.;\]>"'`]+$/g, '')
        .replace(/\/+$/g, '');
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

function isOriginalAudioTrack(stream) {
    if (!stream) return true;

    const trackType = stream.audioTrackType;
    if (typeof trackType === 'string') return trackType.toUpperCase() === 'ORIGINAL';

    const track = stream.audioTrack;
    if (track && typeof track === 'object') {
        if (typeof track.audioIsDefault === 'boolean') return track.audioIsDefault;
        if (typeof track.id === 'string') return /\.4$/.test(track.id);
    }

    return true;
}

function extFromMimeOrFormat(stream, mode) {
    const container = String(stream?.container || stream?.format || '').toLowerCase();
    const mimeType = String(stream?.mimeType || stream?.type || '').toLowerCase();
    const isWebm = container.includes('webm') || mimeType.includes('webm');

    if (mode === 'audio') return isWebm ? 'webm' : 'm4a';
    return isWebm ? 'webm' : 'mp4';
}

function streamAudioScore(stream) {
    return parseInt(stream?.bitrate, 10)
        || parseInt(stream?.quality, 10)
        || parseInt(stream?.audioQuality, 10)
        || 0;
}

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

function describeStreamQuality(stream, mode) {
    if (mode === 'audio') {
        const label = String(stream?.quality || '');
        if (/k?bps/i.test(label)) return label;

        const bps = parseInt(stream?.bitrate, 10);
        if (bps > 0) return `${Math.round(bps / 1000)} kbps`;
        return 'audio';
    }

    const label = String(stream?.qualityLabel || stream?.quality || '');
    if (/^\d+p/i.test(label)) return label;
    const height = streamVideoScore(stream);
    return height > 0 ? `${height}p` : 'video';
}

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
            markEndpointDead(
                provider.id,
                instance,
                hardKill ? CFG.api.hardFailureTtlMs : CFG.api.failureTtlMs
            );
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
    const failed = results.filter(result => !result.winner);

    return { ok: winners.length > 0, provider, winners, failed };
}

/* ── Progress + download ────────────────────────────────────────────────── */

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
        // Let the browser claim the download before releasing blob memory.
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
        setProgress(100, 'Download complete', `${sourceLabel} · ${formatSpeed(bestRate || lastRate)}`, 'done');
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
    // Keep the YouTube URL client-side until the user submits CnvMP3.
    fallback.hash = new URLSearchParams({ rt_url: watchUrl, rt_format: wantedFormat }).toString();
    void GM.openInTab(fallback.href, false);
}

/* ── CnvMP3 autofill (rewritten) ────────────────────────────────────────── */

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
    if (setter) {
        setter.call(el, value);
    } else {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizedText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function findCnvMp3UrlField() {
    const candidates = Array.from(document.querySelectorAll('input, textarea')).filter(el => {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
        const type = String(el.getAttribute('type') || '').toLowerCase();
        return isVisible(el) && !el.disabled && !el.readOnly
            && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'password'].includes(type);
    });

    const hintFor = el => [el.placeholder, el.name, el.id, el.className,
        el.getAttribute?.('aria-label')].filter(Boolean).join(' ').toLowerCase();

    const ytField = candidates.find(el => hintFor(el).includes('youtube'));
    if (ytField) return ytField;

    const urlish = candidates.find(el => {
        const hint = hintFor(el);
        return hint.includes('url') || hint.includes('link') || hint.includes('paste');
    });
    return urlish || candidates[0] || null;
}

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

function findOptionNear(trigger, optionText) {
    const target = String(optionText).toUpperCase();
    const container = trigger.parentElement || document.body;

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

function openDropdownAndPick(trigger, optionText, timeoutMs = 1800) {
    return new Promise(resolve => {
        if (!trigger) { resolve(false); return; }

        const existing = findOptionNear(trigger, optionText);
        if (existing) {
            try { existing.click(); } catch {}
            resolve(true);
            return;
        }

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

    setTimeout(() => {
        if (field.value !== payload.url) setNativeValue(field, payload.url);
    }, 300);

        if (payload.format === 'mp3' || payload.format === 'mp4') {
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
    if (values === null) {
        return null;
    }
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
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    const text = String(value);
    const qualityMatch = /(\d+)\s*p/i.exec(text);
    if (qualityMatch) {
        const n = parseInt(qualityMatch[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const resMatch = /(\d+)\s*x\s*(\d+)/i.exec(text);
    if (resMatch) {
        const n = parseInt(resMatch[2], 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
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

    // Audio filters out auto-dubs when metadata exists; video stays best muxed/progressive.
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

const TOAST_VIEWPORT_MARGIN = 12;
const TOAST_VIDEO_SIDE_INSET = 16;
// Keep the stack clear of YouTube's controls/seeker so timeline clicks pass through.
const TOAST_VIDEO_CONTROL_CLEARANCE = 78;
const TOAST_VARIANT_META = Object.freeze({
    shorts:     { label: 'Shorts', icon: 'shorts' },
    quality:    { label: 'Quality', icon: 'quality' },
    stats:      { label: STATS_TITLE, icon: 'chart' },
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
    if (!container.firstElementChild) return;
    const placement = readToastPlacementSetting(S.toastPlacement);

    const rect = getToastAnchorRect();
    const estimatedWidth = Math.min(380, Math.max(250, window.innerWidth - TOAST_VIEWPORT_MARGIN * 2));
    const estimatedHeight = 88;
    const maxHorizontal = Math.max(
        TOAST_VIEWPORT_MARGIN,
        window.innerWidth - TOAST_VIEWPORT_MARGIN - estimatedWidth
    );
    const maxVertical = Math.max(
        TOAST_VIEWPORT_MARGIN,
        window.innerHeight - TOAST_VIEWPORT_MARGIN - estimatedHeight
    );
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
        const MatrixCtor = window.DOMMatrixReadOnly || window.DOMMatrix;
        if (!MatrixCtor) return 1;
        const matrix = new MatrixCtor(transform);
        return Number.isFinite(matrix.a) ? matrix.a : 1;
    } catch {
        return 1;
    }
}

function getToastParent() {
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
    appendChildren(iconWrap, iconFor(meta.icon, RT_ICONS.general()));
    el.appendChild(iconWrap);

    const main = mk('div', 'rt-toast-main');
    const header = mk('div', 'rt-toast-header');
    if (meta.label) header.appendChild(mk('span', 'rt-toast-kind', meta.label));
    header.appendChild(mk('span', 'rt-toast-msg', message));

    main.appendChild(header);

    if (opts.action && opts.action.label && typeof opts.action.handler === 'function') {
        const btn = mk('button', 'rt-toast-action', opts.action.label, { type: 'button' });
        btn.addEventListener('click', () => {
            try { opts.action.handler(); } catch {}
            dismiss();
        });
        main.appendChild(btn);
    }
    el.appendChild(main);

    const close = mk('button', 'rt-toast-close', '×', { type: 'button', 'aria-label': 'Dismiss' });
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    const bar = mk('div', 'rt-toast-bar');
    el.appendChild(bar);

    container.appendChild(el);
    scheduleToastPositionSync();

    void el.offsetWidth;
    el.classList.add('show');

    const duration = opts.duration || S.toastDurationMs || TOAST_DURATION_DEFAULT_MS;
    bar.style.transition = `transform ${duration}ms linear`;
    bar.style.transform = 'scaleX(0)';

    let timer = null;
    let dismissed = false;
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(timer);
        el.classList.remove('show');
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 220);
    }

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

    timer = setTimeout(dismiss, duration);
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
        if (!tip.classList.contains('show')) tip.classList.remove('rt-tip-native', 'rt-tip-rich', 'rt-tip-hiding');
    }, nativeStyle ? 125 : 180);
}

function bindTooltipTarget(el) {
    if (el.dataset.tipBound === 'true') return;
    el.dataset.tipBound = 'true';
    el.addEventListener('pointerenter', () => showTooltip(el), { passive: true });
    el.addEventListener('pointerleave', hideTooltip, { passive: true });
    el.addEventListener('focus', () => showTooltip(el));
    el.addEventListener('blur', hideTooltip);
}

function initTooltips(root = document) {
    const targets = root.matches?.('[data-tip]')
    ? [root, ...Array.from(root.querySelectorAll('[data-tip]'))]
    : Array.from(root.querySelectorAll('[data-tip]'));
    for (const el of targets) bindTooltipTarget(el);
    if (!_tooltipWindowEventsBound) {
        _tooltipWindowEventsBound = true;
        window.addEventListener('scroll', hideTooltip, { passive: true });
        window.addEventListener('resize', hideTooltip, { passive: true });
    }
}

/* ── UI assembly ────────────────────────────────────────────────────────── */

function makeSvgIcon(pathData, opts = {}) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('rt-icon');
    if (opts.extraClass) svg.classList.add(opts.extraClass);
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

function makeRaintubeLogo(size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('rt-logo-svg');

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', [
        'M12 2.2',
        'C 9 6.5, 4.5 11, 4.5 15',
        'A 7.5 7.5 0 0 0 19.5 15',
        'C 19.5 11, 15 6.5, 12 2.2',
        'Z',
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

const RT_ICONS = Object.freeze({
    shorts: () => makeSvgIcon([
        {
            d: 'M8 3.2 H16 A1.6 1.6 0 0 1 17.6 4.8 V19.2 A1.6 1.6 0 0 1 16 20.8 H8 A1.6 1.6 0 0 1 6.4 19.2 V4.8 A1.6 1.6 0 0 1 8 3.2 Z',
            strokeWidth: 1.7,
        },
        {
            d: 'M10.6 9 L14.4 12 L10.6 15 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
        {
            d: 'M19.5 4.5 L4.5 19.5',
            strokeWidth: 2.2,
        },
    ]),

    shortsOpen: () => makeSvgIcon([
        {
            d: 'M8 3.2 H16 A1.6 1.6 0 0 1 17.6 4.8 V19.2 A1.6 1.6 0 0 1 16 20.8 H8 A1.6 1.6 0 0 1 6.4 19.2 V4.8 A1.6 1.6 0 0 1 8 3.2 Z',
            strokeWidth: 1.7,
        },
        {
            d: 'M10.5 8.7 L14.8 12 L10.5 15.3 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
        { d: 'M9.5 5.8 H14.5', strokeWidth: 1.4 },
        { d: 'M10 18.2 H14', strokeWidth: 1.4 },
    ]),

    customize: () => makeSvgIcon([
        { d: 'M12 3.5 A8.5 8.5 0 1 1 11.99 3.5 Z', strokeWidth: 1.8 },
        {
            d: 'M12 3.5 A8.5 8.5 0 0 1 12 20.5 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
    ]),

    quality: () => makeSvgIcon([
        {
            d: 'M12 2.5 L13.6 10.4 L21.5 12 L13.6 13.6 L12 21.5 L10.4 13.6 L2.5 12 L10.4 10.4 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
        {
            d: 'M18.5 4.5 L19 6.7 L21.2 7.2 L19 7.7 L18.5 9.9 L18 7.7 L15.8 7.2 L18 6.7 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
    ]),

    private: () => makeSvgIcon([
        {
            d: 'M12 3.2 L19.5 5.8 V12.4 C19.5 16.2 16.4 19.5 12 20.8 C7.6 19.5 4.5 16.2 4.5 12.4 V5.8 Z',
            strokeWidth: 1.7,
        },
        { d: 'M12 7.5 V14.5 M8.5 11.5 L12 15 L15.5 11.5', strokeWidth: 2 },
    ]),

    video: () => makeSvgIcon([
        {
            d: 'M4.8 6.6 H19.2 C20.2 6.6 21 7.4 21 8.4 V15.6 C21 16.6 20.2 17.4 19.2 17.4 H4.8 C3.8 17.4 3 16.6 3 15.6 V8.4 C3 7.4 3.8 6.6 4.8 6.6 Z',
            strokeWidth: 1.9,
        },
        {
            d: 'M10.2 9.2 L15.4 12 L10.2 14.8 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
    ]),

    audio: () => makeSvgIcon([
        {
            d: 'M4 9.7 H7.2 L11.3 6.6 V17.4 L7.2 14.3 H4 Z',
            fill: 'currentColor',
            stroke: 'none',
        },
        {
            d: 'M14.2 9.2 C15.1 10 15.6 10.9 15.6 12 C15.6 13.1 15.1 14 14.2 14.8',
            strokeWidth: 2,
        },
        {
            d: 'M16.8 6.8 C18.4 8.2 19.4 10 19.4 12 C19.4 14 18.4 15.8 16.8 17.2',
            strokeWidth: 2,
        },
    ]),

    general: () => makeSvgIcon([
        { d: 'M4 7.5 H20 M4 12 H20 M4 16.5 H20', strokeWidth: 1.6 },
        {
            d: 'M14 7.5 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
            fill: 'currentColor',
            stroke: 'currentColor',
            strokeWidth: 0,
        },
        {
            d: 'M8 12 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
            fill: 'currentColor',
            stroke: 'currentColor',
            strokeWidth: 0,
        },
        {
            d: 'M16 16.5 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0',
            fill: 'currentColor',
            stroke: 'currentColor',
            strokeWidth: 0,
        },
        { d: 'M14 7.5 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0', fill: '#0d0d10', stroke: 'none' },
        { d: 'M8 12 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0', fill: '#0d0d10', stroke: 'none' },
        { d: 'M16 16.5 m-0.55 0 a0.55 0.55 0 1 0 1.1 0 a0.55 0.55 0 1 0 -1.1 0', fill: '#0d0d10', stroke: 'none' },
    ]),

    clock: () => makeSvgIcon([
        { d: 'M12 3.5 A8.5 8.5 0 1 1 11.99 3.5 Z', strokeWidth: 1.7 },
        { d: 'M12 12 L14 7', strokeWidth: 2 },
        { d: 'M12 12 L17 12', strokeWidth: 2 },
        { d: 'M12 12 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0', fill: 'currentColor', stroke: 'none' },
    ]),

    play: () => makeSvgIcon([
        { d: 'M5 4.5 H19 A1.5 1.5 0 0 1 20.5 6 V18 A1.5 1.5 0 0 1 19 19.5 H5 A1.5 1.5 0 0 1 3.5 18 V6 A1.5 1.5 0 0 1 5 4.5 Z', strokeWidth: 1.7 },
        { d: 'M10 8.5 L16 12 L10 15.5 Z', fill: 'currentColor', stroke: 'none' },
    ]),

    star: () => makeSvgIcon([
        { d: 'M12 3.2 L14.5 9.5 L21.2 10 L16 14.3 L17.6 21 L12 17.2 L6.4 21 L8 14.3 L2.8 10 L9.5 9.5 Z', strokeWidth: 1.7 },
    ]),

    trophy: () => makeSvgIcon([
        { d: 'M8 4.5 H16 V7.2 C16 10.2 14.5 12.2 12 12.8 C9.5 12.2 8 10.2 8 7.2 Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.2 },
        { d: 'M8 6 H4.8 V7.5 C4.8 9.7 6.2 11 8.7 11.2', strokeWidth: 1.7 },
        { d: 'M16 6 H19.2 V7.5 C19.2 9.7 17.8 11 15.3 11.2', strokeWidth: 1.7 },
        { d: 'M12 12.8 V16.5', strokeWidth: 1.8 },
        { d: 'M8.6 19.5 H15.4', strokeWidth: 1.8 },
        { d: 'M10 16.5 H14 L14.9 19.5 H9.1 Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1 },
    ]),

    chart: () => makeSvgIcon([
        { d: 'M5 19.5 V10.5', strokeWidth: 2 },
        { d: 'M12 19.5 V5.5', strokeWidth: 2 },
        { d: 'M19 19.5 V13.5', strokeWidth: 2 },
        { d: 'M4.5 19.5 H20.5', strokeWidth: 1.6 },
        { d: 'M5 8.5 L10.5 6 L15 11 L20 8', strokeWidth: 1.7 },
    ]),

    warn: () => makeSvgIcon([
        { d: 'M12 3.6 L21 19.2 H3 Z', strokeWidth: 1.8 },
        { d: 'M12 9.2 V13.2', strokeWidth: 2.1 },
        {
            d: 'M12 16.7 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
            fill: 'currentColor',
            stroke: 'none',
        },
    ]),

    gear: () => makeSvgIcon([
        // Clean 8-tooth cog (geometry computed: outer r=10, root r=7.6, centred at 12,12).
        {
            d: 'M19.31 9.94 L21.93 10.82 L21.93 13.18 L19.31 14.06 L18.63 15.71 L19.85 18.19 '
             + 'L18.19 19.85 L15.71 18.63 L14.06 19.31 L13.18 21.93 L10.82 21.93 L9.94 19.31 '
             + 'L8.29 18.63 L5.81 19.85 L4.15 18.19 L5.37 15.71 L4.69 14.06 L2.07 13.18 '
             + 'L2.07 10.82 L4.69 9.94 L5.37 8.29 L4.15 5.81 L5.81 4.15 L8.29 5.37 L9.94 4.69 '
             + 'L10.82 2.07 L13.18 2.07 L14.06 4.69 L15.71 5.37 L18.19 4.15 L19.85 5.81 L18.63 8.29 Z',
            strokeWidth: 1.5,
        },
        { d: 'M12 12 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0', strokeWidth: 1.6 },
    ]),
});

function iconFor(key, fallback = '◦') {
    const builder = RT_ICONS[key];
    return typeof builder === 'function' ? builder() : fallback;
}

/* ── Statistics (GM v4 storage, rewritten) ─────────────────────────────── */

const StatsStore = Object.freeze({
    getValue: readStoredValue,
    setValue: save,

    async getJson(key, fallback) {
        const raw = await readStoredValue(key, null);
        const parsed = parseJsonMaybe(raw);
        return parsed === null ? fallback : parsed;
    },

    setJson(key, value) {
        return save(key, JSON.stringify(value));
    },
});

const StatsTracker = (() => {
    const state = {
        loaded: false,
        enabled: true,
        range: STATS_SESSION_DEFAULT_RANGE,
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
    const attachedVideos = new WeakSet();
    let inlineRetryTimers = [];
    const STATS_UI_SELECTOR = [
        '.rt-inline-stats',
        '#rt_stats_panel',
        '#rt_panel',
        '#rt_settings_root',
        '#rt_toasts',
        '#rt_tip',
        '.rt-stats-range-menu',
    ].join(',');
    const FAVORITE_BOARD_MAX = 3;
    const FAVORITE_MEDAL_LABELS = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };

    function clearInlineRetryTimers() {
        for (const timer of inlineRetryTimers) clearTimeout(timer);
        inlineRetryTimers = [];
    }

    const getDisplay = () => state.display;
    const getEnabled = () => !!state.enabled;
    const isPanelEnabled = () => getEnabled() && state.display === 'panel';
    const isInlineEnabled = () => getEnabled() && state.display === 'inline';
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
        if (!getVideoId()) return;

        const capped = Math.max(0, Math.min(elapsed, (STATS_WATCH_TICK_MS / 1000) + 1));
        if (capped <= 0) return;

        const bucket = ensureBucket();
        bucket.watchSec += capped;

        // Cache channel metadata to avoid a per-second querySelector sweep.
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
        const channelDays = Object.create(null);   // distinct date-buckets watched
        const channelPeakSec = Object.create(null); // best single-day watch time

        for (const key of keys) {
            const bucket = state.buckets[key];
            if (!bucket) continue;
            shortsOpened += Number(bucket.shortsOpened) || 0;
            shortsBlocked += Number(bucket.shortsBlocked) || 0;
            watchSec += Number(bucket.watchSec) || 0;
            videosWatched += Number(bucket.videosWatched) || 0;
            for (const [channel, sec] of Object.entries(bucket.channelSec || {})) {
                const n = Number(sec) || 0;
                if (n <= 0) continue;
                channelSec[channel] = (channelSec[channel] || 0) + n;
                channelDays[channel] = (channelDays[channel] || 0) + 1;
                if (n > (channelPeakSec[channel] || 0)) channelPeakSec[channel] = n;
            }
            for (const [channel, avatarUrl] of Object.entries(bucket.channelAvatar || {})) {
                if (channel && avatarUrl) channelAvatar[channel] = avatarUrl;
            }
        }

        const topFavoriteChannels = Object.entries(channelSec)
            .map(([name, sec]) => ({
                name,
                sec: Math.round(Number(sec) || 0),
            }))
            .filter(channel => channel.name && channel.sec > 0)
            .sort((a, b) => (b.sec - a.sec) || a.name.localeCompare(b.name))
            .slice(0, FAVORITE_BOARD_MAX)
            // Each of the top-3 reveals a picture + breakdown when expanded, so
            // resolve all three avatars and carry the derived per-channel stats.
            .map((channel, index) => ({
                ...channel,
                rank: index + 1,
                avatar: channelAvatar[channel.name] || '',
                days: channelDays[channel.name] || 0,
                peakSec: Math.round(channelPeakSec[channel.name] || 0),
            }));

        return {
            shortsOpened: Math.round(shortsOpened),
            shortsBlocked: Math.round(shortsBlocked),
            watchSec: Math.round(watchSec),
            videosWatched: Math.round(videosWatched),
            topFavoriteChannels,
        };
    }

    function isStatsUiNode(node) {
        if (!(node instanceof Element)) return false;
        return !!node.closest?.(STATS_UI_SELECTOR);
    }

    function mutationTouchesOnlyRainTubeUi(record) {
        if (isStatsUiNode(record.target)) return true;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return !!nodes.length && nodes.every(node => {
            if (node instanceof Element) {
                return isStatsUiNode(node)
                    || node.matches?.(STATS_UI_SELECTOR);
            }
            return true;
        });
    }

    function stopStatsControlPropagation(event) {
        event.stopPropagation();
    }

    function metricDisplayValue(key, totals) {
        if (key === 'watchTime') return formatStatsDuration(totals.watchSec);
        if (key === 'videosWatched') return formatStatsCount(totals.videosWatched);
        if (key === 'shortsOpened') return formatStatsCount(totals.shortsOpened);
        if (key === 'shortsBlocked') return formatStatsCount(totals.shortsBlocked);
        return '';
    }

    function hidePortaledMenu(menu, homeProp) {
        if (!menu) return;
        menu.hidden = true;
        menu.style.display = 'none';
        const home = menu[homeProp];
        if (home && menu.parentNode !== home) home.appendChild(menu);
    }

    function closePortaledMenus(buttonSelector, menuSelector, hideMenu) {
        for (const button of document.querySelectorAll(`${buttonSelector}[aria-expanded="true"]`)) {
            button.setAttribute('aria-expanded', 'false');
        }
        for (const menu of document.querySelectorAll(menuSelector)) hideMenu(menu);
    }

    function focusSiblingMenuItem(menu, item, itemSelector, direction) {
        const items = Array.from(menu.querySelectorAll(itemSelector));
        const current = items.indexOf(item);
        if (current < 0 || !items.length) return;
        items[(current + direction + items.length) % items.length].focus?.();
    }

    function positionPortaledMenu(menu, button, { align = 'left' } = {}) {
        const btnRect = button.getBoundingClientRect();
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const margin = 8;
        let left = align === 'right' ? btnRect.right - menuWidth : btnRect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
        let top = btnRect.bottom + 4;
        if (top + menuHeight > window.innerHeight - margin) {
            const above = btnRect.top - 4 - menuHeight;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - menuHeight - margin);
        }
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function hideStatsRangeMenu(menu) {
        hidePortaledMenu(menu, '_rtHomeWrap');
    }

    function closeStatsRangeMenus() {
        closePortaledMenus('.rt-stats-range-picker', '.rt-stats-range-menu', hideStatsRangeMenu);
    }

    function setStatsRangeMenuOpen(wrap, open, { focusSelected = false } = {}) {
        const button = wrap.querySelector('.rt-stats-range-picker');
        const menu = wrap._rtRangeMenu || wrap.querySelector('.rt-stats-range-menu');
        if (!button || !menu) return;
        if (open) closeStatsRangeMenus();
        button.setAttribute('aria-expanded', open ? 'true' : 'false');

        if (!open) {
            hideStatsRangeMenu(menu);
            return;
        }

        // Escape #rt_panel backdrop clipping while open.
        menu._rtHomeWrap = wrap;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.hidden = false;
        menu.style.display = '';

        positionPortaledMenu(menu, button, { align: 'left' });

        if (focusSelected) {
            (menu.querySelector('.rt-stats-range-item[aria-checked="true"]')
                || menu.querySelector('.rt-stats-range-item'))?.focus?.();
        }
    }

    // Top channels by watch time; one row expands at a time.
    let favoriteTileSeq = 0;

    function makeFavoriteMedal(rank) {
        const badge = mk('span', 'rt-cb-medal-badge', null, {
            title: FAVORITE_MEDAL_LABELS[rank] ? `${FAVORITE_MEDAL_LABELS[rank]} — rank ${rank}` : `Rank ${rank}`,
        });
        badge.appendChild(RT_ICONS.trophy());
        return mk('span', `rt-cb-medal rt-cb-medal-${rank}`, null, {
            'aria-hidden': 'true',
            children: [badge, mk('span', 'rt-cb-rnk', `#${rank}`)],
        });
    }

    function applyFavoriteOpenState(board, openName) {
        for (const row of board.querySelectorAll('.rt-cb-row')) {
            const isOpen = !!openName && row.dataset.channel === openName;
            row.classList.toggle('is-open', isOpen);
            row.querySelector('.rt-cb-bar')?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
    }

    function buildFavoriteRow(tile, board, channel, pct, stats, detailId) {
        const rankClass = channel.rank <= 3 ? ` rt-cb-rank-${channel.rank}` : '';
        const row = mk('div', `rt-cb-row${rankClass}`, null, { role: 'listitem' });
        row.dataset.channel = channel.name;

        const bar = mk('button', 'rt-cb-bar', null, {
            type: 'button',
            'aria-expanded': 'false',
            'aria-controls': detailId,
            title: `${channel.name} — ${formatStatsDuration(channel.sec)} watched · tap to expand`,
        });
        const fill = mk('span', 'rt-cb-fill');
        fill.style.width = `${pct}%`;
        const track = mk('span', 'rt-cb-track', null, {
            children: [
                fill,
                mk('span', 'rt-cb-name', channel.name),
            ],
        });
        appendChildren(bar, [
            makeFavoriteMedal(channel.rank),
            track,
            mk('span', 'rt-cb-time', formatStatsDuration(channel.sec)),
            // CSS-drawn chevron (no icon dependency); rotates when open.
            mk('span', 'rt-cb-chev', null, { 'aria-hidden': 'true' }),
        ]);

        bar.onpointerdown = stopStatsControlPropagation;
        bar.onclick = event => {
            event.stopPropagation();
            const willOpen = tile._rtOpenChannel !== channel.name;
            tile._rtOpenChannel = willOpen ? channel.name : null;
            applyFavoriteOpenState(board, tile._rtOpenChannel);
        };
        row.appendChild(bar);

        // Collapsible detail: avatar + context stats (no duplicated name/time).
        const detail = mk('div', 'rt-cb-detail', null, { id: detailId });
        const inner = mk('div', 'rt-cb-detail-inner', null, {
            children: favoriteDetailContent(channel, stats),
        });
        appendChildren(detail, inner);
        row.appendChild(detail);
        return row;
    }

    function favoriteStatPair(label, value) {
        return mk('span', 'rt-cb-stat', null, {
            children: [
                mk('span', 'rt-cb-stat-val', value),
                mk('span', 'rt-cb-stat-lbl', label),
            ],
        });
    }

    // Builds the inner content of an expanded row. Deliberately omits the
    // channel name and total watch time — both already shown on the bar — and
    // instead surfaces context the bar can't: rank framing, how it stacks up
    // against the leader, and viewing cadence (active days + daily average).
    function favoriteDetailContent(channel, stats) {
        const avatar = mk('span', 'rt-cb-avatar');
        if (channel.avatar) {
            const img = mk('img', null, null, { src: channel.avatar, alt: '', loading: 'lazy' });
            img.referrerPolicy = 'no-referrer';
            avatar.appendChild(img);
        } else {
            avatar.appendChild(RT_ICONS.star());
        }

        // Headline: share of all watch time, with a rank-aware comparison.
        const headline = mk('span', 'rt-cb-detail-headline', null, {
            children: [
                mk('strong', null, `${stats.sharePct}%`),
                document.createTextNode(' of your watch time'),
            ],
        });
        const compare = mk('span', 'rt-cb-detail-compare',
            stats.isLeader ? 'Your most-watched channel' : `${stats.vsLeaderPct}% of your #1`);

        const text = mk('div', 'rt-cb-detail-text', null, { children: [headline, compare] });

        // Stat chips: cadence the bar doesn't convey. Only meaningful across
        // multiple days — on a single day, avg/day and best day just restate
        // the total, so they're omitted (along with the row itself).
        const bodyChildren = [text];
        if (stats.days > 1) {
            const chips = [favoriteStatPair('avg / day', formatStatsDuration(stats.avgPerDaySec))];
            if (stats.peakSec > 0) {
                chips.push(favoriteStatPair('best day', formatStatsDuration(stats.peakSec)));
            }
            bodyChildren.push(mk('div', 'rt-cb-detail-stats', null, { children: chips }));
        }

        return [avatar, mk('div', 'rt-cb-detail-body', null, { children: bodyChildren })];
    }

    function favoriteRosterSignature(channels) {
        // Identity = which channels, in what order, at what rank. Numeric
        // values (sec/width/share) are intentionally excluded so a ticking
        // watch-second patches in place instead of forcing a rebuild.
        return channels.map(c => `${c.rank}:${c.name}`).join('|');
    }

    function patchFavoriteRow(row, channel, pct, stats) {
        const timeText = formatStatsDuration(channel.sec);
        row.querySelector('.rt-cb-fill').style.width = `${pct}%`;
        row.querySelector('.rt-cb-time').textContent = timeText;
        row.querySelector('.rt-cb-bar')?.setAttribute(
            'title', `${channel.name} — ${timeText} watched · tap to expand`);

        const inner = row.querySelector('.rt-cb-detail-inner');
        if (inner) replaceChildrenSafe(inner, favoriteDetailContent(channel, stats));
    }

    function renderFavoriteChannelBoard(tile, totals) {
        const board = tile.querySelector('.rt-stat-channel-board');
        if (!board) return;

        if (tile._rtId == null) tile._rtId = ++favoriteTileSeq;
        const channels = Array.isArray(totals.topFavoriteChannels) ? totals.topFavoriteChannels : [];

        if (!channels.length) {
            tile.classList.add('rt-channel-empty');
            tile._rtOpenChannel = null;
            board._rtRoster = '';
            replaceChildrenSafe(board, mk('div', 'rt-cb-empty', 'No watch history yet'));
            return;
        }
        tile.classList.remove('rt-channel-empty');

        // Forget a stored open channel that no longer ranks.
        if (tile._rtOpenChannel && !channels.some(c => c.name === tile._rtOpenChannel)) {
            tile._rtOpenChannel = null;
        }

        // Bar fill = share of the shown channels' combined watch time, so the
        // bars compare the favorites against each other AND #1's length reflects
        // how dominant it actually is (rather than always pegging at 100%, which
        // a leader-relative scale produced). The detail panel still reports each
        // channel's share of ALL watch time separately.
        const shownSec = Math.max(1, channels.reduce((s, c) => s + (c.sec || 0), 0));
        const totalSec = Math.max(1, Number(totals.watchSec) || shownSec);
        const leaderSec = channels[0]?.sec || 0;
        const compute = channel => {
            const sec = channel.sec || 0;
            const days = Math.max(0, channel.days || 0);
            return {
                pct: Math.max(6, Math.round((sec / shownSec) * 100)),
                stats: {
                    sharePct: Math.round((sec / totalSec) * 100),
                    vsLeaderPct: leaderSec ? Math.round((sec / leaderSec) * 100) : 100,
                    isLeader: channel.rank === 1,
                    days,
                    avgPerDaySec: days ? Math.round(sec / days) : sec,
                    peakSec: channel.peakSec || 0,
                },
            };
        };

        // Reconcile in place when the roster is unchanged. A full rebuild here
        // would destroy the row the user is hovering — and since a playing
        // video re-renders every watch-tick (~1s), that manifested as the bar
        // "pulsating" as its hover/transition state reset each second.
        const signature = favoriteRosterSignature(channels);
        const rows = board.querySelectorAll(':scope > .rt-cb-row');
        if (board._rtRoster === signature && rows.length === channels.length) {
            channels.forEach((channel, i) => {
                const { pct, stats } = compute(channel);
                patchFavoriteRow(rows[i], channel, pct, stats);
            });
            return;
        }

        // Roster changed (different channels/order) — rebuild from scratch.
        replaceChildrenSafe(board, []);
        channels.forEach((channel, index) => {
            const { pct, stats } = compute(channel);
            const detailId = `rt-cbd-${tile._rtId}-${index}`;
            board.appendChild(buildFavoriteRow(tile, board, channel, pct, stats, detailId));
        });
        board._rtRoster = signature;

        applyFavoriteOpenState(board, tile._rtOpenChannel);
    }

    function syncFavoriteChannelTile(tile, totals) {
        renderFavoriteChannelBoard(tile, totals);
    }

    function buildMetricHead(info, ...extraChildren) {
        const head = mk('div', 'rt-stat-head');
        const ico = mk('span', 'rt-stat-ico');
        appendChildren(ico, iconFor(info.icon, null));
        head.appendChild(ico);
        head.appendChild(mk('span', 'rt-stat-name', info.label));
        for (const child of extraChildren) head.appendChild(child);
        return head;
    }

    function buildMetricTile(key, totals) {
        const info = STATS_METRIC_INFO[key];
        const tile = mk('div', `rt-stat-tile rt-stat-tile-${key}`);
        tile.dataset.metricKey = key;

        if (key === 'favoriteChannel') {
            tile.appendChild(buildMetricHead(info));

            const board = mk('div', 'rt-stat-channel-board', null, {
                role: 'list',
                'aria-label': 'Top channels by watch time',
            });
            tile.appendChild(board);

            tile.classList.add('rt-stat-tile-channel');
            syncFavoriteChannelTile(tile, totals);
            return tile;
        }

        tile.appendChild(buildMetricHead(info));
        tile.appendChild(mk('strong', 'rt-stat-tile-val', metricDisplayValue(key, totals)));
        return tile;
    }

    function patchMetricTile(tile, key, totals) {
        if (!tile || tile.dataset.metricKey !== key) return false;
        if (key === 'favoriteChannel') {
            syncFavoriteChannelTile(tile, totals);
            return true;
        }
        const head = tile.querySelector(':scope > .rt-stat-head');
        if (!head) return false;
        const nameEl = head.querySelector('.rt-stat-name');
        if (!nameEl) return false;
        nameEl.textContent = STATS_METRIC_INFO[key].label;
        const valueEl = tile.querySelector('.rt-stat-tile-val');
        if (!valueEl) return false;
        valueEl.textContent = metricDisplayValue(key, totals);
        return true;
    }

    function patchStatsCard(card) {
        if (!card || !state.loaded || !getEnabled()) return false;
        const range = readStatsRange(state.range);
        const rangeLabel = card.querySelector('.rt-stats-range-label');
        const title = card.querySelector('.rt-stats-card-title');
        if (!rangeLabel || !title) return false;
        rangeLabel.textContent = STATS_RANGE_LABEL[range] || STATS_TITLE;
        title.textContent = STATS_TITLE;
        const rangeWrap = card.querySelector('.rt-stats-range');
        const rangeMenu = rangeWrap?._rtRangeMenu || rangeWrap?.querySelector('.rt-stats-range-menu');
        if (rangeMenu) {
            for (const item of rangeMenu.querySelectorAll('.rt-stats-range-item')) {
                item.setAttribute('aria-checked', item.dataset.range === range ? 'true' : 'false');
            }
        }

        const enabled = STATS_METRICS_ORDER.filter(key => state.metrics[key] !== false);
        if (!enabled.length) return false;
        const grid = card.querySelector('.rt-stat-grid');
        if (!grid) return false;
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

    function buildStatsCardHead(range) {
        const logo = mk('span', 'rt-stats-card-logo');
        logo.appendChild(RT_ICONS.chart());
        return mk('div', 'rt-stats-card-head', null, {
            children: [
                logo,
                mk('div', 'rt-stats-card-heading', null, {
                    children: [
                        mk('span', 'rt-stats-card-title', STATS_TITLE),
                        buildStatsRangePicker(range),
                    ],
                }),
            ],
        });
    }

    function buildStatsRangePicker(activeRange) {
        const clean = readStatsRange(activeRange);
        const wrap = mk('span', 'rt-stats-range');

        const button = mk('span', 'rt-stats-range-picker', null, {
            role: 'button',
            tabindex: '0',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            'aria-label': 'Choose statistics time range',
        });
        button.appendChild(mk('span', 'rt-stats-range-label', STATS_RANGE_LABEL[clean] || STATS_TITLE));
        button.appendChild(mk('span', 'rt-stats-range-caret', null, { 'aria-hidden': 'true' }));
        wrap.appendChild(button);

        const menu = mk('div', 'rt-stats-range-menu', null, { role: 'menu' });
        menu.hidden = true;
        menu.style.display = 'none';
        for (const value of STATS_RANGE_ORDER) {
            const item = mk('button', 'rt-stats-range-item', STATS_RANGE_LABEL[value], {
                type: 'button',
                role: 'menuitemradio',
                tabindex: '-1',
                'aria-checked': value === clean ? 'true' : 'false',
            });
            item.dataset.range = value;
            item.onpointerdown = stopStatsControlPropagation;
            item.onclick = event => {
                event.stopPropagation();
                chooseStatsRange(value);
            };
            item.onkeydown = event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setStatsRangeMenuOpen(wrap, false);
                    button.focus?.();
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    focusSiblingMenuItem(
                        menu,
                        item,
                        '.rt-stats-range-item',
                        event.key === 'ArrowDown' ? 1 : -1
                    );
                    return;
                }
                if (!['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                chooseStatsRange(value);
            };
            menu.appendChild(item);
        }
        wrap.appendChild(menu);
        wrap._rtRangeMenu = menu;
        menu._rtHomeWrap = wrap;
        bindStatsRangePicker(button, wrap);
        return wrap;
    }

    function bindStatsRangePicker(button, wrap) {
        button.onpointerdown = stopStatsControlPropagation;
        button.onclick = event => {
            event.stopPropagation();
            setStatsRangeMenuOpen(wrap, button.getAttribute('aria-expanded') !== 'true');
        };
        button.onkeydown = event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setStatsRangeMenuOpen(wrap, false);
                return;
            }
            if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            setStatsRangeMenuOpen(wrap, true, { focusSelected: true });
        };
    }

    function chooseStatsRange(value) {
        closeStatsRangeMenus();
        setActiveRange(value);
    }

    function buildStatsCard({ loading = false } = {}) {
        if (!state.loaded && !loading) return null;
        if (!getEnabled()) return null;
        const range = readStatsRange(state.range);

        const card = mk('div', 'rt-stats-card');
        card.appendChild(buildStatsCardHead(range));
        if (loading) {
            card.appendChild(mk('div', 'rt-stats-empty', 'Loading local statistics…'));
            return card;
        }

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

    function renderStatsCardInto(wrapper, { loading = false } = {}) {
        const existingCard = wrapper.querySelector(':scope > .rt-stats-card');
        if (!loading && patchStatsCard(existingCard)) return true;

        const card = buildStatsCard({ loading });
        if (!card) return false;
        replaceChildrenSafe(wrapper, card);
        return true;
    }

    function renderStatsPanelSlot() {
        const slot = document.getElementById('rt_stats_panel_slot');
        if (!slot) return;
        const canRenderPanel = isPanelEnabled();
        if (!canRenderPanel) {
            replaceChildrenSafe(slot, []);
            return;
        }

        syncStatsPanelWidth();

        let wrapper = slot.querySelector(':scope > .rt-inline-stats');
        if (!wrapper) {
            replaceChildrenSafe(slot, []);
            wrapper = mk('div', 'rt-inline-stats');
            slot.appendChild(wrapper);
        }

        if (!renderStatsCardInto(wrapper, { loading: !state.loaded })) wrapper.remove();
    }

    function findInlineHost() {
        return document.querySelector('ytd-watch-flexy #secondary #secondary-inner')
        || document.querySelector('ytd-watch-flexy #secondary')
        || document.querySelector('#secondary');
    }

    function cssPx(value) {
        return parseFloat(value) || 0;
    }

    function elementContentWidth(el) {
        if (!el) return 0;
        const rectWidth = el.getBoundingClientRect?.().width || 0;
        const style = getComputedStyle(el);
        return Math.max(0, rectWidth
        - cssPx(style.borderLeftWidth)
        - cssPx(style.borderRightWidth)
        - cssPx(style.paddingLeft)
        - cssPx(style.paddingRight));
    }

    function inlineStatsBaselineWidth() {
        const inline = document.querySelector('#rt_inline_stats');
        if (inline && !inline.closest?.('#rt_stats_panel')) {
            return inline.getBoundingClientRect?.().width || 0;
        }
        return elementContentWidth(findInlineHost());
    }

    function statsPanelContentChromeWidth(panel) {
        const body = panel.querySelector('.rt-stats-menu-body');
        const panelStyle = getComputedStyle(panel);
        const bodyStyle = body ? getComputedStyle(body) : null;
        return Math.round(
            cssPx(panelStyle.borderLeftWidth)
            + cssPx(panelStyle.borderRightWidth)
            + cssPx(bodyStyle?.paddingLeft)
            + cssPx(bodyStyle?.paddingRight)
        );
    }

    function syncStatsPanelWidth() {
        const panel = document.getElementById('rt_stats_panel');
        if (!panel) return;

        const sourceWidth = inlineStatsBaselineWidth();
        // Mirror the inline stats card width, ignoring oversized #secondary fallbacks.
        const cardWidth = sourceWidth >= 320 && sourceWidth <= 760
        ? Math.round(sourceWidth)
        : 420;
        const targetWidth = cardWidth + statsPanelContentChromeWidth(panel);

        panel.style.setProperty('--rt-stats-panel-width', `${targetWidth}px`);
    }

    function removeInlineCards(except = null) {
        for (const node of document.querySelectorAll('.rt-inline-stats')) {
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
        if (!wrapper) wrapper = mk('div', 'rt-inline-stats', null, { id: 'rt_inline_stats' });
        if (wrapper.parentElement !== host || host.firstElementChild !== wrapper) host.insertBefore(wrapper, host.firstChild);

        if (!renderStatsCardInto(wrapper)) {
            removeInlineCards();
            return;
        }
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
        mountRainTubeButtons(S?._statsFab, S?._fab, S?._settingsFab);
    }

    function applyVisibility() {
        syncStatsButtonVisibility();
        renderStatsPanelSlot();
        renderInlineCard();
        if (isInlineEnabled()) scheduleInlineMount(true);
        else clearInlineRetryTimers();
    }

    function syncSettingsControls() {
        const display = document.getElementById('rt_stats_display_select');
        if (display) display.value = state.display;
        for (const key of STATS_METRICS_ORDER) {
            const input = document.getElementById(`rt_stats_metric_${key}`);
            if (input) input.checked = state.metrics[key] !== false;
        }
    }

    async function load() {
        const [enabled, display, metrics, buckets] = await Promise.all([
            StatsStore.getValue(CFG.storage.statsEnabled, true),
            StatsStore.getValue(CFG.storage.statsDisplay, 'panel'),
            StatsStore.getJson(CFG.storage.statsMetrics, null),
            StatsStore.getJson(CFG.storage.statsBuckets, null),
        ]);
        state.enabled = typeof enabled === 'boolean' ? enabled : true;
        state.range = STATS_SESSION_DEFAULT_RANGE;
        state.display = readStatsDisplay(display);
        state.metrics = sanitizeStatsMetrics(metrics);
        state.buckets = sanitizeStatsBuckets(buckets);
        state.loaded = true;
        pruneBuckets();
        syncSettingsControls();
        applyVisibility();

        // Record the current route now that state is loaded.
        onNavigate();
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
        await deleteStoredValue(CFG.storage.statsBuckets);
        scheduleRender();
    }

    function resetSettings() {
        state.enabled = true;
        state.range = STATS_SESSION_DEFAULT_RANGE;
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
        document.addEventListener('pointerdown', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target?.closest?.('.rt-stats-range-picker, .rt-stats-range-menu')) {
                closeStatsRangeMenus();
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

    // The active/displayed range — transient. The in-card range picker uses
    // this so switching ranges is a quick view change that does not persist.
    function setActiveRange(value) {
        state.range = readStatsRange(value);
        renderInlineCard();
        renderStatsPanelSlot();
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
        setActiveRange,
        setDisplay,
        setMetric,
        getDisplay,
        getEnabled,
        isPanelEnabled,
        isInlineEnabled,
        getMetrics,
        summary,
    });
})();

function buildToggleCard(iconKey, swId, name, stId, infoText) {
    const card = mk('div', `rt-tc rt-tc-${iconKey}`);
    const sw = mk('button', 'rt-sw', null, {
        id: swId, type: 'button', role: 'switch', 'aria-checked': 'false',
        children: mk('span', 'rt-thumb'),
    });
    appendChildren(card, [
        mk('div', 'rt-tc-top', null, {
            children: [mk('span', 'rt-tc-ico', null, { children: iconFor(iconKey) }), sw],
        }),
        mk('div', 'rt-tc-bot', null, {
            children: [mk('span', 'rt-tc-name', name), mk('span', 'rt-tc-st', 'OFF', { id: stId })],
        }),
    ]);

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
        head.appendChild(mk('span', `rt-set-icon rt-set-icon-${icon}`, null, { children: iconFor(icon, icon) }));
    }
    head.appendChild(mk('div', 'rt-set-heading', null, {
        children: [eyebrow && mk('span', 'rt-set-eyebrow', eyebrow), mk('span', 'rt-set-title', title)],
    }));
    panel.appendChild(head);

    return panel;
}

function buildFieldLabel(text, helpText, labelClass = 'rt-field-label') {
    const label = mk('span', labelClass || null, text);
    if (!helpText) return label;

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
    return mk('span', 'rt-field-label-wrap', null, { children: [label, help] });
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
    for (const item of items) grid.appendChild(buildCheckboxField({ ...item, wide: false }));
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
    box.appendChild(buildCheckboxField({ ...checkbox, wide: true }));

    if (noteText) {
        box.appendChild(mk('div', 'rt-setting-warning-note', null, {
            children: [
                mk('span', 'rt-setting-warning-ico', noteIcon),
                mk('span', 'rt-setting-warning-text', noteText),
            ],
        }));
    }

    return box;
}

// Two related warning checkboxes side by side under one shared note, instead of
// two stacked full-width boxes that each repeat the same warning.
function buildWarningCheckboxPair({ items = [], noteText, noteIcon = '⚠' }) {
    const box = mk('div', 'rt-setting-warning-box');
    const grid = mk('div', 'rt-warning-check-grid');
    for (const item of items) {
        grid.appendChild(buildCheckboxField({ ...settingControl('checkbox', item), wide: true }));
    }
    box.appendChild(grid);

    if (noteText) {
        box.appendChild(mk('div', 'rt-setting-warning-note', null, {
            children: [
                mk('span', 'rt-setting-warning-ico', noteIcon),
                mk('span', 'rt-setting-warning-text', noteText),
            ],
        }));
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
    if (control.type === 'warningCheckboxPair') return buildWarningCheckboxPair(control);
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

function applySettingChange(control, rawValue) {
    const read = control.read || (value => value);
    const stored = control.store || (value => value);
    const value = read(rawValue);
    if (control.stateKey) S[control.stateKey] = value;
    if (control.storageKey) save(control.storageKey, stored(value));
    control.afterChange?.(value, rawValue);
    return value;
}

function settingControl(type, control) {
    const current = control.stateKey ? S[control.stateKey] : undefined;
    const out = { ...control, type };
    if (!out.onChange) out.onChange = value => applySettingChange(control, value);
    if (type === 'checkbox' || type === 'warningCheckbox') {
        if (out.checked === undefined) out.checked = !!current;
    } else if (out.value === undefined && current !== undefined) {
        out.value = current;
    }
    return out;
}

const selectSetting = control => settingControl('select', control);
const sliderSetting = control => settingControl('slider', control);
const checkboxSetting = control => settingControl('checkbox', control);
const SETTINGS_SECTION_ORDER = Object.freeze(['general', 'customization', 'shorts', 'statistics', 'quality', 'private', 'danger']);
const labelOptions = (order, labels) => order.map(value => ({ value, label: labels[value] || value }));
const shortsSurfaceSetting = (inputId, text, stateKey, storageKey) => checkboxSetting({
    inputId, text, stateKey, storageKey,
    read: Boolean,
    afterChange: () => ShortsBlocker.apply(),
});

function SETTINGS_SECTIONS() {
    return {
        general: {
            id: 'rt_set_general',
            title: 'General',
            icon: 'general',
            eyebrow: 'Appearance',
            hint: 'Buttons, rain, lightning, and notifications.',
            controls: [
                sliderSetting({
                    labelText: 'Toast duration',
                    sliderId: 'rt_toast_duration_slider',
                    min: TOAST_DURATION_MIN_MS / 1000,
                    max: TOAST_DURATION_MAX_MS / 1000,
                    step: 0.5,
                    value: S.toastDurationMs / 1000,
                    valueRender: secs => `${secs.toFixed(1)}s`,
                    stateKey: 'toastDurationMs',
                    storageKey: CFG.storage.toastDurationMs,
                    read: secs => Math.max(TOAST_DURATION_MIN_MS, Math.min(TOAST_DURATION_MAX_MS, Math.round(secs * 1000))),
                }),
                selectSetting({
                    labelText: 'Toast position',
                    selectId: 'rt_toast_position_select',
                    options: labelOptions(TOAST_PLACEMENT_ORDER, TOAST_PLACEMENT_LABEL),
                    stateKey: 'toastPlacement',
                    storageKey: CFG.storage.toastPlacement,
                    read: readToastPlacementSetting,
                    afterChange: scheduleToastPositionSync,
                }),
                selectSetting({
                    labelText: 'Rain quantity',
                    selectId: 'rt_rain_quantity_select',
                    options: labelOptions(RAIN_QUANTITY_ORDER, RAIN_QUANTITY_LABEL),
                    stateKey: 'rainQuantity',
                    storageKey: CFG.storage.rainQuantity,
                    read: readRainQuantitySetting,
                    afterChange: syncRainQuantity,
                }),
                sliderSetting({
                    labelText: 'Rain FPS cap',
                    helpText: 'Limits how often the rain animation redraws. Lower values may use less power.',
                    sliderId: 'rt_rain_fps_cap_slider',
                    min: RAIN_FPS_MIN,
                    max: RAIN_FPS_MAX,
                    step: 5,
                    valueRender: fps => `${Math.round(fps)} fps`,
                    stateKey: 'rainFpsCap',
                    storageKey: CFG.storage.rainFpsCap,
                    read: readRainFpsCap,
                    afterChange: syncRainFps,
                }),
                checkboxSetting({
                    inputId: 'rt_lightning_enabled',
                    text: 'Lightning effects',
                    wide: true,
                    stateKey: 'lightningEnabled',
                    storageKey: CFG.storage.lightning,
                    read: Boolean,
                    afterChange: syncLightning,
                }),
                selectSetting({
                    labelText: 'Button placement',
                    helpText: 'Choose where RainTube buttons appear on YouTube.',
                    selectId: 'rt_button_placement_select',
                    options: labelOptions(BUTTON_PLACEMENT_ORDER, BUTTON_PLACEMENT_LABEL),
                    stateKey: 'buttonPlacement',
                    storageKey: CFG.storage.buttonPlacement,
                    read: readButtonPlacement,
                    afterChange: syncButtonPlacement,
                }),
                {
                    type: 'warningCheckboxPair',
                    noteText: "Advanced options, don't toggle blindly.",
                    items: [
                        {
                            inputId: 'rt_main_button_visible',
                            text: 'Show RainTube button',
                            helpText: "Shows the RainTube button on YouTube. If you hide it, open RainTube from your userscript manager's menu command.",
                            stateKey: 'mainButtonVisible',
                            storageKey: CFG.storage.mainButtonVisible,
                            read: Boolean,
                            afterChange: syncButtonPlacement,
                        },
                        {
                            inputId: 'rt_settings_button_visible',
                            text: 'Show settings button',
                            helpText: "Shows the dedicated settings button next to the RainTube button. If you hide it, open settings from your userscript manager's menu command.",
                            stateKey: 'settingsButtonVisible',
                            storageKey: CFG.storage.settingsButtonVisible,
                            read: Boolean,
                            afterChange: syncButtonPlacement,
                        },
                    ],
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
                    type: 'checkboxGrid',
                    items: [
                        checkboxSetting({
                            inputId: 'rt_oled_theme',
                            text: 'OLED pure-black theme',
                            helpText: "Makes YouTube dark mode pure black and turns off the player glow.",
                            stateKey: 'oledThemeEnabled',
                            storageKey: CFG.storage.oledTheme,
                            read: Boolean,
                            afterChange: () => OledTheme.apply(),
                        }),
                        checkboxSetting({
                            inputId: 'rt_topbar_theme',
                            text: 'RainTube top bar',
                            helpText: "Styles YouTube's top bar with RainTube's dark glass, glow, and rain.",
                            stateKey: 'topbarThemeEnabled',
                            storageKey: CFG.storage.topbarTheme,
                            read: Boolean,
                            afterChange: () => TopbarTheme.apply(),
                        }),
                    ],
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
                        shortsSurfaceSetting('rt_shorts_hide_sidebar', 'Sidebar', 'shortsHideSidebar', CFG.storage.shortsHideSidebar),
                        shortsSurfaceSetting('rt_shorts_hide_home', 'Home & feeds', 'shortsHideHome', CFG.storage.shortsHideHome),
                        shortsSurfaceSetting('rt_shorts_hide_search', 'Search results', 'shortsHideSearch', CFG.storage.shortsHideSearch),
                        shortsSurfaceSetting('rt_shorts_hide_channel', 'Channel tabs', 'shortsHideChannel', CFG.storage.shortsHideChannel),
                        shortsSurfaceSetting('rt_shorts_hide_watch', 'Watch suggestions', 'shortsHideWatch', CFG.storage.shortsHideWatch),
                    ],
                },
                selectSetting({
                    labelText: 'Direct /shorts/ links',
                    selectId: 'rt_shorts_on_visit_select',
                    options: labelOptions(SHORTS_ON_VISIT_ORDER, SHORTS_ON_VISIT_LABEL),
                    stateKey: 'shortsOnVisit',
                    storageKey: CFG.storage.shortsOnVisit,
                    read: readShortsOnVisit,
                }),
            ],
        },
        statistics: {
            id: 'rt_set_statistics',
            title: STATS_TITLE,
            icon: 'chart',
            eyebrow: 'Local rollups',
            hint: 'Local watch summaries for time watched, opened videos, Shorts, and favorite channels.',
            controls: [
                {
                    type: 'select',
                    labelText: 'Show statistics',
                    helpText: 'Collapsed keeps statistics behind the Statistics button. Always shows them above recommendations.',
                    selectId: 'rt_stats_display_select',
                    options: labelOptions(STATS_DISPLAY_ORDER, STATS_DISPLAY_LABEL),
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
                selectSetting({
                    labelText: 'Target quality',
                    helpText: 'Uses this quality when available, otherwise chooses the closest lower eligible option.',
                    selectId: 'rt_quality_max',
                    options: labelOptions(QUALITY_ORDER, QUALITY_LABEL),
                    stateKey: 'qualityMax',
                    storageKey: CFG.storage.qualityMax,
                    read: value => readEnumSetting(value, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax),
                    afterChange: restartQualityTargeting,
                }),
                checkboxSetting({
                    inputId: 'rt_quality_super_resolution',
                    text: 'Include Super resolution',
                    helpText: 'Allows RainTube to choose YouTube AI-upscaled Super resolution rows when they are the first eligible match in YouTube’s quality menu.',
                    wide: true,
                    stateKey: 'qualitySuperResolutionEnabled',
                    storageKey: CFG.storage.qualitySuperResolution,
                    read: Boolean,
                    afterChange: restartQualityTargeting,
                }),
            ],
        },
        private: {
            id: 'rt_set_private',
            title: 'Private Downloads',
            icon: 'private',
            eyebrow: 'Proxy routing',
            hint: 'Download through privacy-friendly mirrors.',
            controls: [
                selectSetting({
                    labelText: 'Provider',
                    helpText: 'Choose which private mirrors RainTube tries. “Both” uses Piped and Invidious.',
                    selectId: 'rt_private_provider_select',
                    options: labelOptions(PRIVATE_PROVIDER_ORDER, PRIVATE_PROVIDER_LABEL),
                    stateKey: 'privateProvider',
                    storageKey: CFG.storage.privateProvider,
                    read: readPrivateProvider,
                }),
                sliderSetting({
                    labelText: 'Request timeout',
                    helpText: 'How long RainTube waits for one download mirror before trying another or failing. Lower values recover sooner; higher values help slow downloads finish.',
                    sliderId: 'rt_private_download_timeout_slider',
                    min: PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS / 1000,
                    max: PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS / 1000,
                    step: PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS / 1000,
                    value: S.privateDownloadTimeoutMs / 1000,
                    valueRender: formatPrivateDownloadTimeoutSeconds,
                    stateKey: 'privateDownloadTimeoutMs',
                    storageKey: CFG.storage.privateDownloadTimeoutMs,
                    read: secs => readPrivateDownloadTimeoutMs(Math.round(secs * 1000)),
                }),
                checkboxSetting({
                    inputId: 'rt_private_fallback',
                    text: 'Open CnvMP3 when private downloads fail',
                    helpText: 'Opens CnvMP3 with the current video link when private mirrors fail.',
                    wide: true,
                    stateKey: 'privateFallbackEnabled',
                    storageKey: CFG.storage.privateFallback,
                    read: Boolean,
                }),
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
                            toast('Statistics cleared', 'off', { label: STATS_TITLE });
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
    syncSettingControlValue('rt_settings_button_visible', null, { checked: S.settingsButtonVisible });
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
    syncSettingControlValue('rt_quality_super_resolution', null, { checked: S.qualitySuperResolutionEnabled });
    syncSettingControlValue('rt_private_provider_select', S.privateProvider);
    syncSettingControlValue('rt_private_download_timeout_slider', S.privateDownloadTimeoutMs / 1000, { input: true });
    syncSettingControlValue('rt_private_fallback', null, { checked: S.privateFallbackEnabled });
}

async function resetAllSettingsToDefaults() {
    Object.assign(S, DEFAULT_SETTINGS, {
        _lastQualityTargetKey: null,
        _lastKnownQuality: null,
    });

    await deleteRainTubeStorageExcept([CFG.storage.statsBuckets]);
    StatsTracker.resetSettings();

    clearProviderFailures();
    ShortsBlocker.apply();
    OledTheme.apply();
    TopbarTheme.apply();
    scheduleToastPositionSync();
    syncRainQuantity();
    syncRainFps();
    syncLightning();
    syncAllSettingsControls();
    syncButtonPlacement();
    if (S.qualityEnabled) scheduleQualityApply();
    uiSync();
}

function buildSettingsSections() {
    const sections = SETTINGS_SECTIONS();
    return SETTINGS_SECTION_ORDER.map(key => buildSettingsSection(sections[key]));
}

function buildSlider({ labelText, helpText, sliderId, min, max, step, value, valueRender, onChange }) {
    const row = mk('div', 'rt-control-row rt-slider-row');

    const left = mk('div', 'rt-slider-left');
    left.appendChild(buildFieldLabel(labelText, helpText));
    const chip = mk('span', 'rt-slider-chip', valueRender(value));
    left.appendChild(chip);
    row.appendChild(left);

    const sliderWrap = mk('div', 'rt-slider-track-wrap');

    appendChildren(sliderWrap, [
        mk('div', 'rt-slider-track'),
        mk('div', 'rt-slider-fill'),
        mk('div', 'rt-slider-thumb-custom'),
    ]);

    const slider = mk('input', 'rt-slider-input', null, {
        id: sliderId,
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
    });
    sliderWrap.appendChild(slider);
    row.appendChild(sliderWrap);

    const span = (max - min) || 1;
    const toPct = v => ((v - min) / span) * 100;
    let displayedPct = toPct(value);
    let targetPct = displayedPct;
    let rafHandle = null;

    const render = pct => {
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
        displayedPct += diff * 0.25;
        render(displayedPct);
        rafHandle = requestAnimationFrame(tick);
    };

    const setTarget = pct => {
        targetPct = pct;
        if (!rafHandle) rafHandle = requestAnimationFrame(tick);
    };

    let lastChipText = chip.textContent;
    const pulseChip = () => {
        chip.classList.remove('rt-chip-pulse');
        void chip.offsetWidth;
        chip.classList.add('rt-chip-pulse');
    };

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

    const onDown = () => row.classList.add('rt-slider-grabbing');
    const onUp = () => row.classList.remove('rt-slider-grabbing');
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
    const iconWrap = mk('span', 'rt-dl-ico');
    appendChildren(iconWrap, iconFor(iconKey, iconKey || '◦'));
    return mk('button', `rt-dl rt-dl-${variant}`, null, {
        id,
        type: 'button',
        children: [
            iconWrap,
            mk('span', 'rt-dl-txt', null, {
                children: mk('span', 'rt-dl-p', primaryLabel),
            }),
        ],
    });
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
    appendChildren(wrap, [
        mk('div', 'rt-progress-top', null, {
            children: [
                mk('span', 'rt-progress-label', 'Ready', { id: 'rt_progress_label' }),
                mk('span', 'rt-progress-pct', '0%', { id: 'rt_progress_pct' }),
            ],
        }),
        mk('div', 'rt-progress-track', null, {
            children: mk('div', 'rt-progress-fill', null, { id: 'rt_progress_fill' }),
        }),
        mk('div', 'rt-progress-meta', '', { id: 'rt_progress_meta' }),
    ]);
    return wrap;
}

function createRainCanvas({ canvas, host: panel, ...opts }) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !panel) return;

    const targetSelector = opts.targetSelector || '.rt-mark, .rt-hdr-btn';
    const targetKind = typeof opts.targetKind === 'function'
    ? opts.targetKind
    : el => (el.classList.contains('rt-mark') ? 'logo' : 'button');
    const shouldRun = typeof opts.shouldRun === 'function'
    ? opts.shouldRun
    : () => panel.classList.contains('show') && !panel.classList.contains('rt-rain-off');
    const optionValue = (value, fallback) => (typeof value === 'function' ? value() : value ?? fallback);
    const readQuantityScale = () => {
        const explicit = optionValue(opts.quantityScale, null);
        if (explicit !== null && explicit !== undefined && Number.isFinite(Number(explicit))) {
            return Math.max(0, Number(explicit));
        }
        const rainQuantity = readRainQuantitySetting(S.rainQuantity);
        return RAIN_QUANTITY_PARTICLE_SCALE[rainQuantity] ?? 1;
    };
    const readFpsCapOption = () => readRainFpsCap(optionValue(opts.fps, S.rainFpsCap));
    const lightningEnabled = () => opts.lightning !== false && !!optionValue(opts.lightning, S.lightningEnabled);
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
        frameIntervalMs: 1000 / readFpsCapOption(),
        width: 0,
        height: 0,
        dpr: 1,
        wind: random(-WIND_RANGE, WIND_RANGE),
        ambientFill: null,
    };

    const particles = {
        ensureCount(list, count) {
            while (list.length < count) list.push({});
            while (list.length > count) list.pop();
        },

        seed(initial = false) {
            const quantityScale = readQuantityScale();
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
            drop.vy = random(118, 248) * (0.54 + depth * 0.68) *
            RAIN_SPEED_SCALE *
            (drop.background ? BACKGROUND_DROP_SPEED_SCALE : 1);
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

    const interaction = {
        markTarget(target, x, y, ts) {
            const lastHit = state.targetHits.get(target.el) ?? -Infinity;
            if (ts - lastHit < UI_IMPACT_COOLDOWN) return false;

            state.targetHits.set(target.el, ts);
            target.el.style.setProperty(
                '--rt-rain-hit-x',
                `${clamp(((x - target.x) / target.w) * 100, 8, 92).toFixed(1)}%`
            );
            target.el.style.setProperty(
                '--rt-rain-hit-y',
                `${clamp(((y - target.y) / target.h) * 100, 8, 92).toFixed(1)}%`
            );
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
            if (!lightningEnabled()) {
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
                glow.addColorStop(1, 'rgba(40, 212, 168, 0.024)');
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
            state.frameIntervalMs = 1000 / readFpsCapOption();
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
        if (!lightningEnabled()) {
            state.lightning = null;
            state.nextLightningTs = 0;
        }
        lifecycle.sync();
    };

    new MutationObserver(lifecycle.sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new window.ResizeObserver(layout.requestResize).observe(canvas);
    document.addEventListener('visibilitychange', lifecycle.sync, { passive: true });
    window.addEventListener('resize', layout.requestResize, { passive: true });
    layout.resize();
}

function rainHosts() {
    return ['rt_panel', 'rt_stats_panel', 'rt_settings_root']
        .map(id => document.getElementById(id))
        .filter(Boolean);
}

function syncRainQuantity() {
    const off = readRainQuantitySetting(S.rainQuantity) === 'off';
    for (const host of rainHosts()) {
        host.classList.toggle('rt-rain-off', off);
        host.__rtRainQuantityChanged?.();
    }
    TopbarTheme.syncRain();
}

function syncRainFps() {
    for (const host of rainHosts()) host.__rtRainFpsChanged?.();
    TopbarTheme.syncRain();
}

function syncLightning() {
    for (const host of rainHosts()) host.__rtLightningChanged?.();
    TopbarTheme.syncRain();
}

function buildPanel() {
    const statsFab = mk('button', 'rt-floating', null, {
        id: 'rt_stats_fab', type: 'button',
        'aria-label': 'Open RainTube statistics', 'aria-expanded': 'false',
        'data-tip': STATS_TITLE, 'data-tip-place': 'bottom', 'data-tip-style': 'native',
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

    const settingsFab = mk('button', 'rt-floating', null, {
        id: 'rt_settings_fab', type: 'button',
        'aria-label': 'Open RainTube settings', 'aria-expanded': 'false',
        'data-tip': 'RainTube settings', 'data-tip-place': 'bottom', 'data-tip-style': 'native',
    });
    setToolbarButtonHidden(settingsFab, !readButtonVisible(S.settingsButtonVisible, true));
    const settingsFabIcon = mk('span', 'rt-fab-icon');
    settingsFabIcon.appendChild(RT_ICONS.gear());
    settingsFab.appendChild(settingsFabIcon);
    document.body.appendChild(settingsFab);
    initTooltips(settingsFab);

    const statsPanel = mk('div', null, null, {
        id: 'rt_stats_panel', role: 'dialog', 'aria-hidden': 'true', 'aria-label': 'RainTube statistics',
    });
    const statsHdr = mk('header', 'rt-hdr rt-stats-menu-hdr', null, { id: 'rt_stats_drag' });
    const statsRain = mk('canvas', 'rt-rain-canvas', null, { 'aria-hidden': 'true' });
    statsHdr.appendChild(statsRain);
    const statsHdrLeft = mk('div', 'rt-hdr-l');
    const statsMark = mk('div', 'rt-mark rt-stats-menu-mark');
    statsMark.appendChild(RT_ICONS.chart());
    statsHdrLeft.appendChild(statsMark);
    const statsHdrText = mk('div', 'rt-stats-menu-title-wrap');
    statsHdrText.appendChild(mk('span', 'rt-stats-menu-eyebrow', 'RainTube'));
    statsHdrText.appendChild(mk('h2', 'rt-stats-menu-title', STATS_TITLE));
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
    createRainCanvas({
        canvas: statsRain,
        host: statsPanel,
        maxDrops: 78,
        surfaceBeadCount: 5,
    });

    const panel = mk('div', null, null, { id: 'rt_panel', role: 'dialog' });

    const hdr = mk('header', 'rt-hdr', null, { id: 'rt_drag' });

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
    [
        ['shorts', 'rt_sw_shorts', 'Shorts', 'rt_sw_shorts_st', 'Hides Shorts across YouTube.'],
        ['quality', 'rt_sw_q', 'Quality', 'rt_sw_q_st', 'Sets playback to your target quality (or closest available).'],
        ['private', 'rt_sw_private', 'Private', 'rt_sw_private_st', 'Downloads through privacy-friendly mirrors.'],
        ['chart', 'rt_sw_stats', STATS_TITLE, 'rt_sw_stats_st', 'Tracks local watch summaries.'],
    ].forEach(args => toggles.appendChild(buildToggleCard(...args)));
    body.appendChild(toggles);

    const note = mk('div', 'rt-note');
    note.appendChild(mk('span', 'rt-note-ico', '🛡'));
    note.appendChild(mk('span', null,
                        'RainTube keeps YouTube cleaner, adds privacy-minded downloads, and gives the interface a little atmosphere. Your preferences stay local.'));
    body.appendChild(note);

    panel.appendChild(body);
    panel.appendChild(mk('footer', 'rt-foot', APP_FOOTER_TEXT));

    document.body.appendChild(panel);
    createRainCanvas({ canvas: rain, host: panel });
    initTooltips(panel);
    resetProgress();
    getToastContainer();

    buildSettingsModal();
    syncRainQuantity();

    return { panel, fab, statsFab, settingsFab, statsPanel };
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
        if (child && child.id !== 'rt_fab' && child.id !== 'rt_stats_fab' && child.id !== 'rt_settings_fab') return child;
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
            if (child && child.id !== 'rt_fab' && child.id !== 'rt_stats_fab' && child.id !== 'rt_settings_fab') return { row: host, before: child };
        }
        return { row: host, before: host.firstElementChild || null };
    }
    return null;
}

function setToolbarButtonHidden(btn, hidden) {
    if (!btn) return;
    btn.hidden = !!hidden;
    // YouTube can restyle moved buttons during masthead hydration.
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
    const settingsFab = S?._settingsFab || document.getElementById('rt_settings_fab');
    if (fab) setToolbarButtonHidden(fab, !readButtonVisible(S?.mainButtonVisible, true));
    if (statsFab) setToolbarButtonHidden(statsFab, !StatsTracker.isPanelEnabled());
    if (settingsFab) setToolbarButtonHidden(settingsFab, !readButtonVisible(S?.settingsButtonVisible, true));
    mountRainTubeButtons(statsFab, fab, settingsFab);
}

function insertRainTubeButtons(row, before, buttons, placementClass) {
    let anchor = before || row.firstElementChild || null;
    for (let i = buttons.length - 1; i >= 0; i--) {
        const btn = buttons[i];
        if (btn.parentElement !== row || btn.nextElementSibling !== anchor) row.insertBefore(btn, anchor);
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

function mountRainTubeButtons(statsFab, fab, settingsFab) {
    parkHiddenToolbarButton(statsFab);
    parkHiddenToolbarButton(fab);
    parkHiddenToolbarButton(settingsFab);

    const buttons = [
        statsFab && !statsFab.hidden ? statsFab : null,
        fab && !fab.hidden ? fab : null,
        settingsFab && !settingsFab.hidden ? settingsFab : null,
    ].filter(Boolean);
    if (!buttons.length) return;

    const placement = readButtonPlacement(S?.buttonPlacement);

    if (placement === 'like') {
        const slot = findYouTubeLikeActionSlot();
        if (slot?.row) {
            insertRainTubeButtons(slot.row, slot.before, buttons, 'rt-watch-action');
            return;
        }
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

        // Avoid invisible panel work unless something visible depends on it.
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
            const text = vid ? (readCurrentQualityLabel() || '—') : '—';
            if (qualityEl.textContent !== text) qualityEl.textContent = text;
        }

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
        panel.style.transform = opts.snapToDevicePixels
        ? `translate(${ox}px, ${oy}px)`
        : `translate3d(${ox}px,${oy}px,0)`;
        panel.__rtRainMoved?.();
    };

    const positionNearButton = (force = false) => {
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
            && e.target.closest('button, input, select, textarea, a, [role="button"], [data-no-drag]')) {
            return;
            }
            dragging = true;
        userMoved = true;
        pid = e.pointerId;
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

    const hdr = mk('header', 'rt-settings-hdr');
    const rain = mk('canvas', 'rt-rain-canvas', null, { 'aria-hidden': 'true' });
    hdr.appendChild(rain);
    const hdrL = mk('div', 'rt-settings-hdr-l');
    const settingsTile = mk('div', 'rt-settings-icon');
    settingsTile.appendChild(RT_ICONS.gear());
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

    const body = mk('div', 'rt-settings-body');
    for (const section of buildSettingsSections()) body.appendChild(section);
    modal.appendChild(body);

    const foot = mk('footer', 'rt-settings-foot');
    foot.appendChild(mk('span', 'rt-settings-foot-ver', `RainTube · ${CFG.version}`));
    const done = mk('button', 'rt-settings-done', 'Done',
                    { id: 'rt_settings_done', type: 'button' });
    foot.appendChild(done);
    modal.appendChild(foot);

    root.appendChild(modal);
    document.body.appendChild(root);
    createRainCanvas({
        canvas: rain,
        host: root,
        targetSelector: '.rt-settings-icon, .rt-settings-close',
        targetKind: el => (el.classList.contains('rt-settings-icon') ? 'logo' : 'button'),
        maxDrops: 92,
        surfaceBeadCount: 7,
    });
    syncRainQuantity();

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
        // Lock YouTube's page scroll while the settings dialog is active.
        if (html.dataset.rtPrevOverflow === undefined) html.dataset.rtPrevOverflow = html.style.overflow || '';
        html.style.overflow = 'hidden';

        root.classList.add('show');
        root.setAttribute('aria-hidden', 'false');
        setTimeout(() => document.getElementById('rt_settings_close')?.focus(), 50);
    } else {
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

function safeAction(label, handler, failMessage = null) {
    return async event => {
        try {
            await handler(event);
        } catch (err) {
            console.warn(`[RainTube] ${label} failed:`, err);
            if (failMessage) toast(failMessage, 'warn');
        }
    };
}

function toggleStoredSetting({ stateKey, storageKey, onLabel, offLabel, onVariant, offVariant = 'off', toastMeta, afterChange }) {
    return () => {
        S[stateKey] = !S[stateKey];
        save(storageKey, S[stateKey]);
        afterChange?.(S[stateKey]);
        uiSync();
        toast(S[stateKey] ? onLabel : offLabel, S[stateKey] ? onVariant : offVariant, toastMeta);
    };
}

function bindEvents(panel, fab, statsFab, statsPanel) {
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

    const clickStatsFab = () => {
        if (!StatsTracker.isPanelEnabled() && !statsOpen) return;
        hideTooltip();
        setStatsOpen(!statsPanel?.classList.contains('show'));
    };
    const clickFab = () => {
        hideTooltip();
        setOpen(!open);
    };
    const clickSettingsFab = () => {
        hideTooltip();
        setSettingsOpen(!isSettingsOpen());
    };
    statsFab?.addEventListener('click', clickStatsFab);
    fab.addEventListener('click', clickFab);
    S._settingsFab?.addEventListener('click', clickSettingsFab);

    const closeSettings = () => setSettingsOpen(false);
    const downloads = {
        rt_dl_v: ['video', 'Video download failed'],
        rt_dl_a: ['audio', 'Audio download failed'],
    };
    for (const [id, [mode, message]] of Object.entries(downloads)) {
        on(id, 'click', safeAction(`${mode} download handler`, e =>
            downloadViaPublicApisOrFallback(getVideoId(), mode, e.currentTarget), message));
    }

    [
        ['rt_close', () => setOpen(false)],
        ['rt_stats_close', () => setStatsOpen(false)],
        ['rt_dl_stop', requestStopAfterCurrentRequest],
        ['rt_settings_close', closeSettings],
        ['rt_settings_done', closeSettings],
        ['rt_settings_backdrop', closeSettings],
    ].forEach(([id, handler]) => on(id, 'click', handler));

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
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

    [
        ['rt_sw_shorts', {
            stateKey: 'shortsBlockerEnabled',
            storageKey: CFG.storage.shortsBlocker,
            onLabel: 'Shorts hidden',
            offLabel: 'Shorts shown',
            onVariant: 'shorts',
            toastMeta: { icon: 'shorts', label: 'Shorts' },
            afterChange: () => ShortsBlocker.apply(),
        }],
        ['rt_sw_q', {
            stateKey: 'qualityEnabled',
            storageKey: CFG.storage.quality,
            onLabel: 'Quality targeting on',
            offLabel: 'Quality targeting off',
            onVariant: 'quality',
            toastMeta: { icon: 'quality', label: 'Quality' },
            afterChange: enabled => restartQualityTargeting({ enabled }),
        }],
        ['rt_sw_private', {
            stateKey: 'privateDownloadsEnabled',
            storageKey: CFG.storage.privateDownloads,
            onLabel: 'Private downloads on',
            offLabel: 'Private downloads off',
            onVariant: 'dl',
            toastMeta: { icon: 'private', label: 'Download' },
        }],
    ].forEach(([id, config]) => on(id, 'click', toggleStoredSetting(config)));

    on('rt_sw_stats', 'click', safeAction('Statistics toggle', async () => {
        const enabled = StatsTracker.getEnabled();
        await StatsTracker.setEnabled(!enabled);
        uiSync();
        toast(enabled ? 'Statistics tracking paused' : 'Statistics tracking on',
            enabled ? 'off' : 'stats', { icon: 'chart', label: STATS_TITLE });
    }, 'Statistics toggle failed'));
}

/* ── Runtime controllers ────────────────────────────────────────────────── */

const ShortsBlocker = (() => {
    const STYLE_ID = 'rt_shorts_blocker_style';

    // Page-scoped selectors keep shared Shorts components tied to each toggle.
    const SURFACES = [
        {
            id: 'sidebar',
            stateKey: 'shortsHideSidebar',
            bodyClass: 'rt-shorts-hide-sidebar',
            selectors: [
                'ytd-guide-entry-renderer:has(a[title="Shorts"])',
                'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
            ],
        },
        {
            id: 'home',
            stateKey: 'shortsHideHome',
            bodyClass: 'rt-shorts-hide-home',
            selectors: [
                'ytd-rich-shelf-renderer[is-shorts]',
                'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
                'ytd-browse ytd-reel-shelf-renderer',
                'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
                'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
                'ytd-reel-item-renderer',
            ],
        },
        {
            id: 'search',
            stateKey: 'shortsHideSearch',
            bodyClass: 'rt-shorts-hide-search',
            selectors: [
                'ytd-search ytd-reel-shelf-renderer',
                'ytd-search ytd-shorts-lockup-view-model',
                'ytd-search ytd-shorts-shelf-renderer',
                'ytd-search ytd-shelf-renderer:has(ytd-shorts-lockup-view-model)',
                'ytd-search ytd-shelf-renderer:has(ytd-reel-item-renderer)',
                'ytd-search grid-shelf-view-model:has(a[href*="/shorts/"])',
                'ytd-search ytd-video-renderer:has(a[href*="/shorts/"])',
                'ytd-search ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])',
                'ytd-search ytd-reel-video-renderer',
            ],
        },
        {
            id: 'channel',
            stateKey: 'shortsHideChannel',
            bodyClass: 'rt-shorts-hide-channel',
            selectors: [
                '[tab-title="Shorts"]',
            ],
        },
        {
            id: 'watch',
            stateKey: 'shortsHideWatch',
            bodyClass: 'rt-shorts-hide-watch',
            selectors: [
                'ytd-watch-flexy ytd-reel-shelf-renderer',
                'ytd-watch-flexy ytd-compact-video-renderer:has(a[href*="/shorts/"])',
            ],
        },
    ];

    let observer = null;
    let counterTimer = null;
    let pendingCount = 0;
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
        activeSelector = active.length ? `:is(${active.join(',')})` : '';
    }

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
        const shortsId = getShortsVideoId();
        if (!shortsId) return;
        if (S.shortsOnVisit === 'redirect') {
            const watchUrl = `${location.origin}/watch?v=${encodeURIComponent(shortsId)}`;
            location.replace(watchUrl);
        } else {
            location.replace(`${location.origin}/`);
        }
    }

    function install() {
        if (!IS_YOUTUBE) return;
        injectStyle();
        apply();

        if (!observer) {
            observer = new MutationObserver(mutations => {
                if (!S.shortsBlockerEnabled) return;
                let total = 0;
                for (const m of mutations) {
                    for (const node of m.addedNodes) total += tallyAdditions(node);
                }
                if (total) bumpCounter(total);
            });
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                });
        }

    }

    return Object.freeze({ install, apply, onNavigate });
})();

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
        '#rt_settings_fab',
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
            el = mk('canvas', 'rt-rain-canvas', null, {
                id: CANVAS_ID,
                'aria-hidden': 'true',
            });
            nextHost.insertBefore(el, nextHost.firstChild || null);
        }
        if (el.dataset.rtRainBound !== 'true') {
            createRainCanvas({
                canvas: el,
                host: nextHost,
                targetSelector: TARGET_SELECTOR,
                targetKind: topbarTargetKind,
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
        if (currentFab) mountRainTubeButtons(S._statsFab, currentFab, S._settingsFab);
        TopbarTheme.apply();

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
        function cancel() { done(false); }

        const check = () => {
            try {
                if (scheduleId !== _qualityScheduleId) {
                    done(false);
                    return;
                }
                if (!S?.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) {
                    done(false);
                    return;
                }
                if (qualityControlsReady()) done(true);
            } catch {
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

        S._player = null;
        S._video = null;

        if (vid !== S.videoId) {
            clearQualityMemos();
        }
        S.videoId = vid;

        clearQualitySchedule();

        if (vid && S.qualityEnabled) scheduleQualityApply();
        StatsTracker.onNavigate();
        ShortsBlocker.onNavigate();
        ChromeRuntime.run(true);
        uiSync();
    }, 500);
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function boot() {
    const { panel, fab, statsFab, settingsFab, statsPanel } = buildPanel();
    S._fab = fab;
    S._statsFab = statsFab;
    S._settingsFab = settingsFab;
    mountRainTubeButtons(statsFab, fab, settingsFab);
    initDrag(panel, fab);
    initDrag(statsPanel, statsFab, { handleSelector: '#rt_stats_drag', fallbackW: 454, fallbackH: 380, snapToDevicePixels: true });
    bindEvents(panel, fab, statsFab, statsPanel);

    StatsTracker.install();
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

/* ── Entry ──────────────────────────────────────────────────────────────── */

// Direct /shorts/ visits redirect before full async boot can let playback start.
async function shortcutShortsVisit() {
    if (!IS_YOUTUBE) return false;
    const shortsId = getShortsVideoId();
    if (!shortsId) return false;
    try {
        const [enabled, rawOnVisit, statsEnabled, rawBuckets] = await Promise.all([
            readStoredValue(CFG.storage.shortsBlocker, DEFAULT_SETTINGS.shortsBlockerEnabled),
            readStoredValue(CFG.storage.shortsOnVisit, DEFAULT_SETTINGS.shortsOnVisit),
            readStoredValue(CFG.storage.statsEnabled, true),
            readStoredValue(CFG.storage.statsBuckets, null),
        ]);
        if (!enabled) return false;

        if (statsEnabled) {
            try {
                const buckets = sanitizeStatsBuckets(rawBuckets);
                const key = statsDateKey();
                const bucket = buckets[key] || (buckets[key] = {
                    shortsOpened: 0, shortsBlocked: 0, watchSec: 0,
                    videosWatched: 0, channelSec: {}, channelAvatar: {},
                });
                bucket.shortsOpened = (Number(bucket.shortsOpened) || 0) + 1;
                await StatsStore.setJson(CFG.storage.statsBuckets, buckets);
            } catch (err) {
                console.warn('[RainTube] Stats record on fast redirect failed:', err);
            }
        }

        const onVisit = readShortsOnVisit(rawOnVisit);
        const target = onVisit === 'redirect'
            ? `${location.origin}/watch?v=${encodeURIComponent(shortsId)}`
            : `${location.origin}/`;
        location.replace(target);
        return true;
    } catch (err) {
        console.warn('[RainTube] Shorts fast redirect failed:', err);
        return false;
    }
}

function waitForDocumentBody() {
    if (document.body) return Promise.resolve();
    return new Promise(resolve => {
        if (document.readyState !== 'loading' && document.body) return resolve();
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
}

// Intentional all-or-nothing startup: a missing/unreadable packaged resource
// stops RainTube so it never renders half-themed. Surface that as a desktop
// notification (clean, no DOM, no dependency on the assets that just failed),
// with the full diagnostic always logged in case the notification is blocked.
async function reportFatalStartupFailure(err) {
    const isResource = err instanceof RainTubeResourceError;
    const resource = isResource ? err.resource : null;
    const reason = isResource ? err.reason : (err?.message || String(err));

    console.error('[RainTube] Startup aborted — packaged resource unavailable:', {
        resource, reason, error: err,
    });

    const text = resource
        ? `Couldn't load "${resource}" (${reason}). Click to reload; reinstall if it persists.`
        : `Couldn't load a required asset (${reason}). Click to reload; reinstall if it persists.`;

    try {
        await GM.notification({
            title: "RainTube didn't start",
            text,
            onclick: () => { try { location.reload(); } catch { /* tab already gone */ } },
        });
    } catch (notifyErr) {
        // GM.notification unsupported or suppressed; the console error stands.
        console.warn('[RainTube] GM.notification unavailable for startup notice:', notifyErr);
    }
}

async function startRainTube() {
    if (IS_CNVMP3) {
        runCnvMp3Autofill();
        return;
    }

    if (!IS_YOUTUBE) return;

    if (await shortcutShortsVisit()) return;

    // Style injection is intentionally all-or-nothing. Convert its rejection
    // into a resolved value so the rest of startup settles cleanly (no
    // unhandled rejections) before we decide to abort with a visible notice.
    const [styleError, state] = await Promise.all([
        injectRainTubeStyles().then(() => null, err => err || new Error('style injection failed')),
        loadRuntimeState(),
        cleanupDeprecatedStorageKeys(),
        waitForDocumentBody(),
    ]);

    if (styleError) {
        await reportFatalStartupFailure(styleError);
        return;
    }

    S = state;
    boot();
}

startRainTube().catch(err => {
    console.error('[RainTube] Startup failed:', err);
});
