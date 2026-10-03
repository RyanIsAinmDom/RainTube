// ==UserScript==
// @name               RainTube — Customization, Shorts, Statistics, Quality & Private Downloads
// @description        Privacy-first YouTube helper: OLED pure-black theme, Shorts blocking, local usage statistics, automatic quality targeting, and Piped/Invidious proxied downloads.
// @namespace          https://github.com/RyanIsAinmDom/RainTube
// @version            1.20.226
// @author             RyanIsAinmDom — Created by hand with robust AI assistance
// @license            MIT
// @updateURL          https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.user.js
// @downloadURL        https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.user.js
// @icon               https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// @icon64             https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.svg
// The UI is built around the desktop www.youtube.com app (ytd-* elements), so
// don't run on the music/consent/accounts subdomains. The noframes rule only
// covers iframes; the live_chat exclude keeps the popped-out chat window (a
// top-level page) untouched.
// @match              https://www.youtube.com/*
// @match              https://*.cnvmp3.com/*
// @exclude            https://www.youtube.com/live_chat*
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
// @grant              GM.info

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
// managers refresh resources when the userscript itself updates, so any
// time CSS changes, bump @version AND mirror it in the rt= query below.
// The userscript manager keys resource cache off the URL string; a
// matching @version makes it impossible to forget the cache-bust.
// Keep the local RainTube.youtube.css file in sync with this URL.
// @resource           rtYouTubeCss https://raw.githubusercontent.com/RyanIsAinmDom/RainTube/refs/heads/main/RainTube.youtube.css?rt=1.20.226

// Piped/Invidious instances are discovered at runtime, so the only rule that
// covers them is the wildcard (which also makes per-domain entries redundant).
// @connect            *

// @run-at             document-start
// @compatible         chrome   Tampermonkey 4+
// @compatible         firefox  Greasemonkey 4.11+ / Tampermonkey / Violentmonkey
// @compatible         edge     Tampermonkey 4+
// ==/UserScript==

'use strict';

/*
   RainTube

   Structure:
     - YouTube pages get the RainTube panel, Shorts blocking, quality
       targeting, and private Piped/Invidious downloads.
     - CnvMP3 pages only run the lightweight fallback autofill path.
     - State is persisted through GM.setValue, reset through GM.deleteValue, and validated defensively on load.
     - Network, probes, and blob downloads use strict GM4 GM.xmlHttpRequest.
*/

const HOST = location.hostname.toLowerCase();
const IS_YOUTUBE = HOST === 'www.youtube.com';
const IS_CNVMP3 = HOST === 'cnvmp3.com' || HOST.endsWith('.cnvmp3.com');

// Single source of truth for the displayed version is the @version metadata
// line (keep the rt= query on the rtYouTubeCss @resource in step with it).
function readScriptVersion() {
    try { return String(GM.info.script.version || 'dev'); } catch { return 'dev'; }
}

const CFG = Object.freeze({
    version: readScriptVersion(),
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
    // Storage keys for the Statistics module. Every other persisted setting
    // declares its own key in SETTING_SPECS below. Stored through
    // GM.getValue/GM.setValue JSON strings so the module stays compatible
    // with Greasemonkey 4's Promise API.
    storage: {
        statsRange: 'rt_stats_range',
        statsEnabled: 'rt_stats_enabled',
        // Statistics display surface: collapsed draggable panel or above recommendations.
        statsDisplay: 'rt_stats_display',
        statsMetrics: 'rt_stats_metrics',
        statsBuckets: 'rt_stats_buckets',
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
    const valid = new Set([
        ...Object.values(CFG.storage),
        ...Object.values(SETTING_SPECS).map(spec => spec.storage),
    ]);
    const keys = await listStoredValues();
    await Promise.all(keys
        .filter(key => key.startsWith('rt_') && !valid.has(key))
        .map(deleteStoredValue));
}

// Every YouTube quality level, best → worst. The lookup tables below are all
// derived from this one list.
const QUALITY_TIERS = Object.freeze([
    { level: 'highres', height: 4320, label: '8K' },
    { level: 'hd2880', height: 2880, label: '5K' },
    { level: 'hd2160', height: 2160, label: '4K' },
    { level: 'hd1440', height: 1440, label: '1440p' },
    { level: 'hd1080', height: 1080, label: '1080p' },
    { level: 'hd720', height: 720, label: '720p' },
    { level: 'large', height: 480, label: '480p' },
    { level: 'medium', height: 360, label: '360p' },
    { level: 'small', height: 240, label: '240p' },
    { level: 'tiny', height: 144, label: '144p' },
]);
const QUALITY_ORDER = Object.freeze(QUALITY_TIERS.map(tier => tier.level));
const QUALITY_LABEL = Object.freeze(
    Object.fromEntries(QUALITY_TIERS.map(tier => [tier.level, tier.label])));
const QUALITY_HEIGHT = Object.freeze(
    Object.fromEntries(QUALITY_TIERS.map(tier => [tier.level, tier.height])));
const QUALITY_LEVEL_BY_HEIGHT = Object.freeze(
    Object.fromEntries(QUALITY_TIERS.map(tier => [tier.height, tier.level])));

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
    for (const tier of QUALITY_TIERS) {
        const diff = Math.abs(tier.height - raw);
        if (!closest || diff < closest.diff) closest = { level: tier.level, diff };
    }
    return closest && closest.diff <= 36 ? closest.level : `${raw}p`;
}

const QUALITY_READY_TIMEOUT_MS = 10_000;
const YT_MENUITEM_SELECTOR = '.ytp-menuitem, ytp-menuitem';
const YT_SETTINGS_MENUITEM_SELECTOR = '.ytp-settings-menu[data-layer] .ytp-menuitem, ytp-settings-menu ytp-menuitem';
const QUALITY_ROW_START_RE = /^\s*(?:(?:\d{3,4})\s*p(?:\d+)?|[458]\s*k)(?!\d)/i;
const QUALITY_SUPER_RESOLUTION_RE = /super[\s-]*resolution/i;
const QUALITY_PREMIUM_RE = /premium|enhanced\s*bitrate/i;
const PREMIUM_LOGO_SELECTOR = ':is(ytd-logo, ytd-yoodle-renderer)[is-red-logo]';

// NOTE: 1440p, 4K, 5K, and 8K are NOT gated by YouTube Premium. They are
// available to everyone when the source video has them. The only quality
// tier actually gated by Premium is "1080p Premium", a higher-bitrate
// 1080p variant at the same resolution. Its row carries the same
// .ytp-premium-label badge for members and non-members; for a non-member a
// click opens an upsell instead of playing it. Standard Greasemonkey cannot
// read the player's playability data (permission-denied Xray wrappers), so
// membership comes from the page instead: YouTube gives members the Premium
// wordmark and reflects it on the logo elements as is-red-logo (its name for
// the Premium logo). Premium rows are chosen only for such an account, and a
// click YouTube answers with an upsell anyway falls back to the standard row.
//
// YouTube also marks AI-upscaled entries as "Super resolution" in the same
// menu. Those are height-agnostic and evolving: YouTube's rollout started with
// below-1080p uploads being upscaled from SD to HD, with stated plans to support
// higher outputs later. Detect them by menu label, not by a hard-coded height.

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

const TOAST_DURATION_DEFAULT_MS = 4000; // on the slider's 0.5 s grid
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

function readEnumSetting(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

// Readers below are function declarations on purpose: SETTING_SPECS refers to
// them while the module is still initialising, so they must be hoisted.
function readShortsOnVisit(value) {
    return readEnumSetting(value, SHORTS_ON_VISIT_ORDER, 'redirect');
}

function readPrivateProvider(value) {
    return readEnumSetting(value, PRIVATE_PROVIDER_ORDER, 'both');
}

function readToastPlacementSetting(value) {
    return readEnumSetting(value, TOAST_PLACEMENT_ORDER, TOAST_PLACEMENT_DEFAULT);
}

function readRainQuantitySetting(value) {
    return readEnumSetting(value, RAIN_QUANTITY_ORDER, 'ultra');
}

function readToastDurationMs(value) {
    return Math.max(TOAST_DURATION_MIN_MS, Math.min(TOAST_DURATION_MAX_MS,
        parseInt(value, 10) || TOAST_DURATION_DEFAULT_MS));
}

// Number(null) and Number('') are 0, which would clamp a missing value to the
// lower bound instead of falling back to the default.
function readNumberOrNaN(value) {
    return value === null || value === '' || Array.isArray(value) ? NaN : Number(value);
}

function readRainFpsCap(value) {
    const fps = Math.round(readNumberOrNaN(value));
    if (!Number.isFinite(fps)) return RAIN_FPS_DEFAULT;
    return Math.max(RAIN_FPS_MIN, Math.min(RAIN_FPS_MAX, fps));
}

// Player glow strength in percent of YouTube's own ambient glow; 0 hides it.
const PLAYER_GLOW_MIN = 0;
const PLAYER_GLOW_MAX = 200;
const PLAYER_GLOW_STEP = 10;
const PLAYER_GLOW_DEFAULT = 100;

function readPlayerGlow(value) {
    const pct = Math.round(readNumberOrNaN(value) / PLAYER_GLOW_STEP) * PLAYER_GLOW_STEP;
    if (!Number.isFinite(pct)) return PLAYER_GLOW_DEFAULT;
    return Math.max(PLAYER_GLOW_MIN, Math.min(PLAYER_GLOW_MAX, pct));
}

function isLegacyHiddenPlacement(value) {
    return value === 'hide' || value === false;
}

const boolSetting = (storage, def) => ({
    storage, default: def, read: value => (typeof value === 'boolean' ? value : def),
});
const enumSetting = (storage, order, def) => ({
    storage, default: def, read: value => readEnumSetting(value, order, def),
});

// Single source of truth for every persisted setting: its storage key, its
// default, and a reader that turns whatever is in storage into a valid value.
// loadRuntimeState, setSetting, resetAllSettingsToDefaults and the stale-key
// cleanup are all driven from this table, so adding a setting means adding
// one entry here (plus its control in createSettingsSections).
//   read(raw, allRaw) — allRaw is the map of every raw stored value at load
//   time (undefined afterwards); only mainButtonVisible needs it.
//   missing — optional raw value to request from storage when the key is
//   absent, for settings that must tell "never saved" apart from a value.
const SETTING_SPECS = Object.freeze({
    shortsBlockerEnabled: boolSetting('rt_shorts_blocker_enabled', true),
    shortsOnVisit: { storage: 'rt_shorts_on_visit', default: 'redirect', read: readShortsOnVisit },
    // Per-surface toggles. The master toggle gates everything; each
    // per-surface toggle then enables or disables that specific area.
    // All default ON so the master toggle starts in a "blocks everywhere"
    // state matching the previous behaviour.
    shortsHideSidebar: boolSetting('rt_shorts_hide_sidebar', true),
    shortsHideHome: boolSetting('rt_shorts_hide_home', true),
    shortsHideSearch: boolSetting('rt_shorts_hide_search', true),
    shortsHideChannel: boolSetting('rt_shorts_hide_channel', true),
    shortsHideWatch: boolSetting('rt_shorts_hide_watch', true),
    // OLED pure-black theme. Off by default — it's an opinionated
    // change that only makes sense when YouTube is already in dark mode.
    oledThemeEnabled: boolSetting('rt_oled_theme_enabled', false),
    // Strength of YouTube's ambient-mode glow around the player, in percent
    // of its own. Hidden anyway while the OLED theme is on.
    playerGlow: { storage: 'rt_player_glow', default: PLAYER_GLOW_DEFAULT, read: readPlayerGlow },
    // RainTube-styled YouTube masthead. Off by default; when enabled it
    // deliberately keeps the top bar dark in every YouTube theme so the
    // rain/glow treatment has enough contrast.
    topbarThemeEnabled: boolSetting('rt_topbar_theme_enabled', false),
    qualityEnabled: boolSetting('rt_quality_enabled', true),
    qualityMax: enumSetting('rt_quality_max', QUALITY_ORDER, 'hd1080'),
    qualitySuperResolutionEnabled: boolSetting('rt_quality_super_resolution_enabled', false),
    privateDownloadsEnabled: boolSetting('rt_private_downloads_enabled', true),
    privateFallbackEnabled: boolSetting('rt_private_fallback_enabled', true),
    privateProvider: { storage: 'rt_private_provider', default: 'both', read: readPrivateProvider },
    privateDownloadTimeoutMs: {
        storage: 'rt_private_download_timeout_ms',
        default: CFG.api.downloadTimeout,
        read: readPrivateDownloadTimeoutMs,
    },
    buttonPlacement: {
        storage: 'rt_button_placement',
        default: BUTTON_PLACEMENT_DEFAULT,
        read: readButtonPlacement,
    },
    // Older builds stored Show/Hide in buttonPlacement; when this key was
    // never saved, inherit visibility from that legacy value.
    mainButtonVisible: {
        storage: 'rt_main_button_visible',
        default: true,
        missing: null,
        read: (value, allRaw) => readButtonVisible(value, !isLegacyHiddenPlacement(allRaw?.buttonPlacement)),
    },
    // Toast dismiss duration in ms, clamped to TOAST_DURATION_{MIN,MAX}_MS.
    toastDurationMs: { storage: 'rt_toast_duration_ms', default: TOAST_DURATION_DEFAULT_MS, read: readToastDurationMs },
    toastPlacement: { storage: 'rt_toast_placement', default: TOAST_PLACEMENT_DEFAULT, read: readToastPlacementSetting },
    rainQuantity: { storage: 'rt_rain_quantity', default: 'ultra', read: readRainQuantitySetting },
    rainFpsCap: { storage: 'rt_rain_fps_cap', default: RAIN_FPS_DEFAULT, read: readRainFpsCap },
    lightningEnabled: boolSetting('rt_lightning_enabled', true),
    // Dark storm clouds along the top of the panel and the top bar (they are part of the rain scene).
    cloudsEnabled: boolSetting('rt_clouds_enabled', true),
});

// Raw default value of every persisted setting (the wipe target for
// resetAllSettingsToDefaults).
const DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(
    Object.entries(SETTING_SPECS).map(([key, spec]) => [key, spec.default])));

// Validate `value`, store it on the live state object and persist it.
function setSetting(key, value) {
    const spec = SETTING_SPECS[key];
    S[key] = spec.read(value, S);
    void save(spec.storage, S[key]);
    return S[key];
}

const PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS = 60_000;
const PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS = 10 * 60_000;
const PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS = 30_000;

function readPrivateDownloadTimeoutMs(value) {
    const raw = Math.round(readNumberOrNaN(value));
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
    watchTime: { label: 'Watch time', icon: 'clock' },
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
// Each persist re-reads, merges and rewrites the whole (up to two-year)
// history, so keep the cadence low while watching. visibilitychange and
// pagehide still flush immediately, so at most this window is lost on a crash.
const STATS_PERSIST_DEBOUNCE_MS = 10_000;
const STATS_WATCH_TICK_MS = 1000;

function readStatsRange(value) {
    return readEnumSetting(value, STATS_RANGE_ORDER, 'daily');
}

function readStatsEnabled(value) {
    return typeof value === 'boolean' ? value : true;
}

function readStatsDisplay(value) {
    return readEnumSetting(value, STATS_DISPLAY_ORDER, 'panel');
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
        // Drop over-long URLs rather than truncating them into a broken one.
        if (url.protocol !== 'https:' || url.href.length > 600) return '';
        return url.href;
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

function emptyStatsBucket() {
    return { shortsOpened: 0, shortsBlocked: 0, watchSec: 0, videosWatched: 0, channelSec: {}, channelAvatar: {} };
}

// Add every count in `delta` onto `target` (both date → bucket maps). Never
// aliases delta's objects into target.
function mergeStatsBuckets(target, delta) {
    for (const [date, d] of Object.entries(delta)) {
        const b = target[date] || (target[date] = emptyStatsBucket());
        b.shortsOpened += d.shortsOpened;
        b.shortsBlocked += d.shortsBlocked;
        b.watchSec += d.watchSec;
        b.videosWatched += d.videosWatched;
        for (const [name, sec] of Object.entries(d.channelSec)) b.channelSec[name] = (b.channelSec[name] || 0) + sec;
        Object.assign(b.channelAvatar, d.channelAvatar);
    }
    return target;
}

// Drop buckets past retention, and keep each channel's avatar only in its
// newest bucket. Every range ends today, so any range that includes a channel
// also includes that channel's newest bucket — the summary still finds it.
function compactStatsBuckets(buckets) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STATS_BUCKET_RETENTION_DAYS);
    const cutoffKey = statsDateKey(cutoff);
    const seen = new Set();
    for (const key of Object.keys(buckets).sort().reverse()) {
        if (key < cutoffKey) {
            delete buckets[key];
            continue;
        }
        const avatars = buckets[key].channelAvatar;
        for (const name of Object.keys(avatars)) {
            if (seen.has(name)) delete avatars[name];
            else seen.add(name);
        }
    }
    return buckets;
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

let S = null;

async function loadRuntimeState() {
    // Fan out every persisted-setting read in parallel. GM.getValue calls
    // are independent, so awaiting them sequentially serialises startup
    // for no reason; running them all at once drops total wall-time to
    // roughly the slowest single read.
    const specs = Object.entries(SETTING_SPECS);
    const stored = await Promise.all(specs.map(([, spec]) =>
        readStoredValue(spec.storage, 'missing' in spec ? spec.missing : spec.default)));
    const allRaw = Object.fromEntries(specs.map(([key], i) => [key, stored[i]]));

    // Older builds stored "hidden" in buttonPlacement. Make that inherited
    // visibility explicit now, or changing Button placement later would
    // overwrite the only record of it and the button would reappear.
    if (allRaw.mainButtonVisible === null && isLegacyHiddenPlacement(allRaw.buttonPlacement)) {
        void save(SETTING_SPECS.mainButtonVisible.storage, false);
    }

    return {
        // ── Persisted settings (validated by each spec's reader) ──
        ...Object.fromEntries(specs.map(([key, spec]) => [key, spec.read(allRaw[key], allRaw)])),

        // ── Page / navigation ──
        videoId: null,

        // ── Download runtime ──
        downloading: false,
        privateCancelRequested: false,

        // ── UI / DOM handles ──
        _lastQualityTargetKey: null,
        _qualityGaveUpKey: null,
        _lastKnownQuality: null,
        // YouTube answered a Premium row with an upsell: the account shows the
        // Premium logo but can't play those rows. Kept for the page's lifetime.
        _premiumQualityRefused: false,
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
    if (text !== null && text !== undefined) el.appendChild(document.createTextNode(text));
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    }
    return el;
}

function injectUserStyle(css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
}

// RainTube.youtube.css is packaged as rtYouTubeCss and injected as a <style>
// tag. Bump @version whenever that resource changes so script managers refresh
// their cached copy.
const RT_YOUTUBE_CSS_RESOURCE = 'rtYouTubeCss';

// Greasemonkey 4 answers GM.getResourceUrl with a local data: or blob: URL, and
// its GM.xmlHttpRequest throws on those; Tampermonkey / Violentmonkey return a
// URL the request API can fetch. A local URL is read in place; null = not local
// or not readable (the caller then goes through gmRequest).
async function readLocalResourceText(url) {
    if (/^data:/i.test(url)) {
        const comma = url.indexOf(',');
        if (comma < 0) return null;
        const head = url.slice(5, comma);
        const body = url.slice(comma + 1);
        try {
            if (/;base64$/i.test(head)) {
                const bin = atob(decodeURIComponent(body));
                return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
            }
            return decodeURIComponent(body);
        } catch {
            return null;
        }
    }
    if (!/^blob:/i.test(url)) return null;
    try {
        const res = await fetch(url);
        if (res.ok) return await res.text();
    } catch {}
    // fetch can be refused by the page's CSP where XMLHttpRequest is not
    return new Promise(resolve => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.onload = () => resolve(xhr.responseText || null);
            xhr.onerror = () => resolve(null);
            xhr.send();
        } catch {
            resolve(null);
        }
    });
}

