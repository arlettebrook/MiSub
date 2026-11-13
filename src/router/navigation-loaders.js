// Share the same lazy imports between navigation and background preloading.
export const navigationLoaders = {
    '/dashboard': () => import('../views/DashboardView.vue'),
    '/dashboard/groups': () => import('../views/SubscriptionGroupsView.vue'),
    '/dashboard/nodes': () => import('../views/ManualNodesView.vue'),
    '/dashboard/subscriptions': () => import('../views/MySubscriptionsView.vue'),
    '/dashboard/settings': () => import('../views/SettingsView.vue'),
};
