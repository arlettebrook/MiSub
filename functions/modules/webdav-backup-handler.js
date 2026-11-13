/**
 * WebDAV backup / restore handler for MiSub.
 *
 * Design notes:
 * - Backup is domain-level, not KV/D1 whole-store mirroring.
 * - Restore only touches known MiSub business keys/collections.
 * - WebDAV credentials and runtime secrets are never written into backup payloads.
 */

import { StorageFactory, SettingsCache, STORAGE_TYPES } from '../storage-adapter.js';
import { KV_KEY_SUBS, KV_KEY_PROFILES, KV_KEY_SETTINGS } from './config.js';
import { KV_KEY_RULE_TEMPLATES, listRuleTemplates } from './rule-template-handler.js';
import {
    createJsonResponse,
    createErrorResponse,
    JSON_BODY_LIMITS,
    readJsonWithLimit,
} from './utils.js';

export const BACKUP_TYPE = 'misub-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_SCOPES = {
    DATA_ONLY: 'dataOnly',
    DATA_AND_SETTINGS: 'dataAndSettings',
};

const RESTORE_SNAPSHOT_KEY = 'misub_restore_snapshot_latest';
const BACKUP_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_WEBDAV_CONFIG = {
    enabled: false,
    endpoint: '',
    username: '',
    password: '',
    remotePath: '/MiSub',
    filenameTemplate: 'misub-backup-{datetime}.json',
    backupScope: BACKUP_SCOPES.DATA_ONLY,
    autoBackup: false,
    interval: 'daily',
    retentionCount: 7,
    lastCheckedAt: null,
    lastBackupAt: null,
    lastBackupStatus: null,
    lastBackupMessage: '',
    lastBackupFile: '',
};

function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeScope(scope) {
    return scope === BACKUP_SCOPES.DATA_AND_SETTINGS
        ? BACKUP_SCOPES.DATA_AND_SETTINGS
        : BACKUP_SCOPES.DATA_ONLY;
}

function normalizeWebdavConfig(settings = {}) {
    const config = { ...DEFAULT_WEBDAV_CONFIG, ...(settings.webdavBackup || {}) };
    const retentionCount =
        typeof config.retentionCount === 'number' || typeof config.retentionCount === 'string'
            ? Number(config.retentionCount)
            : NaN;
    config.retentionCount =
        Number.isFinite(retentionCount) && retentionCount >= 1
            ? Math.min(100, Math.floor(retentionCount))
            : DEFAULT_WEBDAV_CONFIG.retentionCount;
    return config;
}

function sanitizeRuntimeSecrets(settings = {}) {
    const sanitized = cloneJson(settings) || {};
    delete sanitized.webdavBackup;
    delete sanitized.adminPassword;
    delete sanitized.ADMIN_PASSWORD;
    delete sanitized.password;
    delete sanitized.cookieSecret;
    delete sanitized.COOKIE_SECRET;
    delete sanitized.sessionSecret;
    delete sanitized.lastBackupAt;
    delete sanitized.lastBackupStatus;
    delete sanitized.lastBackupMessage;
    delete sanitized.lastBackupFile;
    return sanitized;
}

export function sanitizeSettingsForBackup(settings = {}) {
    return sanitizeRuntimeSecrets(settings);
}

export function sanitizeSettingsForRestore(settings = {}) {
    return sanitizeRuntimeSecrets(settings);
}

async function getStorage(env) {
    const storageType = await StorageFactory.getStorageType(env);
    return {
        storageType,
        storageAdapter: StorageFactory.createAdapter(env, storageType),
    };
}

async function readBusinessData(storageAdapter) {
    const [subscriptions, profiles, ruleTemplates] = await Promise.all([
        typeof storageAdapter.getAllSubscriptions === 'function'
            ? storageAdapter.getAllSubscriptions()
            : storageAdapter.get(KV_KEY_SUBS).then((value) => value || []),
        typeof storageAdapter.getAllProfiles === 'function'
            ? storageAdapter.getAllProfiles()
            : storageAdapter.get(KV_KEY_PROFILES).then((value) => value || []),
        listRuleTemplates(storageAdapter).catch(() => []),
    ]);

    return {
        subscriptions: Array.isArray(subscriptions) ? subscriptions : [],
        profiles: Array.isArray(profiles) ? profiles : [],
        ruleTemplates: Array.isArray(ruleTemplates) ? ruleTemplates : [],
    };
}

