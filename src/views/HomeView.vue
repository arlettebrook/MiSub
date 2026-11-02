<script setup>
    import { defineAsyncComponent, computed, watchEffect, h } from 'vue';
    import { useSessionStore } from '../stores/session';
    import { storeToRefs } from 'pinia';
    import { useRoute, useRouter } from 'vue-router';

    // Lazy load components
    const PublicProfilesView = defineAsyncComponent(() => import('./PublicProfilesView.vue'));
    const NotFoundView = defineAsyncComponent(() => import('./NotFound.vue'));

    // 使用 render 占位，避免严格 CSP 拦截运行时模板编译。
    const RedirectPlaceholder = { render: () => h('div') };

    const sessionStore = useSessionStore();
    const { sessionState, publicConfig } = storeToRefs(sessionStore);
    const route = useRoute();
    const router = useRouter();

    const isExploreRoute = computed(() => route.path === '/explore');

    // 如果用户已登录且访问的是首页 /，自动通过逻辑重定向到仪表盘 /dashboard
    watchEffect(() => {
        if (sessionState.value === 'loggedIn' && !isExploreRoute.value) {
            router.replace('/dashboard').catch((error) => {
                console.warn('Home redirect failed:', error);
            });
        }
    });

    const currentView = computed(() => {
        // 1. 明确的 /explore 路由，显示公开页
        if (isExploreRoute.value) {
            if (publicConfig.value && !publicConfig.value.enablePublicPage) {
                return NotFoundView;
            }
            return PublicProfilesView;
        }

        // 2. 根路径 /
        // Initial authenticated entry is prepared by App before this view is revealed.
        if (sessionState.value === 'loggedIn') {
            return RedirectPlaceholder;
        }

        // 未登录 + 公开页关闭：显示 404 (Disguise)
        if (
            sessionState.value === 'loggedOut' &&
            publicConfig.value &&
            !publicConfig.value.enablePublicPage
        ) {
            return NotFoundView;
        }

        // 其他情况（未登录 + 公开页开启）：显示公开页
        return PublicProfilesView;
    });
</script>

<template>
    <component :is="currentView" />
</template>
