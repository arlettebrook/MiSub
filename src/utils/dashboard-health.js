import { getSubscriptionTrafficState as getTrafficState } from './dashboard-deeplink.js';

const DEFAULT_NOW = () => Date.now();

function getTokenState(settings = {}) {
    const token = settings.mytoken;
    if (!token) return 'missing';
    if (token === 'auto') return 'auto';
    return 'stable';
}

export function shouldShowFullGuide({ subscriptions = [], profiles = [] } = {}) {
    return subscriptions.length === 0 || profiles.length === 0;
}

export function getDashboardHealthItems({
    subscriptions = [],
    profiles = [],
    settings = {},
    totalNodesCount = null,
    now = DEFAULT_NOW(),
} = {}) {
    const items = [];
    const enabledSubscriptions = subscriptions.filter((sub) => sub.enabled);
    const disabledSubscriptions = subscriptions.filter((sub) => !sub.enabled);
    const activeProfiles = profiles.filter((profile) => profile.enabled !== false);
    const tokenState = getTokenState(settings);
    const resolvedTotalNodes =
        totalNodesCount ?? subscriptions.reduce((sum, sub) => sum + Number(sub.nodeCount || 0), 0);
    const errorSubscriptions = subscriptions.filter((sub) => Boolean(sub.lastError));
    const expiredSubscriptions = subscriptions.filter(
        (sub) => getTrafficState(sub, now) === 'expired'
    );
    const lowTrafficSubscriptions = subscriptions.filter(
        (sub) => getTrafficState(sub, now) === 'low'
    );

    if (subscriptions.length === 0) {
        items.push({
            id: 'missing-subscriptions',
            tone: 'warning',
            titleKey: 'dashboard.healthItems.missingSubscriptions.title',
            descriptionKey: 'dashboard.healthItems.missingSubscriptions.description',
            actionLabelKey: 'dashboard.healthItems.missingSubscriptions.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'missing' },
        });
    } else if (enabledSubscriptions.length === 0) {
        items.push({
            id: 'no-enabled-subscriptions',
            tone: 'danger',
            titleKey: 'dashboard.healthItems.noEnabledSubscriptions.title',
            descriptionKey: 'dashboard.healthItems.noEnabledSubscriptions.description',
            actionLabelKey: 'dashboard.healthItems.noEnabledSubscriptions.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'disabled' },
        });
    }

    if (profiles.length === 0) {
        items.push({
            id: 'missing-profiles',
            tone: 'warning',
            titleKey: 'dashboard.healthItems.missingProfiles.title',
            descriptionKey: 'dashboard.healthItems.missingProfiles.description',
            actionLabelKey: 'dashboard.healthItems.missingProfiles.action',
            actionRoute: '/dashboard/subscriptions',
            actionQuery: { focus: 'profiles' },
        });
    } else if (activeProfiles.length === 0) {
        items.push({
            id: 'no-active-profiles',
            tone: 'warning',
            titleKey: 'dashboard.healthItems.noActiveProfiles.title',
            descriptionKey: 'dashboard.healthItems.noActiveProfiles.description',
            actionLabelKey: 'dashboard.healthItems.noActiveProfiles.action',
            actionRoute: '/dashboard/subscriptions',
            actionQuery: { focus: 'profiles' },
        });
    }

    if (tokenState === 'missing') {
        items.push({
            id: 'missing-token',
            tone: 'danger',
            titleKey: 'dashboard.healthItems.missingToken.title',
            descriptionKey: 'dashboard.healthItems.missingToken.description',
            actionLabelKey: 'dashboard.healthItems.missingToken.action',
            actionRoute: '/dashboard/settings',
            actionQuery: { focus: 'mytoken' },
        });
    } else if (tokenState === 'auto') {
        items.push({
            id: 'auto-token',
            tone: 'warning',
            titleKey: 'dashboard.healthItems.autoToken.title',
            descriptionKey: 'dashboard.healthItems.autoToken.description',
            actionLabelKey: 'dashboard.healthItems.autoToken.action',
            actionRoute: '/dashboard/settings',
            actionQuery: { focus: 'mytoken' },
        });
    }

    if (subscriptions.length > 0 && resolvedTotalNodes === 0) {
        items.push({
            id: 'zero-nodes',
            tone: 'danger',
            titleKey: 'dashboard.healthItems.zeroNodes.title',
            descriptionKey: 'dashboard.healthItems.zeroNodes.description',
            actionLabelKey: 'dashboard.healthItems.zeroNodes.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'zero-nodes' },
        });
    }

    if (errorSubscriptions.length > 0) {
        items.push({
            id: 'subscription-errors',
            tone: 'danger',
            titleKey: 'dashboard.healthItems.subscriptionErrors.title',
            titleParams: { count: errorSubscriptions.length },
            descriptionKey: 'dashboard.healthItems.subscriptionErrors.description',
            actionLabelKey: 'dashboard.healthItems.subscriptionErrors.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'error' },
            secondaryActionLabelKey: 'dashboard.healthItems.subscriptionErrors.secondaryAction',
            secondaryAction: 'openLog',
            count: errorSubscriptions.length,
        });
    }

    if (expiredSubscriptions.length > 0) {
        items.push({
            id: 'expired-subscriptions',
            tone: 'danger',
            titleKey: 'dashboard.healthItems.expiredSubscriptions.title',
            titleParams: { count: expiredSubscriptions.length },
            descriptionKey: 'dashboard.healthItems.expiredSubscriptions.description',
            actionLabelKey: 'dashboard.healthItems.expiredSubscriptions.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'expired' },
            count: expiredSubscriptions.length,
        });
    }

    if (lowTrafficSubscriptions.length > 0) {
        items.push({
            id: 'low-traffic',
            tone: 'warning',
            titleKey: 'dashboard.healthItems.lowTraffic.title',
            titleParams: { count: lowTrafficSubscriptions.length },
            descriptionKey: 'dashboard.healthItems.lowTraffic.description',
            actionLabelKey: 'dashboard.healthItems.lowTraffic.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'low-traffic' },
            count: lowTrafficSubscriptions.length,
        });
    }

    if (disabledSubscriptions.length > 0 && enabledSubscriptions.length > 0) {
        items.push({
            id: 'disabled-subscriptions',
            tone: 'info',
            titleKey: 'dashboard.healthItems.disabledSubscriptions.title',
            titleParams: { count: disabledSubscriptions.length },
            descriptionKey: 'dashboard.healthItems.disabledSubscriptions.description',
            actionLabelKey: 'dashboard.healthItems.disabledSubscriptions.action',
            actionRoute: '/dashboard/groups',
            actionQuery: { status: 'disabled' },
            count: disabledSubscriptions.length,
        });
    }

    return items;
}

export function resolveHealthItemCopy(item, t) {
    return {
        ...item,
        title: t(item.titleKey, item.titleParams),
        description: t(item.descriptionKey),
        actionLabel: t(item.actionLabelKey),
        secondaryActionLabel: item.secondaryActionLabelKey ? t(item.secondaryActionLabelKey) : '',
    };
}