export async function buildBackupPayload(env, options = {}) {
    const { storageAdapter, storageType } = await getStorage(env);
    const settings =
        (await storageAdapter.get(KV_KEY_SETTINGS)) || (await SettingsCache.get(env)) || {};
    const backupConfig = normalizeWebdavConfig(settings);
    const scope = normalizeScope(options.scope || backupConfig.backupScope);
    const businessData = await readBusinessData(storageAdapter);

    const payload = {
        version: BACKUP_VERSION,
        app: 'MiSub',
        type: BACKUP_TYPE,
        scope,
        exportedAt: new Date().toISOString(),
        source: {
            storageType,
            trigger: options.trigger || 'manual',
        },
        data: {
            subscriptions: cloneJson(businessData.subscriptions),
            profiles: cloneJson(businessData.profiles),
            ruleTemplates: cloneJson(businessData.ruleTemplates),
            settings: null,
        },
    };

    if (scope === BACKUP_SCOPES.DATA_AND_SETTINGS) {
        payload.data.settings = sanitizeSettingsForBackup(settings);
    }

    return payload;
}

export function normalizeBackupPayload(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('无效的备份文件格式');
    }

    // New unified format.
    if (raw.type === BACKUP_TYPE && raw.data && typeof raw.data === 'object') {
        return {
            ...raw,
            scope: normalizeScope(raw.scope),
            data: {
                subscriptions: Array.isArray(raw.data.subscriptions) ? raw.data.subscriptions : [],
                profiles: Array.isArray(raw.data.profiles) ? raw.data.profiles : [],
                ruleTemplates: Array.isArray(raw.data.ruleTemplates) ? raw.data.ruleTemplates : [],
                settings:
                    raw.data.settings && typeof raw.data.settings === 'object'
                        ? raw.data.settings
                        : null,
            },
        };
    }

    // Legacy local export format: { subscriptions, manualNodes, profiles }.
    if (Array.isArray(raw.subscriptions)) {
        return {
            version: BACKUP_VERSION,
            app: 'MiSub',
            type: BACKUP_TYPE,
            scope: BACKUP_SCOPES.DATA_ONLY,
            exportedAt: raw.exportedAt || new Date().toISOString(),
            source: { storageType: 'legacy-local', trigger: 'import' },
            data: {
                subscriptions: [
                    ...raw.subscriptions,
                    ...(Array.isArray(raw.manualNodes) ? raw.manualNodes : []),
                ],
                profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
                ruleTemplates: Array.isArray(raw.ruleTemplates) ? raw.ruleTemplates : [],
                settings: null,
            },
        };
    }

    throw new Error('无效的备份文件格式');
}

async function syncCollection(storageAdapter, type, items) {
    const finalItems = Array.isArray(items) ? items : [];
    const isProfiles = type === 'profiles';
    const key = isProfiles ? KV_KEY_PROFILES : KV_KEY_SUBS;

    if (storageAdapter.type !== STORAGE_TYPES.KV) {
        const getAll = isProfiles
            ? storageAdapter.getAllProfiles?.bind(storageAdapter)
            : storageAdapter.getAllSubscriptions?.bind(storageAdapter);
        const putItem = isProfiles
            ? storageAdapter.putProfile?.bind(storageAdapter)
            : storageAdapter.putSubscription?.bind(storageAdapter);
        const deleteItem = isProfiles
            ? storageAdapter.deleteProfileById?.bind(storageAdapter)
            : storageAdapter.deleteSubscriptionById?.bind(storageAdapter);

        if (getAll && putItem && deleteItem) {
            const currentItems = await getAll();
            const finalMap = new Map(
                finalItems.filter((item) => item?.id).map((item) => [item.id, item])
            );
            const currentMap = new Map(
                (Array.isArray(currentItems) ? currentItems : [])
                    .filter((item) => item?.id)
                    .map((item) => [item.id, item])
            );

            for (const item of finalMap.values()) {
                const existing = currentMap.get(item.id);
                if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) {
                    await putItem(item);
                }
            }
            for (const id of currentMap.keys()) {
                if (!finalMap.has(id)) {
                    await deleteItem(id);
                }
            }
            return;
        }
    }

    await storageAdapter.put(key, finalItems);
}

