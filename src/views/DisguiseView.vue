<script setup>
    import { ref, watch, onUnmounted } from 'vue';
    import { useSessionStore } from '../stores/session.js';
    import { createDisguiseResponse } from '../../functions/modules/disguise-page.js';

    const sessionStore = useSessionStore();
    const html = ref('');
    let renderId = 0;

    watch(
        [() => sessionStore.sessionState, () => sessionStore.publicConfig?.disguise],
        async () => {
            const id = ++renderId;
            html.value = '';
            if (sessionStore.sessionState !== 'loggedOut') return;

            const config = sessionStore.publicConfig?.disguise;
            const response = createDisguiseResponse(
                config?.enabled === true ? config : undefined,
                window.location.href
            );
            const redirect = response.headers.get('Location');
            if (redirect) {
                window.location.replace(redirect);
                return;
            }

            const content = await response.text();
            if (id !== renderId || sessionStore.sessionState !== 'loggedOut') return;
            html.value = content.replace('<head>', '<head><base target="_top">');
            document.title = '404 Not Found';
        },
        { immediate: true }
    );

    onUnmounted(() => {
        renderId++;
    });
</script>

<template>
    <iframe
        v-if="html"
        :srcdoc="html"
        title="404 Not Found"
        sandbox="allow-top-navigation-by-user-activation"
        class="fixed inset-0 z-[9999] h-full w-full border-0"
        data-testid="disguise-frame"
    />
</template>
