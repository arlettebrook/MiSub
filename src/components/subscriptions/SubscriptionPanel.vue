<script setup>
    import { computed } from 'vue';
    import draggable from 'vuedraggable';
    import Card from '../ui/Card.vue';
    import MoreActionsMenu from '@/components/shared/MoreActionsMenu.vue';
    import PanelPagination from '@/components/shared/PanelPagination.vue';
    import EmptyState from '@/components/ui/EmptyState.vue';
    import Button from '@/components/ui/Button.vue';
    import { useUIStore } from '@/stores/ui';
    import { useI18n } from '@/i18n/index.js';

    const { layoutMode } = useUIStore();
    const { t } = useI18n();

    const props = defineProps({
        subscriptions: { type: Array, default: () => [] },
        paginatedSubscriptions: Array,
        currentPage: Number,
        totalPages: Number,
        isSorting: Boolean,
        searchable: { type: Boolean, default: false },
        searchQuery: { type: String, default: '' },
        filteredCount: { type: Number, default: undefined },
        statusFilter: { type: String, default: '' },
        statusFilterLabel: { type: String, default: '' },
    });

    const emit = defineEmits([
        'add',
        'delete',
        'changePage',
        'updateNodeCount',
        'edit',
        'toggleSort',
        'markDirty',
        'preview',
        'deleteAll',
        'refreshAll',
        'reorder',
        'import',
        'qrcode',
        'updateSearch',
        'clearStatusFilter',
    ]);

    const searchModel = computed({
        get: () => props.searchQuery,
        set: (value) => emit('updateSearch', value),
    });

    const visibleCount = computed(() => props.filteredCount ?? props.subscriptions.length);

    const draggableSubscriptions = computed({
        get: () => [...props.subscriptions],
        set: (val) => emit('reorder', val),
    });

    const handleDelete = (id) => emit('delete', id);
    const handleEdit = (id) => emit('edit', id);
    const handleUpdate = (id) => emit('updateNodeCount', id);
    const handlePreview = (id) => emit('preview', id);
    const handleQRCode = (id) => emit('qrcode', id);
    const handleAdd = () => emit('add');
    const handleChangePage = (page) => emit('changePage', page);
    const handleToggleSort = () => emit('toggleSort');
    const handleSortEnd = () => emit('markDirty');
    const handleDeleteAll = () => emit('deleteAll');
    const handleRefreshAll = () => emit('refreshAll');
    const handleImport = () => emit('import');
</script>