async function createPreRestoreSnapshot(env, storageAdapter, scope) {
    const snapshot = await buildBackupPayload(env, {
        scope:
            scope === BACKUP_SCOPES.DATA_AND_SETTINGS
                ? BACKUP_SCOPES.DATA_AND_SETTINGS
                : BACKUP_SCOPES.DATA_ONLY,
        trigger: 'pre-restore',
    });
    await storageAdapter.put(RESTORE_SNAPSHOT_KEY, snapshot);
    return snapshot;
}

export async function restoreBackupPayload(env, rawPayload, options = {}) {
    const payload = normalizeBackupPayload(rawPayload);
    const scope = normalizeScope(options.scope || payload.scope);
    const { storageAdapter } = await getStorage(env);

    if (options.createSnapshot !== false) {
        await createPreRestoreSnapshot(env, storageAdapter, scope);
    }

    await syncCollection(storageAdapter, 'subscriptions', payload.data.subscriptions);
    await syncCollection(storageAdapter, 'profiles', payload.data.profiles);
    await storageAdapter.put(
        KV_KEY_RULE_TEMPLATES,
        Array.isArray(payload.data.ruleTemplates) ? payload.data.ruleTemplates : []
    );

    if (scope === BACKUP_SCOPES.DATA_AND_SETTINGS && payload.data.settings) {
        const currentSettings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
        const restoredSettings = sanitizeSettingsForRestore(payload.data.settings);
        const finalSettings = {
            ...restoredSettings,
            webdavBackup: currentSettings.webdavBackup,
        };
        await storageAdapter.put(KV_KEY_SETTINGS, finalSettings);
        SettingsCache.clear();
    }

    return {
        success: true,
        message: '备份已恢复',
        scope,
        restored: {
            subscriptions: payload.data.subscriptions.length,
            profiles: payload.data.profiles.length,
            ruleTemplates: payload.data.ruleTemplates.length,
            settings: scope === BACKUP_SCOPES.DATA_AND_SETTINGS && !!payload.data.settings,
        },
    };
}

function joinWebdavPath(base, path) {
    const trimmedBase = String(base || '').replace(/\/+$/, '');
    const parts = String(path || '')
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part));
    return [trimmedBase, ...parts].join('/');
}

