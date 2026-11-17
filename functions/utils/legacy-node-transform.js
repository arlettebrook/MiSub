export function adaptLegacyTransform(config) {
    if (!config || !config.enabled) return [];

    const ops = [];

    // 1. 过滤器 (Filter)
    const filter = config.filter;
    if (
        filter &&
        (filter.include?.enabled ||
            filter.exclude?.enabled ||
            filter.protocols?.enabled ||
            filter.regions?.enabled ||
            filter.script?.enabled ||
            filter.useless?.enabled)
    ) {
        ops.push({
            id: 'legacy-filter',
            type: 'filter',
            enabled: true,
            params: { ...filter },
        });
    }

    // 2. 正则重命名 (Regex Rename)
    const regex = config.rename?.regex;
    if (regex?.enabled && regex.rules?.length > 0) {
        ops.push({
            id: 'legacy-rename-regex',
            type: 'rename',
            enabled: true,
            params: { regex: { ...regex } },
        });
    }

    // 3. 模板重命名 (Template Rename)
    const template = config.rename?.template;
    if (template?.enabled) {
        ops.push({
            id: 'legacy-rename-template',
            type: 'rename',
            enabled: true,
            params: {
                template: {
                    enabled: true,
                    template: template.template || '{emoji}{region}-{protocol}-{index}',
                    offset: template.indexStart || 1,
                    indexScope: template.indexScope || 'region',
                },
            },
        });
    }

    // 4. 重命名脚本 (Script Rename)
    const renameScript = config.rename?.script;
    if (renameScript?.enabled && renameScript.expression) {
        ops.push({
            id: 'legacy-rename-script',
            type: 'script',
            enabled: true,
            params: { dsl: [{ action: 'rename', template: renameScript.expression }] },
        });
    }

    // 5. 去重 (Dedup)
    const dedup = config.dedup;
    if (dedup?.enabled) {
        ops.push({
            id: 'legacy-dedup',
            type: 'dedup',
            enabled: true,
            params: { ...dedup },
        });
    }

    // 6. 排序 (Sort)
    const sort = config.sort;
    if (sort?.enabled && sort.keys?.length > 0) {
        ops.push({
            id: 'legacy-sort',
            type: 'sort',
            enabled: true,
            params: { ...sort },
        });
    }

    return ops;
}