async function readTextResource(resourceName) {
    const url = await GM.getResourceUrl(resourceName);
    const local = await readLocalResourceText(url);
    if (local?.trim()) return local;
    const r = await gmRequest({
        method: 'GET',
        url,
        headers: { Accept: 'text/css, text/plain, */*' },
        responseType: 'text',
        timeout: CFG.api.metaTimeout,
    });

    if (!r.ok) {
        const reason = r.status ? `HTTP ${r.status}` : (r.reason || 'network');
        throw new Error(`RainTube resource ${resourceName} failed to load: ${reason}`);
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
    // document.title carries an unread-notification prefix like "(3) " and a
    // " - YouTube" suffix; strip both.
    return document.title?.replace(/^\(\d+\)\s*/, '').replace(/\s*[-|]\s*YouTube\s*$/i, '').trim() || '';
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

function hasPremiumLogo() {
    return !!document.querySelector(PREMIUM_LOGO_SELECTOR);
}

function premiumQualityAllowed() {
    return !S?._premiumQualityRefused && hasPremiumLogo();
}

// The logo part keeps a pick made before the masthead rendered from counting
// as handled once the account turns out to be a member.
function currentQualityTargetKey(target = S?.qualityMax) {
    const videoId = getVideoId();
    if (!videoId) return null;
    const quality = readEnumSetting(target, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    const sr = S?.qualitySuperResolutionEnabled ? 'sr1' : 'sr0';
    const pm = hasPremiumLogo() ? 'pm1' : 'pm0';
    return `${videoId}|${quality}|${sr}|${pm}`;
}

// "Handled" covers both a successful application and a target we gave up on
// (retry budget spent, or nothing eligible in the menu). Without the second
// case every tab focus / duplicate navigation event would start a fresh retry
// cycle for a video whose menu simply can't satisfy the target.
function qualityTargetAlreadyHandled(target = S?.qualityMax) {
    const targetKey = currentQualityTargetKey(target);
    return !!targetKey
        && (S?._lastQualityTargetKey === targetKey || S?._qualityGaveUpKey === targetKey);
}

function qualitySelectionStillWanted(level) {
    const requested = readEnumSetting(level, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    const current = readEnumSetting(S?.qualityMax, QUALITY_ORDER, DEFAULT_SETTINGS.qualityMax);
    return !!S?.qualityEnabled && requested === current;
}

function playerDomRoot() {
    return $player() || document;
}

function playerQuery(root, selector) {
    return root?.querySelector?.(selector) || null;
}

function playerQueryAll(root, selector) {
    return Array.from(root?.querySelectorAll?.(selector) || []);
}

function menuText(el) {
    if (!el) return '';

    // YouTube often renders newer quality badges as nested/ARIA-only labels.
    // Reading only textContent can turn a visible "1080p Super resolution"
    // row into plain "1080p", so collect the visible text plus nearby
    // accessibility labels before parsing.
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
    // YouTube's player menu usually updates synchronously, but yielding one
    // frame keeps us out of framework-internal timing details. Animation
    // frames never fire while the tab is hidden, so a short timer backs the
    // frame up; otherwise a tab hidden mid-flow would leave the settings popup
    // open with this promise pending forever.
    return new Promise(resolve => {
        let done = false;
        let timer = 0;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve();
        };
        requestAnimationFrame(finish);
        timer = setTimeout(finish, 250);
    });
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
    // YouTube has historically used .ytp-premium-label for quality badges.
    // Treat a Super resolution badge as its own variant before applying the
    // Premium skip rule, otherwise upscaled rows get filtered out.
    const isPremium = !isSuperResolution && (hasPremiumBadgeClass || textSaysPremium);
    const disabled = item.matches('[disabled], [aria-disabled="true"]')
        || item.classList.contains('ytp-disabled')
        || item.getAttribute('aria-hidden') === 'true';
    const level = qualityLevelFromHeight(height);
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

// Forget every per-video quality memo at once. Called whenever the context
// the memos describe is no longer valid (video changed, target setting
// changed, quality targeting toggled). The pair always travels together.
function clearQualityMemos() {
    setKnownQuality(null);
    S._lastQualityTargetKey = null;
    S._qualityGaveUpKey = null;
}

function pickQualityMenuOption(options, targetLevel, {
    includeSuperResolution = false,
    includePremium = false,
} = {}) {
    const targetHeight = qualityHeight(targetLevel);
    const eligible = options.filter(opt => {
        if (opt.disabled || opt.height <= 0) return false;
        if (opt.isPremium && !includePremium) return false;
        return includeSuperResolution || !opt.isSuperResolution;
    });

    // YouTube lists manual qualities best-first. Keep that order instead of
    // re-ranking same-height variants: when Super Resolution is enabled, the
    // menu's first eligible row is the row the user would naturally click.
    // The one exception is Premium: YouTube lists it before its standard row,
    // and if a menu ever doesn't, a member still gets the better bitrate.
    const bestAtOrBelow = eligible.find(opt => opt.height <= targetHeight);
    if (bestAtOrBelow) {
        return (includePremium && !bestAtOrBelow.isPremium
            && eligible.find(opt => opt.isPremium && opt.height === bestAtOrBelow.height))
            || bestAtOrBelow;
    }

    // If only higher qualities are exposed, choose the lowest eligible manual
    // option instead of leaving the player on Auto.
    return eligible[eligible.length - 1] || null;
}

function closeQualityMenu(root, settingsButton) {
    const backButton = playerQuery(root,
        '.ytp-settings-menu .ytp-panel-header button, ytp-settings-menu .ytp-panel-header button');
    if (backButton) clickMenuElement(backButton);
    if (isSettingsMenuOpen(settingsButton)) clickMenuElement(settingsButton);
}

// While RainTube drives YouTube's settings popup, a class on <html> makes the
// popup transparent (see the rt-quality-busy rule in the stylesheet) so the
// menu doesn't visibly flash open and shut on every video. The class is
// removed a beat after the popup closes so its own close transition is also
// hidden, and it can never stick: the caller clears it in a finally block.
let _qualityBusyTimer = 0;
function setQualityBusy(on) {
    const cls = document.documentElement.classList;
    clearTimeout(_qualityBusyTimer);
    _qualityBusyTimer = 0;
    if (on) cls.add('rt-quality-busy');
    else _qualityBusyTimer = setTimeout(() => cls.remove('rt-quality-busy'), 200);
}

// The player carries these classes while an ad is playing; the ad stream has
// its own (or no) quality menu, so targeting has to wait for the video.
function isAdShowing(root = playerDomRoot()) {
    return !!root?.classList
        && (root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting'));
}

async function selectQualityFromYouTubeMenu(level, { silent = false } = {}) {
    if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };

    // Background tabs don't lay out or animate the player; wait until visible.
    if (document.hidden) return { ok: false, reason: 'tab-hidden' };

    const root = playerDomRoot();
    if (isAdShowing(root)) return { ok: false, reason: 'ad-showing' };
    wakePlayerControls(root);

    const settingsButton = getQualitySettingsButton(root);
    if (!settingsButton) return { ok: false, reason: 'settings-button-missing' };

    // Avoid hijacking YouTube's settings menu while the user is using it.
    if (isSettingsMenuOpen(settingsButton)) return { ok: false, reason: 'settings-menu-already-open' };

    try {
        setQualityBusy(true);
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

        const pickOptions = {
            includeSuperResolution: !!S.qualitySuperResolutionEnabled,
            includePremium: premiumQualityAllowed(),
        };
        let choice = pickQualityMenuOption(options, level, pickOptions);
        if (!choice) return { ok: false, reason: 'target-quality-unavailable' };
        if (!qualitySelectionStillWanted(level)) return { ok: false, reason: 'quality-no-longer-current' };
        if (!clickMenuElement(choice.item)) return { ok: false, reason: 'quality-option-click-failed' };

        // A row YouTube plays closes the settings popup. A Premium row it
        // answers with an upsell instead returns before that, leaving the
        // quality list open: this account can't play Premium rows, so take
        // the standard row from the same list.
        if (choice.isPremium) {
            await afterYouTubeMenuClick();
            if (isSettingsMenuOpen(settingsButton)) {
                S._premiumQualityRefused = true;
                choice = pickQualityMenuOption(collectQualityMenuOptions(root), level,
                    { ...pickOptions, includePremium: false });
                if (!choice) return { ok: false, reason: 'target-quality-unavailable' };
                if (!clickMenuElement(choice.item)) return { ok: false, reason: 'quality-option-click-failed' };
            }
        }

        setKnownQuality(choice);
        if (!silent) toast(`Quality · ${choice.label}`, 'quality');
        return { ok: true, choice };
    } finally {
        try {
            closeQualityMenu(root, settingsButton);
        } finally {
            setQualityBusy(false);
        }
    }
}

// Failures that are worth another attempt: the menu wasn't ready yet, an ad
// was playing, or the user had the popup open. 'tab-hidden' is resumed by the
// visibilitychange listener instead of a timer.
const QUALITY_RETRY_REASONS = new Set([
    'ad-showing',
    'settings-button-missing',
    'settings-button-click-failed',
    'settings-menu-already-open',
    'settings-menu-did-not-open',
    'quality-row-missing',
    'quality-row-click-failed',
    'quality-options-missing',
    'quality-option-click-failed',
]);
const QUALITY_RETRY_DELAYS_MS = Object.freeze([700, 1_400, 2_500, 4_000, 6_000]);
const QUALITY_AD_POLL_MS = 1_500;
const QUALITY_AD_WAIT_MAX_MS = 120_000;

let _qualityRetryTimer = 0;
let _qualityRetryCount = 0;
let _qualityAdWaitSince = 0;

function clearQualityRetry() {
    clearTimeout(_qualityRetryTimer);
    _qualityRetryTimer = 0;
    _qualityRetryCount = 0;
    _qualityAdWaitSince = 0;
}

// Returns true when another attempt was scheduled.
function scheduleQualityRetry(reason) {
    if (!QUALITY_RETRY_REASONS.has(reason)) return false;
    if (!S.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) return false;

    let delay;
    if (reason === 'ad-showing') {
        // Ads don't count against the retry budget, but don't poll forever.
        if (!_qualityAdWaitSince) _qualityAdWaitSince = Date.now();
        if (Date.now() - _qualityAdWaitSince > QUALITY_AD_WAIT_MAX_MS) return false;
        delay = QUALITY_AD_POLL_MS;
    } else {
        if (_qualityRetryCount >= QUALITY_RETRY_DELAYS_MS.length) return false;
        delay = QUALITY_RETRY_DELAYS_MS[_qualityRetryCount++];
    }

    clearTimeout(_qualityRetryTimer);
    const scheduleId = _qualityScheduleId;
    _qualityRetryTimer = setTimeout(() => {
        _qualityRetryTimer = 0;
        // A newer schedule (navigation, setting change) supersedes this one.
        if (scheduleId !== _qualityScheduleId) return;
        if (!S.qualityEnabled || !getVideoId() || qualityTargetAlreadyHandled()) return;
        void applyBestQuality({ silent: false });
    }, delay);
    return true;
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
    // A navigation or settings change while the menu sequence was running
    // supersedes this run: it must not cancel or re-arm the newer schedule.
    const runId = _qualityScheduleId;

    const result = await selectQualityFromYouTubeMenu(target, { silent });
    const superseded = runId !== _qualityScheduleId;
    if (result?.ok) {
        if (targetKey) S._lastQualityTargetKey = targetKey;
        if (!superseded) clearQualitySchedule();
    } else {
        const quiet = ['settings-menu-already-open', 'quality-no-longer-current', 'ad-showing', 'tab-hidden'];
        if (!quiet.includes(result?.reason)) {
            console.debug('[RainTube] Quality targeting skipped:', {
                videoId: S.videoId || getVideoId() || null,
                target,
                result,
            });
        }
        if (!superseded) {
            const retrying = scheduleQualityRetry(result?.reason);
            // Out of options for this video (retry budget spent, or the menu
            // has nothing eligible): stop re-trying until the target changes.
            // A hidden tab or a superseded run isn't a real failure.
            if (!retrying && targetKey
                && !['tab-hidden', 'quality-no-longer-current'].includes(result?.reason)
                && S.videoId === getVideoId()) {
                S._qualityGaveUpKey = targetKey;
            }
        }
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
    if (typeof trackType === 'string') return trackType.toUpperCase() === 'ORIGINAL';

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

// Requests made on behalf of a private download can be aborted from the Stop
// button. GM.xmlHttpRequest returns an object/promise with abort() in
// Tampermonkey and Violentmonkey; other managers may not, in which case
// cancellation stays cooperative (see requestStopAfterCurrentRequest).
const cancelableAborts = new Set();
let privateAbortSupported = null;

function abortPrivateRequests() {
    const aborts = Array.from(cancelableAborts);
    cancelableAborts.clear();
    for (const abort of aborts) abort();
    return aborts.length;
}

/**
 * Strict GM4 request wrapper. Resolves (never rejects) with a normalised
 * result. `cancelable` requests register with abortPrivateRequests(); the
 * returned promise also carries an abort() of its own.
 *
 * Deliberately NOT `anonymous: true`: Tampermonkey implements that by
 * switching to fetch mode, where (in Chrome) `timeout` and `onprogress` stop
 * working, and both are load-bearing here (mirror timeouts, download progress
 * and the stall watchdog).
 */
function gmRequest({
    method = 'GET', url, headers = {}, responseType = 'text', timeout, onprogress,
    cancelable = false,
}) {
    let handle = null;
    let settleAbort = null;
    const promise = new Promise(resolve => {
        let settled = false;
        let unregister = null;
        const finish = result => {
            if (settled) return;
            settled = true;
            unregister?.();
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

            // A manager can deliver a progress event after the request has
            // already settled (or been aborted); don't let it reach the UI.
            if (typeof onprogress === 'function') {
                details.onprogress = e => { if (!settled) onprogress(e); };
            }
            // An abort settles the wrapper itself rather than waiting for the
            // manager's onabort, so Stop and the stall watchdog can never
            // leave a job hanging on a manager that cancels silently.
            settleAbort = () => finish({ ok: false, reason: 'abort' });
            handle = GM.xmlHttpRequest(details);
            // Tampermonkey's return value is a promise that can reject on
            // error/abort; the callbacks above already cover those outcomes.
            handle?.then?.(undefined, () => {});
            if (cancelable) {
                privateAbortSupported = typeof handle?.abort === 'function';
                if (privateAbortSupported) {
                    const abort = () => {
                        try { handle.abort(); } catch {}
                        settleAbort();
                    };
                    cancelableAborts.add(abort);
                    unregister = () => cancelableAborts.delete(abort);
                }
            }
        } catch (err) {
            finish({ ok: false, reason: 'throw', error: err });
        }
    });
    promise.abort = () => {
        try { handle?.abort?.(); } catch {}
        settleAbort?.();
    };
    return promise;
}

async function fetchJson(url, timeout) {
    const r = await gmRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        responseType: 'json',
        timeout,
        cancelable: true,
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
        cancelable: true,
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
 * Probe provider stream endpoints across one batch concurrently and resolve as
 * soon as the first mirror returns usable streams (or every mirror has
 * failed), instead of waiting for the slowest mirror's timeout. The returned
 * `race` object stays live: `winners` (in order of arrival, i.e. metadata
 * response time) and `failed` keep filling as stragglers finish, `done` flips
 * once every mirror has answered, and `changed()` returns a promise that
 * settles on the next update so the download job can fall back to a late
 * winner without polling.
 */
function raceStreamsRequest(videoId, instances, mode, provider) {
    const race = { provider, winners: [], failed: [], cancelled: false, done: false };
    let wake = null;
    race.changed = () => new Promise(resolve => { wake = resolve; });
    const notify = () => {
        const resolveChanged = wake;
        wake = null;
        resolveChanged?.();
    };

    if (!instances.length) {
        race.done = true;
        return Promise.resolve(race);
    }

    const probe = async instance => {
        const startedAt = performance.now();
        const url = provider.streamUrl(instance, videoId);
        const r = await gmRequest({
            method: 'GET',
            url,
            headers: provider.headers,
            responseType: 'json',
            timeout: CFG.api.streamsTimeout,
            cancelable: true,
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
    };

    return new Promise(resolve => {
        let pending = instances.length;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            resolve(race);
        };

        for (const instance of instances) {
            probe(instance)
                // A provider whose payload can't be normalised must not sink
                // the whole batch.
                .catch(err => ({
                    provider: provider.id, instance, status: null, reason: 'throw',
                    message: String(err?.message || err), killedHost: false,
                }))
                .then(result => {
                    if (result.cancelled) {
                        race.cancelled = true;
                    } else if (result.winner) {
                        const { winner, ...entry } = result;
                        race.winners.push(entry);
                        release();
                    } else {
                        race.failed.push(result);
                    }
                    if (--pending === 0) {
                        race.done = true;
                        release();
                    }
                    notify();
                });
        }
    });
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

// Pending delayed reset from resetProgress(). Any new progress update cancels
// it, otherwise the previous download's "reset in 2.4 s" would blank the next
// download's progress bar while it is still checking mirrors.
let _progressResetTimer = 0;

function setProgress(pct, label, meta, state = 'active') {
    clearTimeout(_progressResetTimer);
    _progressResetTimer = 0;
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
    clearTimeout(_progressResetTimer);
    _progressResetTimer = 0;
    if (delay > 0) _progressResetTimer = setTimeout(() => { _progressResetTimer = 0; run(); }, delay);
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
    if (S.privateCancelRequested) return;
    S.privateCancelRequested = true;
    // Managers that hand back an abort handle stop right away; on the rest,
    // the in-flight request has to finish or time out before the job notices.
    // (Nothing in flight, e.g. between mirrors, still stops at the next check.)
    if (abortPrivateRequests() > 0 || privateAbortSupported === true) {
        toast('Stopping download…', 'warn');
        setProgress(NaN, 'Stopping download…', '', 'active');
    } else {
        toast('Stopping after current request…', 'warn');
        setProgress(NaN, 'Stopping after current request…', 'This userscript manager can\'t cancel a request in flight, so it will complete or time out first.', 'active');
    }
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
            cancelable: true,
        });
        // Stop aborts the HEAD; don't answer that by starting the ranged GET.
        if (isPrivateCancelled()) {
            return { ok: false, total: 0, status: null, contentType: '', reason: 'cancel' };
        }
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
            cancelable: true,
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

// Where the manager can abort requests, the configured "Request timeout" is a
// stall limit (no bytes for that long) and the transfer itself may run far
// longer, so a big file on a moderate connection isn't cut off mid-download.
// Elsewhere it stays the total per-request limit.
const PRIVATE_DOWNLOAD_HARD_LIMIT_MS = 60 * 60_000;

async function downloadUrlWithProgress(url, filename, btn, sourceLabel) {
    if (!url) return { ok: false, reason: 'missing-url' };

    const startedAt = performance.now();
    let lastLoaded = 0;
    let lastAt = startedAt;
    let lastProgressAt = startedAt;
    let bestRate = 0;
    let lastRate = 0;
    let stalled = false;
    let stallWatch = 0;

    const timeoutMs = readPrivateDownloadTimeoutMs(S.privateDownloadTimeoutMs);
    const stallWatchdog = privateAbortSupported === true;

    try {
        const request = gmRequest({
            method: 'GET',
            url,
            // Preserve Invidious/Piped proxy behaviour that performs better
            // with an explicit open-ended range while still requesting the
            // whole resource.
            headers: { Range: 'bytes=0-' },
            responseType: 'blob',
            timeout: stallWatchdog ? PRIVATE_DOWNLOAD_HARD_LIMIT_MS : timeoutMs,
            cancelable: true,
            onprogress(e) {
                const now = performance.now();
                const loaded = Number(e.loaded || 0);
                // Progress means new bytes, not merely another event.
                if (loaded > lastLoaded) lastProgressAt = now;
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
                if (S.privateCancelRequested) {
                    setProgress(pct,
                        privateAbortSupported ? 'Stopping download…' : 'Stopping after current request…',
                        privateAbortSupported ? label : `Can't cancel in flight · ${label}`,
                        'active');
                } else {
                    setBtnProgress(btn, pct, label);
                }
            },
        });

        if (stallWatchdog) {
            stallWatch = setInterval(() => {
                if (performance.now() - lastProgressAt < timeoutMs) return;
                stalled = true;
                clearInterval(stallWatch);
                request.abort();
            }, 1_000);
        }

        const response = await request;

        if (isPrivateCancelled()) {
            return { ok: false, reason: 'cancel', bestRate };
        }

        // (A download that finished in the same instant the watchdog fired is kept.)
        if (stalled && !response.ok) return { ok: false, reason: 'stalled', status: response.status };

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
    } finally {
        clearInterval(stallWatch);
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
            // Cheap checks first: isVisible() forces layout + computed style,
            // which is far too costly to run on every element of the page.
            // An option is a small element, so skip big containers outright.
            if (el.childElementCount > 3) continue;
            if (normalizedText(el).toUpperCase() !== target) continue;
            if (el === trigger || trigger.contains(el) || el.contains(trigger)) continue;
            if (el.querySelector('img')) continue;
            if (isVisible(el)) return el;
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
    if (values === null) {
        return null; // cancelled
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

// instances.json lists [domain, meta] pairs; tolerate a bare meta object too.
function invidiousInstanceMeta(entry) {
    return Array.isArray(entry) ? entry[1] : entry;
}

function isUsableInvidiousInstance(entry) {
    const meta = invidiousInstanceMeta(entry);
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
        const url = normalizeBaseUrl(invidiousInstanceMeta(entry).uri);
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
        title: data.title,
        videoStreams: formatStreams.map(stream => mapStream(stream, { videoOnly: false })),
        audioStreams: adaptiveFormats
            .filter(stream => isAudio(stream) && !isVideo(stream))
            .map(stream => mapStream(stream)),
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

            let result = await this.tryProviders();
            // A Stop that raced the last check must not fall through to the
            // CnvMP3 fallback tab.
            if (this.isCancelled() && result !== 'success') result = 'cancelled';
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

        const race = await raceStreamsRequest(this.videoId, batch, this.mode, provider);
        let recordedFailures = 0;
        const recordNewFailures = () => {
            this.recordRaceFailures(race.failed.slice(recordedFailures));
            recordedFailures = race.failed.length;
        };

        // The race resolves on the first usable mirror; slower mirrors keep
        // reporting into race.winners while earlier ones are being tried.
        let next = 0;
        for (;;) {
            if (race.cancelled || this.isCancelled()) return 'cancelled';
            while (next < race.winners.length) {
                const result = await this.tryRaceWinner(provider, race.winners[next++]);
                if (result === 'success' || result === 'cancelled') return result;
                if (race.cancelled || this.isCancelled()) return 'cancelled';
            }
            if (race.done) break;
            // Every known winner failed; wait for the next mirror to report.
            // (No await between the checks above and changed(), so no update
            // can slip through unnoticed.)
            await race.changed();
        }

        // Every mirror in this batch either failed metadata probing or failed
        // its usable media candidates. Only now advance to the next batch.
        recordNewFailures();
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
            // A mirror that stalled won't serve its other streams any faster;
            // move on rather than waiting out the timeout again per stream.
            if (result === 'stalled') break;
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

        if (result.reason === 'stalled') return 'stalled';

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
        const MatrixCtor = window.DOMMatrixReadOnly || window.DOMMatrix;
        if (!MatrixCtor) return 1;
        const matrix = new MatrixCtor(transform);
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
        el = mk('div', null, null, { id: 'rt_toasts', role: 'status', 'aria-live': 'polite' });
        target.appendChild(el);
    }

    const all = Array.from(document.querySelectorAll('#rt_toasts'));
    for (const existing of all) {
        if (existing === el) continue;
        while (existing.firstChild) el.appendChild(existing.firstChild);
        existing.remove();
    }
    return el;
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
    if (meta.label) header.appendChild(mk('span', 'rt-toast-kind', meta.label));
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
    // Position before the first style pass: a position set a frame later
    // would make the stack glide in from the stylesheet's default corner.
    syncToastPosition(container);

    // Force reflow so the animation starts from 0.
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
    const revealPending = _tooltipShowRaf !== 0;
    clearTooltipShowCue();
    const nativeStyle = tip.classList.contains('rt-tip-native');
    const wasShown = tip.classList.contains('show');
    // Scroll/resize call this constantly; do nothing when nothing is showing.
    if (!wasShown && !revealPending && !_tooltipCleanupTimer) return;
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
        // Capture: scroll doesn't bubble, so this also covers scrolling
        // inside the settings modal, not just the page.
        window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
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

const RT_ICONS = Object.freeze({
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
});


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
        range: 'daily',
        defaultRange: 'daily',
        display: 'panel',
        metrics: { ...STATS_METRICS_DEFAULTS },
        buckets: {},
    };

    // Counts recorded since the last persist, in bucket shape. Persisting
    // re-reads storage and adds this delta, so other tabs' writes (and a
    // "Clear all" from another tab) are never overwritten by a stale copy.
    let pending = {};
    // Serializes load, persists and clears so they never interleave.
    let storageChain = Promise.resolve();
    let persistTimer = 0;
    let renderRaf = 0;
    let activeVideo = null;
    let watchTimer = 0;
    let lastWatchTickMs = 0;
    // Sub-second watch time carried to the next tick, so only whole seconds
    // are recorded and nothing is lost to rounding when storage is re-read.
    let watchCarrySec = 0;
    let currentChannelName = '';
    let currentChannelAvatar = '';
    let currentOpenKey = null;
    let attachRaf = 0;
    let inlineMountRaf = 0;
    const attachedVideos = new WeakSet();
    let inlineRetryTimers = [];
    let favoriteChannelIndex = 0;

    function clearInlineRetryTimers() {
        for (const timer of inlineRetryTimers) clearTimeout(timer);
        inlineRetryTimers = [];
    }

    const getRange = () => state.defaultRange;
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

    // Apply one change to today's bucket in both the displayed totals and the
    // unsaved delta, then schedule a render and a persist.
    function record(apply) {
        const date = statsDateKey();
        apply(state.buckets[date] || (state.buckets[date] = emptyStatsBucket()));
        apply(pending[date] || (pending[date] = emptyStatsBucket()));
        scheduleRender();
        if (!persistTimer) persistTimer = setTimeout(() => { void flush(); }, STATS_PERSIST_DEBOUNCE_MS);
    }

    function enqueue(task) {
        storageChain = storageChain.then(task).catch(err => {
            console.warn('[RainTube] Statistics storage failed:', err);
        });
        return storageChain;
    }

    function scheduleRender() {
        if (renderRaf) return;
        renderRaf = requestAnimationFrame(() => {
            renderRaf = 0;
            renderStatsPanelSlot();
            renderInlineCard();
        });
    }

    async function persistPending() {
        if (!Object.keys(pending).length) return;
        const delta = pending;
        pending = {};
        const stored = await StatsStore.getJson(CFG.storage.statsBuckets, null);
        const merged = compactStatsBuckets(mergeStatsBuckets(sanitizeStatsBuckets(stored), delta));
        await StatsStore.setJson(CFG.storage.statsBuckets, merged);
        // Adopt the merged totals (which include other tabs' activity), plus
        // anything recorded while this write was in flight.
        state.buckets = mergeStatsBuckets(merged, pending);
        scheduleRender();
    }

    function flush() {
        if (persistTimer) {
            clearTimeout(persistTimer);
            persistTimer = 0;
        }
        return enqueue(persistPending);
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
        if (!getEnabled() || !count) return;
        record(b => { b.shortsBlocked += count; });
    }

    function currentOpenFromRoute() {
        const shortsId = getShortsVideoId();
        if (shortsId) return { type: 'shorts', id: shortsId, key: `shorts:${shortsId}` };
        const videoId = getVideoId();
        if (videoId) return { type: 'video', id: videoId, key: `video:${videoId}` };
        return null;
    }

    function recordOpen(open) {
        if (!open || !getEnabled()) return;
        const field = open.type === 'shorts' ? 'shortsOpened' : 'videosWatched';
        record(b => { b[field] += 1; });
    }

    // `final` is the tick taken as timing stops (pause, end, tab hidden,
    // navigation): the video was playing up to that moment, so the partial
    // second since the previous tick counts even though it is paused now.
    function tickWatchTime(final = false) {
        if (!activeVideo || !lastWatchTickMs) return;
        const now = Date.now();
        const elapsed = (now - lastWatchTickMs) / 1000;
        lastWatchTickMs = now;
        if (!getEnabled()) return;
        if (!final && (document.hidden || activeVideo.paused || activeVideo.ended)) return;
        // Ad playback isn't time spent watching this channel's video.
        if (isAdShowing()) return;
        // getVideoId() handles both /watch?v=... and /shorts/... URLs, so
        // Shorts and full videos contribute to the same overall watch-time total.
        if (!getVideoId()) return;

        watchCarrySec += Math.max(0, Math.min(elapsed, (STATS_WATCH_TICK_MS / 1000) + 1));
        const sec = Math.floor(watchCarrySec);
        if (!sec) return;
        watchCarrySec -= sec;

        // Favorite channel is based on watched seconds, not opens. We only
        // re-query the DOM when we don't already have a name or avatar —
        // once metadata has been captured for the current video it doesn't
        // change, and avoiding the per-second querySelector sweep is a
        // meaningful saving across a long watch session.
        if (!currentChannelName) currentChannelName = getVideoAuthor();
        if (!currentChannelAvatar) currentChannelAvatar = readChannelAvatar();
        const channel = currentChannelName;
        const avatar = currentChannelAvatar;
        record(b => {
            b.watchSec += sec;
            if (!channel) return;
            b.channelSec[channel] = (b.channelSec[channel] || 0) + sec;
            if (avatar) b.channelAvatar[channel] = avatar;
        });
    }

    function startWatch(video) {
        if (!getEnabled() || !video || document.hidden) return;
        if (activeVideo && activeVideo !== video) stopWatch(activeVideo);
        // Re-read on every call: right after an SPA navigation YouTube can
        // still be showing the previous video's channel.
        currentChannelName = getVideoAuthor();
        currentChannelAvatar = readChannelAvatar();
        // Already timing this video ('play' + 'playing', and the attach
        // retries after each navigation): keep the tick baseline, or the time
        // since the last tick would be thrown away on every repeat call.
        if (activeVideo === video) return;
        activeVideo = video;
        lastWatchTickMs = Date.now();
        watchTimer = setInterval(tickWatchTime, STATS_WATCH_TICK_MS);
    }

    function stopWatch(video = activeVideo) {
        if (video && activeVideo && video !== activeVideo) return;
        if (watchTimer) {
            tickWatchTime(true);
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
        // $video() prefers the player's own <video>, so a hover-preview
        // element elsewhere in the DOM can't be picked up first.
        const video = $video();
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

        return {
            shortsOpened: Math.round(shortsOpened),
            shortsBlocked: Math.round(shortsBlocked),
            watchSec: Math.round(watchSec),
            videosWatched: Math.round(videosWatched),
            topFavoriteChannels,
        };
    }

    function stopStatsControlPropagation(event) {
        event.stopPropagation();
    }

    function metricDisplayValue(key, totals) {
        if (key === 'watchTime') return formatStatsDuration(totals.watchSec);
        if (key === 'videosWatched') return formatStatsCount(totals.videosWatched);
        if (key === 'shortsOpened') return formatStatsCount(totals.shortsOpened);
        if (key === 'shortsBlocked') return formatStatsCount(totals.shortsBlocked);
        // Unreachable in practice: callers filter favoriteChannel out beforehand,
        // and every other key in STATS_METRICS_ORDER is handled above. The empty
        // string makes a missing branch visibly broken rather than silently zero.
        return '';
    }

    function makeFavoriteChannelTrophy(rank) {
        if (rank < 1 || rank > 3) return null;
        const label = rank === 1 ? 'Gold trophy'
            : rank === 2 ? 'Silver trophy' : 'Copper trophy';
        const trophy = mk('span', `rt-stat-channel-rank rt-stat-channel-rank-${rank}`, null, { title: label });
        trophy.appendChild(RT_ICONS.trophy());
        return trophy;
    }

    // Both stats pickers (time range, favorite-channel rank) open a small menu
    // portaled onto <body>; everything they share lives in the helpers below.
    // `host` is the element that owns the picker and the menu's home (the
    // range wrapper, or the favorite-channel tile).
    const POPUPS = Object.freeze({
        range: {
            picker: '.rt-stats-range-picker',
            menu: '.rt-stats-range-menu',
            item: '.rt-stats-range-item',
            align: 'left',
        },
        channel: {
            picker: '.rt-stat-channel-picker',
            menu: '.rt-stat-channel-menu',
            item: '.rt-stat-channel-menu-item',
            align: 'right',
        },
    });

    // Move a portaled menu back to its home element and hide it. Returning it
    // keeps host-relative lookups working for the build/sync code.
    function hidePopupMenu(menu) {
        if (!menu) return;
        menu.hidden = true;
        menu.style.display = 'none';
        const home = menu._rtHome;
        if (home && menu.parentNode !== home) home.appendChild(menu);
    }

    function closePopupMenus(kind) {
        const { picker, menu } = POPUPS[kind];
        for (const button of document.querySelectorAll(`${picker}[aria-expanded="true"]`)) {
            button.setAttribute('aria-expanded', 'false');
        }
        // Menus may be portaled onto document.body while open, so search the
        // whole document.
        for (const el of document.querySelectorAll(menu)) hidePopupMenu(el);
    }

    // Arrow-key roving focus shared by both stats menus (their children are
    // all menu items).
    function focusMenuSibling(item, direction) {
        const items = Array.from(item.parentElement.children);
        items[(items.indexOf(item) + direction + items.length) % items.length].focus();
    }

    function setPopupMenuOpen(kind, host, open, { focusSelected = false } = {}) {
        const { picker, menu: menuSelector, item, align } = POPUPS[kind];
        const button = host.querySelector(picker);
        // The menu is portaled to document.body while open, so it is tracked
        // by reference, not by query.
        const menu = host._rtMenu || host.querySelector(menuSelector);
        if (!button || !menu) return;
        if (open) closePopupMenus(kind);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');

        if (!open) {
            hidePopupMenu(menu);
            return;
        }

        // Portal the menu onto document.body so it escapes #rt_panel's
        // backdrop-filter subtree. A backdrop-filter ancestor clips the
        // background fill of its descendants; with the menu reparented to the
        // body it no longer has that ancestor, so its fill paints solidly even
        // where the menu overhangs the stats card. Positioned with fixed
        // coords derived from the picker's viewport rect.
        menu._rtHome = host;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.hidden = false;
        menu.style.display = '';

        // Measure after it's visible (it sizes to content, < the max-width cap).
        const btnRect = button.getBoundingClientRect();
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const margin = 8;
        // Line the menu up with the picker's left or right edge.
        const preferredLeft = align === 'right' ? btnRect.right - menuWidth : btnRect.left;
        const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - menuWidth - margin));
        // Drop below the picker; flip above if it would overflow the viewport.
        let top = btnRect.bottom + 4;
        if (top + menuHeight > window.innerHeight - margin) {
            const above = btnRect.top - 4 - menuHeight;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - menuHeight - margin);
        }
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;

        if (focusSelected) {
            (menu.querySelector(`${item}[aria-checked="true"]`) || menu.querySelector(item))?.focus();
        }
    }

    function bindPopupPicker(kind, button, host) {
        button.onpointerdown = stopStatsControlPropagation;
        button.onclick = event => {
            event.stopPropagation();
            setPopupMenuOpen(kind, host, button.getAttribute('aria-expanded') !== 'true');
        };
        button.onkeydown = event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setPopupMenuOpen(kind, host, false);
                return;
            }
            if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            setPopupMenuOpen(kind, host, true, { focusSelected: true });
        };
    }

    function bindPopupItem(kind, host, item, choose) {
        item.onpointerdown = stopStatsControlPropagation;
        item.onclick = event => {
            event.stopPropagation();
            choose();
        };
        item.onkeydown = event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                focusMenuSibling(item, event.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (!['Escape', 'Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') setPopupMenuOpen(kind, host, false);
            else choose();
            // The menu just closed under the focused item; hand focus back
            // to the picker instead of dropping it to <body>.
            host.querySelector(POPUPS[kind].picker)?.focus();
        };
    }

    const closeFavoriteChannelMenus = () => closePopupMenus('channel');
    const closeStatsRangeMenus = () => closePopupMenus('range');

    function chooseFavoriteChannel(tile, index) {
        favoriteChannelIndex = index;
        setPopupMenuOpen('channel', tile, false);
        scheduleRender();
    }

    function buildFavoriteChannelMenuItem(tile, index) {
        const item = mk('button', 'rt-stat-channel-menu-item', null, {
            type: 'button',
            role: 'menuitemradio',
            tabindex: '-1',
            'aria-checked': 'false',
        });
        item.append(
            mk('span', 'rt-stat-channel-menu-rank', `#${index + 1}`),
            mk('span', 'rt-stat-channel-menu-name'),
            mk('span', 'rt-stat-channel-menu-time'));
        bindPopupItem('channel', tile, item, () => chooseFavoriteChannel(tile, index));
        return item;
    }

    function syncFavoriteChannelPicker(tile, topChannels, selectedIndex) {
        // Picker mounts directly into the tile and rides at the right edge
        // of the flex row — alongside avatar and copy.
        let button = tile.querySelector('.rt-stat-channel-picker');
        // The menu is portaled to document.body while open (to escape the
        // panel's backdrop-filter), so it is tracked by reference, not query.
        let menu = tile._rtMenu;

        if (topChannels.length <= 1) {
            button?.remove();
            menu?.remove();
            tile._rtMenu = null;
            return;
        }

        if (!button) {
            button = mk('span', 'rt-stat-channel-picker', null, {
                role: 'button',
                tabindex: '0',
                'aria-haspopup': 'menu',
                'aria-expanded': 'false',
                'aria-label': 'Choose favorite channel rank',
            });
            button.append(
                mk('span', 'rt-stat-channel-picker-label'),
                mk('span', 'rt-stat-channel-picker-caret', null, { 'aria-hidden': 'true' }));
            bindPopupPicker('channel', button, tile);
            tile.appendChild(button);
        }
        if (!menu) {
            menu = mk('div', 'rt-stat-channel-menu', null, { role: 'menu' });
            menu.hidden = true;
            menu.style.display = 'none';
            menu._rtHome = tile;
            tile._rtMenu = menu;
            tile.appendChild(menu);
        }

        const selected = topChannels[selectedIndex];
        button.querySelector('.rt-stat-channel-picker-label').textContent = `#${selected.rank}`;
        button.title = selected.name;

        // Items are patched in place so an open menu keeps its focus and
        // position while stats refresh underneath it.
        if (menu.children.length !== topChannels.length) {
            menu.replaceChildren(...topChannels.map((_, index) => buildFavoriteChannelMenuItem(tile, index)));
            if (button.getAttribute('aria-expanded') === 'true') setPopupMenuOpen('channel', tile, true);
        }
        topChannels.forEach((channel, index) => {
            const [, name, time] = menu.children[index].children;
            menu.children[index].setAttribute('aria-checked', index === selectedIndex ? 'true' : 'false');
            name.textContent = channel.name;
            time.textContent = formatStatsDuration(channel.sec);
        });
    }

    function renderFavoriteChannel(tile, channel) {
        // Trophy lives inside the avatar wrapper as a corner badge. Rebuilt
        // only when the picture or rank changes, so the <img> isn't
        // re-created (and re-requested) on every refresh.
        const avatar = tile.querySelector('.rt-stat-channel-avatar');
        const avatarKey = channel ? `${channel.rank}|${channel.avatar}` : '';
        if (avatar._rtKey !== avatarKey) {
            avatar._rtKey = avatarKey;
            avatar.replaceChildren(channel?.avatar
                ? mk('img', null, null, { referrerpolicy: 'no-referrer', src: channel.avatar, alt: '' })
                : RT_ICONS.star());
            const trophy = channel ? makeFavoriteChannelTrophy(channel.rank) : null;
            if (trophy) avatar.appendChild(trophy);
        }

        tile.querySelector('.rt-stat-channel-name').textContent = channel?.name || '—';
        tile.querySelector('.rt-stat-channel-sub').textContent = channel?.sec
            ? `· ${formatStatsDuration(channel.sec)} watched` : '';
    }

    function syncFavoriteChannelTile(tile, totals) {
        const topChannels = totals.topFavoriteChannels;
        const selectedIndex = Math.max(0, Math.min(favoriteChannelIndex, topChannels.length - 1));
        favoriteChannelIndex = selectedIndex;
        // Skip all DOM work while nothing this tile shows has changed — the
        // stats card refreshes every second during playback.
        const key = JSON.stringify([selectedIndex,
            topChannels.map(c => [c.name, formatStatsDuration(c.sec), c.avatar])]);
        if (tile._rtChannelKey === key) return;
        tile._rtChannelKey = key;
        syncFavoriteChannelPicker(tile, topChannels, selectedIndex);
        renderFavoriteChannel(tile, topChannels[selectedIndex] || null);
    }

    function buildMetricTile(key, totals) {
        const info = STATS_METRIC_INFO[key];
        const tile = mk('div', `rt-stat-tile rt-stat-tile-${key}`);
        tile.dataset.metricKey = key;

        if (key === 'favoriteChannel') {
            const avatar = mk('span', 'rt-stat-channel-avatar');
            tile.appendChild(avatar);

            const channelCopy = mk('div', 'rt-stat-channel-copy');
            const head = mk('div', 'rt-stat-head');
            const ico = mk('span', 'rt-stat-ico');
            const iconFn = RT_ICONS[info.icon];
            if (typeof iconFn === 'function') ico.appendChild(iconFn());
            head.appendChild(ico);
            head.appendChild(mk('span', 'rt-stat-name', info.label));
            // Inline watch-time pill so the channel's read-out lives on the
            // eyebrow row instead of taking its own line below the name.
            head.appendChild(mk('span', 'rt-stat-channel-sub'));
            channelCopy.appendChild(head);
            channelCopy.appendChild(mk('strong', 'rt-stat-tile-val rt-stat-channel-name', '—'));
            tile.appendChild(channelCopy);
            // Picker (rank pill) is appended in-place by syncFavoriteChannelPicker
            // when there are 2+ channels to choose from.

            tile.classList.add('rt-stat-tile-channel');
            syncFavoriteChannelTile(tile, totals);
            return tile;
        }

        // Stacked column layout: icon on top, two-line label below,
        // value at the bottom. Glow emanates from the icon's position
        // at the top-left of each tile.
        const ico = mk('span', 'rt-stat-ico');
        const iconFn = RT_ICONS[info.icon];
        if (typeof iconFn === 'function') ico.appendChild(iconFn());
        tile.appendChild(ico);
        tile.appendChild(mk('span', 'rt-stat-name', info.label));
        tile.appendChild(mk('strong', 'rt-stat-tile-val', metricDisplayValue(key, totals)));
        return tile;
    }

    function patchMetricTile(tile, key, totals) {
        if (!tile || tile.dataset.metricKey !== key) return false;
        if (key === 'favoriteChannel') {
            syncFavoriteChannelTile(tile, totals);
            return true;
        }
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
        rangeLabel.textContent = STATS_RANGE_LABEL[range] || 'Statistics';
        title.textContent = 'Your YouTube';
        // Keep the picker's active-item marker in sync with the range.
        const rangeWrap = card.querySelector('.rt-stats-range');
        const rangeMenu = rangeWrap?._rtMenu || rangeWrap?.querySelector('.rt-stats-range-menu');
        if (rangeMenu) {
            for (const item of rangeMenu.querySelectorAll('.rt-stats-range-item')) {
                item.setAttribute('aria-checked', item.dataset.range === range ? 'true' : 'false');
            }
        }

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

    function buildStatsCardHead(range, title) {
        const head = mk('div', 'rt-stats-card-head');
        const logo = mk('span', 'rt-stats-card-logo');
        logo.appendChild(RT_ICONS.chart());
        head.appendChild(logo);

        const text = mk('div', 'rt-stats-card-heading');
        text.appendChild(mk('span', 'rt-stats-card-title', title));
        text.appendChild(buildStatsRangePicker(range));
        head.appendChild(text);
        return head;
    }

    // The range eyebrow doubles as a picker: it shows the active range and,
    // when clicked, opens a menu to switch the displayed range. This is a
    // transient view change only — it does NOT persist. The saved default
    // (set in settings) is what loads on every visit; switching here resets
    // to that default on the next load.
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
        button.appendChild(mk('span', 'rt-stats-range-label', STATS_RANGE_LABEL[clean] || 'Statistics'));
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
            bindPopupItem('range', wrap, item, () => chooseStatsRange(value));
            menu.appendChild(item);
        }
        wrap.appendChild(menu);
        wrap._rtMenu = menu;
        menu._rtHome = wrap;
        bindPopupPicker('range', button, wrap);
        return wrap;
    }

    function chooseStatsRange(value) {
        closeStatsRangeMenus();
        // Transient view change only — does not alter the saved default.
        setActiveRange(value);
    }

    function buildStatsCard() {
        if (!state.loaded) return null;
        if (!getEnabled()) return null;
        const range = readStatsRange(state.range);

        const card = mk('div', 'rt-stats-card');
        card.appendChild(buildStatsCardHead(range, 'Your YouTube'));

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
        card.appendChild(buildStatsCardHead(readStatsRange(state.range), 'Your YouTube'));
        card.appendChild(mk('div', 'rt-stats-empty', 'Loading local statistics…'));
        return card;
    }

    function renderStatsPanelSlot(force = false) {
        const slot = document.getElementById('rt_stats_panel_slot');
        if (!slot) return;
        if (!isPanelEnabled()) {
            slot.replaceChildren();
            return;
        }
        // A collapsed panel is invisible; opening it renders with force.
        if (!force && !document.getElementById('rt_stats_panel')?.classList.contains('show')) return;

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
        if (!wrapper) wrapper = mk('div', 'rt-inline-stats', null, { id: 'rt_inline_stats' });
        // Either (a) we just created it and need to insert, or (b) it lives
        // elsewhere from a previous mount and needs moving, or (c) it's in
        // the right host but not at the top of the column.
        if (wrapper.parentElement !== host || host.firstElementChild !== wrapper) host.insertBefore(wrapper, host.firstChild);

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

    // (Re)mount the inline card if YouTube hasn't built its column yet, or
    // re-rendered it. Content refreshes go through scheduleRender instead.
    function ensureInlineCard() {
        const wrapper = document.getElementById('rt_inline_stats');
        if (wrapper?.firstElementChild && findInlineHost()?.firstElementChild === wrapper) return;
        renderInlineCard();
    }

    function scheduleInlineMount(retry = false) {
        if (!inlineMountRaf) {
            inlineMountRaf = requestAnimationFrame(() => {
                inlineMountRaf = 0;
                ensureInlineCard();
            });
        }
        if (retry) {
            clearInlineRetryTimers();
            inlineRetryTimers = [250, 750, 1600, 3200].map(ms => setTimeout(ensureInlineCard, ms));
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
        if (range) range.value = state.defaultRange;
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
        state.defaultRange = readStatsRange(range);
        state.range = state.defaultRange;
        state.display = readStatsDisplay(display);
        state.metrics = sanitizeStatsMetrics(metrics);
        // Keep anything recorded before storage answered (the first route's
        // open can land first) — unless stats turn out to be switched off.
        if (!state.enabled) pending = {};
        state.buckets = compactStatsBuckets(mergeStatsBuckets(sanitizeStatsBuckets(buckets), pending));
        state.loaded = true;
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

    function clearAll() {
        // Queued behind any in-flight persist, so that write can't land after
        // the delete and bring the old totals back.
        return enqueue(async () => {
            if (persistTimer) {
                clearTimeout(persistTimer);
                persistTimer = 0;
            }
            pending = {};
            state.buckets = {};
            await deleteStoredValue(CFG.storage.statsBuckets);
            scheduleRender();
        });
    }

    function resetSettings() {
        state.enabled = true;
        state.defaultRange = 'daily';
        state.range = 'daily';
        state.display = 'panel';
        state.metrics = { ...STATS_METRICS_DEFAULTS };
        syncSettingsControls();
        applyVisibility();
        scheduleAttachVideo(true);
    }

    function install() {
        void enqueue(load);

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
            if (!target?.closest?.('.rt-stat-channel-picker, .rt-stat-channel-menu')) {
                closeFavoriteChannelMenus();
            }
            if (!target?.closest?.('.rt-stats-range-picker, .rt-stats-range-menu')) {
                closeStatsRangeMenus();
            }
        }, { passive: true });
        // pagehide fires on every unload (after visibilitychange has usually
        // flushed already). No beforeunload listener: in Firefox it would
        // make YouTube ineligible for the back/forward cache.
        window.addEventListener('pagehide', () => { void flush(); }, { passive: true });

        // Keeps the inline card mounted at the top of YouTube's column when
        // YouTube re-renders it. The per-frame check is a no-op while the card
        // is in place, so RainTube's own mutations can't cause a loop.
        const observer = new MutationObserver(() => {
            if (state.loaded && isInlineEnabled()) scheduleInlineMount();
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

    // The persisted default range — applied on every page load. Only the
    // settings "Default time range" control writes this.
    async function setDefaultRange(value) {
        state.defaultRange = readStatsRange(value);
        state.range = state.defaultRange;
        await StatsStore.setValue(CFG.storage.statsRange, state.defaultRange);
        applyVisibility();
    }

    // The active/displayed range — transient. The in-card range picker uses
    // this so switching ranges is a quick view change that does NOT become the
    // saved default; on the next load the stored default is shown again.
    function setActiveRange(value) {
        state.range = readStatsRange(value);
        renderInlineCard();
        renderStatsPanelSlot();
    }

    async function setDisplay(value) {
        state.display = readStatsDisplay(value);
        await StatsStore.setValue(CFG.storage.statsDisplay, state.display);
        applyVisibility();
    }

    // Close both portaled popup menus (they live on <body>, so closing the
    // stats panel would otherwise leave one floating there).
    function closeMenus() {
        closeStatsRangeMenus();
        closeFavoriteChannelMenus();
    }

    return Object.freeze({
        install,
        onNavigate,
        closeMenus,
        recordShortsHidden,
        flush,
        renderStatsPanelSlot,
        clearAll,
        resetSettings,
        setEnabled,
        setDefaultRange,
        setDisplay,
        setMetric,
        getRange,
        getDisplay,
        getEnabled,
        isPanelEnabled,
        getMetrics,
    });
})();

function buildToggleCard(iconKey, swId, name, stId, infoText) {
    const card = mk('div', `rt-tc rt-tc-${iconKey}`);
    const top = mk('div', 'rt-tc-top');

    const iconWrap = mk('span', 'rt-tc-ico');
    const builder = RT_ICONS[iconKey];
    if (typeof builder === 'function') iconWrap.appendChild(builder());
    else {
        iconWrap.textContent = '◦'; // fallback if a typo'd key sneaks in
    }
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

// Controls that mirror a persisted setting declare `setting: '<key>'` (and
// `scale` for sliders whose control unit differs from the stored one) and
// register here, so syncAllSettingsControls() can refresh every one of them
// after a reset without a second hand-maintained list of element ids.
const settingBindings = [];

function registerSettingBinding(control) {
    const id = control.inputId || control.selectId || control.sliderId;
    if (!control.setting || !id) return;
    settingBindings.push({
        id,
        key: control.setting,
        scale: control.scale || 1,
        slider: control.type === 'slider',
    });
}

function buildSettingControl(control) {
    if (control.type === 'checkboxGrid') {
        for (const item of control.items) registerSettingBinding(item);
    } else {
        registerSettingBinding(control);
    }

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

// Push the rain settings into the panel's rain loop and the top bar's. Each
// flag limits the refresh to what actually changed, because re-seeding the
// drops is visible (the top bar keeps its own record of what it was last told).
function syncRainEffects({ quantity = true, fps = true, lightning = true, clouds = true } = {}) {
    const panelEl = document.getElementById('rt_panel');
    if (panelEl) {
        panelEl.classList.toggle('rt-rain-off', S.rainQuantity === 'off');
        if (quantity) panelEl.__rtRainQuantityChanged?.();
        if (fps) panelEl.__rtRainFpsChanged?.();
        if (lightning) panelEl.__rtLightningChanged?.();
        if (clouds) panelEl.__rtCloudsChanged?.();
    }
    TopbarTheme.syncRain();
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
                    setting: 'toastDurationMs',
                    scale: 1000,
                    min: TOAST_DURATION_MIN_MS / 1000,
                    max: TOAST_DURATION_MAX_MS / 1000,
                    step: 0.5,
                    value: S.toastDurationMs / 1000,
                    valueRender: secs => `${secs.toFixed(1)}s`,
                    onChange: secs => { setSetting('toastDurationMs', Math.round(secs * 1000)); },
                },
                {
                    type: 'select',
                    labelText: 'Toast position',
                    selectId: 'rt_toast_position_select',
                    setting: 'toastPlacement',
                    options: TOAST_PLACEMENT_ORDER.map(value => ({
                        value,
                        label: TOAST_PLACEMENT_LABEL[value],
                    })),
                    value: S.toastPlacement,
                    onChange: value => {
                        setSetting('toastPlacement', value);
                        scheduleToastPositionSync();
                    },
                },
                {
                    type: 'select',
                    labelText: 'Rain quantity',
                    selectId: 'rt_rain_quantity_select',
                    setting: 'rainQuantity',
                    options: RAIN_QUANTITY_ORDER.map(value => ({
                        value,
                        label: RAIN_QUANTITY_LABEL[value],
                    })),
                    value: S.rainQuantity,
                    onChange: value => {
                        setSetting('rainQuantity', value);
                        syncRainEffects({ fps: false, lightning: false });
                    },
                },
                {
                    type: 'slider',
                    labelText: 'Rain FPS cap',
                    helpText: 'Limits how often the rain animation redraws. Lower values may use less power.',
                    sliderId: 'rt_rain_fps_cap_slider',
                    setting: 'rainFpsCap',
                    min: RAIN_FPS_MIN,
                    max: RAIN_FPS_MAX,
                    step: 5,
                    value: S.rainFpsCap,
                    valueRender: fps => `${Math.round(fps)} fps`,
                    onChange: fps => {
                        setSetting('rainFpsCap', fps);
                        syncRainEffects({ quantity: false, lightning: false });
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_lightning_enabled',
                    setting: 'lightningEnabled',
                    text: 'Lightning effects',
                    checked: S.lightningEnabled,
                    wide: true,
                    onChange: checked => {
                        setSetting('lightningEnabled', checked);
                        syncRainEffects({ quantity: false, fps: false, clouds: false });
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_clouds_enabled',
                    setting: 'cloudsEnabled',
                    text: 'Storm clouds',
                    helpText: 'Dark clouds drifting along the top of the panel. They are part of the rain scene, so they go with it when Rain quantity is Off.',
                    checked: S.cloudsEnabled,
                    wide: true,
                    onChange: checked => {
                        setSetting('cloudsEnabled', checked);
                        syncRainEffects({ quantity: false, fps: false, lightning: false });
                    },
                },
                {
                    type: 'select',
                    labelText: 'Button placement',
                    helpText: 'Choose where RainTube buttons appear on YouTube.',
                    selectId: 'rt_button_placement_select',
                    setting: 'buttonPlacement',
                    options: BUTTON_PLACEMENT_ORDER.map(value => ({
                        value,
                        label: BUTTON_PLACEMENT_LABEL[value],
                    })),
                    value: S.buttonPlacement,
                    onChange: value => {
                        setSetting('buttonPlacement', value);
                        syncButtonPlacement();
                    },
                },
                {
                    type: 'warningCheckbox',
                    inputId: 'rt_main_button_visible',
                    setting: 'mainButtonVisible',
                    text: 'Show main RainTube button',
                    helpText: "Shows the main RainTube button on YouTube. If you hide it, open RainTube from your userscript manager's menu command.",
                    checked: S.mainButtonVisible,
                    noteText: "Advanced option, don't toggle blindly.",
                    onChange: checked => {
                        setSetting('mainButtonVisible', checked);
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
                    setting: 'oledThemeEnabled',
                    text: 'OLED pure-black theme',
                    helpText: "Makes YouTube dark mode pure black and turns off the player glow.",
                    checked: S.oledThemeEnabled,
                    wide: true,
                    onChange: checked => {
                        setSetting('oledThemeEnabled', checked);
                        OledTheme.apply();
                    },
                },
                {
                    type: 'slider',
                    labelText: 'Player glow',
                    helpText: "How strong YouTube's Ambient mode glow around the player is; 100% is YouTube's own. Needs Ambient mode on in the player settings. Changing it turns off the OLED theme, which hides the glow.",
                    sliderId: 'rt_player_glow_slider',
                    setting: 'playerGlow',
                    min: PLAYER_GLOW_MIN,
                    max: PLAYER_GLOW_MAX,
                    step: PLAYER_GLOW_STEP,
                    value: S.playerGlow,
                    valueRender: pct => (pct === 0 ? 'Off' : `${Math.round(pct)}%`),
                    onChange: pct => {
                        setSetting('playerGlow', pct);
                        PlayerGlow.apply();
                        // OLED hides the glow: its canvases are filled with
                        // YouTube's dark grey, which would show as a box on
                        // pure black. A glow the user turned up or down has
                        // to be seen, so OLED makes way (0% and 100% are no
                        // glow and "leave it", which OLED already satisfies).
                        if (S.oledThemeEnabled && S.playerGlow !== 0 && S.playerGlow !== PLAYER_GLOW_DEFAULT) {
                            setSetting('oledThemeEnabled', false);
                            OledTheme.apply();
                            syncSettingControlValue('rt_oled_theme', null, { checked: false });
                            toast('OLED theme turned off so the player glow can show', 'off',
                                { label: 'Customization', icon: 'customize' });
                        }
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_topbar_theme',
                    setting: 'topbarThemeEnabled',
                    text: 'RainTube top bar',
                    helpText: "Styles YouTube's top bar with RainTube's dark glass, glow, and rain.",
                    checked: S.topbarThemeEnabled,
                    wide: true,
                    onChange: checked => {
                        setSetting('topbarThemeEnabled', checked);
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
                    // One checkbox per blocker surface (sidebar, home, ...).
                    items: ShortsBlocker.surfaces.map(({ id, stateKey, label }) => ({
                        inputId: `rt_shorts_hide_${id}`,
                        setting: stateKey,
                        text: label,
                        checked: S[stateKey],
                        onChange: checked => {
                            setSetting(stateKey, checked);
                            ShortsBlocker.apply();
                        },
                    })),
                },
                {
                    type: 'select',
                    labelText: 'Direct /shorts/ links',
                    selectId: 'rt_shorts_on_visit_select',
                    setting: 'shortsOnVisit',
                    options: SHORTS_ON_VISIT_ORDER.map(value => ({
                        value,
                        label: SHORTS_ON_VISIT_LABEL[value],
                    })),
                    value: S.shortsOnVisit,
                    onChange: value => { setSetting('shortsOnVisit', value); },
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
                    labelText: 'Default time range',
                    helpText: 'The time period shown when stats first load each visit. Switch it temporarily anytime from the range picker on the stats card — that view resets to this default on reload. Turning Statistics off pauses tracking.',
                    selectId: 'rt_stats_range_select',
                    options: STATS_RANGE_ORDER.map(value => ({
                        value, label: STATS_RANGE_LABEL[value],
                    })),
                    value: StatsTracker.getRange(),
                    onChange: value => { void StatsTracker.setDefaultRange(value); },
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
                    helpText: 'Uses this quality when available, otherwise chooses the closest lower eligible option.',
                    selectId: 'rt_quality_max',
                    setting: 'qualityMax',
                    options: QUALITY_ORDER.map(q => ({ value: q, label: QUALITY_LABEL[q] || q })),
                    value: S.qualityMax,
                    onChange: value => {
                        setSetting('qualityMax', value);
                        restartQualityTargeting();
                    },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_quality_super_resolution',
                    setting: 'qualitySuperResolutionEnabled',
                    text: 'Include Super resolution',
                    helpText: 'Allows RainTube to choose YouTube AI-upscaled Super resolution rows when they are the first eligible match in YouTube’s quality menu.',
                    checked: S.qualitySuperResolutionEnabled,
                    wide: true,
                    onChange: checked => {
                        setSetting('qualitySuperResolutionEnabled', checked);
                        restartQualityTargeting();
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
                    setting: 'privateProvider',
                    options: PRIVATE_PROVIDER_ORDER.map(value => ({
                        value,
                        label: PRIVATE_PROVIDER_LABEL[value],
                    })),
                    value: S.privateProvider,
                    onChange: value => { setSetting('privateProvider', value); },
                },
                {
                    type: 'slider',
                    labelText: 'Request timeout',
                    helpText: 'How long RainTube waits on one download mirror without receiving any data before trying another or failing. Lower values recover sooner; higher values help slow mirrors finish. (In userscript managers that cannot cancel requests this is a total time limit instead.)',
                    sliderId: 'rt_private_download_timeout_slider',
                    setting: 'privateDownloadTimeoutMs',
                    scale: 1000,
                    min: PRIVATE_DOWNLOAD_TIMEOUT_MIN_MS / 1000,
                    max: PRIVATE_DOWNLOAD_TIMEOUT_MAX_MS / 1000,
                    step: PRIVATE_DOWNLOAD_TIMEOUT_STEP_MS / 1000,
                    value: S.privateDownloadTimeoutMs / 1000,
                    valueRender: formatPrivateDownloadTimeoutSeconds,
                    onChange: secs => { setSetting('privateDownloadTimeoutMs', Math.round(secs * 1000)); },
                },
                {
                    type: 'checkbox',
                    inputId: 'rt_private_fallback',
                    setting: 'privateFallbackEnabled',
                    text: 'Open CnvMP3 when private downloads fail',
                    helpText: 'Opens CnvMP3 with the current video link when private mirrors fail.',
                    checked: S.privateFallbackEnabled,
                    wide: true,
                    onChange: checked => { setSetting('privateFallbackEnabled', checked); },
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

// Refresh every setting-backed control from the live state (after a reset).
function syncAllSettingsControls() {
    for (const { id, key, scale, slider } of settingBindings) {
        const value = S[key];
        if (typeof value === 'boolean') syncSettingControlValue(id, null, { checked: value });
        else syncSettingControlValue(id, scale === 1 ? value : value / scale, { input: slider });
    }
}

async function resetAllSettingsToDefaults() {
    Object.assign(S, DEFAULT_SETTINGS, {
        _lastQualityTargetKey: null,
        _qualityGaveUpKey: null,
        _lastKnownQuality: null,
    });

    await deleteRainTubeStorageExcept([CFG.storage.statsBuckets]);
    StatsTracker.resetSettings();

    clearProviderFailures();
    ShortsBlocker.apply();
    OledTheme.apply();
    PlayerGlow.apply();
    TopbarTheme.apply();
    scheduleToastPositionSync();
    syncRainEffects();
    syncAllSettingsControls();
    syncButtonPlacement();
    restartQualityTargeting();
    uiSync();
}

function buildSettingsSections() {
    settingBindings.length = 0;
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

/**
 * RainSky: the weather shared by every rain canvas (the panel and the top
 * bar), so both lean, gust and flash together as one storm.
 *
 * Wind is tan(lean): a slow sum of incommensurate sines (so it drifts from
 * nearly vertical to a steady slant) plus a gust every 5-20 s with an eased
 * attack and an exponential release. It is a pure function of the clock, so
 * there is no shared state to fall out of step. Lightning is one timeline (a
 * strong flicker, then a weaker second one); every canvas flashes at the same
 * instant and exactly one of them draws the bolt.
 */
const RainSky = (() => {
    const TAU = Math.PI * 2;
    const GUST_PERIOD = 13;
    const GUST_LIFE = 14;               // s: after this a gust has decayed to nothing
    const smooth = t => t * t * (3 - 2 * t);
    const between = (min, max) => min + Math.random() * (max - min);
    const gustStart = k => k * GUST_PERIOD + 3 + 4 * Math.sin(k * 12.9898);
    const gustAmp = k => 0.12 + 0.14 * (Math.abs(Math.sin(k * 78.233) * 43758.5453) % 1);

    // The push of one gust (per unit amplitude) over its first `age` s: the
    // integral of its eased attack and exponential release.
    const gustPush = age => {
        if (age <= 0) return 0;
        if (age < 1.2) {
            const u = age / 1.2;
            return 1.2 * u * u * u * (1 - u * 0.5);
        }
        return 0.6 + 3 * (1 - Math.exp(-(Math.min(age, GUST_LIFE) - 1.2) / 3));
    };
    const GUST_FULL = gustPush(GUST_LIFE);
    let pushK = 0;
    let pushSum = 0;
    const pastGusts = n => {            // total push of the finished gusts 0 .. n-1 (memo; it only ever walks forward)
        if (n < pushK) pushK = pushSum = 0;
        for (; pushK < n; pushK++) pushSum += gustAmp(pushK) * GUST_FULL;
        return pushSum;
    };

    let windTs = NaN;
    let lean = 0.1;
    let gust = 0;
    const evaluate = t => {
        const base = 0.1
            + 0.075 * Math.sin(t * TAU / 61 + 1.3)
            + 0.04 * Math.sin(t * TAU / 23 + 4.1)
            + 0.015 * Math.sin(t * TAU / 7.3 + 0.7)
            + 0.008 * Math.sin(t * TAU / 2.9 + 2.2);
        let g = 0;
        const k0 = Math.floor(t / GUST_PERIOD);
        for (let k = k0 - 1; k <= k0 + 1; k++) {
            const age = t - gustStart(k);
            if (age > 0 && age < GUST_LIFE) g += gustAmp(k) * (age < 1.2 ? smooth(age / 1.2) : Math.exp(-(age - 1.2) / 3));
        }
        gust = g;
        lean = base + g;
    };

    // One strike at a time. `jit` holds the bolt's sideways wander per segment
    // (in canvas-independent units), so each canvas can draw the same channel.
    const strike = {
        id: 0, t0: 0, second: 0, x: 0.5, level: 0, owner: -1,
        jit: new Float32Array(24), fork: 0, forkDx: 0,
    };
    const seen = [];
    const isStrip = [];
    const free = [];                    // ids of canvases that have left, up for reuse
    let nextStrike = 0;
    let strikeTs = NaN;
    let live = false;

    const step = (ts, who) => {
        if (!nextStrike) nextStrike = ts + between(6000, 12000);
        if (!live && ts >= nextStrike) {
            strike.id++;
            strike.t0 = ts;
            strike.second = between(0.11, 0.18);
            strike.x = between(0.16, 0.84);
            for (let i = 0; i < strike.jit.length; i++) strike.jit[i] = between(-1, 1);
            strike.fork = 2 + Math.floor(Math.random() * 4);
            strike.forkDx = (Math.random() < 0.5 ? -1 : 1) * between(0.5, 1);
            // The bolt is drawn by the panel when it is running (it is the tall
            // one), otherwise by whichever canvas is.
            let owner = -1;
            for (let id = 0; id < seen.length; id++) {
                if (ts - seen[id] > 400) continue;
                if (owner < 0 || (isStrip[owner] && !isStrip[id])) owner = id;
            }
            strike.owner = owner < 0 ? who : owner;
            nextStrike = ts + between(18000, 45000);
            live = true;
        }
        if (!live) {
            strike.level = 0;
            return;
        }
        const t = (ts - strike.t0) / 1000;
        const p1 = t < 0.025 ? t / 0.025 : Math.exp(-(t - 0.025) / 0.09);
        const t2 = t - strike.second;
        const p2 = t2 < 0 ? 0 : 0.55 * (t2 < 0.025 ? t2 / 0.025 : Math.exp(-(t2 - 0.025) / 0.14));
        strike.level = Math.max(p1, p2);
        if (t > strike.second + 0.9) {
            live = false;
            strike.level = 0;
        }
    };

    return {
        strike,

        join(strip) {
            const id = free.length ? free.pop() : seen.length;
            seen[id] = -1e9;
            isStrip[id] = !!strip;
            return id;
        },

        // A canvas was torn down: it can no longer draw the bolt, and its id
        // goes back to the pool.
        leave(id) {
            if (!(id >= 0 && id < seen.length) || free.includes(id)) return;
            seen[id] = -1e9;
            free.push(id);
            if (strike.owner === id) strike.owner = -1;
        },

        // Lean (tan of the angle) and the gust share of it at time t (s).
        wind(t) {
            if (t !== windTs) {
                windTs = t;
                evaluate(t);
            }
            return lean;
        },

        get gust() {
            return gust;
        },

        // How far the wind has pushed things by time t: the integral of
        // (lean - 0.1), in closed form (the sines integrate, a gust has a fixed
        // shape, finished gusts left a fixed push), so drifting layers can be a
        // pure function of the clock.
        drift(t) {
            let s = -(0.075 * 61 * Math.cos(t * TAU / 61 + 1.3)
                + 0.04 * 23 * Math.cos(t * TAU / 23 + 4.1)
                + 0.015 * 7.3 * Math.cos(t * TAU / 7.3 + 0.7)
                + 0.008 * 2.9 * Math.cos(t * TAU / 2.9 + 2.2)) / TAU;
            const k0 = Math.floor(t / GUST_PERIOD);
            for (let k = k0 - 1; k <= k0 + 1; k++) s += gustAmp(k) * gustPush(t - gustStart(k));
            return s + pastGusts(Math.max(0, k0 - 1));
        },

        // The running strike, or null. Evaluated once per timestamp however
        // many canvases ask.
        lightning(ts, who) {
            seen[who] = ts;
            if (ts !== strikeTs) {
                strikeTs = ts;
                step(ts, who);
            }
            if (live && strike.owner < 0) strike.owner = who;   // the owner left mid-strike
            return live && strike.level > 0.004 ? strike : null;
        },

        // Lightning was switched off: forget the schedule.
        calm() {
            nextStrike = 0;
            live = false;
            strike.level = 0;
        },

    };
})();

/**
 * StormClouds: the dark cloud deck along the top of a rain canvas (the whole
 * 56 px top bar, or the top of the panel, fading out below the header).
 *
 * Interface (the rain engine owns the canvas, the clock and the lightning):
 *   const c = StormClouds.create({ strip });  strip = the short, wide top bar
 *   c.resize(width, height, dpr)   CSS size of the canvas and its pixel ratio
 *   c.draw(ctx, now, wind, gust, lit, litX)
 *       paints the clouds onto `ctx`, a freshly cleared canvas whose transform
 *       is the identity (device pixels). `now` is the engine clock in seconds
 *       (the rAF timestamp / 1000). draw() is a PURE function of (now, wind,
 *       gust, lit, litX): no state that changes the picture is carried from one
 *       call to the next (caches that do not are fine). So a canvas that was
 *       paused or runs at another frame rate agrees with the other canvas, and
 *       a capture can seek to any moment. `wind` is RainSky's lean (tan of the
 *       rain's angle, about -0.04..0.44, itself a pure function of `now`),
 *       `gust` its gust share, `lit` the lightning level 0..1 and `litX` the
 *       strike's x as a fraction of the width (-1 when there is none).
 *   c.dispose()                    release every canvas and buffer
 * Nothing may allocate per frame.
 *
 * How it works. The sky is four parallax layers (far haze, two decks, ragged
 * scud). Each is a seamlessly tiling strip, baked into small canvases (one
 * per band of rows) at device resolution and then only blitted, at integer
 * pixels, with its own drift speed (the wind's push is integrated in closed
 * form, RainSky.drift). What a layer looks like is a density field on a coarse
 * grid (a few px per cell): a ceiling, a jittered scatter of domes (billows:
 * two scales, rounded tops, creases where they meet, each swelling and
 * shrinking on its own slow clock, so billows grow, merge and dissolve) and
 * a little noise on the torn edge, whose lattice steps along a third axis,
 * time. The field is the same for every canvas (the panel is the same sky at
 * another scale). A band is shaded from it (self-shadow toward the light,
 * relief, a thin rim on the edge that faces the light, a per-pixel threshold
 * so edges stay crisp at any grid size, dither in the premultiplied domain) a
 * couple of times a second, every band on its own phase. A band is a function
 * of its own key (floor(now * rate - phase)) only, so the picture is a pure
 * function of `now` and the work per frame is flat.
 */
const StormClouds = (() => {
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const TAU = Math.PI * 2;

    // ── Noise ───────────────────────────────────────────────────────────
    // One 2D layer of value noise, periodic in x (nx lattice cells) so a
    // layer tiles. `iz` picks the lattice layer (the time axis). The lattice
    // is hashed with Math.imul, so it is exact at any clock value.
    const hash = (x, y, z, seed) => {
        let h = Math.imul(x, 0x1B873593) ^ Math.imul(y, 0x85EBCA6B) ^ Math.imul(z, 0xC2B2AE35) ^ seed;
        h ^= h >>> 15;
        h = Math.imul(h, 0x2C1B3C6D);
        h ^= h >>> 12;
        h = Math.imul(h, 0x297A2D39);
        h ^= h >>> 15;
        return (h >>> 0) * 2.3283064365386963e-10;
    };
    const quint = t => t * t * t * (t * (t * 6 - 15) + 10);
    const noiseLayer = (x, y, iz, nx, seed) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const tx = quint(x - ix);
        const ty = quint(y - iy);
        const x0 = ((ix % nx) + nx) % nx;
        const x1 = x0 + 1 === nx ? 0 : x0 + 1;
        const a = hash(x0, iy, iz, seed);
        const b = hash(x1, iy, iz, seed);
        const c = hash(x0, iy + 1, iz, seed);
        const d = hash(x1, iy + 1, iz, seed);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };

    // Interleaved gradient noise as a 64x64 threshold tile: the dither (blue-ish, no pattern).
    const DITHER = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const g = 0.06711056 * x + 0.00583715 * y;
            const f = 52.9829189 * (g - Math.floor(g));
            DITHER[y * 64 + x] = f - Math.floor(f);
        }
    }
    const INV = new Float32Array(256);     // 255 / alpha, to un-premultiply after dithering the premultiplied value
    for (let a = 1; a < 256; a++) INV[a] = 255 / a;
    const EXP_N = 256;
    const EXP_K = 32;                      // table steps per unit of optical depth
    const EXP = new Float32Array(EXP_N);
    for (let i = 0; i < EXP_N; i++) EXP[i] = Math.exp(-i / EXP_K);

    // Fine grain, 128 x 32 px, wrapping both ways: a few px of raggedness for the
    // edge of the cloud and speckle for its body. It is part of the tile, so it
    // moves with the cloud.
    const MICRO_W = 128;
    const MICRO = new Float32Array(MICRO_W * 32);
    const wrapNoise = (u, v, nx, ny, seed) => {
        const ix = Math.floor(u);
        const iy = Math.floor(v);
        const tx = quint(u - ix);
        const ty = quint(v - iy);
        const x0 = ix % nx;
        const y0 = iy % ny;
        const x1 = (x0 + 1) % nx;
        const y1 = (y0 + 1) % ny;
        const a = hash(x0, y0, 0, seed);
        const b = hash(x1, y0, 0, seed);
        const c = hash(x0, y1, 0, seed);
        const d = hash(x1, y1, 0, seed);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let y = 0; y < 32; y++) {
        for (let x = 0; x < MICRO_W; x++) {
            MICRO[y * MICRO_W + x] = wrapNoise(x * 26 / 128, y * 6 / 32, 26, 6, 77) + 0.5 * wrapNoise(x * 48 / 128, y * 12 / 32, 48, 12, 99) - 0.75;
        }
    }

    // ── Look ────────────────────────────────────────────────────────────
    // Colour ramps by shade 0..1 (straight sRGB): cool and desaturated, the
    // darker the bluer, the lighter the greyer. The top stops are the rim.
    const RAMPS = {
        haze: [[0, 28, 40, 56], [0.5, 46, 63, 86], [1, 84, 108, 138]],
        mid: [[0, 4, 7, 12], [0.2, 12, 18, 28], [0.4, 24, 34, 48], [0.6, 38, 52, 72], [0.8, 58, 76, 102], [1, 96, 118, 148]],
        near: [[0, 2, 4, 7], [0.2, 8, 12, 19], [0.4, 17, 25, 36], [0.6, 28, 40, 56], [0.8, 46, 62, 84], [1, 90, 112, 142]],
        scud: [[0, 8, 12, 19], [0.5, 20, 29, 41], [1, 48, 64, 86]],
    };
    const SHADE_N = 256;
    const ALPHA_N = 1024;
    const K_NEAR = 4;                       // candidate domes kept per node (the code below is unrolled for 4)

    // One spec per layer, far to near. Lengths are px of the sky (= CSS px
    // of the 1920 px bar).
    //   P tile period, cx/cy grid cell, y0/h the rows the tile covers
    //   v drift (px/s), kw wind coupling, x0 start offset
    //   R field and re-shade rate (Hz), nb bands, ph phase of band 0
    //   oct: noise octaves as [wavelength x, wavelength y (0 = a function of x
    //        only), seconds per lattice step in time]: ceiling wobble x2, torn edge
    //   dome sets: [cell size x/y, row offset, radius x/y, size spread, weight of each
    //        row, swell period range s, mean and amplitude of the swell, density gain]
    //   yc/ya/ya2 the ceiling's depth and wobble, sd px of depth per unit of density
    //   f1 torn-edge displacement (px), er0/ye0/ye1 how it grows down the deck
    //   a0/a1 density edge of the alpha curve, amax peak alpha
    //   shading: kappa/sh0 self-shadow, emb emboss of the silhouette, rb/rs/rf
    //   relief of the domes and the edge noise, kr/kv/kao emboss, level and crease
    //   darkening of the relief, kt thin-edge glow, kb belly, rim edge light,
    //   march shadow samples (nodes up and to the left)
    const LAYERS = [
        {
            name: 'haze', ramp: 'haze', kind: 'deck', seed: 0x1a2b3c, P: 1280, Pp: 600, cx: 8, cy: 4, y0: 0, h: 48, v: 2.2, kw: 0.5, x0: 300,
            R: 1.0, nb: 4, ph: 0.15,
            oct: [[380, 0, 150], [150, 0, 60], [70, 30, 40], [18, 8, 22]],
            doms: [
                { csx: 84, csy: 24, yo: -4, rx: 40, ry: 27, sv: 0.4, row: [1, 1, 0.55], T: [200, 420], m: 0.55, a: 0.12, a2: 0.16, T2: 300, lat: 500, kd: 1.8, rb: 0.7 },
                { csx: 38, csy: 14, yo: -3, rx: 19, ry: 13, sv: 0.4, row: [1, 1, 1, 0.5], T: [100, 240], m: 0.5, a: 0.12, kd: 0.45, rb: 0.4 },
                { csx: 16, csy: 8, yo: -1, rx: 8, ry: 7, sv: 0.4, row: [1, 1, 1, 0.9, 0.7, 0.3, 0, 0], T: [60, 140], m: 0.5, a: 0.12, kd: 0.2, rb: 0.15 },
            ],
            yc: 7, ya: 30, ya2: 6, gm: 3.2, mb: -0.28, sd: 11, f1: 8, f2: 3, rf: 0.4, rf2: 0.2, er0: 0.3, ye0: 8, ye1: 32,
            a0: -0.3, a1: 1.1, amax: 0.34, kappa: 0.4, sh0: 0.3, emb: 0.3, ei: 2, ej: 1, kr: 0.7, kv: 0.2, kao: 0.5, kt: 0.2, ri: 1, rj: 1, kb: 0.2, rim: 0.4, kT: 0.5, mk: 0.12, ms: 0.02,
            march: [[1, 1], [2, 2], [3, 3]], top: 0,
        },
        {
            name: 'mid', ramp: 'mid', kind: 'deck', seed: 0x2c3d4e, P: 1472, Pp: 600, cx: 4, cy: 2, y0: 0, h: 50, v: 4, kw: 0.9, x0: 700,
            R: 2.0, nb: 6, ph: 0.4,
            oct: [[330, 0, 130], [130, 0, 50], [40, 18, 36], [14, 7, 16]],
            doms: [
                { csx: 58, csy: 24, yo: -2, rx: 28, ry: 26, sv: 0.4, row: [0.9, 0.95, 0.4], T: [150, 340], m: 0.55, a: 0.12, a2: 0.16, T2: 260, lat: 360, kd: 1.6, rb: 0.8 },
                { csx: 26, csy: 14, yo: -2, rx: 15, ry: 13, sv: 0.4, row: [1, 1, 0.8, 0.3], T: [70, 170], m: 0.5, a: 0.12, kd: 0.45, rb: 0.4 },
                { csx: 12, csy: 8, yo: -1, rx: 7, ry: 7, sv: 0.4, row: [1, 1, 1, 0.9, 0.7, 0.3, 0.1, 0, 0], T: [40, 100], m: 0.5, a: 0.12, kd: 0.2, rb: 0.15 },
            ],
            yc: 7, ya: 28, ya2: 6, gm: 3.4, mb: -0.22, sd: 10, f1: 8, f2: 3, rf: 0.4, rf2: 0.15, er0: 0.3, ye0: 8, ye1: 32,
            a0: -0.25, a1: 0.9, amax: 0.78, kappa: 0.6, sh0: 0.3, emb: 0.4, ei: 2, ej: 1, kr: 0.6, kv: 0.15, kao: 0.45, kt: 0.25, ri: 1, rj: 1, kb: 0.25, rim: 0.5, kT: 0.45, mk: 0.3, ms: 0.1,
            march: [[1, 1], [2, 2], [3, 4], [5, 6]], top: 0.15,
        },
        {
            name: 'near', ramp: 'near', kind: 'deck', seed: 0x3d4e5f, P: 1920, Pp: 600, cx: 4, cy: 2, y0: 0, h: 54, v: 6, kw: 1.2, x0: 0,
            R: 2.4, nb: 6, ph: 0.65,
            oct: [[340, 0, 100], [140, 0, 45], [36, 18, 32], [13, 7, 14]],
            doms: [
                { csx: 60, csy: 26, yo: -3, rx: 31, ry: 29, sv: 0.4, row: [0.9, 0.95, 0.0], T: [130, 300], m: 0.55, a: 0.12, a2: 0.16, T2: 240, lat: 400, kd: 1.6, rb: 0.9 },
                { csx: 28, csy: 15, yo: -2, rx: 16, ry: 14, sv: 0.4, row: [1, 1, 0.8, 0.0], T: [60, 150], m: 0.5, a: 0.12, kd: 0.45, rb: 0.45 },
                { csx: 12, csy: 8, yo: -1, rx: 7, ry: 7, sv: 0.4, row: [1, 1, 1, 0.9, 0.7, 0.3, 0.0, 0], T: [36, 90], m: 0.5, a: 0.12, kd: 0.22, rb: 0.15 },
            ],
            yc: 8, ya: 34, ya2: 6, gm: 3.4, mb: -0.2, sd: 10, f1: 8, f2: 3, rf: 0.45, rf2: 0.2, er0: 0.3, ye0: 8, ye1: 32,
            a0: -0.25, a1: 0.9, amax: 0.92, kappa: 0.5, sh0: 0.28, emb: 0.3, ei: 2, ej: 1, kr: 0.5, kv: 0.25, kao: 0.4, kt: 0.2, ri: 1, rj: 1, kb: 0.25, rim: 0.9, kT: 0.5, mk: 0.3, ms: 0.12,
            march: [[1, 1], [2, 2], [3, 4], [5, 6]], top: 0.1,
        },
    ];
    // How a canvas views the sky: the panel is the same sky at 1.2 x 1.0 scale.
    const VIEW_BAR = { sx: 1, sy: 1, speed: 1 };
    const VIEW_PANEL = { sx: 1.2, sy: 1.0, speed: 0.45, panel: true };

    // Lightning: how much brighter the sky built up so far gets at the strike
    // (passes after the haze, the mid deck and the near deck: the far layers
    // are backlit most, so the near lobes turn into lit rims on a bright
    // ground), the glow where the bolt leaves the cloud, and the spread of the
    // flash (px; it grows a little with the level).
    const LIT_BAR = { gain: [1.5, 1.0, 0.55], tint: 0.16, glow: 0.5, s1: 0.055, s2: 0.3, minS1: 70 };
    const LIT_PANEL = { gain: [0.9, 0.5, 0.25], tint: 0.07, glow: 0.3, s1: 0.2, s2: 0.5, minS1: 50 };

    const ZE = 0.6;                         // how much the time axis eases at the lattice (0 = linear)
    const RING = 4;                         // lattice layers kept per octave

    const makeCanvas = (w, h) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(w));
        c.height = Math.max(1, Math.ceil(h));
        return c;
    };

    // ── The sky: one density field per layer, shared by every canvas ────
    // Domes: a jittered grid of cells, each with one dome (a paraboloid, so
    // the max of them has rounded tops and creases where two meet). Which
    // domes can matter at a node does not change, so the nearest few are
    // found once; their heights swell and shrink with the clock.
    const makeDomes = (F, D, seed) => {
        const S = F.S;
        const ncx = Math.max(2, Math.round(S.P / D.csx));
        const csx = S.P / ncx;
        const nr = D.row.length;
        const nc = ncx * nr;
        const nodes = F.gwp * F.ghp;
        const o = {
            D, ncx, csx, nr, nc,
            w: new Float32Array(nc),
            mean: new Float32Array(nc), amp: new Float32Array(nc), om: new Float32Array(nc), ph: new Float32Array(nc),
            amp2: new Float32Array(nc), ph2: new Float32Array(nc), om2: TAU / (D.T2 || 150), ic: new Int32Array(nc),
            ids: new Uint16Array(nodes * K_NEAR), q: new Float32Array(nodes * K_NEAR),
        };
        const jx = new Float32Array(nc);
        const jy = new Float32Array(nc);
        const irx = new Float32Array(nc);       // 1 / radius of each cell's dome
        const iry = new Float32Array(nc);
        for (let r = 0; r < nr; r++) {
            for (let c = 0; c < ncx; c++) {
                const id = r * ncx + c;
                jx[id] = (c + 0.1 + 0.8 * hash(c, r, 1, seed)) * csx;
                jy[id] = D.yo + (r + 0.1 + 0.8 * hash(c, r, 2, seed)) * D.csy;
                const sz = 1 - D.sv + 2 * D.sv * hash(c, r, 3, seed);
                irx[id] = 1 / (D.rx * sz);
                iry[id] = 1 / (D.ry * sz);
                o.ph[id] = TAU * hash(c, r, 4, seed);
                o.om[id] = TAU / (D.T[0] + (D.T[1] - D.T[0]) * hash(c, r, 5, seed));
                o.mean[id] = D.m * D.row[r] * (0.85 + 0.3 * hash(c, r, 6, seed));
                o.amp[id] = D.a * D.row[r];
                o.ic[id] = clamp(Math.round(jx[id] / S.cx), 0, F.gw - 1);
            }
        }
        // neighbours swell together on a second, slower clock: groups of billows grow and fade as a mass
        const lat = Math.max(1, Math.round(S.P / (D.lat || 420)));
        for (let r = 0; r < nr; r++) {
            for (let c = 0; c < ncx; c++) {
                const id = r * ncx + c;
                o.amp2[id] = (D.a2 || 0) * D.row[r];
                o.ph2[id] = TAU * 1.5 * noiseLayer(jx[id] * lat / S.P, 0.5 + r * 0.01, 9, lat, seed);
            }
        }
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
        let i0 = 0, i1 = 0, i2 = 0, i3 = 0;
        for (let j = 0; j < F.ghp; j++) {
            const y = F.ny[j];
            const rTop = Math.floor((y - D.yo) / D.csy);
            for (let i = 0; i < F.gwp; i++) {
                const x = i * S.cx;
                const c0 = Math.floor(x / csx);
                b0 = b1 = b2 = b3 = 1e9;
                for (let r = Math.max(0, rTop - 1); r <= Math.min(nr - 1, rTop + 1); r++) {
                    for (let cu = c0 - 1; cu <= c0 + 1; cu++) {
                        const c = cu < 0 ? cu + ncx : cu >= ncx ? cu - ncx : cu;
                        const id = r * ncx + c;
                        const ex = (x - jx[id] - (cu - c) * csx) * irx[id];
                        const ey = (y - jy[id]) * iry[id];
                        const qv = ex * ex + ey * ey;
                        // insert into the four smallest, kept sorted
                        if (qv < b3) {
                            if (qv < b1) {
                                b3 = b2; i3 = i2;
                                b2 = b1; i2 = i1;
                                if (qv < b0) {
                                    b1 = b0; i1 = i0;
                                    b0 = qv; i0 = id;
                                } else {
                                    b1 = qv; i1 = id;
                                }
                            } else if (qv < b2) {
                                b3 = b2; i3 = i2;
                                b2 = qv; i2 = id;
                            } else {
                                b3 = qv; i3 = id;
                            }
                        }
                    }
                }
                const n = (j * F.gwp + i) * K_NEAR;
                o.ids[n] = i0; o.q[n] = b0 > 1e8 ? 1e3 : b0;
                o.ids[n + 1] = i1; o.q[n + 1] = b1 > 1e8 ? 1e3 : b1;
                o.ids[n + 2] = i2; o.q[n + 2] = b2 > 1e8 ? 1e3 : b2;
                o.ids[n + 3] = i3; o.q[n + 3] = b3 > 1e8 ? 1e3 : b3;
            }
        }
        return o;
    };

    // Dome weights at time t. `mass` (the slow big-scale noise at each node, or null)
    // makes whole stretches of the deck heavy or thin: big billows where it is high.
    const swell = (o, t, mass, gm) => {
        for (let c = 0; c < o.nc; c++) {
            const w = o.mean[c] + o.amp[c] * Math.sin(o.om[c] * t + o.ph[c]) + o.amp2[c] * Math.sin(o.om2 * t + o.ph2[c]);
            o.w[c] = mass ? w * (1 + gm * mass[o.ic[c]]) : w;
        }
    };

    // Height of the dome surface at every node (the highest dome there).
    const domeHeights = (F, o, out, floor) => {
        const w = o.w;
        const ids = o.ids;
        const q = o.q;
        const n = F.gwp * F.ghp;
        for (let k = 0; k < n; k++) {
            const b = k * K_NEAR;
            let h = w[ids[b]] - q[b];
            for (let m = 1; m < K_NEAR; m++) {
                const v = w[ids[b + m]] - q[b + m];
                if (v > h) h = v;
            }
            out[k] = h < floor ? floor : h;
        }
    };

    function makeField(S) {
        const F = { S };
        F.gw = Math.round(S.P / S.cx);
        F.gwp = F.gw + 1;
        F.ghp = Math.ceil(S.h / S.cy) + 1;
        F.ny = new Float32Array(F.ghp);
        for (let j = 0; j < F.ghp; j++) F.ny[j] = S.y0 + j * S.cy;
        const nodes = F.gwp * F.ghp;
        // noise octaves: lattice cells across the period, a ring of lattice layers
        F.oct = S.oct.map((o, k) => {
            const n = Math.max(1, Math.round(S.P / o[0]));
            return {
                n, ly: o[1], T: o[2], seed: S.seed + 977 * (k + 1),
                off: 11.3 * k + (S.seed % 97) * 0.37,
                ring: Array.from({ length: RING }, () => ({ iz: -1e9, d: new Float32Array(o[1] ? nodes : F.gwp) })),
            };
        });
        F.tA = new Array(F.oct.length).fill(null);
        F.tB = new Array(F.oct.length).fill(null);
        F.wA = new Float64Array(F.oct.length);
        F.wB = new Float64Array(F.oct.length);
        F.domes = S.doms ? S.doms.map((D, k) => makeDomes(F, D, S.seed + 31 * k)) : [];
        F.fade = new Float32Array(F.ghp);     // the field is gone before the bottom of the tile: no cut line
        for (let j = 0; j < F.ghp; j++) F.fade[j] = 3 * smooth((F.ny[j] - (S.y0 + S.h - (S.fl || 10) - 2)) / (S.fl || 10));
        F.hs = F.domes.map(() => new Float32Array(nodes));
        F.kd = Float32Array.from(S.doms || [], D => D.kd);
        F.rb = Float32Array.from(S.doms || [], D => D.rb);
        F.rel = new Float32Array(nodes);
        F.mass = new Float32Array(F.gwp);
        // two cached fields: the quantum n and the one before it
        F.slot = [0, 1].map(() => ({ n: NaN, dens: new Float32Array(nodes), shade: new Float32Array(nodes) }));
        F.mi = Int32Array.from(S.march, m => m[0]);
        F.mj = Int32Array.from(S.march, m => m[1]);
        return F;
    }

    // Lattice layer iz of octave o, on the node grid (centred on 0).
    const getTable = (F, o, iz) => {
        const O = F.oct[o];
        const ring = O.ring;
        let victim = ring[0];
        for (let s = 0; s < RING; s++) {
            if (ring[s].iz === iz) return ring[s].d;
            if (Math.abs(ring[s].iz - iz) > Math.abs(victim.iz - iz)) victim = ring[s];
        }
        victim.iz = iz;
        const d = victim.d;
        const S = F.S;
        const gwp = F.gwp;
        const dx = S.cx * O.n / S.P;
        if (!O.ly) {
            for (let i = 0; i < gwp; i++) d[i] = noiseLayer(i * dx, 7.3, iz, O.n, O.seed) - 0.5;
        } else {
            for (let j = 0; j < F.ghp; j++) {
                const yy = F.ny[j] / O.ly + 3.1;
                const r = j * gwp;
                for (let i = 0; i < gwp; i++) d[r + i] = noiseLayer(i * dx, yy, iz, O.n, O.seed) - 0.5;
            }
        }
        return d;
    };

    // Pick the two lattice layers an octave is between at time t, and their weights.
    const aim = (F, t) => {
        for (let o = 0; o < F.oct.length; o++) {
            const O = F.oct[o];
            const z = t / O.T + O.off;
            const iz = Math.floor(z);
            const f = z - iz;
            const w = f + ZE * (smooth(f) - f);
            const nrm = 1 / Math.sqrt((1 - w) * (1 - w) + w * w);   // keeps the contrast of the octave constant
            F.tA[o] = getTable(F, o, iz);
            F.tB[o] = getTable(F, o, iz + 1);
            F.wA[o] = (1 - w) * nrm;
            F.wB[o] = w * nrm;
        }
    };

    const fillDeck = (F, d, t) => {
        const S = F.S;
        const gwp = F.gwp;
        const rel = F.rel;
        const A0 = F.tA[0], B0 = F.tB[0], A1 = F.tA[1], B1 = F.tB[1], A2 = F.tA[2], B2 = F.tB[2];
        const a0 = F.wA[0], b0 = F.wB[0], a1 = F.wA[1], b1 = F.wB[1], a2 = F.wA[2], b2 = F.wB[2];
        const A3 = F.tA[3] || A2, B3 = F.tB[3] || B2;
        const a3 = F.tA[3] ? F.wA[3] : 0, b3 = F.tA[3] ? F.wB[3] : 0;
        const { yc, ya, ya2, sd, er0, ye0, ye1, rf } = S;
        const nd = F.domes.length;
        const kd = F.kd;
        const rb = F.rb;
        const amp2 = S.f1 / sd;
        const amp3 = (S.f2 || 0) / sd;
        const hs = F.hs;
        const mass = F.mass;
        const gm = S.gm || 0;
        for (let i = 0; i < gwp; i++) mass[i] = 2 * (A0[i] * a0 + B0[i] * b0);
        // The big-scale noise has only a few lattice cells across the tile, so its average wanders: keep the coverage steady (banks still move and change, the sky does not fill up or clear).
        let mm = 0;
        for (let i = 0; i < F.gw; i++) mm += mass[i];
        mm = mm / F.gw - (S.mb || 0);
        for (let i = 0; i < gwp; i++) mass[i] -= mm;
        for (let m = 0; m < nd; m++) {
            swell(F.domes[m], t, gm ? mass : null, gm);
            domeHeights(F, F.domes[m], hs[m], -0.7);
        }
        const h0 = hs[0];
        for (let j = 0; j < F.ghp; j++) {
            const y = F.ny[j];
            const r = j * gwp;
            const ero = er0 + (1 - er0) * smooth((y - ye0) / (ye1 - ye0));
            const fade = F.fade[j];
            for (let i = 0; i < gwp; i++) {
                const k = r + i;
                const ceil = (yc + ya * mass[i] + ya2 * 2 * (A1[i] * a1 + B1[i] * b1) - y) / sd;
                const fin = 2 * (A2[k] * a2 + B2[k] * b2);
                const fin2 = 2 * (A3[k] * a3 + B3[k] * b3);
                const dome = kd[0] * h0[k];
                let add = 0;
                let rl = rb[0] * h0[k];
                for (let m = 1; m < nd; m++) {
                    add += kd[m] * hs[m][k];
                    rl += rb[m] * hs[m][k];
                }
                // the domes and the torn edge bite into the underside; the ceiling stays dense
                d[k] = (ceil > dome ? ceil : dome) + (add + amp2 * fin + amp3 * fin2) * ero - fade;
                rel[k] = rl + rf * fin + (S.rf2 || 0) * fin2;
            }
        }
    };

    // Shade of a node (0 = deep shadow .. 1 = lit rim): how much sky it sees
    // toward the light (up and to the left), an emboss of the silhouette and of
    // the relief inside it so billows read as lit on one side, darker creases,
    // thin edges that let light through, and a darker belly.
    const fillShade = (F, dens, shade) => {
        const S = F.S;
        const gw = F.gw;
        const gwp = F.gwp;
        const rel = F.rel;
        const mi = F.mi;
        const mj = F.mj;
        const nm = mi.length;
        const kk = S.kappa * EXP_K;
        const { sh0, emb, ei, ej, kr, kv, kao, kt, ri, rj, kb } = S;
        const kT = S.kT === undefined ? 1 - sh0 : S.kT;
        const yb = S.yc || S.yb;
        const last = F.ghp - 1;
        for (let j = 0; j < F.ghp; j++) {
            const r = j * gwp;
            const rE = (j - ej < 0 ? 0 : j - ej) * gwp;
            const rR = (j - rj < 0 ? 0 : j - rj) * gwp;
            const rU = (j > 0 ? j - 1 : 0) * gwp;
            const rD = (j < last ? j + 1 : last) * gwp;
            const belly = kb * smooth((F.ny[j] - yb) / (yb * 2 + 8));
            for (let i = 0; i < gw; i++) {
                let sum = 0;
                for (let m = 0; m < nm; m++) {
                    let ii = i - mi[m];
                    if (ii < 0) ii += gw;
                    const jj = j - mj[m];
                    const d = dens[(jj < 0 ? 0 : jj) * gwp + ii];
                    if (d > 0) sum += d > 1.3 ? 1.3 : d;
                }
                let ie = i - ei;
                if (ie < 0) ie += gw;
                let e = dens[r + i] - dens[rE + ie];
                e = e > 0.7 ? 0.7 : e < -0.7 ? -0.7 : e;
                let ir = i - ri;
                if (ir < 0) ir += gw;
                const dr = rel[r + i] - rel[rR + ir];
                const il = i > 1 ? i - 2 : i - 2 + gw;
                const ih = i + 2 < gw ? i + 2 : i + 2 - gw;
                let lap = (rel[r + il] + rel[r + ih] + rel[rU + i] + rel[rD + i]) * 0.25 - rel[r + i];
                lap = lap > 0 ? (lap > 0.5 ? 0.5 : lap) : 0;
                const dd = dens[r + i];
                const thin = dd < 0.8 ? (dd > 0 ? 1 - dd * 1.25 : 1) : 0;
                const q = (sum * kk) | 0;
                shade[r + i] = sh0 + kT * EXP[q < EXP_N ? q : EXP_N - 1] + emb * e + kr * dr + kv * rel[r + i] - kao * lap + kt * thin - belly;
            }
            shade[r + gw] = shade[r];
        }
    };

    // The field at quantum n: from the cache, or worked out into the older slot.
    const fieldFor = (F, n) => {
        const s0 = F.slot[0];
        const s1 = F.slot[1];
        if (s0.n === n) return s0;
        if (s1.n === n) return s1;
        const victim = s0.n !== s0.n ? s0 : s1.n !== s1.n ? s1 : (s0.n < s1.n ? s0 : s1);
        victim.n = n;
        const t = n / F.S.R;
        aim(F, t);
        fillDeck(F, victim.dens, t);
        fillShade(F, victim.dens, victim.shade);
        return victim;
    };

    // ── Tiles: a layer as one canvas sees it ────────────────────────────
    const buildRamp = (stops, lr, lg, lb, pk) => {
        for (let s = 0; s < SHADE_N; s++) {
            const t = s / (SHADE_N - 1);
            let i = 1;
            while (i < stops.length - 1 && stops[i][0] < t) i++;
            const a = stops[i - 1];
            const b = stops[i];
            const m = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
            lr[s] = a[1] + (b[1] - a[1]) * m;
            lg[s] = a[2] + (b[2] - a[2]) * m;
            lb[s] = a[3] + (b[3] - a[3]) * m;
            pk[s] = (Math.round(lb[s]) << 16) | (Math.round(lg[s]) << 8) | Math.round(lr[s]);
        }
    };

    // `S0` is the layer's spec; this canvas gets its own field: the period is
    // longer on a wider bar (so a layer does not repeat in view) and the panel's
    // is its own, shorter one.
    function makeTile(S0, view, dpr, width) {
        const P = view.panel ? S0.Pp : S0.P * clamp(width / 1920, 1, 2);
        const S = Object.assign({}, S0, { P: Math.round(P / S0.cx) * S0.cx, R: S0.R * (dpr > 1.25 ? 0.7 : 1) });
        const F = makeField(S);
        const L = { F, S, dpr, view };
        L.gw = F.gw;
        L.gwp = F.gwp;
        L.ghp = F.ghp;
        // device geometry
        L.Pd = Math.max(8, Math.round(S.P * view.sx * dpr));
        L.kx = L.Pd / S.P;                  // device px per sky px, across
        L.ky = view.sy * dpr;               // and down
        L.rowsDev = Math.max(1, Math.round(S.h * L.ky));
        L.top = Math.round(S.y0 * L.ky);
        L.nb = clamp(S.nb, 1, L.rowsDev);
        L.bandRows = Math.ceil(L.rowsDev / L.nb);
        L.nb = Math.ceil(L.rowsDev / L.bandRows);
        L.bands = [];
        for (let b = 0; b < L.nb; b++) {
            const rows = Math.min(L.bandRows, L.rowsDev - b * L.bandRows);
            const cv = makeCanvas(L.Pd, rows);
            L.bands.push({ cv, ctx: cv.getContext('2d'), y: L.top + b * L.bandRows, rows });
        }
        L.key = new Float64Array(L.nb).fill(NaN);
        L.phase = new Float64Array(L.nb);
        for (let b = 0; b < L.nb; b++) {
            const p = S.ph + b / L.nb;
            L.phase[b] = p - Math.floor(p);
        }
        L.stag = 1 / L.nb;
        L.ld = new Float32Array(L.gwp);
        L.ls = new Float32Array(L.gwp);
        L.pa = new Float32Array(L.Pd + 2);
        // column tables: pixel -> node + fraction
        L.cell0 = new Int32Array(L.gwp + 1);
        L.tt = new Float32Array(L.Pd);
        const cdev = S.cx * L.kx;
        for (let i = 0; i <= L.gw; i++) L.cell0[i] = Math.min(L.Pd, Math.ceil(i * cdev - 0.5));
        L.cell0[L.gw] = L.Pd;
        for (let x = 0; x < L.Pd; x++) {
            const fi = (x + 0.5) / cdev;
            L.tt[x] = fi - Math.floor(fi);
        }
        L.lr = new Float32Array(SHADE_N);
        L.lg = new Float32Array(SHADE_N);
        L.lb = new Float32Array(SHADE_N);
        L.pk = new Uint32Array(SHADE_N);
        buildRamp(typeof S.ramp === 'string' ? RAMPS[S.ramp] : S.ramp, L.lr, L.lg, L.lb, L.pk);
        L.la = new Float32Array(ALPHA_N);
        for (let n = 0; n < ALPHA_N; n++) {
            const d = S.a0 + (S.a1 - S.a0) * (n / (ALPHA_N - 1));
            L.la[n] = S.amax * smooth((d - S.a0) / (S.a1 - S.a0));
        }
        L.dK = (ALPHA_N - 1) / (S.a1 - S.a0);
        return L;
    }

    const freeTile = L => {
        for (const b of L.bands) {
            b.cv.width = b.cv.height = 0;
            b.ctx = null;
        }
        L.bands.length = 0;
        L.F = null;
    };

    // ── Shading one band of a tile ──────────────────────────────────────
    const bake = (L, b, f, img, u32) => {
        const S = L.S;
        const gwp = L.gwp;
        const band = L.bands[b];
        const dens = f.dens;
        const shade = f.shade;
        const y0 = b * L.bandRows;
        const y1 = y0 + band.rows;
        const yA = y0 - 1;                  // one row above the band, for the edge light
        const Pd = L.Pd;
        const pa = L.pa;
        const ld = L.ld;
        const ls = L.ls;
        const la = L.la;
        const lr = L.lr;
        const lg = L.lg;
        const lb = L.lb;
        const pk = L.pk;
        const tt = L.tt;
        const cell0 = L.cell0;
        const a0 = S.a0;
        const dK = L.dK;
        const rim = S.rim;
        const mk = S.mk || 0;
        const ms = S.ms || 0;
        const dLo = a0 - 0.5;
        const dHi = S.a1 + 0.6;
        const top = S.top;
        const topH = 18 * L.ky;
        const stride = img.width;
        const ky = L.ky;
        const jMax = L.ghp - 2;
        if (yA < 0) pa.fill(1);             // the deck goes on above the top edge: no rim there
        for (let y = yA < 0 ? 0 : yA; y < y1; y++) {
            const write = y >= y0;
            const jf = ((L.top + y + 0.5) / ky - S.y0) / S.cy;
            const jc = jf < 0 ? 0 : jf;
            let j = jc | 0;
            if (j > jMax) j = jMax;
            const tj = jc - j;
            const r0 = j * gwp;
            const r1 = r0 + gwp;
            for (let i = 0; i < gwp; i++) {
                ld[i] = dens[r0 + i] + (dens[r1 + i] - dens[r0 + i]) * tj;
                ls[i] = shade[r0 + i] + (shade[r1 + i] - shade[r0 + i]) * tj;
            }
            const o0 = (y - y0) * stride;
            const dy = (y & 63) << 6;
            const my = (y & 31) << 7;
            const my2 = ((y + 11) & 31) << 7;
            const topW = top * Math.max(0, 1 - y / topH);
            let ul = pa[Pd - 1];            // the tile wraps: the pixel left of x = 0 is the last of the row (above)
            let al = ul;
            for (let i = 0; i < L.gw; i++) {
                const xa = cell0[i];
                const xb = cell0[i + 1];
                const da = ld[i];
                const db = ld[i + 1];
                if (da < a0 && db < a0) {
                    for (let x = xa; x < xb; x++) {
                        ul = pa[x];
                        pa[x] = 0;
                        al = 0;
                        if (write) u32[o0 + x] = 0;
                    }
                    continue;
                }
                const sa = ls[i];
                const sb = ls[i + 1];
                for (let x = xa; x < xb; x++) {
                    const t = tt[x];
                    let d = da + (db - da) * t;
                    if (d > dLo && d < dHi) d += mk * MICRO[my + (x & 127)];
                    let ai = ((d - a0) * dK) | 0;
                    ai = ai < 0 ? 0 : ai > ALPHA_N - 1 ? ALPHA_N - 1 : ai;
                    const a = la[ai];
                    const up = pa[x];
                    pa[x] = a;
                    if (write) {
                        if (a < 0.004) {
                            u32[o0 + x] = 0;
                        } else {
                            const e = a - (ul + up + al) * 0.3333;
                            let sh = sa + (sb - sa) * t + topW + ms * MICRO[my2 + ((x + 53) & 127)];
                            if (e > 0) sh += e * rim;
                            const si = sh <= 0 ? 0 : sh >= 1 ? 255 : (sh * 255) | 0;
                            const dn = DITHER[dy + (x & 63)];
                            const A8 = (a * 255 + dn) | 0;
                            if (A8 < 8) {
                                u32[o0 + x] = (A8 << 24) | pk[si];
                            } else {
                                const iv = INV[A8];
                                const pr = ((a * lr[si] + dn) | 0) * iv;
                                const pg = ((a * lg[si] + dn) | 0) * iv;
                                const pb = ((a * lb[si] + dn) | 0) * iv;
                                u32[o0 + x] = (A8 << 24) | ((pb | 0) << 16) | ((pg | 0) << 8) | (pr | 0);
                            }
                        }
                    }
                    ul = up;
                    al = a;
                }
            }
        }
        band.ctx.putImageData(img, 0, 0, 0, 0, Pd, band.rows);
    };

    function create({ strip = false } = {}) {
        const view = strip ? VIEW_BAR : VIEW_PANEL;
        const LIT = strip ? LIT_BAR : LIT_PANEL;
        let width = 0;
        let height = 0;
        let dpr = 1;
        let layers = null;
        let img = null;
        let u32 = null;
        let lt = null;                      // lightning scratch, made on the first strike

        const release = () => {
            if (layers) for (const L of layers) freeTile(L);
            layers = null;
            img = u32 = null;
            if (lt) {
                lt.cv.width = lt.cv.height = lt.mcv.width = lt.mcv.height = lt.gcv.width = lt.gcv.height = 0;
                lt = null;
            }
        };

        const build = () => {
            layers = LAYERS.map(S => makeTile(S, view, dpr, width));
            let maxW = 1;
            let maxH = 1;
            for (const L of layers) {
                maxW = Math.max(maxW, L.Pd);
                maxH = Math.max(maxH, L.bandRows);
            }
            img = new ImageData(maxW, maxH);
            u32 = new Uint32Array(img.data.buffer);
        };

        // A radial glow, white-blue, for where the bolt leaves the cloud.
        const makeGlow = () => {
            const cv = makeCanvas(64, 32);
            const g = cv.getContext('2d');
            const gr = g.createRadialGradient(32, 16, 0, 32, 16, 31);
            gr.addColorStop(0, 'rgba(214, 228, 255, 1)');
            gr.addColorStop(0.35, 'rgba(150, 184, 240, 0.45)');
            gr.addColorStop(1, 'rgba(120, 160, 230, 0)');
            g.setTransform(1, 0, 0, 0.5, 0, 0);
            g.fillStyle = gr;
            g.fillRect(0, 0, 64, 64);
            return cv;
        };

        // The strike's brightening: copy the sky drawn so far in a window around
        // the bolt, fade it out sideways with the flash's profile, and add it
        // back (`lighter`): the light is in proportion to what is there, so the
        // structure of the cloud shows, a thin edge flares and a dark core does
        // not.
        const flashPass = (ctx, gain, wx, ww, rows, tint) => {
            const t = lt.ctx;
            t.globalCompositeOperation = 'copy';
            t.drawImage(ctx.canvas, wx, 0, ww, rows, 0, 0, ww, rows);
            t.globalCompositeOperation = 'destination-in';
            t.drawImage(lt.mcv, 0, 0, ww, 1, 0, 0, ww, rows);
            if (tint) {
                // the cloud that is there, turned into light of one colour: it fills the cores in too
                t.globalCompositeOperation = 'source-in';
                t.fillStyle = 'rgb(128, 168, 232)';
                t.fillRect(0, 0, ww, rows);
            }
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = gain;
            ctx.drawImage(lt.cv, wx, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        };

        const flashSetup = (cw, rows, lit, litX) => {
            const k = Math.sqrt(lit);
            const s1 = Math.max(LIT.minS1, LIT.s1 * width) * (0.6 + 0.7 * k) * dpr;
            const s2 = LIT.s2 * width * dpr;
            const cx = litX * cw;
            const half = Math.max(2.4 * s1, 1.4 * s2);
            const wx = Math.max(0, Math.floor(cx - half));
            const ww = Math.min(cw, Math.ceil(cx + half)) - wx;
            if (!lt || lt.cv.width < ww || lt.cv.height < rows) {
                if (!lt) lt = { cv: makeCanvas(1, 1), mcv: makeCanvas(1, 1), gcv: makeGlow() };
                lt.cv.width = ww;
                lt.cv.height = rows;
                lt.ctx = lt.cv.getContext('2d');
                lt.mcv.width = ww;
                lt.mcv.height = 1;
                lt.mctx = lt.mcv.getContext('2d');
                lt.mimg = new ImageData(ww, 1);
                lt.mu32 = new Uint32Array(lt.mimg.data.buffer);
            }
            const m = lt.mu32;
            for (let x = 0; x < ww; x++) {
                const dx = wx + x - cx;
                const a = 0.74 * Math.exp(-(dx * dx) / (s1 * s1)) + 0.26 * Math.exp(-Math.abs(dx) / s2);
                m[x] = ((a * 255 + 0.5) | 0) << 24 | 0xffffff;
            }
            lt.mctx.putImageData(lt.mimg, 0, 0, 0, 0, ww, 1);
            lt.wx = wx;
            lt.ww = ww;
            lt.cx = cx;
            lt.s1 = s1;
        };

        return {
            resize(w, h, ratio) {
                width = Math.max(0, w || 0);
                height = Math.max(0, h || 0);
                const r = clamp(ratio || 1, 1, 3);
                if (r !== dpr) {
                    dpr = r;
                    release();
                }
            },

            draw(ctx, now, wind, gust, lit, litX) {
                if (!(width > 0 && height > 0) || !isFinite(now)) return;
                if (!layers) build();
                const cw = ctx.canvas.width;
                ctx.imageSmoothingEnabled = false;
                const push = RainSky.drift(now);
                const flash = lit > 0.004 && litX >= 0 && litX <= 1;
                let rows = 0;
                if (flash) {
                    for (const L of layers) rows = Math.max(rows, L.top + L.rowsDev);
                    rows = Math.min(rows, ctx.canvas.height);
                    flashSetup(cw, rows, lit, litX);
                }
                for (let l = 0; l < layers.length; l++) {
                    const L = layers[l];
                    const S = L.S;
                    for (let b = 0; b < L.nb; b++) {
                        const n = Math.floor(now * S.R - L.phase[b]);
                        if (L.key[b] === n) continue;
                        bake(L, b, fieldFor(L.F, n), img, u32);
                        L.key[b] = n;
                    }
                    const Pd = L.Pd;
                    const off = (S.v * view.speed * (now + S.kw * push) + S.x0) * L.kx;
                    for (let b = 0; b < L.nb; b++) {
                        let x = Math.floor(off + b * L.stag) % Pd;
                        if (x < 0) x += Pd;
                        const y = L.bands[b].y;
                        const cv = L.bands[b].cv;
                        for (x -= Pd; x < cw; x += Pd) ctx.drawImage(cv, x, y);
                    }
                    if (flash && l < LIT.gain.length) {
                        const g = LIT.gain[l] * lit;
                        if (g > 0.01) flashPass(ctx, g, lt.wx, lt.ww, rows);
                    }
                }
                if (flash && LIT.tint > 0) flashPass(ctx, LIT.tint * Math.sqrt(lit), lt.wx, lt.ww, rows, true);
                if (flash && LIT.glow > 0) {
                    // where the bolt leaves the cloud: a glow, only on the cloud that is there
                    const r = Math.max(lt.s1 * 1.6, 60 * dpr);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.globalAlpha = Math.min(1, LIT.glow * lit);
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(lt.gcv, lt.cx - r, -rows * 0.25, 2 * r, rows * 1.1);
                    ctx.imageSmoothingEnabled = false;
                    ctx.globalAlpha = 1;
                    ctx.globalCompositeOperation = 'source-over';
                }
            },

            dispose() {
                release();
                width = height = 0;
            },
        };
    }

    return Object.freeze({ create });
})();

/**
 * Rain engine shared by the panel and the YouTube top bar.
 *
 * Back to front: the lightning flash, three depth layers of pre-rendered
 * streaks (parallax, gusting wind), the wet-glass layer (beads sliding with
 * fading trails), a small pool of "hitter" drops aimed at the top edges of real
 * UI surfaces (cards, buttons, the logo), gravity-correct crown splashes, water
 * that runs round a card's corner and hangs from it before it drips onto the
 * next one, and the bolt. Rain dims behind every card and text block so content
 * stays crisp; a wet rim on the card itself (CSS, driven by --rt-wet) shows
 * where water has been landing. The canvas is decoration behind the UI
 * (pointer-events: none).
 *
 * `canvas` is the layer it draws on, `host` the element that owns it (the
 * panel, or YouTube's masthead): the hooks below live on `host`, and the
 * observers and listeners watch it.
 *
 * Options: strip (short wide bar: slower rain, shorter streaks), targetSelector
 * (surfaces that take hits and dim rain), coverSelector (dim only),
 * objectSelector (targets that take splashes but have no surface of their own,
 * like a logo), rimSelector (targets the stylesheet gives a wet rim; the
 * engine writes --rt-wet / --rt-hx on those and on nothing else),
 * solidCheck (skip targets with no visible background: rain landing on a bare
 * icon would splash in mid air), scrollSelector (scroller whose clip rect
 * limits which targets can be hit), sill (the bottom edge is a ledge that
 * takes hits), shouldRun, lightning.
 *
 * Hooks set on `host`: __rtRainMoved, __rtRainQuantityChanged,
 * __rtRainFpsChanged, __rtLightningChanged and __rtRainDispose (stops the loop,
 * removes every observer, listener and inline property, and releases the
 * sprites; safe to call twice). The returned function is the same dispose.
 */
function initHeaderRain(canvas, host, opts = {}) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !host) return null;

    const strip = !!opts.strip;
    const targetSelector = opts.targetSelector || '.rt-mark, .rt-hdr-btn';
    const coverSelector = opts.coverSelector || '';
    const objectSelector = opts.objectSelector || '';
    const rimSelector = opts.rimSelector || '';
    const scrollSelector = opts.scrollSelector || '';
    const solidCheck = !!opts.solidCheck;
    const sill = !!opts.sill;
    const shouldRun = typeof opts.shouldRun === 'function'
        ? opts.shouldRun
        : () => host.classList.contains('show') && !host.classList.contains('rt-rain-off');
    const lightningAllowed = opts.lightning !== false;
    let clouds = null;                    // StormClouds instance while the setting is on
    const hdrText = { x: 0, y: 0, w: 0, h: 0 };   // the panel header's text block, canvas px: clouds are thinned out behind it
    const random = (min, max) => min + Math.random() * (max - min);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const TAU = Math.PI * 2;
    const skyId = RainSky.join(strip);

    // ── Look ────────────────────────────────────────────────────────────
    // Layers 0/1/2 = far/mid/near. A streak is the distance a drop covers in
    // LEN_TIME (that is what motion blur is), so fast near rain is long,
    // bright and soft while far rain is short, dim and crisp. The strip is
    // only 56 px tall, where a full-speed streak crosses it in three frames
    // and reads as flicker, so it gets slower rain and shorter streaks.
    const LAYERS = 3;
    const LAYER_SPEED = [[300, 420], [520, 700], [850, 1100]]; // px/s
    const LAYER_HALF_W = [0.42, 0.55, 0.8];
    const LAYER_SOFT = [0, 0.5, 1.1];
    const LAYER_ALPHA = [[0.16, 0.25], [0.25, 0.37], [0.33, 0.48]];
    const LAYER_COUPLE = [0.55, 0.8, 1];  // how much of the wind each layer feels
    const LAYER_LAG = [0.9, 0.5, 0.25];   // s: far rain reacts to gusts late
    const LAYER_RGB = ['150, 178, 214', '190, 212, 240', '228, 240, 255'];
    const LEN_TIME = 0.04;
    const SPEED_SCALE = strip ? 0.6 : 1;
    const MAX_STREAK = strip ? 24 : 54;
    // Share of far / mid / near drops (cumulative), and a brightness gain: the
    // bar is small and busy, so its near rain does more of the work.
    const SHARE_FAR = strip ? 0.36 : 0.55;
    const SHARE_MID = strip ? 0.7 : 0.85;
    const ALPHA_GAIN = strip ? 1.6 : 1.4;
    const AREA_PER_DROP = strip ? 470 : 900; // px² of canvas per background drop at ultra
    const MAX_DROPS = 600;                   // at ultra; a very wide bar would otherwise get thousands
    const HITTERS = strip ? 13 : 12;
    const MAX_HITTERS = 16;
    const HIT_WAIT = strip ? [0.25, 1.5] : [0.3, 2.1]; // s between a hitter's drops
    const BIN_STEP = 0.04;                // wind resolution of the baked sprites (2 degrees)
    const BIN_MIN = -1;
    const BINS = 13;                      // lean -0.04 .. 0.44
    const WIND_MIN = BIN_STEP * BIN_MIN;
    const WIND_MAX = BIN_STEP * (BIN_MIN + BINS - 1);
    const GRAVITY = 800;                  // px/s², splash droplets
    const DRIP_GRAVITY = 900;
    const MAX_SPLASH = 56;
    const MAX_SHEEN = 16;
    const MAX_PENDANT = 6;
    const MAX_DRIP = 8;
    const MAX_RUN = 4;
    const MAX_BEADS = 8;
    const MAX_RESIDUE = 14;
    const TRAIL = 6;
    const MAX_TARGETS = 64;
    const CLOUD_STILL_S = 4000;           // s: the moment reduced-motion users get a still of
    const SPLASH_SCALE = [0.6, 0.75, 0.9, 1];            // droplets per hit by quantity tier
    const PENDANTS = strip ? [0, 2, 2, 3] : [0, 2, 3, 4]; // pendant drips allowed by quantity tier
    const RUNS = [0, 1, 2, 3];                            // edge beads allowed by quantity tier
    const BEADS = strip ? [2, 2, 3, 3] : [2, 3, 5, 6];    // ambient glass beads by quantity tier
    const COVER_RAMP = 3;                 // px over which rain fades into a card
    const MEASURE_MIN_MS = 150;
    const MEASURE_POLL_MS = 500;
    const SOLID_RECHECK_MS = 2000;
    const WET_FLUSH_MS = 100;             // the CSS wet rim is written at 10 Hz
    const RIM_MIN = 30;                   // px: smaller surfaces get no rim (it would double their outline)
    const FRAME_EPSILON_MS = 0.75;

    const state = {
        width: 0,
        height: 0,
        dpr: 1,
        q: 1,                              // quantity scale 0..1
        now: 0,                            // s, rAF clock
        resizePending: true,
        raf: null,
        lastTs: 0,
        nextFrameTs: 0,
        frameIntervalMs: 1000 / readRainFpsCap(S.rainFpsCap),
        dirty: true,
        measureTs: -1e9,
        overflow: false,                   // more surfaces than MAX_TARGETS
        litWritten: -1,
        strikeId: 0,
    };

    // ── Streak geometry per (layer, speed class) ────────────────────────
    const STREAK_LEN = new Float32Array(LAYERS * 2);
    const CLASS_LO = new Float32Array(LAYERS * 2);
    const CLASS_HI = new Float32Array(LAYERS * 2);
    for (let l = 0; l < LAYERS; l++) {
        const [lo, hi] = LAYER_SPEED[l];
        for (let c = 0; c < 2; c++) {
            const k = l * 2 + c;
            CLASS_LO[k] = lo + (hi - lo) * c / 2;
            CLASS_HI[k] = lo + (hi - lo) * (c + 1) / 2;
            STREAK_LEN[k] = clamp((CLASS_LO[k] + CLASS_HI[k]) / 2 * SPEED_SCALE * LEN_TIME, 5, MAX_STREAK);
        }
    }

    // ── Wind ────────────────────────────────────────────────────────────
    // RainSky says what the air is doing; each layer follows through its own
    // coupling and lag, which is what makes far rain answer a gust later
    // than near rain. Drops move with the same tan their streak sprite was
    // sheared for, so streak and motion always agree.
    const wl = new Float32Array(LAYERS);   // current lean per layer
    const lb = new Uint8Array(LAYERS);     // sprite bin per layer (with hysteresis)
    const binFor = tan => clamp(Math.round(tan / BIN_STEP) - BIN_MIN, 0, BINS - 1);
    let thick = 1;                         // rain thickens a little in a gust
    const wind = {
        init() {
            const w = RainSky.wind(performance.now() / 1000);
            for (let l = 0; l < LAYERS; l++) {
                wl[l] = clamp(w * LAYER_COUPLE[l], WIND_MIN, WIND_MAX);
                lb[l] = binFor(wl[l]);
            }
        },
        update(t, dt) {
            const w = RainSky.wind(t);
            for (let l = 0; l < LAYERS; l++) {
                wl[l] = clamp(wl[l] + (w * LAYER_COUPLE[l] - wl[l]) * (1 - Math.exp(-dt / LAYER_LAG[l])), WIND_MIN, WIND_MAX);
                // Hysteresis: a lean sitting on a bin boundary must not flip sprites every frame.
                if (Math.abs(wl[l] - (lb[l] + BIN_MIN) * BIN_STEP) > BIN_STEP * 0.6) lb[l] = binFor(wl[l]);
            }
            thick = clamp(0.9 + RainSky.gust * 1.6, 0.9, 1.3);
        },
    };

    // ── Sprites (baked once per dpr, blitted upright at integer pixels) ─
    // Shearing or fractionally placing a drawImage costs 4-7x more than an
    // upright integer blit, so the wind slant is baked into BINS variants. They
    // are all built in resize() (dpr change), never in a frame.
    const makeCanvas = (w, h) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(w));
        c.height = Math.max(1, Math.ceil(h));
        return c;
    };
    const NSPR = LAYERS * 2 * BINS;
    const sprites = new Array(NSPR).fill(null);
    const spW = new Int32Array(NSPR);
    const spH = new Int32Array(NSPR);
    const spAX = new Float32Array(NSPR);
    const spAY = new Float32Array(NSPR);
    let sheenSprites = [null, null];
    let beadSprite = null;
    let spriteDpr = 0;

    const streakGeom = (l, c, bin) => {
        const dpr = state.dpr;
        const len = STREAK_LEN[l * 2 + c];
        const half = LAYER_HALF_W[l] + LAYER_SOFT[l] + 0.75;
        const tan = (bin + BIN_MIN) * BIN_STEP;
        const slant = len * tan;
        return {
            len, half, tan, slant,
            w: Math.ceil((2 * half + Math.abs(slant) + 1) * dpr),
            h: Math.ceil((len + half + 1) * dpr),
        };
    };

    const paintStreak = (g, l, geo) => {
        const dpr = state.dpr;
        const { len, half, tan, slant } = geo;
        const hw = LAYER_HALF_W[l];
        const soft = LAYER_SOFT[l];
        const rgb = LAYER_RGB[l];
        const tailX = half + 0.5 + Math.max(0, -slant);
        // Work in a sheared space (u across, v along the streak) so the
        // gradients follow the slant.
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.transform(1, 0, tan, 1, tailX, 1);
        const along = g.createLinearGradient(0, 0, 0, len);
        along.addColorStop(0, `rgba(${rgb}, 0)`);
        along.addColorStop(0.25, `rgba(${rgb}, 0.2)`);
        along.addColorStop(0.55, `rgba(${rgb}, 0.55)`);
        along.addColorStop(0.85, `rgba(${rgb}, 0.9)`);
        along.addColorStop(1, `rgba(${rgb}, 1)`);
        g.fillStyle = along;
        const wide = hw + soft;
        g.fillRect(-wide, 0, 2 * wide, len);
        if (soft > 0) {
            // Soft cross-section for near rain (out of focus), blur baked once.
            g.globalCompositeOperation = 'destination-in';
            const across = g.createLinearGradient(-wide, 0, wide, 0);
            across.addColorStop(0, 'rgba(0, 0, 0, 0)');
            across.addColorStop(0.22, 'rgba(0, 0, 0, 0.2)');
            across.addColorStop(0.4, 'rgba(0, 0, 0, 0.75)');
            across.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
            across.addColorStop(0.6, 'rgba(0, 0, 0, 0.75)');
            across.addColorStop(0.78, 'rgba(0, 0, 0, 0.2)');
            across.addColorStop(1, 'rgba(0, 0, 0, 0)');
            g.fillStyle = across;
            g.fillRect(-wide, 0, 2 * wide, len);
            g.globalCompositeOperation = 'source-over';
        }
        if (l >= 1) {
            // A brighter head: the drop itself, ahead of its own blur.
            const rad = hw * 1.3 + soft * 0.8;
            const head = g.createRadialGradient(0, len, 0, 0, len, rad);
            head.addColorStop(0, 'rgba(240, 249, 255, 0.55)');
            head.addColorStop(1, 'rgba(240, 249, 255, 0)');
            g.fillStyle = head;
            g.fillRect(-rad, len - rad, 2 * rad, 2 * rad);
        }
    };

    const bakeStreaks = () => {
        const dpr = state.dpr;
        for (let r = 0; r < LAYERS * 2; r++) {
            for (let b = 0; b < BINS; b++) {
                const geo = streakGeom(r >> 1, r & 1, b);
                const i = r * BINS + b;
                const cv = makeCanvas(geo.w, geo.h);
                paintStreak(cv.getContext('2d'), r >> 1, geo);
                sprites[i] = cv;
                spW[i] = geo.w;
                spH[i] = geo.h;
                spAX[i] = (geo.half + 0.5 + Math.max(0, -geo.slant) + geo.slant) * dpr;
                spAY[i] = (1 + geo.len) * dpr;
            }
        }
    };

    // Soft horizontal glint that sits on a surface edge where a drop landed.
    const bakeSheen = big => {
        const dpr = state.dpr;
        const w = big ? 22 : 14;
        const h = big ? 3.4 : 2.6;
        const cv = makeCanvas(w * dpr, h * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr * w / 2, 0, 0, dpr * h / 2, dpr * w / 2, dpr * h / 2);
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, 'rgba(226, 244, 255, 1)');
        glow.addColorStop(0.3, 'rgba(206, 236, 255, 0.55)');
        glow.addColorStop(1, 'rgba(190, 228, 255, 0)');
        g.fillStyle = glow;
        g.fillRect(-1, -1, 2, 2);
        return { c: cv, w, h };
    };

    // A water bead on glass: a faint halo, a translucent body that is darker
    // at the top and lit at the bottom (light gathering through the drop), a
    // bright lower rim and a specular dot. Used sliding, hanging and running.
    const bakeBead = () => {
        const dpr = state.dpr;
        const size = 16;
        const cv = makeCanvas(size * dpr, size * dpr);
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const halo = g.createRadialGradient(8, 8, 3, 8, 8, 8);
        halo.addColorStop(0, 'rgba(150, 205, 245, 0.16)');
        halo.addColorStop(1, 'rgba(150, 205, 245, 0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, size, size);
        const body = g.createLinearGradient(0, 3, 0, 13);
        body.addColorStop(0, 'rgba(24, 44, 66, 0.34)');
        body.addColorStop(0.55, 'rgba(120, 170, 215, 0.24)');
        body.addColorStop(1, 'rgba(206, 236, 255, 0.5)');
        g.fillStyle = body;
        g.beginPath();
        g.arc(8, 8, 5, 0, TAU);
        g.fill();
        g.lineWidth = 0.7;
        g.strokeStyle = 'rgba(190, 226, 255, 0.34)';
        g.stroke();
        g.lineWidth = 1.2;
        g.strokeStyle = 'rgba(232, 246, 255, 0.85)';
        g.beginPath();
        g.arc(8, 8, 4.3, 0.35, Math.PI - 0.35);
        g.stroke();
        g.fillStyle = 'rgba(255, 255, 255, 0.95)';
        g.beginPath();
        g.arc(6.3, 5.9, 0.9, 0, TAU);
        g.fill();
        return { c: cv, size };
    };

    const ensureSprites = () => {
        if (spriteDpr === state.dpr) return;
        spriteDpr = state.dpr;
        bakeStreaks();
        sheenSprites = [bakeSheen(false), bakeSheen(true)];
        beadSprite = bakeBead();
    };

    // ── Surfaces (targets, covers, sill) ────────────────────────────────
    // Rects are kept in canvas-relative CSS px in typed arrays and updated in
    // place. Kind 0 = solid surface (takes hits, dims rain, gets a wet rim),
    // 1 = only dims (text blocks), 2 = the virtual sill along the bottom of a
    // strip, 3 = an object with no surface of its own (takes small splashes).
    const tl = new Float32Array(MAX_TARGETS);
    const tt = new Float32Array(MAX_TARGETS);
    const tr = new Float32Array(MAX_TARGETS);
    const tb = new Float32Array(MAX_TARGETS);
    const tR = new Float32Array(MAX_TARGETS);
    const tcx = new Float32Array(MAX_TARGETS);
    const tcy = new Float32Array(MAX_TARGETS);
    const thw = new Float32Array(MAX_TARGETS);
    const thh = new Float32Array(MAX_TARGETS);
    const tS = new Float32Array(MAX_TARGETS);          // how much rain dims behind it
    const tK = new Uint8Array(MAX_TARGETS);
    const tNext = new Float64Array(MAX_TARGETS);       // s: next impact allowed
    const tWet = new Float32Array(MAX_TARGETS);        // fast wetness 0..1, drives the CSS rim (rim targets only)
    const tFilm = new Float32Array(MAX_TARGETS);       // slow water film 0..1, feeds runs and drips
    const tHx = new Float32Array(MAX_TARGETS);         // 0..1 along the top edge: last impact
    const tWq = new Uint8Array(MAX_TARGETS);           // wet level last written to the element
    const tHq = new Uint8Array(MAX_TARGETS);
    const tRim = new Uint8Array(MAX_TARGETS);          // 1: the stylesheet draws a wet rim on it and the engine drives it
    const tSW = new Float32Array(MAX_TARGETS);
    const tSH = new Float32Array(MAX_TARGETS);
    const tEl = new Array(MAX_TARGETS).fill(null);
    const hitList = new Int16Array(MAX_TARGETS);
    const hitCum = new Float32Array(MAX_TARGETS);
    const solidCache = new WeakMap();
    let tn = 0;
    let nHitTargets = 0;
    let bandTop = 0;
    let bandBottom = 0;
    let coverCount = 0;

    const readRadius = (el, w, h) => {
        const first = (getComputedStyle(el).borderTopLeftRadius || '0').split(' ')[0];
        const num = parseFloat(first);
        if (!(num > 0)) return 0;
        return Math.min(first.endsWith('%') ? num / 100 * Math.min(w, h) : num, w / 2, h / 2);
    };

    // Does the element have a visible surface of its own? Rain landing on a
    // bare icon would splash in mid air. Re-checked now and then: a hover can
    // give a button a background.
    const looksSolid = (el, ts) => {
        let c = solidCache.get(el);
        if (c && ts - c.ts < SOLID_RECHECK_MS) return c.solid;
        const cs = getComputedStyle(el);
        let solid = cs.backgroundImage !== 'none' || (cs.boxShadow && cs.boxShadow !== 'none');
        if (!solid) {
            const m = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor || '');
            if (m) {
                const p = m[1].split(/[\s,/]+/);
                solid = p.length < 4 || parseFloat(p[3]) > 0.03;
            } else {
                solid = !!cs.backgroundColor && cs.backgroundColor !== 'transparent';
            }
        }
        if (!c) solidCache.set(el, c = { solid: false, ts: 0 });
        c.solid = !!solid;
        c.ts = ts;
        return c.solid;
    };

    // Wet rim: the CSS custom properties are removed from an element that no
    // longer has a slot, dried out, or stopped being a rim target (it shrank
    // or was clipped), so no inline style lingers and the slot starts dry.
    const clearRim = n => {
        const el = tEl[n];
        if (el && tWq[n]) {
            el.style.removeProperty('--rt-wet');
            el.style.removeProperty('--rt-hx');
        }
        tWq[n] = 0;
        tHq[n] = 0;
        tWet[n] = 0;
    };
    const clearAllRims = () => {
        for (let i = 0; i < MAX_TARGETS; i++) clearRim(i);
    };

    const measure = ts => {
        state.measureTs = ts;
        state.dirty = false;
        const cr = canvas.getBoundingClientRect();
        if (cr.width < 1 || cr.height < 1) {
            tn = nHitTargets = coverCount = 0;
            return;
        }
        // The panel is scaled while it opens; measure in canvas CSS px.
        const sx = state.width / cr.width;
        const sy = state.height / cr.height;
        const scroller = scrollSelector ? host.querySelector(scrollSelector) : null;
        let clipTop = -Infinity;
        let clipBottom = Infinity;
        if (scroller) {
            const sr = scroller.getBoundingClientRect();
            clipTop = (sr.top - cr.top) * sy;
            clipBottom = (sr.bottom - cr.top) * sy;
        }

        let n = 0;
        let overflow = false;
        const add = (el, kind, strength) => {
            if (n >= MAX_TARGETS) {
                overflow = true;
                return;
            }
            const b = el.getBoundingClientRect();
            if (b.width < 6 || b.height < 6) return;
            const l = Math.round((b.left - cr.left) * sx * 2) / 2;
            const r = Math.round((b.right - cr.left) * sx * 2) / 2;
            let t = Math.round((b.top - cr.top) * sy * 2) / 2;
            let bt = Math.round((b.bottom - cr.top) * sy * 2) / 2;
            if (r < 0 || l > state.width || bt < 0 || t > state.height) return;
            let k = kind;
            if (k === 0 && solidCheck) {
                if (objectSelector && el.matches(objectSelector)) k = 3;
                else if (!looksSolid(el, ts)) return;
            }
            if (scroller && scroller !== el && scroller.contains(el)) {
                // Half scrolled out of view: it can no longer be hit, and only
                // its visible part dims the rain.
                if (t < clipTop) k = k === 0 || k === 3 ? 1 : k;
                t = Math.max(t, clipTop);
                bt = Math.min(bt, clipBottom);
                if (bt - t < 4) return;
            }
            const w = r - l;
            const h = bt - t;
            if (tEl[n] !== el) {
                clearRim(n);
                tEl[n] = el;
                tFilm[n] = 0;
                tNext[n] = 0;
                tSW[n] = -1;
            }
            if (Math.abs(tSW[n] - w) > 0.5 || Math.abs(tSH[n] - h) > 0.5 || k !== tK[n]) {
                tR[n] = readRadius(el, w, h);
                tSW[n] = w;
                tSH[n] = h;
            }
            tl[n] = l; tt[n] = t; tr[n] = r; tb[n] = bt;
            tcx[n] = (l + r) / 2; tcy[n] = (t + bt) / 2;
            thw[n] = w / 2; thh[n] = h / 2;
            tK[n] = k;
            tS[n] = strength;
            // Only surfaces the stylesheet gives a rim, and big enough for it.
            // One that just lost that (shrank, or the scroller clipped it) is
            // dried at once: flushWet no longer visits it to do so.
            const rim = k === 0 && Math.min(w, h) >= RIM_MIN && !!rimSelector && el.matches(rimSelector);
            if (!rim && tWq[n]) clearRim(n);
            tRim[n] = rim ? 1 : 0;
            n++;
        };
        for (const el of host.querySelectorAll(targetSelector)) add(el, 0, strip ? 0.82 : 0.72);
        if (coverSelector) for (const el of host.querySelectorAll(coverSelector)) add(el, 1, 0.7);
        if (sill && n < MAX_TARGETS) {
            clearRim(n);
            tEl[n] = null;
            tl[n] = 0; tr[n] = state.width; tt[n] = state.height - 3.5; tb[n] = state.height;
            tR[n] = 0; tS[n] = 0; tK[n] = 2; tRim[n] = 0;
            n++;
        }
        tn = n;
        for (let i = n; i < MAX_TARGETS; i++) {
            if (tEl[i]) clearRim(i);
            tEl[i] = null;
        }
        state.overflow = overflow;

        nHitTargets = 0;
        coverCount = 0;
        bandTop = Infinity;
        bandBottom = -Infinity;
        let total = 0;
        for (let i = 0; i < tn; i++) {
            if (tK[i] !== 2) {
                coverCount++;
                bandTop = Math.min(bandTop, tt[i]);
                bandBottom = Math.max(bandBottom, tb[i]);
            }
            if (tK[i] === 1) continue;
            total += 40 + (tr[i] - tl[i]) * (tK[i] === 2 ? 0.12 : tK[i] === 3 ? 0.3 : 0.6);
            hitList[nHitTargets] = i;
            hitCum[nHitTargets++] = total;
        }
    };

    // Rain falls behind glass: multiplier for a streak at (x, y). A signed
    // distance to the rounded rect gives a soft edge and correct corners.
    const coverAt = (x, y) => {
        if (y < bandTop || y > bandBottom) return 1;
        for (let i = 0; i < tn; i++) {
            if (tK[i] === 2 || x < tl[i] || x > tr[i] || y < tt[i] || y > tb[i]) continue;
            const r = tR[i];
            const qx = Math.abs(x - tcx[i]) - (thw[i] - r);
            const qy = Math.abs(y - tcy[i]) - (thh[i] - r);
            const d = (qx > 0 && qy > 0 ? Math.sqrt(qx * qx + qy * qy) : Math.max(qx, qy)) - r;
            if (d >= 0) continue;
            return 1 - tS[i] * (d < -COVER_RAMP ? 1 : -d / COVER_RAMP);
        }
        return 1;
    };

    // Top edge of target t at x (Infinity when x misses it), following the
    // rounded corners; the outward normal of the hit point goes to NX/NY.
    let NX = 0;
    let NY = -1;
    const surfaceTop = (t, x) => {
        const l = tl[t];
        const rt = tr[t];
        if (x < l || x > rt) return Infinity;
        const r = tR[t];
        if (r > 0.5) {
            const cxa = x < l + r ? l + r : x > rt - r ? rt - r : NaN;
            if (cxa === cxa) {
                const dx = x - cxa;
                return tt[t] + r - Math.sqrt(Math.max(0, r * r - dx * dx));
            }
        }
        return tt[t];
    };
    const surfaceNormal = (t, x, y) => {
        const r = tR[t];
        NX = 0;
        NY = -1;
        if (r > 0.5) {
            const cxa = x < tl[t] + r ? tl[t] + r : x > tr[t] - r ? tr[t] - r : NaN;
            if (cxa === cxa) {
                NX = (x - cxa) / r;
                NY = Math.min(-0.2, (y - (tt[t] + r)) / r);
            }
        }
    };
    // Bottom edge at x, for drips.
    const surfaceBottom = (t, x) => {
        const r = tR[t];
        if (r > 0.5) {
            const cxa = x < tl[t] + r ? tl[t] + r : x > tr[t] - r ? tr[t] - r : NaN;
            if (cxa === cxa) {
                const dx = x - cxa;
                return tb[t] - r + Math.sqrt(Math.max(0, r * r - dx * dx));
            }
        }
        return tb[t];
    };

    // A point s px along the outline of target t, walked from the top edge at
    // fraction fx towards `dir` (+1 right, -1 left): the rest of the top edge,
    // the corner, the side and the lower corner. Sets OX/OY (point), ONX/ONY
    // (outward normal), OTY (how much of the path points down) and returns
    // false once s is past the end (bottom, where a pendant takes over).
    let OX = 0;
    let OY = 0;
    let ONX = 0;
    let ONY = -1;
    let OTY = 0;
    const HALF_PI = Math.PI / 2;
    const outline = (t, fx, dir, s) => {
        const w = tr[t] - tl[t];
        const h = tb[t] - tt[t];
        const r = clamp(tR[t], 1.5, Math.min(w, h) / 2);
        const x0 = tl[t] + fx * w;
        const la = Math.max(0, dir > 0 ? tr[t] - r - x0 : x0 - tl[t] - r);
        const arc = HALF_PI * r;
        const side = Math.max(0, h - 2 * r);
        const cx = dir > 0 ? tr[t] - r : tl[t] + r;
        if (s < la) {
            OX = x0 + dir * s; OY = tt[t]; ONX = 0; ONY = -1; OTY = 0;
            return true;
        }
        s -= la;
        if (s < arc) {
            const a = s / r;
            ONX = dir * Math.sin(a); ONY = -Math.cos(a);
            OX = cx + r * ONX; OY = tt[t] + r + r * ONY; OTY = Math.sin(a);
            return true;
        }
        s -= arc;
        if (s < side) {
            OX = dir > 0 ? tr[t] : tl[t]; OY = tt[t] + r + s; ONX = dir; ONY = 0; OTY = 1;
            return true;
        }
        s -= side;
        if (s < arc) {
            const a = s / r;
            ONX = dir * Math.cos(a); ONY = Math.sin(a);
            OX = cx + r * ONX; OY = tb[t] - r + r * ONY; OTY = Math.cos(a);
            return true;
        }
        OX = cx; OY = tb[t]; ONX = 0; ONY = 1; OTY = 0;
        return false;
    };

    // A target is still the one a drop was aimed at: same element (the sill
    // has none), still a surface.
    const targetIs = (t, el) => t >= 0 && t < tn && tEl[t] === el && tK[t] !== 1;

    const pickTarget = () => {
        if (!nHitTargets) return -1;
        for (let tries = 0; tries < 3; tries++) {
            const pick = Math.random() * hitCum[nHitTargets - 1];
            let i = 0;
            while (i < nHitTargets - 1 && hitCum[i] < pick) i++;
            const t = hitList[i];
            if (state.now >= tNext[t]) return t;
        }
        return -1;
    };

    // ── Particles (typed arrays, pooled; nothing allocates per frame) ───
    let nDrops = 0;
    let dx = new Float32Array(0);
    let dy = new Float32Array(0);
    let dv = new Float32Array(0);
    let da = new Float32Array(0);
    let dl = new Uint8Array(0);
    let dc = new Uint8Array(0);
    const growDrops = n => {
        if (dx.length >= n) return;
        const cap = n + 16;
        const grow = (Type, old) => {
            const next = new Type(cap);
            next.set(old);
            return next;
        };
        dx = grow(Float32Array, dx); dy = grow(Float32Array, dy); dv = grow(Float32Array, dv);
        da = grow(Float32Array, da); dl = grow(Uint8Array, dl); dc = grow(Uint8Array, dc);
    };
    // Drops drift sideways as they fall, so resetDrop seeds them left of the
    // canvas by the lean they will pick up on the way in: at most WIND_MAX x the
    // height (+ 8). They are only culled beyond that, or the strongest gusts
    // would throw away every seed that starts far left, every frame.
    const cullLeft = () => -(WIND_MAX * state.height + 24);
    const resetDrop = (i, initial) => {
        const r = Math.random();
        const l = r < SHARE_FAR ? 0 : r < SHARE_MID ? 1 : 2;
        const c = Math.random() < 0.5 ? 0 : 1;
        const k = l * 2 + c;
        dl[i] = l;
        dc[i] = c;
        dv[i] = random(CLASS_LO[k], CLASS_HI[k]) * SPEED_SCALE;
        da[i] = random(LAYER_ALPHA[l][0], LAYER_ALPHA[l][1]) * ALPHA_GAIN;
        // Drops drift sideways as they fall, so seed outside the canvas by the
        // lean they will pick up on the way in.
        const lean = wl[l] * state.height;
        dx[i] = random(-Math.max(0, lean) - 8, state.width + 6 + Math.max(0, -lean));
        dy[i] = initial ? random(-STREAK_LEN[k], state.height) : -STREAK_LEN[k] - random(0, 24);
    };

    // Hitters: a few drops aimed at UI surfaces. State machine: 0 waiting,
    // 1 flying, 2 pouring into the surface. Timers, not chance, set the
    // impact rate, so it is bounded.
    let nHit = 0;
    const hs = new Uint8Array(MAX_HITTERS);
    const hx = new Float32Array(MAX_HITTERS);
    const hy = new Float32Array(MAX_HITTERS);
    const hv = new Float32Array(MAX_HITTERS);
    const ha = new Float32Array(MAX_HITTERS);
    const hf = new Float32Array(MAX_HITTERS);          // y where the fade-in starts
    const hd = new Float32Array(MAX_HITTERS);          // fade-in distance (0: none)
    const hWait = new Float32Array(MAX_HITTERS);       // wait timer
    const hFx = new Float32Array(MAX_HITTERS);         // aimed x as a fraction of the target's width
    const hLean = new Float32Array(MAX_HITTERS);       // current lean, steered towards the aim
    const hLand = new Float32Array(MAX_HITTERS);       // y of the edge it landed on
    const hl = new Uint8Array(MAX_HITTERS);
    const hc = new Uint8Array(MAX_HITTERS);
    const hT = new Int16Array(MAX_HITTERS);
    const hEl = new Array(MAX_HITTERS).fill(null);

    const planHitter = i => {
        const t = pickTarget();
        if (t < 0) return false;
        const l = Math.random() < 0.62 ? 1 : 2;
        const c = Math.random() < 0.5 ? 0 : 1;
        const k = l * 2 + c;
        const len = STREAK_LEN[k];
        let v = random(CLASS_LO[k], CLASS_HI[k]) * SPEED_SCALE;
        const w = tr[t] - tl[t];
        const inset = Math.min(tR[t] * 0.35 + 2, w * 0.4);
        const fx = tK[t] === 2 ? random(10, state.width - 10) / w : random(inset / w, 1 - inset / w);
        const ax = tl[t] + fx * w;
        const sy = surfaceTop(t, ax);
        if (sy === Infinity) return false;
        const run = strip ? len * 1.3 + random(0, 12) : Math.max(len * 1.3, 26) + random(0, 44);
        let y0 = sy - run;
        let fade = 0;
        if (y0 < -len) y0 = -len - random(0, 6);
        else fade = Math.min(28, len * 1.2);
        // Keep the flight readable when the surface is close to the canvas top.
        v = Math.min(v, (sy - y0) / (strip ? 0.11 : 0.07));
        hs[i] = 1;
        hl[i] = l;
        hc[i] = c;
        hv[i] = v;
        hLean[i] = wl[l];
        hx[i] = ax - wl[l] * (sy - y0);
        hy[i] = y0;
        hf[i] = y0;
        hd[i] = fade;
        hFx[i] = fx;
        ha[i] = random(LAYER_ALPHA[l][0], LAYER_ALPHA[l][1]) * ALPHA_GAIN * 1.12;
        hT[i] = t;
        hEl[i] = tEl[t];
        tNext[t] = state.now + 1 / clamp((tr[t] - tl[t]) / 70, 0.8, 3.5);
        return true;
    };

    // Splash droplets: ring buffer, real gravity, drawn as short dashes.
    const sdX = new Float32Array(MAX_SPLASH);
    const sdY = new Float32Array(MAX_SPLASH);
    const sdY0 = new Float32Array(MAX_SPLASH);
    const sdVx = new Float32Array(MAX_SPLASH);
    const sdVy = new Float32Array(MAX_SPLASH);
    const sdLife = new Float32Array(MAX_SPLASH);
    const sdTtl = new Float32Array(MAX_SPLASH);
    let sdHead = 0;

    // Sheen: the glint left on an edge where a drop landed.
    const shX = new Float32Array(MAX_SHEEN);
    const shY = new Float32Array(MAX_SHEEN);
    const shAge = new Float32Array(MAX_SHEEN).fill(-1);
    const shPeak = new Float32Array(MAX_SHEEN);
    const shBig = new Uint8Array(MAX_SHEEN);
    let shHead = 0;

    // Runs: water that leaves a card's top edge, creeps to the nearer corner,
    // runs round it and down the side, and finally hangs as a pendant.
    // Phases: 0 pinned on the edge (swelling), 1 moving.
    const ruT = new Int16Array(MAX_RUN).fill(-1);
    const ruEl = new Array(MAX_RUN).fill(null);
    const ruPh = new Uint8Array(MAX_RUN);
    const ruFx = new Float32Array(MAX_RUN);
    const ruDir = new Int8Array(MAX_RUN);
    const ruS = new Float32Array(MAX_RUN);
    const ruV = new Float32Array(MAX_RUN);
    const ruR = new Float32Array(MAX_RUN);
    const ruPin = new Float32Array(MAX_RUN);
    const ruStick = new Float32Array(MAX_RUN);
    let ruCool = 2;

    // Pendant drips: swell under wet surfaces, neck, fall.
    const peT = new Int16Array(MAX_PENDANT).fill(-1);
    const peEl = new Array(MAX_PENDANT).fill(null);
    const peX = new Float32Array(MAX_PENDANT);
    const peAge = new Float32Array(MAX_PENDANT);
    const peDur = new Float32Array(MAX_PENDANT);
    const peNeck = new Float32Array(MAX_PENDANT);
    let peCool = 1;
    const drX = new Float32Array(MAX_DRIP);
    const drY = new Float32Array(MAX_DRIP);
    const drV = new Float32Array(MAX_DRIP);
    const drOn = new Uint8Array(MAX_DRIP);

    // Ambient glass beads: slide with stick-slip, leave a fading trail and a
    // few residue droplets, merge when they meet (water is conserved).
    let nBeads = 0;
    const bX = new Float32Array(MAX_BEADS);
    const bY = new Float32Array(MAX_BEADS);
    const bR = new Float32Array(MAX_BEADS);
    const bV = new Float32Array(MAX_BEADS);
    const bMode = new Uint8Array(MAX_BEADS);            // 0 pinned, 1 sliding
    const bT = new Float32Array(MAX_BEADS);             // pinned: s left; sliding: px left
    const bAge = new Float32Array(MAX_BEADS);
    const bTn = new Uint8Array(MAX_BEADS);              // trail samples
    const bTh = new Uint8Array(MAX_BEADS);              // ring head
    const bTx = new Float32Array(MAX_BEADS * TRAIL);
    const bTy = new Float32Array(MAX_BEADS * TRAIL);
    const bTs = new Float32Array(MAX_BEADS * TRAIL);    // birth time of the sample
    const rsX = new Float32Array(MAX_RESIDUE);
    const rsY = new Float32Array(MAX_RESIDUE);
    const rsR = new Float32Array(MAX_RESIDUE);
    const rsAge = new Float32Array(MAX_RESIDUE).fill(-1);
    let rsHead = 0;

    const tier = () => (state.q >= 0.95 ? 3 : state.q >= 0.7 ? 2 : state.q >= 0.5 ? 1 : 0);

    const spawnBead = (i, initial) => {
        bR[i] = strip ? random(1.1, 1.9) : random(1.3, 2.3);
        bY[i] = initial ? random(4, state.height * 0.85) : random(-2, state.height * 0.14);
        // Prefer open glass to the inside of a card, where it would be dimmed.
        for (let tries = 0; tries < 6; tries++) {
            bX[i] = random(10, Math.max(12, state.width - 10));
            if (coverAt(bX[i], bY[i]) > 0.9) break;
        }
        bV[i] = 0;
        bMode[i] = 0;
        bT[i] = random(0.4, 2.8);
        bAge[i] = initial ? 1 : 0;
        bTn[i] = 0;
        bTh[i] = 0;
    };

    const addResidue = (x, y, r) => {
        const i = rsHead;
        rsHead = (rsHead + 1) % MAX_RESIDUE;
        rsX[i] = x; rsY[i] = y; rsR[i] = r; rsAge[i] = 0;
    };

    const addSheen = (x, y, big, peak) => {
        const i = shHead;
        shHead = (shHead + 1) % MAX_SHEEN;
        shX[i] = x; shY[i] = y; shAge[i] = 0; shBig[i] = big ? 1 : 0; shPeak[i] = peak;
    };

    const addPendant = (t, x, grow0) => {
        let free = -1;
        let active = 0;
        for (let i = 0; i < MAX_PENDANT; i++) {
            if (peT[i] < 0) {
                if (free < 0) free = i;
            } else {
                active++;
                if (peT[i] === t && Math.abs(peX[i] - x) < 24) return false;
            }
        }
        if (free < 0 || active >= PENDANTS[tier()]) return false;
        peT[free] = t;
        peEl[free] = tEl[t];
        peX[free] = x;
        peDur[free] = random(1.7, 3.6) / (0.5 + tFilm[t]);
        peAge[free] = peDur[free] * grow0;
        peNeck[free] = 0;
        return true;
    };

    const spawnRun = (t, x) => {
        if (ruCool > 0 || RUNS[tier()] === 0) return;
        const w = tr[t] - tl[t];
        if (tK[t] !== 0 || w < 44 || tb[t] - tt[t] < 20) return;
        let free = -1;
        let active = 0;
        for (let i = 0; i < MAX_RUN; i++) {
            if (ruT[i] < 0) { if (free < 0) free = i; } else active++;
        }
        if (free < 0 || active >= RUNS[tier()]) return;
        const fx = clamp((x - tl[t]) / w, 0.06, 0.94);
        ruT[free] = t;
        ruEl[free] = tEl[t];
        ruPh[free] = 0;
        ruFx[free] = fx;
        ruDir[free] = fx < 0.5 ? -1 : 1;
        ruS[free] = 0;
        ruV[free] = 0;
        ruR[free] = 0.9;
        ruPin[free] = random(0.9, 2.2);
        ruStick[free] = random(0.5, 1.4);
        ruCool = random(1.8, 3.6);
    };

    // A drop of nominal speed vN (px/s along the surface normal) lands on
    // target t at (x, y). Strength maps to droplet count, launch speed, sheen.
    const impact = (t, x, y, vN, carry) => {
        const k = clamp(vN / 700, 0.4, 1.6);
        if (tRim[t]) {
            tWet[t] += (1 - tWet[t]) * (0.18 + 0.12 * k);
            tHx[t] = clamp((x - tl[t]) / Math.max(1, tr[t] - tl[t]), 0, 1);
        }
        tFilm[t] += (1 - tFilm[t]) * 0.07;
        surfaceNormal(t, x, y);
        const nx = NX;
        const ny = NY;
        const upTilt = Math.atan2(ny, nx);
        const kind = tK[t];
        const flat = tr[t] - tl[t] - 2 * tR[t];
        if (tier() >= 1 && kind !== 3) addSheen(x, y, k > 0.95 && flat > 46, 0.26 + 0.16 * k);
        const scale = SPLASH_SCALE[tier()] * (kind === 3 ? 0.7 : 1);
        const count = Math.max(1, Math.round((1.6 + 1.6 * k) * scale));
        for (let n = 0; n < count; n++) {
            const side = n & 1 ? 1 : -1;
            const ang = upTilt + side * (0.2 + 0.55 * Math.random());
            const speed = Math.min(150, 36 + 78 * k) * (0.75 + 0.5 * Math.random());
            const vx = Math.cos(ang) * speed + carry * 0.25;
            const vy = Math.sin(ang) * speed;
            const i = sdHead;
            sdHead = (sdHead + 1) % MAX_SPLASH;
            sdX[i] = x + nx * 0.8;
            sdY[i] = y + ny * 0.8;
            sdY0[i] = y + ny * 0.8;
            sdVx[i] = vx;
            sdVy[i] = vy;
            sdTtl[i] = sdLife[i] = clamp(-2 * vy / GRAVITY + 0.07, 0.2, 0.42);
        }
        if (kind === 0 && Math.random() < 0.05 + 0.25 * tFilm[t]) spawnRun(t, x);
    };

    const spawnPendant = () => {
        if (!nHitTargets) return;
        // Wetter, wider surfaces drip more.
        let best = -1;
        let bestScore = 0.12;
        for (let n = 0; n < nHitTargets; n++) {
            const t = hitList[n];
            if (tK[t] !== 0 || thh[t] < 7) continue;
            const score = tFilm[t] * (0.6 + Math.random() * 0.8);
            if (score > bestScore) { bestScore = score; best = t; }
        }
        if (best < 0) return;
        const r = tR[best];
        const lo = tl[best] + Math.max(r * 0.55, 6);
        const hi = tr[best] - Math.max(r * 0.55, 6);
        const x = hi > lo ? random(lo, hi) : tcx[best];
        if (addPendant(best, x, 0)) tFilm[best] *= 0.8;
    };

    // Mist and other slow CSS ambience only run when the rain is dense and the
    // loop is not throttled (they would keep the compositor busy at display
    // rate whatever the fps cap says).
    const syncCalm = () => {
        host.classList.toggle('rt-rain-calm', state.q < 0.5 || readRainFpsCap(S.rainFpsCap) < 60);
    };

    // A smaller canvas can leave glass beads and residue outside it, and only a
    // sliding bead ever respawns on its own: bring the strays back.
    const fitGlass = () => {
        const W = state.width;
        const H = state.height;
        for (let i = 0; i < nBeads; i++) {
            if (bX[i] < -bR[i] || bX[i] > W + bR[i] || bY[i] > H + bR[i]) spawnBead(i, false);
        }
        for (let i = 0; i < MAX_RESIDUE; i++) {
            if (rsAge[i] >= 0 && (rsX[i] < 0 || rsX[i] > W || rsY[i] > H)) rsAge[i] = -1;
        }
    };

    const seed = (all = true) => {
        const rainQuantity = readRainQuantitySetting(S.rainQuantity);
        state.q = RAIN_QUANTITY_PARTICLE_SCALE[rainQuantity] ?? 1;
        syncCalm();
        const target = state.q <= 0 ? 0
            : Math.max(6, Math.min(Math.round(MAX_DROPS * state.q),
                Math.round(state.width * state.height / AREA_PER_DROP * state.q)));
        growDrops(target);
        const old = nDrops;
        nDrops = target;
        const xMin = cullLeft();
        for (let i = 0; i < nDrops; i++) {
            if (all || i >= old || dx[i] > state.width + 40 || dx[i] < xMin || dy[i] > state.height) resetDrop(i, true);
        }
        const wantHit = state.q <= 0 ? 0 : Math.max(3, Math.round(HITTERS * state.q));
        for (let i = wantHit; i < nHit; i++) hs[i] = 0;
        for (let i = nHit; i < wantHit; i++) { hs[i] = 0; hWait[i] = random(0.1, 1.2); }
        nHit = wantHit;
        const wantBeads = state.q <= 0 ? 0 : BEADS[tier()];
        for (let i = nBeads; i < wantBeads; i++) spawnBead(i, true);
        nBeads = wantBeads;
        fitGlass();
        if (all) {
            sdLife.fill(0);
            shAge.fill(-1);
            rsAge.fill(-1);
            ruT.fill(-1);
            peT.fill(-1);
            drOn.fill(0);
            for (let i = 0; i < nBeads; i++) spawnBead(i, true);
            clearAllRims();
        }
    };

    // ── Lightning ───────────────────────────────────────────────────────
    // The timeline is RainSky's, shared with the other canvas. This canvas
    // dresses it: the drops and beads brighten, a cool flash washes in around
    // the bolt, the CSS haze glows (--rt-lit), wet surfaces glisten, and if it
    // is the owner it draws the bolt over the full height of its canvas.
    let flashGradient = null;
    const bx = new Float32Array(20);
    const by = new Float32Array(20);
    const bf = new Float32Array(20);      // how much light each bolt segment gets
    let boltId = 0;                       // the strike boltX was worked out for
    let boltX = 0;
    const lightning = {
        sky: null,
        level: 0,

        update(ts) {
            if (!lightningAllowed || !S.lightningEnabled) {
                if (lightning.sky) lightning.reset();
                RainSky.calm();
                return;
            }
            const s = RainSky.lightning(ts, skyId);
            lightning.sky = s;
            lightning.level = s ? s.level : 0;
            if (s && s.id !== state.strikeId) {
                state.strikeId = s.id;
                // Every solid surface glistens for a moment.
                for (let i = 0; i < tn; i++) if (tRim[i]) tWet[i] = Math.max(tWet[i], 0.6);
            }
            lightning.writeLit();
        },

        writeLit() {
            const q = Math.round(lightning.level * 20);
            if (q === state.litWritten) return;
            state.litWritten = q;
            if (q === 0) host.style.removeProperty('--rt-lit');
            else host.style.setProperty('--rt-lit', (q / 20).toFixed(2));
        },

        reset() {
            lightning.sky = null;
            lightning.level = 0;
            lightning.writeLit();
        },

        // Where the bar's bolt strikes: the shared x, nudged to the nearest gap
        // between the search box and the buttons so it does not cross them
        // (worked out once per strike).
        stripX(s) {
            if (boltId !== s.id) {
                boltId = s.id;
                const W = state.width;
                const H = state.height;
                boltX = s.x * W;
                for (let d = 0; d <= W * 0.3; d += 8) {
                    let found = false;
                    for (let side = 1; side >= -1; side -= 2) {
                        const x = clamp(s.x * W + side * d, 12, W - 12);
                        if (coverAt(x - 9, H * 0.4) > 0.95 && coverAt(x, H * 0.4) > 0.95 && coverAt(x + 9, H * 0.4) > 0.95
                            && coverAt(x, H * 0.15) > 0.95 && coverAt(x, H * 0.7) > 0.95) {
                            boltX = x;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }
            return boltX;
        },

        // Bolt polyline for this canvas: n+1 points from above the top to the
        // bottom edge, wandering by the strike's jitter.
        path(s, n) {
            const W = state.width;
            const H = state.height;
            const wander = strip ? 3.5 : 13;
            let x = strip ? lightning.stripX(s) : s.x * W;
            for (let i = 0; i <= n; i++) {
                bx[i] = clamp(x, 8, W - 8);
                by[i] = -4 + (H + 8) * i / n;
                x += s.jit[i % s.jit.length] * wander + wl[2] * (H + 8) / n * 0.6;
            }
        },

        draw() {
            const s = lightning.sky;
            const level = lightning.level;
            if (!s || level < 0.01) return;
            const dpr = state.dpr;
            const W = state.width;
            const H = state.height;
            const rx = strip ? W * 0.25 : Math.max(160, W * 0.75);
            const ry = strip ? H * 1.4 : Math.max(64, H * 0.17);
            if (!flashGradient) {
                flashGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
                flashGradient.addColorStop(0, 'rgba(196, 214, 255, 1)');
                flashGradient.addColorStop(0.45, 'rgba(196, 214, 255, 0.36)');
                flashGradient.addColorStop(1, 'rgba(196, 214, 255, 0)');
            }
            // The panel's flash is centred a little below the top edge, not on it:
            // there it would wash out the muted header text (it stays above ~4:1).
            // Its size is what the old one covered on screen: a fill costs by pixel.
            ctx.setTransform(dpr * rx, 0, 0, dpr * ry, dpr * (strip ? lightning.stripX(s) : s.x * W), dpr * H * (strip ? 0.5 : 0.14));
            ctx.globalAlpha = Math.min(0.9, (strip ? 0.17 : 0.24) * level);
            ctx.fillStyle = flashGradient;
            ctx.fillRect(-1, -1, 2, 2);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
        },

        // The bolt itself: three stacked strokes stand in for shadowBlur (which
        // costs 4-60x more). It tapers on the way down, and each segment dims
        // behind cards and text (averaged over both ends and the middle), like the
        // rain does. In the 56 px bar a full-height zigzag reads as a crack
        // across the search box, so there it is a short bright spike that fades
        // out into a soft column of light (a radial glow, no hard edge).
        drawBolt() {
            const s = lightning.sky;
            const level = lightning.level;
            if (!s || s.owner !== skyId || level < 0.01 || !flashGradient) return;
            const dpr = state.dpr;
            const H = state.height;
            const segs = strip ? 6 : 16;
            lightning.path(s, segs);
            const a = Math.min(1, level * 1.15);
            const covered = coverCount > 0;
            for (let i = 0; i < segs; i++) {
                let f = 1;
                if (covered) {
                    f = (coverAt(bx[i], by[i]) + coverAt((bx[i] + bx[i + 1]) / 2, (by[i] + by[i + 1]) / 2) + coverAt(bx[i + 1], by[i + 1])) / 3;
                }
                const t = i / segs;
                // A little light is left behind a surface; the bar's spike also fades with depth.
                bf[i] = (strip ? 0.1 + 0.9 * f : 0.16 + 0.84 * f) * (strip ? 1 - 0.85 * t * t : 1);
            }
            if (strip) {
                // Light spilling around the strike: wide and faint at the top edge,
                // a narrow column down the bar.
                ctx.globalAlpha = Math.min(0.9, 0.5 * level);
                ctx.fillStyle = flashGradient;
                ctx.setTransform(dpr * 26, 0, 0, dpr * H * 0.8, dpr * bx[2], dpr * H * 0.3);
                ctx.fillRect(-1, -1, 2, 2);
                ctx.globalAlpha = Math.min(0.9, 0.42 * level);
                ctx.setTransform(dpr * 70, 0, 0, dpr * H * 0.45, dpr * bx[0], 0);
                ctx.fillRect(-1, -1, 2, 2);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.lineJoin = 'round';
            for (let pass = 0; pass < 3; pass++) {
                ctx.strokeStyle = pass === 2 ? 'rgb(244, 250, 255)' : 'rgb(130, 190, 255)';
                ctx.lineCap = pass === 2 ? 'round' : 'butt';
                const w = strip ? (pass === 0 ? 5 : pass === 1 ? 2.2 : 1) : (pass === 0 ? 9 : pass === 1 ? 3.6 : 1.2);
                const pa = pass === 0 ? 0.16 : pass === 1 ? 0.32 : 0.8;
                for (let i = 0; i < segs; i++) {
                    ctx.globalAlpha = Math.min(0.92, pa * a * bf[i]);
                    ctx.lineWidth = w * (1 - (strip ? 0.6 : 0.25) * i / segs);
                    ctx.beginPath();
                    ctx.moveTo(bx[i], by[i]);
                    ctx.lineTo(bx[i + 1], by[i + 1]);
                    ctx.stroke();
                }
            }
            // A fork off one of the upper segments.
            const fi = Math.min(segs - 2, strip ? Math.min(s.fork, 2) : s.fork);
            ctx.strokeStyle = 'rgb(190, 222, 255)';
            ctx.lineCap = 'round';
            ctx.lineWidth = 0.9;
            ctx.globalAlpha = Math.min(0.8, 0.55 * a * bf[fi]);
            ctx.beginPath();
            ctx.moveTo(bx[fi], by[fi]);
            ctx.lineTo(bx[fi] + s.forkDx * (strip ? 6 : 24), by[fi] + (by[fi + 1] - by[fi]) * 0.9);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        },
    };

    // ── Frame ───────────────────────────────────────────────────────────
    const SPLASH_STROKE = 'rgb(214, 238, 255)';
    const DRIP_STROKE = 'rgb(200, 232, 255)';
    const TRAIL_STROKE = 'rgb(176, 214, 250)';
    const SPLASH_ALPHA = [0.9, 0.6, 0.3];
    const TRAIL_ALPHA = [0.2, 0.11, 0.05];
    const TRAIL_WIDTH = [1.5, 1.05, 0.7];       // a wet smear: wider by the bead, thinner as it dries
    const TRAIL_BUCKET_S = [0.8, 1.7, 2.6];     // a trail sample fades out in about 2.6 s
    const A_MAX = 0.92;                          // an alpha above 1 would be ignored by the canvas

    // The header's muted text has to stay readable under the clouds, and under
    // their lightning (the title and the buttons are bright or sit on glass of
    // their own): thin the cloud layer out behind the text block, feathered
    // with three nested rects, and thinner still while it is lit. Only clouds
    // are on the canvas at this point, so nothing else is touched.
    const dimCloudsBehindText = lit => {
        const a = 1 - Math.pow(1 - Math.min(0.97, 0.52 + 0.45 * lit), 1 / 3);
        const r = hdrText;
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = a;
        ctx.fillStyle = '#000';
        ctx.fillRect(r.x - 18, r.y - 12, r.w + 36, r.h + 24);
        ctx.fillRect(r.x - 10, r.y - 6, r.w + 20, r.h + 12);
        ctx.fillRect(r.x - 2, r.y, r.w + 4, r.h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const drawFrame = dt => {
        const dpr = state.dpr;
        const W = state.width;
        const H = state.height;
        const cw = canvas.width;
        const ch = canvas.height;
        const level = lightning.level;
        // Lightning lights the drops; a gust thickens them; if there are more
        // surfaces than slots some of them are not dimming the rain, so hold back.
        const bright = (1 + 1.1 * level) * thick * (state.overflow ? 0.65 : 1);
        const covered = coverCount > 0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, cw, ch);
        ctx.imageSmoothingEnabled = false;

        // Clouds, behind everything else.
        if (S.cloudsEnabled && !strip) {
            if (!clouds) {
                clouds = StormClouds.create({ strip });
                clouds.resize(W, H, dpr);
            }
            const sky = lightning.sky;
            clouds.draw(ctx, state.now, RainSky.wind(state.now), RainSky.gust, level, sky ? (strip ? lightning.stripX(sky) / W : sky.x) : -1);
            if (hdrText.w > 0) dimCloudsBehindText(level);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.imageSmoothingEnabled = false;
        } else if (clouds) {
            clouds.dispose();
            clouds = null;
        }

        // 0. Lightning flash, under the rain.
        lightning.draw();

        // 1. Background rain, one upright integer-pixel blit per drop.
        const vFade = strip ? 0 : 0.2 / H;      // the panel's rain thins out down its height
        const xMin = cullLeft();
        for (let i = 0; i < nDrops; i++) {
            const l = dl[i];
            const c = dc[i];
            const v = dv[i];
            const x = dx[i] + v * wl[l] * dt;
            const y = dy[i] + v * dt;
            const len = STREAK_LEN[l * 2 + c];
            if (y - len > H + 2 || x > W + 8 || x < xMin) {
                resetDrop(i, false);
                continue;
            }
            dx[i] = x;
            dy[i] = y;
            const si = (l * 2 + c) * BINS + lb[l];
            const px = Math.round(x * dpr - spAX[si]);
            const py = Math.round(y * dpr - spAY[si]);
            if (px + spW[si] <= 0 || px >= cw || py + spH[si] <= 0 || py >= ch) continue;
            let a = da[i] * bright * (1 - vFade * y);
            if (!strip) a *= x < 14 ? 0.55 + 0.45 * Math.max(0, x) / 14 : x > W - 14 ? 0.55 + 0.45 * Math.max(0, W - x) / 14 : 1;
            if (covered) a *= coverAt(x - wl[l] * len * 0.4, y - len * 0.4);
            if (a < 0.006) continue;
            ctx.globalAlpha = a > A_MAX ? A_MAX : a;
            ctx.drawImage(sprites[si], px, py);
        }

        // 2. Wet glass: beads sliding with fading trails, residue droplets.
        if (nBeads > 0) drawGlass(dt, bright);

        // 3. Hitters.
        for (let i = 0; i < nHit; i++) {
            if (hs[i] === 0) {
                hWait[i] -= dt;
                if (hWait[i] > 0) continue;
                if (!planHitter(i)) {
                    hWait[i] = random(0.1, 0.3);
                    continue;
                }
            }
            const l = hl[i];
            const c = hc[i];
            const v = hv[i];
            const len = STREAK_LEN[l * 2 + c];
            let t = hT[i];
            let x;
            let y;
            if (hs[i] === 1) {
                if (t >= 0 && !targetIs(t, hEl[i])) hT[i] = t = -1; // gone: let it fall through
                const prevY = hy[i];
                y = prevY + v * dt;
                let lean = wl[l];
                let landX = 0;
                let sy = Infinity;
                if (t >= 0) {
                    // Steer towards the aimed point on the live geometry, so a
                    // target that moved (scroll, resize, the panel opening) still
                    // gets its drop.
                    landX = tl[t] + hFx[i] * (tr[t] - tl[t]);
                    sy = surfaceTop(t, landX);
                    if (sy === Infinity) hT[i] = t = -1;
                    else lean = clamp((landX - hx[i]) / Math.max(6, sy - prevY), WIND_MIN, WIND_MAX);
                }
                hLean[i] = lean;
                x = hx[i] + v * lean * dt;
                hx[i] = x;
                hy[i] = y;
                if (t >= 0 && prevY < sy && y >= sy) {
                    impact(t, landX, sy, v / SPEED_SCALE, v * lean);
                    hs[i] = 2;
                    hLand[i] = sy;
                    hx[i] = x = landX;
                    // The wait starts now; the streak still pours into the edge.
                    hWait[i] = random(HIT_WAIT[0], HIT_WAIT[1]) * (1 + (1 - state.q) * 0.7);
                } else if (y - len > H + 2 || x > W + 40 || x < -60) {
                    hs[i] = 0;
                    hWait[i] = random(0.1, 0.8);
                    continue;
                }
            } else {
                // Pouring in: the part of the streak still above the edge.
                y = hy[i] + v * dt;
                hy[i] = y;
                x = hx[i] + v * hLean[i] * dt;
                hx[i] = x;
                if (y - len > hLand[i]) {
                    hs[i] = 0;
                    continue;
                }
            }
            let a = ha[i] * bright;
            if (hd[i] > 0) a *= Math.min(1, (y - hf[i]) / hd[i]);
            if (hs[i] === 1 && covered) a *= coverAt(x - hLean[i] * len * 0.4, y - len * 0.4);
            if (a < 0.006) continue;
            const si = (l * 2 + c) * BINS + binFor(hLean[i]);
            const px = Math.round(x * dpr - spAX[si]);
            const py = Math.round(y * dpr - spAY[si]);
            ctx.globalAlpha = a > A_MAX ? A_MAX : a;
            if (hs[i] === 2) {
                const rows = Math.min(spH[si], Math.round(hLand[i] * dpr) - py);
                if (rows > 0) ctx.drawImage(sprites[si], 0, 0, spW[si], rows, px, py, spW[si], rows);
            } else {
                ctx.drawImage(sprites[si], px, py);
            }
        }

        // 4. Wetness decay and the glints where drops landed.
        const wetDecay = 1 - dt / 1.4;
        const filmDecay = 1 - dt / 6;
        for (let i = 0; i < tn; i++) {
            tWet[i] *= wetDecay;
            tFilm[i] *= filmDecay;
        }
        for (let i = 0; i < MAX_SHEEN; i++) {
            if (shAge[i] < 0) continue;
            const age = shAge[i] += dt;
            if (age > 0.7) {
                shAge[i] = -1;
                continue;
            }
            const a = shPeak[i] * bright * (age < 0.04 ? age / 0.04 : Math.exp(-(age - 0.04) / 0.2));
            if (a < 0.008) continue;
            const s = sheenSprites[shBig[i]];
            ctx.globalAlpha = a > A_MAX ? A_MAX : a;
            ctx.drawImage(s.c, Math.round((shX[i] - s.w / 2) * dpr), Math.round((shY[i] - s.h / 2) * dpr));
        }

        // 5. Splash droplets: three alpha buckets, one stroke each.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let liveSplash = false;
        for (let i = 0; i < MAX_SPLASH; i++) {
            if (sdLife[i] <= 0) continue;
            sdLife[i] -= dt;
            sdVy[i] += GRAVITY * dt;
            sdX[i] += sdVx[i] * dt;
            sdY[i] += sdVy[i] * dt;
            if (sdLife[i] <= 0 || (sdVy[i] > 0 && sdY[i] > sdY0[i] + 1.5)) sdLife[i] = 0;
            else liveSplash = true;
        }
        if (liveSplash) {
            ctx.lineCap = 'round';
            ctx.lineWidth = 1.1;
            ctx.strokeStyle = SPLASH_STROKE;
            for (let b = 0; b < 3; b++) {
                ctx.beginPath();
                for (let i = 0; i < MAX_SPLASH; i++) {
                    if (sdLife[i] <= 0) continue;
                    const f = sdLife[i] / sdTtl[i];
                    if ((f > 0.66 ? 0 : f > 0.33 ? 1 : 2) !== b) continue;
                    ctx.moveTo(sdX[i], sdY[i]);
                    ctx.lineTo(sdX[i] - sdVx[i] * 0.028, sdY[i] - sdVy[i] * 0.028);
                }
                ctx.globalAlpha = Math.min(A_MAX, SPLASH_ALPHA[b] * 0.62 * bright);
                ctx.stroke();
            }
        }

        // 6. Water on the surfaces: runs, pendants, falling drips.
        if (tier() >= 1) {
            ruCool -= dt;
            drawRuns(dt, bright);
            peCool -= dt;
            if (peCool <= 0) {
                peCool = 0.7 + Math.random() * 0.9;
                spawnPendant();
            }
            drawPendants(dt, bright);
        }

        // 7. The bolt, over everything else on the canvas.
        lightning.drawBolt();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
    };

    // Ambient wet glass. Called inside drawFrame; leaves the transform at dpr.
    const drawGlass = (dt, bright) => {
        const dpr = state.dpr;
        const H = state.height;
        const now = state.now;
        const covered = coverCount > 0;
        // Motion and merging.
        for (let i = 0; i < nBeads; i++) {
            bAge[i] += dt;
            if (bMode[i] === 0) {
                bT[i] -= dt;
                bR[i] = Math.min(3.4, bR[i] + 0.05 * dt);
                if (bT[i] <= 0) {
                    bMode[i] = 1;
                    bT[i] = random(9, 34);
                    bV[i] = 0;
                }
            } else {
                // Bigger beads slide faster and drift a touch with the wind.
                bV[i] += (14 + 22 * (bR[i] - 1) - bV[i]) * Math.min(1, dt * 6);
                const d = bV[i] * dt;
                bY[i] += d;
                bX[i] += d * wl[1] * 0.2;
                bT[i] -= d;
                const th = bTh[i];
                const last = (th + TRAIL - 1) % TRAIL;
                if (bTn[i] === 0 || bY[i] - bTy[i * TRAIL + last] >= 4) {
                    bTx[i * TRAIL + th] = bX[i];
                    bTy[i * TRAIL + th] = bY[i];
                    bTs[i * TRAIL + th] = now;
                    bTh[i] = (th + 1) % TRAIL;
                    bTn[i] = Math.min(TRAIL, bTn[i] + 1);
                }
                if (Math.random() < d * 0.05) addResidue(bX[i] + random(-0.4, 0.4), bY[i] - bR[i], random(0.45, 0.85));
                if (bT[i] <= 0) {
                    bMode[i] = 0;
                    bT[i] = random(0.9, 3.2);
                    bR[i] = Math.max(1, bR[i] * 0.97);
                }
                if (bY[i] > H + bR[i] + 2) spawnBead(i, false);
            }
        }
        for (let i = 0; i < nBeads; i++) {
            for (let j = i + 1; j < nBeads; j++) {
                const ddx = bX[i] - bX[j];
                const ddy = bY[i] - bY[j];
                const rr = (bR[i] + bR[j]) * 0.85;
                if (ddx * ddx + ddy * ddy > rr * rr || bAge[i] < 0.6 || bAge[j] < 0.6) continue;
                // Merge into the bigger bead; mass (r²) is conserved.
                const a = bR[i] >= bR[j] ? i : j;
                const b = a === i ? j : i;
                const m = bR[a] * bR[a] + bR[b] * bR[b];
                bX[a] = (bX[a] * bR[a] * bR[a] + bX[b] * bR[b] * bR[b]) / m;
                bY[a] = (bY[a] * bR[a] * bR[a] + bY[b] * bR[b] * bR[b]) / m;
                bR[a] = Math.min(3.6, Math.sqrt(m));
                bMode[a] = 0;
                bT[a] = 0.35;
                spawnBead(b, false);
            }
        }
        for (let i = 0; i < MAX_RESIDUE; i++) if (rsAge[i] >= 0) {
            rsAge[i] += dt;
            if (rsAge[i] > 6) rsAge[i] = -1;
        }

        // Trails: straight, thin, fading. Three alpha buckets, one stroke each.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.strokeStyle = TRAIL_STROKE;
        for (let b = 0; b < 3; b++) {
            ctx.lineWidth = TRAIL_WIDTH[b];
            const lo = b === 0 ? 0 : TRAIL_BUCKET_S[b - 1];
            const hi = TRAIL_BUCKET_S[b];
            ctx.beginPath();
            let any = false;
            for (let i = 0; i < nBeads; i++) {
                const n = bTn[i];
                for (let k = 0; k < n; k++) {
                    // Segment from this sample to the next newer one (or the bead).
                    const s0 = (bTh[i] - n + k + TRAIL * 2) % TRAIL + i * TRAIL;
                    const age = now - bTs[s0];
                    if (age < lo || age >= hi) continue;
                    let x1;
                    let y1;
                    if (k === n - 1) {
                        if (bMode[i] === 0) continue;
                        x1 = bX[i]; y1 = bY[i];
                    } else {
                        const s1 = (bTh[i] - n + k + 1 + TRAIL * 2) % TRAIL + i * TRAIL;
                        x1 = bTx[s1]; y1 = bTy[s1];
                    }
                    // Behind a card the trail would run through its text.
                    if (covered && coverAt((bTx[s0] + x1) / 2, (bTy[s0] + y1) / 2) < 0.6) continue;
                    ctx.moveTo(bTx[s0], bTy[s0]);
                    ctx.lineTo(x1, y1);
                    any = true;
                }
            }
            if (any) {
                ctx.globalAlpha = Math.min(A_MAX, TRAIL_ALPHA[b] * bright * (strip ? 1.3 : 1));
                ctx.stroke();
            }
        }

        // Residue droplets and the beads themselves.
        ctx.imageSmoothingEnabled = true;
        const s = beadSprite;
        for (let i = 0; i < MAX_RESIDUE; i++) {
            if (rsAge[i] < 0) continue;
            let a = 0.5 * (1 - rsAge[i] / 6) * bright;
            if (covered) a *= coverAt(rsX[i], rsY[i]) ** 2;
            if (a < 0.01) continue;
            const size = rsR[i] * 2.6;
            ctx.globalAlpha = Math.min(A_MAX, a);
            ctx.drawImage(s.c, rsX[i] - size / 2, rsY[i] - size / 2, size, size);
        }
        for (let i = 0; i < nBeads; i++) {
            let a = Math.min(1, bAge[i] / 0.6) * 0.95 * bright;
            if (covered) a *= coverAt(bX[i], bY[i]) ** 2;
            if (a < 0.01) continue;
            const size = bR[i] * 2.7;
            ctx.globalAlpha = Math.min(A_MAX, a);
            ctx.drawImage(s.c, bX[i] - size / 2, bY[i] - size / 2, size, size);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    // Runs: a bead that swells on a card's top edge, creeps to the nearer
    // corner, runs round it and down the side, then hangs as a pendant.
    const drawRuns = (dt, bright) => {
        ctx.imageSmoothingEnabled = true;
        const s = beadSprite;
        for (let i = 0; i < MAX_RUN; i++) {
            const t = ruT[i];
            if (t < 0) continue;
            if (!targetIs(t, ruEl[i]) || tK[t] !== 0) {
                ruT[i] = -1;
                ruEl[i] = null;
                continue;
            }
            let ok;
            if (ruPh[i] === 0) {
                ruPin[i] -= dt;
                ruR[i] = Math.min(1.9, ruR[i] + 0.55 * dt);
                ok = outline(t, ruFx[i], ruDir[i], 0);
                if (ruPin[i] <= 0) ruPh[i] = 1;
            } else {
                ok = outline(t, ruFx[i], ruDir[i], ruS[i]);
                // Along the top it creeps in stick-slip; going down, gravity
                // along the outline speeds it up.
                ruStick[i] -= dt;
                const stuck = ruStick[i] < 0 && ruStick[i] > -0.4 && OTY < 0.9;
                if (ruStick[i] < -0.4) ruStick[i] = random(0.7, 1.7);
                const target = stuck ? 0 : 8 + 95 * OTY * OTY;
                ruV[i] += (target - ruV[i]) * Math.min(1, dt * 5);
                ruS[i] += ruV[i] * dt;
                if (OTY > 0.5) ruR[i] = Math.min(2.2, ruR[i] + 0.06 * dt);
                if (!ok) {
                    // Reached the underside: hang there (and drip).
                    const cx = OX;
                    ruT[i] = -1;
                    ruEl[i] = null;
                    if (!addPendant(t, cx, 0.45)) {
                        const j = drOn.indexOf(0);
                        if (j >= 0) {
                            drOn[j] = 1;
                            drX[j] = cx;
                            drY[j] = OY + 1;
                            drV[j] = 0;
                        }
                    }
                    continue;
                }
            }
            const r = ruR[i];
            const off = r * 0.5;
            const size = r * 2.5;
            const a = Math.min(A_MAX, 0.85 * bright);
            ctx.globalAlpha = a;
            ctx.drawImage(s.c, OX + ONX * off - size / 2, OY + ONY * off - size / 2, size, size);
        }
        ctx.imageSmoothingEnabled = false;
    };

    const drawPendants = (dt, bright) => {
        ctx.imageSmoothingEnabled = true;
        const bead = beadSprite;
        for (let i = 0; i < MAX_PENDANT; i++) {
            const t = peT[i];
            if (t < 0) continue;
            if (t >= tn || tEl[t] !== peEl[i]) {
                peT[i] = -1;
                peEl[i] = null;
                continue;
            }
            const age = peAge[i] += dt;
            const grow = Math.min(1, age / peDur[i]);
            const r = 0.6 + 1.7 * grow * grow;
            let stretch = 1 + 0.35 * (r - 0.8) / 1.6;
            const by = surfaceBottom(t, peX[i]);
            if (grow >= 1) {
                const neck = peNeck[i] += dt;
                stretch += neck * 3;
                if (neck > 0.16) {
                    const j = drOn.indexOf(0);
                    if (j >= 0) {
                        drOn[j] = 1;
                        drX[j] = peX[i];
                        drY[j] = by + r * 1.6;
                        drV[j] = 0;
                    }
                    // A small residue stays and regrows.
                    peAge[i] = peDur[i] * 0.35;
                    peNeck[i] = 0;
                    if (Math.random() < 0.6) {
                        peT[i] = -1;
                        peEl[i] = null;
                    }
                    continue;
                }
            }
            const w = r * 2.4;
            const h = w * stretch;
            ctx.globalAlpha = Math.min(A_MAX, (0.35 + grow * 0.5) * bright);
            ctx.drawImage(bead.c, peX[i] - w / 2, by - h * 0.22, w, h);
        }
        ctx.imageSmoothingEnabled = false;

        let liveDrip = false;
        for (let i = 0; i < MAX_DRIP; i++) {
            if (!drOn[i]) continue;
            const prevY = drY[i];
            drV[i] += DRIP_GRAVITY * dt;
            const y = prevY + drV[i] * dt;
            drY[i] = y;
            let hit = -1;
            let hitY = Infinity;
            for (let n = 0; n < nHitTargets; n++) {
                const t = hitList[n];
                if (tK[t] === 2) continue;
                const sy = surfaceTop(t, drX[i]);
                if (sy >= prevY && sy <= y && sy < hitY) { hit = t; hitY = sy; }
            }
            if (hit >= 0) {
                impact(hit, drX[i], hitY, drV[i], 0);
                drOn[i] = 0;
            } else if (y > state.height + 12) {
                drOn[i] = 0;
            } else {
                liveDrip = true;
            }
        }
        if (liveDrip) {
            ctx.lineCap = 'round';
            ctx.lineWidth = 1.3;
            ctx.strokeStyle = DRIP_STROKE;
            ctx.globalAlpha = Math.min(A_MAX, 0.5 * bright);
            ctx.beginPath();
            for (let i = 0; i < MAX_DRIP; i++) {
                if (!drOn[i]) continue;
                ctx.moveTo(drX[i], drY[i]);
                ctx.lineTo(drX[i], drY[i] - Math.min(drV[i] * 0.03, 14));
            }
            ctx.stroke();
        }
    };

    // The wet rim is CSS (a 1 px inner highlight on the element itself, painted
    // above its translucent fill). The engine only writes two quantised custom
    // properties, at most 10 times a second, and only when they changed.
    const WET_STR = ['0', '0.125', '0.25', '0.375', '0.5', '0.625', '0.75', '0.875', '1'];
    const HX_STR = ['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
    let wetFlushTs = 0;
    const flushWet = ts => {
        if (ts - wetFlushTs < WET_FLUSH_MS) return;
        wetFlushTs = ts;
        for (let i = 0; i < tn; i++) {
            const el = tEl[i];
            if (!el || !tRim[i]) continue;
            const q = tWet[i] < 0.06 ? 0 : Math.min(8, Math.round(tWet[i] * 8));
            const h = Math.round(tHx[i] * 10);
            if (q === tWq[i] && (q === 0 || h === tHq[i])) continue;
            if (q === 0) {
                clearRim(i);
                continue;
            }
            if (q !== tWq[i]) el.style.setProperty('--rt-wet', WET_STR[q]);
            if (h !== tHq[i] || tWq[i] === 0) el.style.setProperty('--rt-hx', HX_STR[h]);
            tWq[i] = q;
            tHq[i] = h;
        }
    };

    // ── Layout ──────────────────────────────────────────────────────────
    const layout = {
        requestResize() {
            state.resizePending = true;
        },

        markDirty() {
            state.dirty = true;
        },

        resize() {
            state.resizePending = false;
            const rect = canvas.getBoundingClientRect();
            const width = Math.max(1, Math.round(canvas.clientWidth || rect.width));
            const height = Math.max(1, Math.round(canvas.clientHeight || rect.height));
            const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
            if (width === state.width && height === state.height && dpr === state.dpr) return false;

            const dprChanged = dpr !== state.dpr;
            state.width = width;
            state.height = height;
            state.dpr = dpr;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            flashGradient = null;
            clouds?.resize(width, height, dpr);
            const ht = strip ? null : host.querySelector?.('.rt-hdr-text');
            if (ht) {
                const hr = ht.getBoundingClientRect();
                hdrText.x = hr.left - rect.left;
                hdrText.y = hr.top - rect.top;
                hdrText.w = hr.width;
                hdrText.h = hr.height;
            }
            ensureSprites();
            // Keep the rain that is already falling when only the size changed.
            seed(dprChanged && !nDrops);
            state.dirty = true;
            state.measureTs = -1e9;
            return true;
        },
    };

    // Nothing to see (and nothing to spend GPU on) while the tab is hidden, a
    // fullscreen element covers the page, the canvas is scrolled/hidden out of
    // view, or the user asked their OS for reduced motion (the rain and the
    // lightning flashes are pure decoration).
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let inView = true;
    let disposed = false;

    const lifecycle = {
        shouldRun() {
            return !disposed
                && !document.hidden
                && !document.fullscreenElement
                && !reducedMotion?.matches
                && inView
                && shouldRun();
        },

        updateFrameInterval() {
            state.frameIntervalMs = 1000 / readRainFpsCap(S.rainFpsCap);
            syncCalm();
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
            state.now = ts / 1000;

            // Geometry is read before anything is drawn or written this frame.
            const since = ts - state.measureTs;
            if ((state.dirty && since >= MEASURE_MIN_MS) || since >= MEASURE_POLL_MS) measure(ts);

            wind.update(state.now, dt);
            lightning.update(ts);
            drawFrame(dt);
            flushWet(ts);

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
            state.strikeId = 0;
            lightning.reset();
            // A paused loop would leave every rim frozen at its last level.
            clearAllRims();
        },

        // Reduced motion: no rain, no drift, but the clouds are still there:
        // one frame, painted again when the size or the setting changes.
        still() {
            if (disposed || document.hidden || !shouldRun() || !reducedMotion?.matches) return;
            if (state.resizePending) layout.resize();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!S.cloudsEnabled || strip) return;
            if (!clouds) {
                clouds = StormClouds.create({ strip });
                clouds.resize(state.width, state.height, state.dpr);
            }
            clouds.draw(ctx, CLOUD_STILL_S, 0.1, 0, 0, -1);
            if (hdrText.w > 0) dimCloudsBehindText(0);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
        },

        sync() {
            state.dirty = true;
            if (lifecycle.shouldRun()) lifecycle.start();
            else {
                lifecycle.stop();
                lifecycle.still();
            }
        },
    };

    // ── Teardown ────────────────────────────────────────────────────────
    // Everything below is undone by dispose(), so a host that is replaced
    // (YouTube re-creates its masthead) does not leave a whole engine behind:
    // observers, window / document listeners, the RainSky slot, the sprite
    // canvases and the typed arrays.
    const observers = [];
    const unlisten = [];
    const listen = (target, type, fn, options) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, fn, options);
        unlisten.push(() => target.removeEventListener(type, fn, options));
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        lifecycle.stop();                       // frame loop, --rt-lit and every inline rim property
        for (const off of unlisten) off();
        unlisten.length = 0;
        for (const o of observers) o.disconnect();
        observers.length = 0;
        RainSky.leave(skyId);
        clouds?.dispose();
        clouds = null;
        host.classList.remove('rt-rain-calm');
        canvas.width = canvas.height = 0;       // clears it and frees the backing store
        for (const cv of sprites) if (cv) cv.width = cv.height = 0;
        sprites.fill(null);
        for (const sh of sheenSprites) if (sh) sh.c.width = sh.c.height = 0;
        sheenSprites = [null, null];
        if (beadSprite) beadSprite.c.width = beadSprite.c.height = 0;
        beadSprite = null;
        spriteDpr = 0;
        flashGradient = null;
        tEl.fill(null); hEl.fill(null); ruEl.fill(null); peEl.fill(null);
        tn = nHitTargets = coverCount = nDrops = nHit = nBeads = 0;
        dx = new Float32Array(0); dy = new Float32Array(0); dv = new Float32Array(0);
        da = new Float32Array(0); dl = new Uint8Array(0); dc = new Uint8Array(0);
        // Only take back hooks that are still ours (a successor may have set its own).
        if (host.__rtRainDispose === dispose) {
            delete host.__rtRainMoved;
            delete host.__rtRainQuantityChanged;
            delete host.__rtRainFpsChanged;
            delete host.__rtLightningChanged;
            delete host.__rtCloudsChanged;
            delete host.__rtRainDispose;
        }
    };

    host.__rtRainMoved = layout.markDirty;
    host.__rtRainQuantityChanged = () => {
        seed(true);
        lifecycle.sync();
    };
    host.__rtRainFpsChanged = () => {
        lifecycle.updateFrameInterval();
        state.lastTs = 0;
        state.nextFrameTs = 0;
        lifecycle.sync();
    };
    host.__rtLightningChanged = () => {
        if (!S.lightningEnabled) {
            lightning.reset();
            RainSky.calm();
        }
        lifecycle.sync();
    };
    host.__rtCloudsChanged = () => {
        if (!S.cloudsEnabled && clouds) {
            clouds.dispose();
            clouds = null;
        }
        lifecycle.sync();
    };
    host.__rtRainDispose = dispose;

    wind.init();
    observers.push(new MutationObserver(lifecycle.sync));
    observers[0].observe(host, { attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) {
        observers.push(new window.ResizeObserver(layout.requestResize));
        observers[observers.length - 1].observe(canvas);
    }
    if (window.IntersectionObserver) {
        observers.push(new window.IntersectionObserver(entries => {
            inView = entries[entries.length - 1].isIntersecting;
            lifecycle.sync();
        }));
        observers[observers.length - 1].observe(canvas);
    }
    listen(reducedMotion, 'change', lifecycle.sync);
    listen(document, 'fullscreenchange', lifecycle.sync, { passive: true });
    listen(document, 'visibilitychange', lifecycle.sync, { passive: true });
    listen(window, 'resize', layout.requestResize, { passive: true });
    // A surface can move without its size changing: a scroll, or the panel's
    // open animation finishing. Both just flag a re-measure.
    listen(host, 'transitionend', layout.markDirty, { capture: true, passive: true });
    listen(host, 'animationend', layout.markDirty, { capture: true, passive: true });
    if (scrollSelector) listen(host, 'scroll', layout.markDirty, { capture: true, passive: true });
    layout.resize();
    return dispose;
}

// Surfaces the panel rain lands on (and dims behind), and text blocks it only
// dims behind.
const PANEL_RAIN_TARGETS = '.rt-mark, .rt-hdr-btn, .rt-card, .rt-dl, .rt-ctrl, .rt-tc, .rt-note';
const PANEL_RAIN_COVERS = '.rt-hdr-text, .rt-section, .rt-foot';

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

    const panel = mk('div', null, null, { id: 'rt_panel', role: 'dialog', 'aria-label': 'RainTube' });

    const hdr = mk('header', 'rt-hdr', null, { id: 'rt_drag' });

    // Rain animation layer: one canvas behind the whole panel, so the cards
    // and buttons are real surfaces the rain lands on.
    const rain = mk('canvas', 'rt-rain-canvas', null, { 'aria-hidden': 'true' });
    panel.appendChild(rain);

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
    controls.appendChild(buildControlButton('rt_dl_stop', '✕', 'rt-ctrl-cancel', 'Stop download'));

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
    initHeaderRain(rain, panel, {
        targetSelector: PANEL_RAIN_TARGETS,
        // Every panel target has a wet-rim rule in the stylesheet.
        rimSelector: PANEL_RAIN_TARGETS,
        coverSelector: PANEL_RAIN_COVERS,
        scrollSelector: '.rt-body',
    });
    initTooltips(panel);
    resetProgress();

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
            if (child && child.id !== 'rt_fab' && child.id !== 'rt_stats_fab') return { row: host, before: child };
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

const BUTTON_PLACEMENT_CLASSES = ['rt-topbar', 'rt-floating', 'rt-watch-action'];

// Toggle only the classes that differ, so the 5 s re-mount pass doesn't
// remove and re-add the same class (a style invalidation) every time.
function setButtonPlacementClass(btn, placementClass) {
    for (const cls of BUTTON_PLACEMENT_CLASSES) btn.classList.toggle(cls, cls === placementClass);
}

function parkHiddenToolbarButton(btn) {
    if (!btn || !btn.hidden) return;
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    setButtonPlacementClass(btn, 'rt-floating');
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
        if (btn.parentElement !== row || btn.nextElementSibling !== anchor) row.insertBefore(btn, anchor);
        btn.style.display = '';
        setButtonPlacementClass(btn, placementClass);
        anchor = btn;
    }
}

function parkUnavailablePlacementButton(btn) {
    if (!btn || btn.hidden) return;
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    setButtonPlacementClass(btn, null);
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
        setButtonPlacementClass(btn, 'rt-floating');
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
            const text = vid ? (readCurrentQualityLabel() || '—') : '—';
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
            stop.title = S.privateCancelRequested ? 'Stopping download' : 'Stop download';
        }
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
    // Latest pointer position; the frame callback reads this rather than the
    // first event of the frame, so the panel tracks the cursor without lag.
    let px = 0, py = 0;

    handle.addEventListener('pointerdown', e => {
        if (e.target instanceof Element
            && e.target.closest('button, input, select, textarea, a, [role="button"], [data-no-drag]')) {
            return;
        }
        dragging = true; userMoved = true; pid = e.pointerId;
        ix = e.clientX - ox; iy = e.clientY - oy;
        panel.classList.add('rt-drag');
        try { handle.setPointerCapture(pid); } catch {}
    }, { passive: true });

    handle.addEventListener('pointermove', e => {
        if (!dragging || e.pointerId !== pid) return;
        px = e.clientX;
        py = e.clientY;
        if (raf) return;
        raf = true;
        requestAnimationFrame(() => {
            raf = false;
            if (dragging) setPos(px - ix, py - iy);
        });
    }, { passive: true });

    const end = e => {
        if (e.pointerId !== pid) return;
        // Land on the last pointer position even if its frame hasn't run yet.
        if (dragging && raf) setPos(px - ix, py - iy);
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

// Where keyboard focus was before the settings modal opened, so closing it
// can hand focus back instead of dropping it to <body>.
let _settingsReturnFocus = null;

function setSettingsOpen(open) {
    const root = document.getElementById('rt_settings_root');
    if (!root) return;
    const willOpen = !!open;
    const html = document.documentElement;

    if (willOpen) {
        if (!root.classList.contains('show')) _settingsReturnFocus = document.activeElement;
        // Save the page's existing overflow and lock it for the duration.
        // This prevents wheel/touch events from scrolling YouTube under
        // the modal — `overscroll-behavior: contain` on the modal body
        // handles chained scroll, but a small modal whose body doesn't
        // need to scroll wouldn't catch any scroll events otherwise.
        if (html.dataset.rtPrevOverflow === undefined) html.dataset.rtPrevOverflow = html.style.overflow || '';
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

        const wasOpen = root.classList.contains('show');
        root.classList.remove('show');
        root.setAttribute('aria-hidden', 'true');
        hideTooltip();
        if (wasOpen) {
            const active = document.activeElement;
            if (_settingsReturnFocus?.isConnected && _settingsReturnFocus !== document.body) {
                _settingsReturnFocus.focus?.();
            } else if (active && root.contains(active)) {
                // Nothing to hand focus back to (e.g. opened from the menu
                // command): at least don't leave it on a now-hidden control.
                active.blur?.();
            }
        }
        _settingsReturnFocus = null;
    }
}

// aria-modal only promises a focus trap; make it true. Tab / Shift+Tab wrap
// inside the visible controls of the settings modal while it is open.
function trapSettingsFocus(event) {
    if (event.key !== 'Tab' || !isSettingsOpen()) return;
    const modal = document.getElementById('rt_settings_modal');
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

function registerMenuCommands({ openPanel, openSettings }) {
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
            StatsTracker.renderStatsPanelSlot(true);
            statsPanel?.__rtPositionNearButton?.(false);
        } else {
            hideTooltip();
            StatsTracker.closeMenus();
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
    document.addEventListener('keydown', trapSettingsFocus);
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
        setSetting('shortsBlockerEnabled', !S.shortsBlockerEnabled);
        ShortsBlocker.apply();
        uiSync();
        toast(S.shortsBlockerEnabled ? 'Shorts hidden' : 'Shorts shown',
              S.shortsBlockerEnabled ? 'shorts' : 'off',
              { icon: 'shorts', label: 'Shorts' });
    });

    on('rt_sw_q', 'click', () => {
        setSetting('qualityEnabled', !S.qualityEnabled);
        restartQualityTargeting();
        uiSync();
        toast(S.qualityEnabled ? 'Quality targeting on' : 'Quality targeting off',
              S.qualityEnabled ? 'quality' : 'off',
              { icon: 'quality', label: 'Quality' });
    });

    on('rt_sw_private', 'click', () => {
        setSetting('privateDownloadsEnabled', !S.privateDownloadsEnabled);
        uiSync();
        toast(S.privateDownloadsEnabled ? 'Private downloads on' : 'Private downloads off',
              S.privateDownloadsEnabled ? 'dl' : 'off',
              { icon: 'private', label: 'Download' });
    });

    on('rt_sw_stats', 'click', async () => {
        const enabled = StatsTracker.getEnabled();
        try {
            await StatsTracker.setEnabled(!enabled);
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
    // Shorts containers YouTube uses on several page types. Each surface
    // scopes them to its own page context (ytd-browse split by page-subtype,
    // since channel pages are ytd-browse too; ytd-search; ytd-watch-flexy), so
    // one toggle never hides Shorts on another toggle's pages.
    const SHARED_SHORTS = [
        'ytd-rich-shelf-renderer[is-shorts]',
        'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
        'ytd-reel-shelf-renderer',
        'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
        'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
        'ytd-reel-item-renderer',
    ];
    const within = (scope, selectors) => selectors.map(s => `${scope} ${s}`);
    const SURFACES = [
        {
            id: 'sidebar',
            label: 'Sidebar',
            // Navigation links, not content: hidden but never tallied.
            tally: false,
            stateKey: 'shortsHideSidebar',
            bodyClass: 'rt-shorts-hide-sidebar',
            selectors: [
                // Expanded sidebar Shorts entry, and the mini-nav icon. The
                // expanded entry has no href (only a localized title); the
                // mini entry also links to /shorts/, which covers localized
                // UIs for that one.
                'ytd-guide-entry-renderer:has(a[title="Shorts"])',
                'ytd-mini-guide-entry-renderer:has(a[title="Shorts"])',
                'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"])',
            ],
        },
        {
            // Home, Subscriptions and the other feed pages.
            id: 'home',
            label: 'Home & feeds',
            stateKey: 'shortsHideHome',
            bodyClass: 'rt-shorts-hide-home',
            selectors: within('ytd-browse:not([page-subtype="channels"])', SHARED_SHORTS),
        },
        {
            id: 'search',
            label: 'Search results',
            stateKey: 'shortsHideSearch',
            bodyClass: 'rt-shorts-hide-search',
            selectors: [
                ...within('ytd-search', SHARED_SHORTS),
                // The newer shorts-lockup view-model that YouTube has rolled
                // out to search over 2025/26, and the shelves holding them.
                'ytd-search ytd-shorts-lockup-view-model',
                'ytd-search ytd-shorts-shelf-renderer',
                'ytd-search ytd-shelf-renderer:has(ytd-shorts-lockup-view-model)',
                'ytd-search ytd-shelf-renderer:has(ytd-reel-item-renderer)',
                'ytd-search grid-shelf-view-model:has(a[href*="/shorts/"])',
                // Search-result rows that link to a short. Some shorts
                // surface in search as ytd-video-renderer with the SHORTS
                // overlay rather than a /shorts/ href, so catch both.
                'ytd-search ytd-video-renderer:has(a[href*="/shorts/"])',
                'ytd-search ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])',
                'ytd-search ytd-reel-video-renderer',
            ],
        },
        {
            id: 'channel',
            label: 'Channel tabs',
            stateKey: 'shortsHideChannel',
            bodyClass: 'rt-shorts-hide-channel',
            selectors: [
                // The "Shorts" tab on a channel page, plus Shorts anywhere
                // on channel pages.
                '[tab-title="Shorts"]',
                ...within('ytd-browse[page-subtype="channels"]', SHARED_SHORTS),
            ],
        },
        {
            id: 'watch',
            label: 'Watch suggestions',
            stateKey: 'shortsHideWatch',
            bodyClass: 'rt-shorts-hide-watch',
            selectors: [
                // Watch-page up-next suggestions, including any compact
                // video that links to a short.
                ...within('ytd-watch-flexy', SHARED_SHORTS),
                'ytd-watch-flexy ytd-compact-video-renderer:has(a[href*="/shorts/"])',
            ],
        },
    ];

    // Shorts navigation (the channel tab) is hidden but not tallied either.
    const NAV_ONLY_SELECTORS = new Set(['[tab-title="Shorts"]']);

    // Engines without :has() reject those selectors outright. Checked once,
    // so the tally below never throws and never mixes in a dead selector.
    const isSupportedSelector = selector => {
        try {
            document.createDocumentFragment().querySelector(selector);
            return true;
        } catch {
            return false;
        }
    };

    // Union of the currently-active surfaces' supported selectors, rebuilt
    // by apply(), used by the "Shorts blocked" tally below.
    let activeSelector = '';
    // Elements already tallied, so nodes YouTube re-inserts (or that an
    // already-counted container holds) are never counted twice.
    const counted = new WeakSet();
    // Added nodes waiting for the next batched tally pass.
    const pendingNodes = new Set();
    let tallyTimer = 0;
    const TALLY_DELAY_MS = 300;

    function injectStyle() {
        // One rule per selector: a selector the engine can't parse only
        // invalidates its own rule, not the rest of its surface.
        const rules = SURFACES.flatMap(surface => surface.selectors
            .map(s => `body.${surface.bodyClass} ${s} { display: none !important; }`));
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = rules.join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function apply() {
        const master = !!S.shortsBlockerEnabled;
        const active = [];
        for (const surface of SURFACES) {
            const on = master && !!S[surface.stateKey];
            document.body.classList.toggle(surface.bodyClass, on);
            if (on && surface.tally !== false) {
                active.push(...surface.selectors.filter(sel => !NAV_ONLY_SELECTORS.has(sel)));
            }
        }
        activeSelector = active.filter(isSupportedSelector).join(',');
    }

    // A Shorts shelf, its wrapper section and its items all match the hide
    // selectors, and a wrapper only starts matching once its shelf is inside
    // it. Tally each hidden group once, as its outermost matching element:
    // a shelf counts as one, and so does a standalone Shorts item.
    function tallyHit(hit) {
        if (counted.has(hit)) return 0;
        let outermost = hit;
        for (let el = hit.parentElement; el; el = el.parentElement) {
            if (counted.has(el)) {
                counted.add(hit);
                return 0;
            }
            if (el.matches(activeSelector)) outermost = el;
        }
        counted.add(hit);
        counted.add(outermost);
        return 1;
    }

    // Runs once per batch of DOM additions instead of once per mutation
    // record: the union selector contains :has() rules, which are too costly
    // to evaluate against every added subtree the instant it appears.
    function tallyPendingNodes() {
        tallyTimer = 0;
        const batch = new Set(Array.from(pendingNodes).filter(node => node.isConnected));
        pendingNodes.clear();
        if (!activeSelector || !StatsTracker.getEnabled()) return;

        let total = 0;
        for (const node of batch) {
            // A pending ancestor's scan already covers this node's subtree.
            let covered = false;
            for (let el = node.parentElement; el; el = el.parentElement) {
                if (batch.has(el)) { covered = true; break; }
            }
            if (covered) continue;

            if (node.matches(activeSelector)) total += tallyHit(node);
            for (const hit of node.querySelectorAll(activeSelector)) total += tallyHit(hit);
        }
        if (total) StatsTracker.recordShortsHidden(total);
    }

    function onNavigate() {
        if (!S.shortsBlockerEnabled) return;
        const id = getShortsVideoId();
        if (!id) return;
        location.replace(S.shortsOnVisit === 'redirect'
            ? `${location.origin}/watch?v=${encodeURIComponent(id)}`
            : `${location.origin}/`);
    }

    function install() {
        injectStyle();
        apply();

        // Tally newly-added Shorts for the "Shorts blocked" statistic. The
        // CSS rules hide them either way; this only counts them.
        const observer = new MutationObserver(mutations => {
            if (!activeSelector || !StatsTracker.getEnabled()) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) pendingNodes.add(node);
                }
            }
            if (pendingNodes.size && !tallyTimer) tallyTimer = setTimeout(tallyPendingNodes, TALLY_DELAY_MS);
        });
        // Use documentElement as the root so the observer survives
        // any body re-rendering on SPA transitions.
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    // Surfaces as the settings panel needs them (one checkbox each).
    const surfaces = Object.freeze(SURFACES.map(({ id, label, stateKey }) => ({ id, label, stateKey })));

    return Object.freeze({ install, apply, onNavigate, surfaces });
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
        document.body.classList.toggle(BODY_CLASS, !!S.oledThemeEnabled);
    }

    return Object.freeze({ apply });
})();

/**
 * PlayerGlow — scales YouTube's ambient-mode glow. The stylesheet does the
 * work (see "Player glow"); this hands it the strength as --rt-glow on
 * <body> (1 = YouTube's own) with a class that turns the rules on, and a
 * second class for 0%, which hides the glow outright.
 */
const PlayerGlow = (() => {
    function apply() {
        const pct = readPlayerGlow(S.playerGlow);
        const custom = pct !== PLAYER_GLOW_DEFAULT && pct !== 0;
        const body = document.body;
        body.classList.toggle('rt-glow-off', pct === 0);
        body.classList.toggle('rt-glow-custom', custom);
        if (custom) body.style.setProperty('--rt-glow', String(pct / 100));
        else body.style.removeProperty('--rt-glow');
    }

    return Object.freeze({ apply });
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
    // The search box only dims the rain behind it (its edge is not a surface).
    const SEARCHBOX_SELECTOR = 'ytd-searchbox, yt-searchbox';
    // The wordmark has no surface, but its top edge still catches a drop.
    const LOGO_SELECTOR = 'ytd-topbar-logo-renderer';
    const MIST_ID = 'rt_topbar_mist';
    // Only these have a wet-rim rule in the stylesheet. YouTube's own search
    // and voice buttons take hits but never get inline --rt-* properties.
    const RIM_SELECTOR = '#rt_fab, #rt_stats_fab';
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
    let lastRain = null;      // what the host was last told: theme, quantity, fps cap, lightning
    let freshEngine = false;  // ensureCanvas built an engine this pass: it still has to be told the settings
    let darkObserver = null;

    // YouTube keys its whole dark palette on a [dark] attribute: the
    // --yt-spec-* variables and the hashed colour tokens its newer components
    // use (the search box, its suggestion panel, their icons), which this
    // stylesheet can't name. The masthead reflects its own `dark` property
    // there; it's how YouTube itself puts a dark bar on a light page. The
    // theme forces the bar dark, so it sets the same attribute and YouTube
    // draws everything inside the bar dark. YouTube drops the attribute when
    // its own theme changes; the observer puts it back while the theme is on.
    function forceDark(el) {
        if (el.hasAttribute('dark')) return;
        el.setAttribute('dark', '');
        el.dataset.rtForcedDark = 'true';
    }

    function releaseDark(el) {
        if (el.dataset.rtForcedDark !== 'true') return;
        delete el.dataset.rtForcedDark;
        // In YouTube's own dark theme the bar is dark anyway.
        if (!document.documentElement.hasAttribute('dark')) el.removeAttribute('dark');
    }

    function syncDark(el, on) {
        darkObserver?.disconnect();
        if (!on) {
            releaseDark(el);
            return;
        }
        forceDark(el);
        if (!darkObserver) {
            darkObserver = new MutationObserver(() => {
                if (host?.isConnected && S?.topbarThemeEnabled) forceDark(host);
            });
        }
        darkObserver.observe(el, { attributes: true, attributeFilter: ['dark'] });
    }

    function findMasthead() {
        return document.querySelector('ytd-masthead')
            || document.getElementById('masthead')
            || document.getElementById('masthead-container');
    }

    function ensureCanvas(nextHost) {
        let el = document.getElementById(CANVAS_ID);
        if (el && el.parentElement !== nextHost) {
            el.parentElement?.__rtRainDispose?.();
            el.remove();
            document.getElementById(MIST_ID)?.remove();
            el = null;
        }
        if (!document.getElementById(MIST_ID)) {
            nextHost.insertBefore(mk('div', null, null, { id: MIST_ID, 'aria-hidden': 'true' }), nextHost.firstChild || null);
        }
        if (!el) {
            el = mk('canvas', 'rt-rain-canvas rt-topbar-rain-canvas', null, {
                id: CANVAS_ID,
                'aria-hidden': 'true',
            });
            nextHost.insertBefore(el, document.getElementById(MIST_ID)?.nextSibling || nextHost.firstChild || null);
        }
        // Bound means this host still has a live engine for this canvas; one
        // that was disposed (host detached and back) or belonged to a canvas
        // that is gone is retired, so a host never carries two.
        if (el.dataset.rtRainBound !== 'true' || !nextHost.__rtRainDispose) {
            nextHost.__rtRainDispose?.();
            freshEngine = true;
            initHeaderRain(el, nextHost, {
                targetSelector: TARGET_SELECTOR,
                rimSelector: RIM_SELECTOR,
                // A short, wide bar: slower rain, and its bottom edge is a
                // sill the rain splashes on.
                strip: true,
                sill: true,
                solidCheck: true,
                objectSelector: LOGO_SELECTOR,
                coverSelector: SEARCHBOX_SELECTOR,
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
        const next = {
            enabled: !!S?.topbarThemeEnabled,
            quantity: rainQuantity,
            fps: readRainFpsCap(S.rainFpsCap),
            lightning: !!S?.lightningEnabled,
            clouds: !!S?.cloudsEnabled,
        };
        const prev = force ? null : lastRain;

        activeHost.classList.toggle('rt-rain-off', rainOff);
        if (prev && prev.enabled === next.enabled && prev.quantity === next.quantity
            && prev.fps === next.fps && prev.lightning === next.lightning && prev.clouds === next.clouds) {
            activeHost.__rtRainMoved?.();
            return;
        }

        lastRain = next;
        // Re-seeding the drops is visible, so like syncRainEffects each hook
        // runs only for what changed (all of them for a new host or a toggle).
        const all = !prev || prev.enabled !== next.enabled;
        if (all || prev.quantity !== next.quantity) activeHost.__rtRainQuantityChanged?.();
        if (all || prev.fps !== next.fps) activeHost.__rtRainFpsChanged?.();
        if (all || prev.lightning !== next.lightning) activeHost.__rtLightningChanged?.();
        if (all || prev.clouds !== next.clouds) activeHost.__rtCloudsChanged?.();
    }

    function apply() {
        const enabled = !!S?.topbarThemeEnabled;
        document.body.classList.toggle(BODY_CLASS, enabled);

        const nextHost = findMasthead();
        if (!nextHost) {
            // The masthead went away: retire its engine (a new one is built if
            // it comes back).
            if (host && !host.isConnected) {
                host.__rtRainDispose?.();
                darkObserver?.disconnect();
                host = canvas = null;
            }
            return;
        }

        const hostChanged = host !== nextHost;
        const enabledChanged = hostChanged || nextHost.classList.contains(HOST_CLASS) !== enabled;
        if (host && host !== nextHost) {
            host.__rtRainDispose?.();
            host.classList.remove(HOST_CLASS, 'rt-rain-off');
            syncDark(host, false);
        }
        host = nextHost;
        host.classList.toggle(HOST_CLASS, enabled);
        syncDark(host, enabled);

        freshEngine = false;
        if (enabled) {
            canvas = ensureCanvas(host);
            canvas.hidden = false;
        } else if (canvas?.isConnected) {
            canvas.hidden = true;
        }
        syncRain({ force: hostChanged || enabledChanged || freshEngine });
    }

    function scheduleApply(delay = 0) {
        setTimeout(apply, delay);
    }

    function install() {
        apply();
        scheduleApply(600);
        scheduleApply(1800);
    }

    return Object.freeze({ install, apply, syncRain });
})();

const ChromeRuntime = (() => {
    const run = (force = false) => {
        if (document.hidden && !force) return;
        mountRainTubeButtons(S._statsFab, S._fab);
        TopbarTheme.apply();
        // uiSync skips its work while the panel, settings and downloads are idle.
        uiSync();
    };

    const install = () => {
        setInterval(run, 5000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) run(true);
        }, { passive: true });
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
    clearQualityRetry();
    if (_qualityReadyCancel) {
        _qualityReadyCancel();
        _qualityReadyCancel = null;
    }
}

// Forget what was applied and run targeting again for the current video:
// the target changed, targeting was toggled, or settings were reset.
function restartQualityTargeting() {
    clearQualitySchedule();
    clearQualityMemos();
    if (S.qualityEnabled) scheduleQualityApply();
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
        let checkTimer = 0;

        const done = value => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            clearTimeout(checkTimer);
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
                // YouTube can replace player subtrees during SPA navigation.
            }
        };

        // YouTube mutates the DOM constantly; look at most every 100 ms
        // rather than on every mutation batch.
        const scheduleCheck = () => {
            if (checkTimer || settled) return;
            checkTimer = setTimeout(() => {
                checkTimer = 0;
                check();
            }, 100);
        };

        _qualityReadyCancel = cancel;
        timer = setTimeout(() => done(false), timeoutMs);
        observer = new MutationObserver(scheduleCheck);
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
    // A /shorts/ route the blocker will redirect skips the debounce: every
    // 500 ms waited here is 500 ms of the Short playing.
    if (S.shortsBlockerEnabled && getShortsVideoId()) {
        void leaveShortsRoute();
        return;
    }
    _navTimer = setTimeout(() => {
        const vid = getVideoId();

        // New video → reset per-video memos.
        S._player = null;
        S._video = null;

        // Another trigger (tab focus, a setting change) may already have
        // applied the target for this new video before the debounce fired;
        // only forget memos that belong to a different video.
        if (vid !== S.videoId && !qualityTargetAlreadyHandled()) {
            clearQualityMemos();
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
    }, 500);
}

// Count the Shorts open and persist it before the redirect unloads the page.
async function leaveShortsRoute() {
    StatsTracker.onNavigate();
    await StatsTracker.flush();
    ShortsBlocker.onNavigate();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function boot() {
    const { panel, fab, statsFab, statsPanel } = buildPanel();
    S._fab = fab;
    S._statsFab = statsFab;
    mountRainTubeButtons(statsFab, fab);
    initDrag(panel, fab);
    initDrag(statsPanel, statsFab, { handleSelector: '#rt_stats_drag', fallbackH: 380, snapToDevicePixels: true });
    bindEvents(panel, fab, statsFab, statsPanel);

    // Create the aria-live toast region up front: screen readers announce
    // changes to an existing live region, not one that appears with its first
    // message.
    getToastContainer();
    StatsTracker.install();
    ShortsBlocker.install();
    OledTheme.apply();
    PlayerGlow.apply();
    TopbarTheme.install();
    ChromeRuntime.install();
    document.addEventListener('fullscreenchange', () => syncToastPosition(getToastContainer()), { passive: true });
    window.addEventListener('resize', scheduleToastPositionSync, { passive: true });
    window.addEventListener('scroll', scheduleToastPositionSync, { passive: true });
    window.addEventListener('yt-navigate-finish', onNavigate, { passive: true });
    window.addEventListener('yt-page-data-updated', onNavigate, { passive: true });
    window.addEventListener('yt-navigate-start', () => {
        clearQualitySchedule();
        S._player = null; S._video = null;
        hideTooltip();
    }, { passive: true });
    // Quality targeting doesn't run in a hidden tab (a video opened in the
    // background); pick it up when the tab becomes visible. A no-op when the
    // target has already been applied.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && S.qualityEnabled) scheduleQualityApply();
    }, { passive: true });

    onNavigate();
}

/* ── Entry ──────────────────────────────────────────────────────────────── */

// Fast path: if this is a direct /shorts/ visit, fire the redirect now
// instead of waiting for the full async boot to complete. Otherwise the
// 5s+ delay between loading a short and being redirected lets the Shorts
// player start playing.
async function shortcutShortsVisit() {
    const id = getShortsVideoId();
    if (!id) return false;
    // Blocker settings, the stats flag and the buckets blob are read in
    // parallel so the open can be recorded before the redirect.
    const { shortsBlockerEnabled: blockerSpec, shortsOnVisit: onVisitSpec } = SETTING_SPECS;
    const [rawEnabled, rawOnVisit, statsEnabled, rawBuckets] = await Promise.all([
        readStoredValue(blockerSpec.storage, blockerSpec.default),
        readStoredValue(onVisitSpec.storage, onVisitSpec.default),
        readStoredValue(CFG.storage.statsEnabled, true),
        readStoredValue(CFG.storage.statsBuckets, null),
    ]);
    if (!blockerSpec.read(rawEnabled)) return false;

    if (readStatsEnabled(statsEnabled)) {
        const buckets = sanitizeStatsBuckets(rawBuckets);
        const key = statsDateKey();
        (buckets[key] || (buckets[key] = emptyStatsBucket())).shortsOpened += 1;
        await StatsStore.setJson(CFG.storage.statsBuckets, buckets);
    }

    location.replace(readShortsOnVisit(rawOnVisit) === 'redirect'
        ? `${location.origin}/watch?v=${encodeURIComponent(id)}`
        : `${location.origin}/`);
    return true;
}

// Resolve once document.body exists. At @run-at document-start the body
// element may not be built yet, but most of our async preamble (style
// injection, storage reads) is body-independent and can proceed in parallel.
function waitForDocumentBody() {
    if (document.body) return Promise.resolve();
    return new Promise(resolve => {
        if (document.readyState !== 'loading' && document.body) return resolve();
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
}

async function startRainTube() {
    if (IS_CNVMP3) {
        runCnvMp3Autofill();
        return;
    }

    if (!IS_YOUTUBE) return;

    // Try the fast redirect before anything else. If it navigates, the rest
    // of boot is moot for this page load (location.replace ends execution).
    // Runs immediately at document-start — no DOM dependency.
    if (await shortcutShortsVisit()) return;

    // The async preamble doesn't touch document.body (style injection uses
    // document.head || document.documentElement), so it can run in parallel
    // with DOMContentLoaded.
    const [, , state] = await Promise.all([
        injectRainTubeStyles(),
        cleanupDeprecatedStorageKeys(),
        loadRuntimeState(),
        waitForDocumentBody(),
    ]);
    S = state;
    boot();
}

startRainTube().catch(err => {
    console.error('[RainTube] Startup failed:', err);
});