function decodeWebdavPathSegment(segment) {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function normalizeWebdavHref(endpoint, href) {
    const endpointUrl = new URL(endpoint);
    let hrefUrl;
    try {
        hrefUrl = new URL(String(href || ''), `${endpointUrl.origin}/`);
    } catch {
        return null;
    }

    // A PROPFIND response can contain absolute URLs. Never turn a URL from a
    // different origin into a path that will later be fetched with credentials.
    if (hrefUrl.origin !== endpointUrl.origin || hrefUrl.search || hrefUrl.hash) return null;

    const endpointPath = endpointUrl.pathname.replace(/\/+$/, '');
    const hrefPath = hrefUrl.pathname;
    if (hrefPath !== endpointPath && !hrefPath.startsWith(`${endpointPath}/`)) return null;

    const relativePath = hrefPath.slice(endpointPath.length);
    const decodedParts = relativePath.split('/').filter(Boolean).map(decodeWebdavPathSegment);
    if (
        decodedParts.some(
            (part) => part === '.' || part === '..' || /[/\\\u0000-\u001f]/.test(part)
        )
    ) {
        return null;
    }
    return decodedParts.length ? `/${decodedParts.join('/')}` : '/';
}

function toBasicAuth(username, password) {
    const raw = `${username || ''}:${password || ''}`;
    if (typeof btoa === 'function') {
        return btoa(unescape(encodeURIComponent(raw)));
    }
    return Buffer.from(raw, 'utf8').toString('base64');
}

function assertSafeWebdavConfig(config) {
    if (!config.endpoint || !/^https:\/\//i.test(config.endpoint)) {
        throw new Error('WebDAV 地址必须使用 https://');
    }
    if (!config.username || !config.password) {
        throw new Error('请填写 WebDAV 用户名和密码');
    }
}

async function webdavFetch(config, path, init = {}) {
    assertSafeWebdavConfig(config);
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Basic ${toBasicAuth(config.username, config.password)}`);
    const url = joinWebdavPath(config.endpoint, path);
    return fetch(url, { ...init, headers });
}

async function ensureRemoteDirectory(config) {
    const parts = String(config.remotePath || '/MiSub')
        .split('/')
        .filter(Boolean);
    let current = '';
    for (const part of parts) {
        current += `/${part}`;
        const response = await webdavFetch(config, current, { method: 'MKCOL' });
        if (![200, 201, 204, 405].includes(response.status)) {
            throw new Error(`创建 WebDAV 目录失败: HTTP ${response.status}`);
        }
    }
}

export function formatBackupFilename(
    template = DEFAULT_WEBDAV_CONFIG.filenameTemplate,
    now = new Date()
) {
    // Keep backup names stable at UTC+8 regardless of the Worker/runtime
    // timezone (Cloudflare Workers normally exposes UTC).
    const utcPlus8 = new Date(now.getTime() + BACKUP_TIMEZONE_OFFSET_MS);
    const datetime = utcPlus8.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const date = utcPlus8.toISOString().slice(0, 10);
    const safeTemplate = template || DEFAULT_WEBDAV_CONFIG.filenameTemplate;
    return safeTemplate.replace(/\{datetime\}/g, datetime).replace(/\{date\}/g, date);
}

async function updateBackupStatus(env, patch) {
    const { storageAdapter } = await getStorage(env);
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
    const webdavBackup = { ...normalizeWebdavConfig(settings), ...patch };
    await storageAdapter.put(KV_KEY_SETTINGS, { ...settings, webdavBackup });
    SettingsCache.clear();
    return webdavBackup;
}

async function cleanupWebdavBackups(config, latestFilePath, uploadedAt) {
    const result = {
        success: true,
        deleted: 0,
        retentionCount: config.retentionCount,
        message: '',
    };
    try {
        const files = await listWebdavFiles(config);
        // Reserve a slot even when the server has not yet listed the new upload.
        const olderFiles = files.filter((file) => file.path !== latestFilePath);
        const obsoleteFiles = olderFiles.slice(config.retentionCount - 1).reverse();
        const errors = [];
        for (const file of obsoleteFiles) {
            // Another backup may have uploaded while this one was running.
            if (file.modifiedAt > Date.parse(uploadedAt)) continue;
            try {
                const response = await webdavFetch(config, file.path, {
                    method: 'DELETE',
                    // Workers only supports follow/manual. Inspect redirects below
                    // without forwarding DELETE or credentials to another URL.
                    redirect: 'manual',
                });
                if (
                    (!response.ok || response.status === 207) &&
                    ![404, 410].includes(response.status)
                ) {
                    throw new Error(`HTTP ${response.status}`);
                }
                result.deleted += 1;
            } catch (error) {
                errors.push(`${file.name}: ${error.message || '删除失败'}`);
            }
        }
        if (errors.length) throw new Error(errors.join('; '));
    } catch (error) {
        result.success = false;
        result.message = error.message || '旧备份清理失败';
    }
    return result;
}

export async function performWebdavBackup(env, options = {}) {
    const { storageAdapter } = await getStorage(env);
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
    const config = normalizeWebdavConfig(settings);
    assertSafeWebdavConfig(config);

    const payload = await buildBackupPayload(env, {
        scope: options.scope || config.backupScope,
        trigger: options.trigger || 'manual',
    });
    const filename = formatBackupFilename(config.filenameTemplate);
    const remotePath = `${webdavRemoteDirectory(config).replace(/\/$/, '')}/${filename}`;
    const body = JSON.stringify(payload, null, 2);

    try {
        await ensureRemoteDirectory(config);
        const response = await webdavFetch(config, remotePath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body,
        });
        if (!response.ok && response.status !== 201 && response.status !== 204) {
            throw new Error(`WebDAV 上传失败: HTTP ${response.status}`);
        }

        const cleanup = await cleanupWebdavBackups(config, remotePath, payload.exportedAt);
        const message = cleanup.success
            ? '备份成功'
            : `备份成功，但旧备份清理失败: ${cleanup.message}`;
        await updateBackupStatus(env, {
            lastBackupAt: payload.exportedAt,
            lastBackupStatus: 'success',
            lastBackupMessage: message,
            lastBackupFile: remotePath,
        });

        return {
            success: true,
            message,
            file: remotePath,
            size: body.length,
            scope: payload.scope,
            timestamp: payload.exportedAt,
            cleanup,
        };
    } catch (error) {
        await updateBackupStatus(env, {
            lastBackupAt: new Date().toISOString(),
            lastBackupStatus: 'failed',
            lastBackupMessage: error.message || '备份失败',
        });
        throw error;
    }
}

export async function handleWebdavBackupStatus(env) {
    const { storageAdapter } = await getStorage(env);
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
    const config = normalizeWebdavConfig(settings);
    const { password, ...safeConfig } = config;
    return createJsonResponse({ success: true, data: safeConfig });
}

export async function handleWebdavBackupTest(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const { storageAdapter } = await getStorage(env);
        const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.large).catch((e) => {
            if (e?.status === 413) throw e;
            return {};
        });
        const config = {
            ...normalizeWebdavConfig(settings),
            ...(body?.webdavBackup || body || {}),
        };
        assertSafeWebdavConfig(config);
        await ensureRemoteDirectory(config);
        return createJsonResponse({ success: true, message: 'WebDAV 连接测试成功' });
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || 'WebDAV 连接测试失败' },
            error.status || 400
        );
    }
}

export async function handleManualWebdavBackup(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.large).catch((e) => {
            if (e?.status === 413) throw e;
            return {};
        });
        const result = await performWebdavBackup(env, { scope: body.scope, trigger: 'manual' });
        return createJsonResponse(result);
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '备份失败' },
            error.status || 500
        );
    }
}

export async function handleBackupExport(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.large).catch((e) => {
            if (e?.status === 413) throw e;
            return {};
        });
        const payload = await buildBackupPayload(env, {
            scope: body.scope,
            trigger: 'local-export',
        });
        return createJsonResponse({ success: true, exportData: payload });
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '导出失败' },
            error.status || 500
        );
    }
}

export async function handleBackupRestore(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.large);
        const payload = body?.payload || body?.backup || body;
        const result = await restoreBackupPayload(env, payload, { scope: body?.scope });
        return createJsonResponse(result);
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '恢复失败' },
            error.status || 400
        );
    }
}

function webdavRemoteDirectory(config) {
    const parts = String(config.remotePath || '/MiSub')
        .split('/')
        .filter(Boolean);
    return parts.length ? `/${parts.join('/')}` : '/';
}

function backupFilenamePattern(template) {
    const safeTemplate = template || DEFAULT_WEBDAV_CONFIG.filenameTemplate;
    const tokens = {
        '{date}': '\\d{4}-\\d{2}-\\d{2}',
        '{datetime}': '\\d{4}-\\d{2}-\\d{2}[-_T ]\\d{2}-\\d{2}-\\d{2}',
    };
    const pattern = safeTemplate
        .split(/(\{date\}|\{datetime\})/g)
        .map((part) => tokens[part] || part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('');
    return new RegExp(`^${pattern}$`);
}

function decodeWebdavXml(text) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return text.replace(/&(amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi, (match, entity) => {
        if (entity[0] !== '#') return entities[entity.toLowerCase()];
        const hex = entity[1].toLowerCase() === 'x';
        const codePoint = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    });
}

function webdavXmlElement(xml, name) {
    const pattern = new RegExp(
        `<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`,
        'i'
    );
    return decodeWebdavXml(xml.match(pattern)?.[1]?.trim() || '');
}

function backupFileTime(name) {
    const match = name.match(/(\d{4}-\d{2}-\d{2})(?:[-_T ](\d{2})-(\d{2})-(\d{2}))?/);
    if (!match) return 0;
    const timestamp = Date.parse(
        `${match[1]}T${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}+08:00`
    );
    return Number.isFinite(timestamp) ? timestamp : 0;
}

async function listWebdavFiles(config) {
    const remoteDir = webdavRemoteDirectory(config);
    const response = await webdavFetch(config, remoteDir, {
        method: 'PROPFIND',
        headers: { Depth: '1' },
    });
    if (!response.ok) throw new Error(`列出 WebDAV 备份失败: HTTP ${response.status}`);

    const xml = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
    if (!/<(?:[\w.-]+:)?multistatus\b[^>]*>[\s\S]*<\/(?:[\w.-]+:)?multistatus\s*>/i.test(xml)) {
        throw new Error('无效的 WebDAV 文件列表');
    }
    const namePatterns = [config.filenameTemplate, DEFAULT_WEBDAV_CONFIG.filenameTemplate].map(
        backupFilenamePattern
    );
    const files = new Map();
    const responses = xml.matchAll(
        /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response\s*>/gi
    );
    for (const [, entry] of responses) {
        const href = webdavXmlElement(entry, 'href');
        if (!href || href.endsWith('/')) continue;
        const path = normalizeWebdavHref(config.endpoint, href);
        if (!path || (path.slice(0, path.lastIndexOf('/')) || '/') !== remoteDir) continue;
        const name = path.slice(path.lastIndexOf('/') + 1);
        if (!namePatterns.some((pattern) => pattern.test(name))) continue;

        const propstats = Array.from(
            entry.matchAll(/<(?:[\w.-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?propstat\s*>/gi)
        );
        const successfulProps = propstats
            .filter(([, propstat]) => /\s2\d{2}(?:\s|$)/.test(webdavXmlElement(propstat, 'status')))
            .map(([, propstat]) => webdavXmlElement(propstat, 'prop'))
            .join('');
        if (propstats.length && !successfulProps) continue;
        const status = propstats.length ? '' : webdavXmlElement(entry, 'status');
        if (status && !/\s2\d{2}(?:\s|$)/.test(status)) continue;
        if (/<(?:[\w.-]+:)?collection\b/i.test(successfulProps)) continue;

        const modifiedAt =
            Date.parse(webdavXmlElement(successfulProps, 'getlastmodified')) ||
            Date.parse(webdavXmlElement(successfulProps, 'creationdate')) ||
            backupFileTime(name);
        if (!files.has(path)) files.set(path, { path, name, modifiedAt });
    }
    return [...files.values()].sort(
        (a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name)
    );
}

export async function listWebdavBackupFiles(env) {
    const { storageAdapter } = await getStorage(env);
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
    const files = await listWebdavFiles(normalizeWebdavConfig(settings));
    return files.map(({ path, name }) => ({ path, name }));
}

export async function handleWebdavBackupList(request, env) {
    if (request.method !== 'GET') return createErrorResponse('Method Not Allowed', 405);
    try {
        const files = await listWebdavBackupFiles(env);
        return createJsonResponse({ success: true, data: files });
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '获取备份列表失败', data: [] },
            400
        );
    }
}

export async function fetchWebdavBackupFile(env, filePath) {
    const { storageAdapter } = await getStorage(env);
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || {};
    const config = normalizeWebdavConfig(settings);
    const response = await webdavFetch(config, filePath, { method: 'GET' });
    if (!response.ok) throw new Error(`读取 WebDAV 备份失败: HTTP ${response.status}`);
    return response.json();
}

export async function handleWebdavBackupDownload(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.normal);
        if (typeof body?.file !== 'string' || !body.file.trim()) {
            return createJsonResponse({ success: false, message: '请选择远端备份文件' }, 400);
        }
        const payload = await fetchWebdavBackupFile(env, body.file);
        return createJsonResponse({ success: true, exportData: payload });
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '下载备份失败' },
            error.status || 400
        );
    }
}

export async function handleWebdavRestore(request, env) {
    if (request.method !== 'POST') return createErrorResponse('Method Not Allowed', 405);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.large);
        const payload =
            body.payload || (body.file ? await fetchWebdavBackupFile(env, body.file) : null);
        const result = await restoreBackupPayload(env, payload, { scope: body.scope });
        return createJsonResponse(result);
    } catch (error) {
        return createJsonResponse(
            { success: false, message: error.message || '恢复失败' },
            error.status || 400
        );
    }
}
