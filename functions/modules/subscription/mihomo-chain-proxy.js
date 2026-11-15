// Custom templates declare entry -> landing chains. Mihomo implements them
// through dialer-proxy on landing copies; entry choices must remain original.
const DYNAMIC_KEYS = [
    'include-all',
    'include-all-proxies',
    'include-all-providers',
    'use',
    'filter',
    'exclude-filter',
    'exclude-type',
];
const BUILTINS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(message) {
    const error = new Error(`Invalid MiSub chain proxy: ${message}`);
    error.code = 'MIHOMO_CHAIN_CONFIG_ERROR';
    throw error;
}

export function normalizeChainConfigs(value) {
    if (value === undefined || value === null) return [];
    const items = Array.isArray(value) ? value : [value];
    const configs = [];
    const seen = new Map();
    for (const item of items) {
        if (!isObject(item)) invalid('each declaration must be an object');
        const group = item.group ?? item['landing-group'];
        const entry = item.entry ?? item['entry-group'];
        const prefix = item.prefix ?? item['clone-prefix'] ?? '';
        if (
            typeof group !== 'string' ||
            !group.trim() ||
            typeof entry !== 'string' ||
            !entry.trim()
        ) {
            invalid('landing-group and entry-group are required');
        }
        const config = { group: group.trim(), entry: entry.trim(), prefix };
        if (config.group === config.entry) invalid('entry and landing groups must differ');
        if (BUILTINS.has(config.group) || BUILTINS.has(config.entry))
            invalid('group names cannot be built-in policies');
        if (typeof prefix !== 'string') invalid('clone-prefix must be a string');
        const previous = seen.get(config.group);
        if (previous) {
            if (previous.entry !== config.entry || previous.prefix !== prefix)
                invalid(`conflicting declarations for ${config.group}`);
            continue;
        }
        seen.set(config.group, config);
        configs.push(config);
    }
    const landing = new Set(configs.map((config) => config.group));
    if (configs.some((config) => landing.has(config.entry)))
        invalid('an entry group cannot also be a landing group');
    return configs;
}

function regex(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
        return new RegExp(value.replace(/\(\?i\)/g, ''), 'i');
    } catch {
        invalid(`invalid group filter ${value}`);
    }
}

function groupChoices(group, baseNames) {
    const result = new Set(group?.members || []);
    const options = group?.options || {};
    const filters = [...(group?.filters || []), ...(options.filter ? [options.filter] : [])];
    if (
        options['include-all'] === true ||
        options['include-all'] === 'true' ||
        options['include-all-proxies'] === true ||
        options['include-all-proxies'] === 'true'
    ) {
        baseNames.forEach((name) => result.add(name));
    }
    for (const filter of filters) {
        const pattern = regex(filter);
        for (const name of baseNames) if (pattern?.test(name)) result.add(name);
    }
    const include = regex(options.filter),
        exclude = regex(options['exclude-filter']);
    return [...result].filter(
        (name) => (!include || include.test(name)) && (!exclude || !exclude.test(name))
    );
}

function clearDynamic(group) {
    group.filters = [];
    group.options ||= {};
    for (const key of DYNAMIC_KEYS) delete group.options[key];
}

