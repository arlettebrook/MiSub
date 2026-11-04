<template>
    <div class="entrance-container">
        <!-- If access is allowed (Login), the component renders differently via the component map or state -->
        <!-- Actually, we redirect or render component based on check -->
        <component :is="activeComponent" v-bind="componentProps" />
    </div>
</template>

<script setup>
    import { ref, defineAsyncComponent, watch, markRaw } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useSessionStore } from '../stores/session';
    import { storeToRefs } from 'pinia';

    // Lazy load components
    const Login = defineAsyncComponent(() => import('../components/modals/Login.vue'));
    const NotFound = defineAsyncComponent(() => import('./NotFound.vue'));

    const route = useRoute();
    const router = useRouter();
    const sessionStore = useSessionStore();
    const { publicConfig } = storeToRefs(sessionStore);

    const activeComponent = ref(null);
    const componentProps = ref({});

    let pathCheckId = 0;
    async function checkPath() {
        const checkId = ++pathCheckId;
        // 在 session 还在 loading 时，publicConfig 尚未从 API 加载，不做判断
        if (sessionStore.sessionState === 'loading') {
            activeComponent.value = null;
            return;
        }

        const currentPath = route.path;
        activeComponent.value = null;
        const isLoginPath = await sessionStore.checkLoginPath(currentPath);
        if (checkId !== pathCheckId || currentPath !== route.path) return;
        if (isLoginPath) {
            if (sessionStore.sessionState === 'loggedIn') {
                await router.replace('/dashboard');
                return;
            }
            activeComponent.value = markRaw(Login);
            componentProps.value = { login: sessionStore.login };
        } else {
            // 不匹配任何登录路径 → 显示 404
            activeComponent.value = markRaw(NotFound);
        }
    }

    watch(
        [
            () => route.path,
            () => sessionStore.sessionState,
            () => publicConfig.value?.isLoginPath,
            () => publicConfig.value?.hasCustomLoginPath,
            () => publicConfig.value?.customLoginPath,
        ],
        checkPath,
        { immediate: true }
    );
</script>

<style scoped>
    .entrance-container {
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }
</style>
