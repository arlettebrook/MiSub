const subscriptionStatuses = new Set(['error', 'disabled', 'expired', 'low-traffic', 'zero-nodes']);

export function normalizeDashboardQuery(value) {
    if (Array.isArray(value)) value = value[0];
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolveSubscriptionStatus(value) {
    const status = normalizeDashboardQuery(value);
    return subscriptionStatuses.has(status) ? status : '';
}

// Dashboard counts and destination filters must use the same traffic thresholds.
export function getSubscriptionTrafficState(sub, now = Date.now()) {
    const info = sub?.userInfo;
    if (!sub?.enabled || !info) return null;
    const total = Number(info.total || 0);
    const used = Number(info.upload || 0) + Number(info.download || 0);
    const expire = Number(info.expire || 0);
    if (expire > 0 && expire * 1000 < now) return 'expired';
    if (total > 0 && Math.max(0, total - used) / total <= 0.2) return 'low';
    return null;
}

export function matchesSubscriptionStatus(sub, status) {
    switch (status) {
        case 'error':
            return Boolean(sub.lastError);
        case 'disabled':
            return !sub.enabled;
        case 'expired':
            return getSubscriptionTrafficState(sub) === 'expired';
        case 'low-traffic':
            return getSubscriptionTrafficState(sub) === 'low';
        case 'zero-nodes':
            return Number(sub.nodeCount || 0) === 0;
        default:
            return true;
    }
}

export function resolveSettingsFocusAnchor(value) {
    switch (normalizeDashboardQuery(value)) {
        case 'mytoken':
            return 'setting-mytoken';
        case 'profiletoken':
            return 'setting-profileToken';
        default:
            return '';
    }
}
