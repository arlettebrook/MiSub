<script setup>
    import { ref, watch, nextTick, onUnmounted } from 'vue';
    import QRCode from 'qrcode';
    import Modal from '../forms/Modal.vue';
    import Button from '../ui/Button.vue';
    import { useToastStore } from '../../stores/toast.js';
    import { useI18n } from '../../i18n/index.js';

    const { t } = useI18n();
    const { showToast } = useToastStore();

    const props = defineProps({
        show: {
            type: Boolean,
            default: false,
        },
        url: {
            type: String,
            required: true,
        },
        title: {
            type: String,
            default: '',
        },
    });

    const emit = defineEmits(['update:show']);

    const canvasRef = ref(null);
    const qrReady = ref(false);
    const qrError = ref(false);
    let generationId = 0;

    const generateQRCode = async () => {
        const id = ++generationId;
        const url = props.url;
        const canvas = canvasRef.value;
        qrReady.value = false;
        qrError.value = false;
        if (!props.show || !url || !canvas) return;
        try {
            await QRCode.toCanvas(canvas, url, {
                width: 256,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff',
                },
            });
            if (id === generationId && props.show) qrReady.value = true;
        } catch (err) {
            if (id !== generationId || !props.show) return;
            qrError.value = true;
            console.error('QR Code generation failed', err);
            showToast(t('qr.generateFailed'), 'error');
        }
    };

    watch(
        () => [props.show, props.url],
        async ([newShow, newUrl]) => {
            const id = ++generationId;
            qrReady.value = false;
            qrError.value = false;
            if (newShow && newUrl) {
                await nextTick();
                if (id === generationId) void generateQRCode();
            }
        },
        { immediate: true }
    );
    onUnmounted(() => {
        generationId++;
    });

    const downloadQRCode = () => {
        if (!qrReady.value || !canvasRef.value) return;
        const link = document.createElement('a');
        link.download = `${props.title || 'qrcode'}.png`;
        link.href = canvasRef.value.toDataURL('image/png');
        link.click();
    };
</script>

<template>
    <Modal :show="show" @update:show="emit('update:show', $event)">
        <template #title>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
                {{ title || t('qr.title') }}
            </h3>
        </template>
        <template #body>
            <div class="flex flex-col items-center gap-6 py-4">
                <div
                    class="w-full max-w-72 bg-white p-4 misub-radius-lg shadow-inner border border-gray-100 dark:border-gray-700"
                >
                    <canvas
                        :key="url"
                        ref="canvasRef"
                        class="qr-canvas w-64 max-w-full misub-radius-md"
                    ></canvas>
                </div>

                <p
                    class="w-full max-w-xs max-h-24 overflow-y-auto text-sm text-center text-gray-500 dark:text-gray-400 break-all"
                >
                    {{ url }}
                </p>

                <div v-if="qrError" class="flex flex-col items-center gap-3">
                    <p role="alert" class="text-sm text-center text-red-600 dark:text-red-400">
                        {{ t('qr.generateFailed') }}
                    </p>
                    <Button data-testid="qr-retry" variant="secondary" @click="generateQRCode">
                        {{ t('common.retry') }}
                    </Button>
                </div>

                <Button data-testid="qr-download" :disabled="!qrReady" @click="downloadQRCode">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                    </svg>
                    {{ t('qr.saveImage') }}
                </Button>
            </div>
        </template>
    </Modal>
</template>

<style scoped>
    /* QRCode sets an inline height; allow narrow canvases to keep their aspect ratio. */
    .qr-canvas {
        height: auto !important;
    }
</style>
