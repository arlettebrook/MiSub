<script setup>
    import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
    import { useI18n } from '../../../i18n/index.js';
    import { USER_AGENT_PRESETS, validateUserAgent } from '../../../../shared/user-agents.js';

    const props = defineProps({
        modelValue: { type: String, default: '' },
        id: { type: String, default: 'sub-edit-ua' },
        describedBy: { type: String, default: '' },
        error: { type: String, default: '' },
    });
    const emit = defineEmits(['update:modelValue']);
    const { t } = useI18n();
    const containerRef = ref(null);
    const inputRef = ref(null);
    const menuRef = ref(null);
    const isOpen = ref(false);
    const activeIndex = ref(0);
    const menuId = useId();
    const menuStyle = ref({});
    const pasteError = ref('');
    const displayedError = computed(() => props.error || pasteError.value);
    const presets = computed(() => [
        { label: t('subscriptions.defaultUa'), value: '' },
        ...USER_AGENT_PRESETS,
    ]);

    function updatePosition() {
        if (!isOpen.value || !inputRef.value) return;
        const rect = inputRef.value.getBoundingClientRect();
        const below = Math.max(0, window.innerHeight - rect.bottom - 8);
        const above = Math.max(0, rect.top - 8);
        const openAbove = below < 200 && above > below;
        const maxHeight = Math.min(280, openAbove ? above : below);
        const insideModal = containerRef.value?.closest('[role="dialog"][aria-modal="true"]');
        menuStyle.value = {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            maxHeight: `${maxHeight}px`,
            ...(openAbove
                ? { bottom: `${window.innerHeight - rect.top + 4}px` }
                : { top: `${rect.bottom + 4}px` }),
            zIndex: insideModal ? 'var(--z-modal-popover)' : 'var(--z-popover)',
        };
    }

    function closePresets() {
        isOpen.value = false;
    }

    async function openPresets() {
        const selectedIndex = presets.value.findIndex(
            (preset) => preset.value === props.modelValue
        );
        activeIndex.value = Math.max(0, selectedIndex);
        isOpen.value = true;
        inputRef.value?.focus({ preventScroll: true });
        await nextTick();
        updatePosition();
        scrollActiveOption();
    }

    function togglePresets() {
        if (isOpen.value) closePresets();
        else openPresets();
    }

    function selectPreset(preset) {
        pasteError.value = '';
        emit('update:modelValue', preset.value);
        closePresets();
        inputRef.value?.focus({ preventScroll: true });
    }

    function handleInput(event) {
        pasteError.value = '';
        emit('update:modelValue', event.target.value);
        closePresets();
    }

    function handlePaste(event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return;
        const validation = validateUserAgent(text);
        if (!validation.valid) {
            event.preventDefault();
            pasteError.value = t('subscriptions.uaPasteRejected', {
                reason: t(`subscriptions.uaValidation.${validation.code}`),
            });
            closePresets();
        }
    }

    watch(
        () => props.modelValue,
        () => {
            pasteError.value = '';
        }
    );

    function scrollActiveOption() {
        document
            .getElementById(`${menuId}-${activeIndex.value}`)
            ?.scrollIntoView?.({ block: 'nearest' });
    }

    function handleKeydown(event) {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen.value) {
                openPresets();
            } else {
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                activeIndex.value =
                    (activeIndex.value + direction + presets.value.length) % presets.value.length;
                nextTick(scrollActiveOption);
            }
        } else if (isOpen.value && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            selectPreset(presets.value[activeIndex.value]);
        } else if (isOpen.value && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePresets();
        } else if (event.key === 'Tab') {
            closePresets();
        }
    }

    function handleOutsidePointer(event) {
        if (!containerRef.value?.contains(event.target) && !menuRef.value?.contains(event.target)) {
            closePresets();
        }
    }

    function handleFocusOut(event) {
        if (
            event.relatedTarget &&
            !containerRef.value?.contains(event.relatedTarget) &&
            !menuRef.value?.contains(event.relatedTarget)
        ) {
            closePresets();
        }
    }

    watch(isOpen, (open) => {
        if (open) {
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
        } else {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        }
    });
    onMounted(() => document.addEventListener('pointerdown', handleOutsidePointer));
    onUnmounted(() => {
        document.removeEventListener('pointerdown', handleOutsidePointer);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
    });
</script>

<template>
    <div
        ref="containerRef"
        class="relative w-full"
        @keydown="handleKeydown"
        @focusout="handleFocusOut"
    >
        <div class="relative">
            <input
                :id="id"
                ref="inputRef"
                :value="modelValue"
                :title="modelValue || t('subscriptions.defaultUa')"
                :placeholder="t('subscriptions.defaultUa')"
                :aria-describedby="
                    [describedBy, displayedError ? `${id}-error` : ''].filter(Boolean).join(' ') ||
                    undefined
                "
                :aria-invalid="Boolean(displayedError)"
                role="combobox"
                aria-autocomplete="none"
                aria-haspopup="listbox"
                :aria-expanded="isOpen"
                :aria-controls="menuId"
                :aria-activedescendant="isOpen ? `${menuId}-${activeIndex}` : undefined"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                :spellcheck="false"
                class="block w-full pl-3 pr-12 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 misub-radius-md text-gray-900 dark:text-white placeholder-gray-600 dark:placeholder-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 focus:border-primary-500"
                @input="handleInput"
                @paste="handlePaste"
            />
            <button
                type="button"
                class="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 misub-radius-md"
                :aria-label="t('subscriptions.uaPresets')"
                aria-haspopup="listbox"
                :aria-controls="menuId"
                :aria-expanded="isOpen"
                @click="togglePresets"
            >
                <svg
                    class="h-4 w-4 transition-transform"
                    :class="{ 'rotate-180': isOpen }"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden="true"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="m6 9 6 6 6-6"
                    />
                </svg>
            </button>
        </div>
        <Teleport to="body">
            <ul
                v-if="isOpen"
                :id="menuId"
                ref="menuRef"
                role="listbox"
                :aria-label="t('subscriptions.uaPresets')"
                class="fixed overflow-y-auto overscroll-contain border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 py-1 misub-radius-md shadow-lg"
                :style="menuStyle"
            >
                <li
                    v-for="(preset, index) in presets"
                    :id="`${menuId}-${index}`"
                    :key="preset.value"
                    role="option"
                    :aria-selected="modelValue === preset.value"
                    class="cursor-pointer px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    :class="{ 'bg-primary-50 dark:bg-primary-500/15': index === activeIndex }"
                    @pointermove="activeIndex = index"
                    @mousedown.prevent
                    @click="selectPreset(preset)"
                >
                    <span class="block font-medium">{{ preset.label }}</span>
                    <span
                        v-if="preset.value && preset.value !== preset.label"
                        class="block break-all text-xs text-gray-500 dark:text-gray-400"
                    >
                        {{ preset.value }}
                    </span>
                </li>
            </ul>
        </Teleport>
        <p
            v-if="displayedError"
            :id="`${id}-error`"
            role="alert"
            class="mt-1 text-xs text-red-600 dark:text-red-400"
        >
            {{ displayedError }}
        </p>
    </div>
</template>