<template>
    <div>
        <div
            class="mb-4 rounded-xl border border-gray-100/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/70"
        >
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div class="min-w-0">
                    <div class="flex items-center gap-3 shrink-0">
                        <h2 class="text-xl font-bold text-gray-900 dark:text-white">
                            {{ t('subscriptions.title') }}
                        </h2>
                        <span
                            class="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200"
                            >{{ subscriptions.length }}</span
                        >
                    </div>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {{ t('subscriptions.subtitle') }}
                    </p>
                </div>
                <div
                    class="flex flex-wrap items-center gap-2 sm:w-auto justify-end sm:justify-start"
                >
                    <slot name="actions-prepend"></slot>
                    <button
                        @click="handleImport"
                        class="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                    >
                        {{ t('actions.bulkImport') }}
                    </button>
                    <button
                        @click="handleAdd"
                        class="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                    >
                        {{ t('actions.add') }}
                    </button>
                    <MoreActionsMenu menu-width-class="w-36">
                        <template #menu="{ close }">
                            <button
                                @click="
                                    handleRefreshAll();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                {{ t('actions.refreshAll') }}
                            </button>
                            <button
                                @click="
                                    handleToggleSort();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                {{ isSorting ? t('actions.finishSort') : t('actions.manualSort') }}
                            </button>
                            <div class="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                            <button
                                @click="
                                    handleDeleteAll();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-500/10"
                            >
                                {{ t('actions.clearAll') }}
                            </button>
                        </template>
                    </MoreActionsMenu>
                </div>
            </div>
            <div v-if="searchable" class="relative mt-4">
                <svg
                    class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                    v-model="searchModel"
                    data-testid="subscription-search"
                    type="search"
                    :placeholder="t('subscriptions.listSearchPlaceholder')"
                    :aria-label="t('subscriptions.searchPlaceholder')"
                    :disabled="isSorting"
                    class="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-20 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500"
                />
                <span
                    v-if="searchQuery"
                    class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400"
                >
                    {{ visibleCount }}/{{ subscriptions.length }}
                </span>
            </div>
        </div>
        <div
            v-if="statusFilter && !isSorting"
            data-testid="subscription-status-filter"
            class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
        >
            <span>{{ statusFilterLabel }}</span>
            <span class="opacity-70">{{ visibleCount }}/{{ subscriptions.length }}</span>
            <button
                type="button"
                data-testid="subscription-status-filter-clear"
                class="ml-auto font-semibold underline underline-offset-2 hover:opacity-80"
                @click="emit('clearStatusFilter')"
            >
                {{ t('subscriptions.clearStatusFilter') }}
            </button>
        </div>
        <div v-if="subscriptions.length > 0">
            <draggable
                v-if="isSorting"
                tag="div"
                class="grid grid-cols-1 md:grid-cols-2 gap-4"
                v-model="draggableSubscriptions"
                item-key="id"
                animation="300"
                @end="handleSortEnd"
            >
                <template #item="{ element: subscription }">
                    <div class="cursor-move">
                        <Card
                            :misub="subscription"
                            @delete="handleDelete(subscription.id)"
                            @change="handleSortEnd"
                            @update="handleUpdate(subscription.id)"
                            @edit="handleEdit(subscription.id)"
                            @preview="handlePreview(subscription.id)"
                            @qrcode="handleQRCode(subscription.id)"
                        />
                    </div>
                </template>
            </draggable>
            <div
                v-else-if="paginatedSubscriptions.length > 0"
                class="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
                <div
                    v-for="(subscription, index) in paginatedSubscriptions"
                    :key="subscription.id"
                    class="list-item-animation"
                    :style="{ '--delay-index': index }"
                >
                    <Card
                        :misub="subscription"
                        @delete="handleDelete(subscription.id)"
                        @change="handleSortEnd"
                        @update="handleUpdate(subscription.id)"
                        @edit="handleEdit(subscription.id)"
                        @preview="handlePreview(subscription.id)"
                        @qrcode="handleQRCode(subscription.id)"
                    />
                </div>
            </div>
            <div
                v-else
                class="rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900/50"
            >
                <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {{ t('subscriptions.noSearchResults') }}
                </p>
                <Button v-if="searchQuery" class="mt-3" @click="searchModel = ''">
                    {{ t('actions.clearSearch') }}
                </Button>
            </div>
            <PanelPagination
                v-if="totalPages > 1 && !isSorting"
                variant="panel"
                :current-page="currentPage"
                :total-pages="totalPages"
                :total-items="visibleCount"
                :show-total-items="true"
                @change-page="handleChangePage"
            />
        </div>
        <div
            v-else
            class="rounded-xl border border-dashed border-gray-300 bg-white/60 py-6 dark:border-gray-700 dark:bg-gray-900/50"
        >
            <EmptyState
                :title="t('subscriptions.empty')"
                :description="t('subscriptions.emptyDesc')"
                icon="folder"
                :total-count="0"
            />
            <div class="-mt-8 mb-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <button
                    data-testid="empty-add-subscription"
                    @click="handleAdd"
                    class="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
                >
                    {{ t('subscriptions.addEmpty') }}
                </button>
                <button
                    data-testid="empty-import-subscriptions"
                    @click="handleImport"
                    class="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                    {{ t('actions.bulkImport') }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .cursor-move {
        cursor: move;
    }
</style>
