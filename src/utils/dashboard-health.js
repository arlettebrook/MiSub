import { getSubscriptionTrafficState as getTrafficState } from './dashboard-deeplink.js';

const DEFAULT_NOW = () => Date.now();

function getSubscriptionHealthItem(sub, index, type, copyKey, status, tone) {
    const subscriptionId = sub.id == null ? '' : String(sub.id);
    const name = String(sub.name || '').trim();
    return {
        id: `${type}:${subscriptionId || sub.url || index}`,
        subscriptionId,
        titleKey: `dashboard.healthItems.${copyKey}.title`,
        titleParams: { name },
        descriptionKey: `dashboard.healthItems.${copyKey}.description`,
        actionLabelKey: `dashboard.healthItems.${copyKey}.action`,
        actionRoute: '/dashboard/groups',
        actionQuery: { status, ...(subscriptionId ? { subscription: subscriptionId } : {}) },
        tone,
    };
}

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
    const activeProfiles = profiles.filter((profile) => profile.enabled !== false);
    const tokenState = getTokenState(settings);
    const resolvedTotalNodes =
        totalNodesCount ?? subscriptions.reduce((sum, sub) => sum + Number(sub.nodeCount || 0), 0);
    const errorSubscriptions = enabledSubscriptions.filter((sub) => Boolean(sub.lastError));
    const expiredSubscriptions = enabledSubscriptions.filter(
        (sub) => getTrafficState(sub, now) === 'expired'
    );
    const lowTrafficSubscriptions = enabledSubscriptions.filter(
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

    if (enabledSubscriptions.length > 0 && resolvedTotalNodes === 0) {
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

    errorSubscriptions.forEach((sub, index) => {
        items.push({
            ...getSubscriptionHealthItem(
                sub,
                index,
                'subscription-errors',
                'subscriptionErrors',
                'error',
                'danger'
            ),
            descriptionParams: { error: String(sub.lastError) },
            secondaryActionLabelKey: 'dashboard.healthItems.subscriptionErrors.secondaryAction',
            secondaryAction: 'openLog',
        });
    });

    expiredSubscriptions.forEach((sub, index) => {
        items.push(
            getSubscriptionHealthItem(
                sub,
                index,
                'expired-subscriptions',
                'expiredSubscriptions',
                'expired',
                'danger'
            )
        );
    });

    lowTrafficSubscriptions.forEach((sub, index) => {
        items.push(
            getSubscriptionHealthItem(
                sub,
                index,
                'low-traffic',
                'lowTraffic',
                'low-traffic',
                'warning'
            )
        );
    });

    return items;
}

export function resolveHealthItemCopy(item, t) {
    const titleParams =
        item.titleParams && 'name' in item.titleParams
            ? { ...item.titleParams, name: item.titleParams.name || t('subscriptions.unnamed') }
            : item.titleParams;
    return {
        ...item,
        title: t(item.titleKey, titleParams),
        description: t(item.descriptionKey, item.descriptionParams),
        actionLabel: t(item.actionLabelKey),
        secondaryActionLabel: item.secondaryActionLabelKey ? t(item.secondaryActionLabelKey) : '',
    };
}
