import { StorageFactory } from '../storage-adapter.js';
import { createJsonResponse, JSON_BODY_LIMITS, readJsonWithLimit } from './utils.js';

export const DASHBOARD_PREFERENCES_KEY = 'misub_dashboard_preferences_v1';
const MAX_ITEMS = 1000;
const MAX_ID_LENGTH = 512;

function validId(id) {
    return typeof id === 'string' && id.trim().length > 0 && id.length <= MAX_ID_LENGTH;
}

function normalizeIds(ids) {
    return Array.isArray(ids) ? [...new Set(ids.filter(validId).map((id) => id.trim()))] : [];
}

function response(ids, initialized = true) {
    return createJsonResponse(
        { success: true, initialized, data: { dismissedHealthItemIds: ids } },
        200,
        { 'Cache-Control': 'no-store' }
    );
}

export async function handleDashboardPreferencesRequest(request, env) {
    if (!['GET', 'POST'].includes(request.method)) {
        return createJsonResponse({ success: false, message: 'Method Not Allowed' }, 405);
    }
    try {
        const storageType = await StorageFactory.getStorageType(env);
        const storage = StorageFactory.createAdapter(env, storageType);
        if (!storage.type) {
            return createJsonResponse({ success: false, message: '未配置可用的持久化存储' }, 503);
        }
        let body;
        if (request.method === 'POST') {
            try {
                body = await readJsonWithLimit(request, JSON_BODY_LIMITS.small);
            } catch (error) {
                return createJsonResponse(
                    {
                        success: false,
                        message: error.status === 413 ? error.message : '请求数据格式错误',
                    },
                    error.status || 400
                );
            }
            if (!['dismiss', 'restore', 'restore-all', 'migrate'].includes(body?.action)) {
                return createJsonResponse({ success: false, message: '无效的操作' }, 400);
            }
            if (['dismiss', 'restore'].includes(body.action) && !validId(body.id)) {
                return createJsonResponse({ success: false, message: '无效的事项 ID' }, 400);
            }
            if (
                body.action === 'migrate' &&
                (!Array.isArray(body.ids) ||
                    body.ids.length > MAX_ITEMS ||
                    !body.ids.every(validId))
            ) {
                return createJsonResponse({ success: false, message: '无效的忽略事项列表' }, 400);
            }
        }
        const saved = await storage.get(DASHBOARD_PREFERENCES_KEY);
        let ids = normalizeIds(saved?.dismissedHealthItemIds);
        if (request.method === 'GET') return response(ids, saved != null);

        switch (body.action) {
            case 'dismiss':
                ids = [...new Set([...ids, body.id.trim()])];
                break;
            case 'restore':
                ids = ids.filter((id) => id !== body.id.trim());
                break;
            case 'restore-all':
                ids = [];
                break;
            case 'migrate':
                // An initialized server is authoritative, even when its list is empty.
                if (saved != null) return response(ids);
                ids = normalizeIds(body.ids);
                break;
        }
        if (ids.length > MAX_ITEMS) {
            return createJsonResponse(
                { success: false, message: `最多可忽略 ${MAX_ITEMS} 项事项` },
                409
            );
        }
        await storage.put(DASHBOARD_PREFERENCES_KEY, { dismissedHealthItemIds: ids });
        return response(ids);
    } catch (error) {
        console.error('[DashboardPreferences] request failed:', error);
        return createJsonResponse({ success: false, message: '待处理事项状态保存或读取失败' }, 500);
    }
}