export function applyMihomoChainProxy(input, { enableDialerProxy = false } = {}) {
    const configs = normalizeChainConfigs(input?.extras?.chainProxy);
    if (!configs.length) return input;
    const model = structuredClone(input);
    const base = (model.proxies || []).filter((proxy) => proxy?.name);
    const baseNames = base.map((proxy) => proxy.name);
    const proxiesByName = new Map(base.map((proxy) => [proxy.name, proxy]));
    const groupsByName = new Map((model.groups || []).map((group) => [group.name, group]));
    if (proxiesByName.size !== base.length) invalid('proxy names must be unique');
    const chainNames = new Set(configs.flatMap((config) => [config.group, config.entry]));
    for (const name of chainNames)
        if (proxiesByName.has(name)) invalid(`group name collides with proxy ${name}`);
    const landingNames = new Set(configs.map((config) => config.group));

    // Flatten nested selection groups into original nodes, excluding all landing
    // groups. Dynamic provider membership cannot safely contain generated copies.
    function originalChoices(name, visiting = new Set()) {
        if (landingNames.has(name) || visiting.has(name)) return [];
        if (proxiesByName.has(name) || name === 'DIRECT') return [name];
        const group = groupsByName.get(name);
        if (!group) return [];
        const next = new Set(visiting).add(name);
        return groupChoices(group, baseNames).flatMap((member) => originalChoices(member, next));
    }
    // An original proxy may already have a dialer. Keep it intact, but exclude
    // it from entry choices if any possible dependency reaches a chain or cycle.
    function safeDependency(name, visiting = new Set()) {
        if (BUILTINS.has(name)) return true;
        if (chainNames.has(name) || visiting.has(name)) return false;
        const next = new Set(visiting).add(name);
        const proxy = proxiesByName.get(name);
        if (proxy) return !proxy['dialer-proxy'] || safeDependency(proxy['dialer-proxy'], next);
        const group = groupsByName.get(name);
        if (!group || group.options?.use || group.options?.['include-all-providers']) return false;
        const members = groupChoices(group, baseNames);
        return members.length > 0 && members.every((member) => safeDependency(member, next));
    }
    const safeNames = baseNames.filter((name) => safeDependency(name));
    const usedNames = new Set([
        ...baseNames,
        ...(model.groups || []).map((group) => group.name),
        ...chainNames,
        ...BUILTINS,
    ]);
    model.groups ||= [];
    model.proxies ||= [];
    function ensureGroup(name, members) {
        let group = model.groups.find((candidate) => candidate.name === name);
        if (!group) {
            group = { name, type: 'select', members: [...members], filters: [], options: {} };
            model.groups.push(group);
        }
        return group;
    }
    // Compute selectors from the unmodified snapshot before expanding any chain.
    const entryPools = new Map(
        configs.map((config) => {
            const existing = groupsByName.get(config.entry);
            const choices = existing ? originalChoices(config.entry) : safeNames;
            if (
                existing &&
                !choices.length &&
                ((existing.filters || []).length || existing.options?.filter)
            ) {
                invalid(`entry filter matches no original nodes for ${config.entry}`);
            }
            const safe = [...new Set(choices)].filter(
                (name) => name === 'DIRECT' || safeNames.includes(name)
            );
            return [config.entry, safe.length ? safe : safeNames];
        })
    );
    for (const config of configs) {
        const entryNames = entryPools.get(config.entry);
        if (!entryNames.length && baseNames.length && enableDialerProxy)
            invalid(`no safe original entry nodes for ${config.entry}`);
        const entry = ensureGroup(config.entry, []);
        entry.members = entryNames.length ? entryNames : ['DIRECT'];
        if (!['select', 'url-test', 'fallback', 'load-balance'].includes(entry.type))
            entry.type = 'select';
        clearDynamic(entry);
        const landing = ensureGroup(config.group, []);
        if (!enableDialerProxy || !baseNames.length) {
            const choices = groupChoices(groupsByName.get(config.group), baseNames).filter(
                (name) => baseNames.includes(name) || name === config.entry || name === 'DIRECT'
            );
            landing.members = choices.length
                ? choices
                : baseNames.length
                  ? [...baseNames]
                  : ['DIRECT'];
        } else {
            landing.members = base.map((proxy) => {
                const prefix = config.prefix || `${config.group} - `;
                const stem = `${prefix}${proxy.name}`;
                let name = stem,
                    suffix = 2;
                while (usedNames.has(name)) name = `${stem} (${suffix++})`;
                usedNames.add(name);
                model.proxies.push({
                    ...structuredClone(proxy),
                    name,
                    'dialer-proxy': config.entry,
                });
                return name;
            });
        }
        landing.type = 'select';
        clearDynamic(landing);
    }
    // Consume the declaration on our clone so later processing is idempotent.
    delete model.extras.chainProxy;
    return model;
}

export function applyMihomoChainProxyToClashConfig(input, { enableDialerProxy = false } = {}) {
    const configs = normalizeChainConfigs(input?.['x-misub-chain-proxy']);
    if (!configs.length) {
        const clean = { ...input };
        delete clean['x-misub-chain-proxy'];
        return clean;
    }
    const model = applyMihomoChainProxy(
        {
            proxies: input.proxies || [],
            groups: (input['proxy-groups'] || [])
                .filter(Boolean)
                .map(({ name, type, proxies, ...options }) => ({
                    name,
                    type,
                    members: Array.isArray(proxies) ? proxies : [],
                    filters: [],
                    options,
                })),
            extras: { chainProxy: configs },
        },
        { enableDialerProxy }
    );
    const chainNames = new Set(configs.flatMap((config) => [config.entry, config.group]));
    const rawGroups = new Map(
        (input['proxy-groups'] || []).filter(Boolean).map((group) => [group.name, group])
    );
    const output = {
        ...input,
        proxies: model.proxies,
        'proxy-groups': model.groups.map((group) =>
            !chainNames.has(group.name) && rawGroups.has(group.name)
                ? structuredClone(rawGroups.get(group.name))
                : {
                      name: group.name,
                      type: group.type,
                      proxies: group.members,
                      ...group.options,
                  }
        ),
    };
    delete output['x-misub-chain-proxy'];
    return output;
}
