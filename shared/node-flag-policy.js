const DEFAULT_NAME_TEMPLATE = '{emoji}{region}-{protocol}-{index}';

export function hasEmojiTemplate(template) {
    return /\{emoji(?::[a-zA-Z0-9]+)?\}/.test(String(template || ''));
}

function parseOperators(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // 历史脏数据按未配置处理。
        }
    }
    return [];
}

/** 订阅组 > 所选预设 > 全局，沿用 nodeTransform 的整体覆盖语义。 */
export function resolveEffectiveNodeTransform(profile, config = {}, searchParams) {
    const own = profile?.nodeTransform;
    const presets = Array.isArray(config.nodeTransformPresets) ? config.nodeTransformPresets : [];
    const preset = profile?.nodeTransformPresetId
        ? presets.find((item) => item?.id === profile.nodeTransformPresetId)?.config
        : null;
    const resolved =
        own && Object.keys(own).length > 0 ? own : preset || config.defaultNodeTransform || {};
    const nodeTransform = { ...resolved };
    const emoji = searchParams?.get('emoji');
    if (emoji === 'true' || emoji === 'false') {
        nodeTransform.addFlagEmoji = emoji === 'true';
    }
    return nodeTransform;
}

/** 返回生效的工作流；空数组表示由调用方桥接旧版转换配置。 */
export function resolveNodeOperators(profile, config = {}, nodeTransform = {}) {
    const own = parseOperators(profile?.operators);
    if (own.length) return [...own];
    const transformOperators = nodeTransform.enabled ? parseOperators(nodeTransform.operators) : [];
    if (transformOperators.length) return [...transformOperators];
    return [...parseOperators(config.defaultOperators)];
}

/** 源级重命名中的 emoji 变量依赖生效模式，位置由后续处理决定。 */
export function resolveSourceFlagPolicyFingerprint(source, policy) {
    if (!policy) return undefined;
    const operators = resolveNodeOperators(source, {}, source?.nodeTransform || {});
    const dependsOnEmoji = operators.some((op) => {
        if (op?.enabled === false || op?.type !== 'rename') return false;
        const { template, regex } = op.params || {};
        return Boolean(
            (template?.enabled && hasEmojiTemplate(template.template)) ||
            (regex?.enabled &&
                Array.isArray(regex.rules) &&
                regex.rules.some(
                    (rule) => typeof rule === 'object' && hasEmojiTemplate(rule?.replacement)
                ))
        );
    });
    return dependsOnEmoji ? JSON.stringify({ emoji: policy.mode !== 'remove' }) : undefined;
}

/** 仅在工作流为空时桥接旧模板，保持预览和订阅生成的优先级一致。 */
export function resolveNodeNameTemplate(operators = [], transform = {}) {
    let template;
    for (const op of operators)
        if (
            op?.enabled !== false &&
            op?.type === 'rename' &&
            op.params?.template?.enabled &&
            op.params.template.template
        )
            template = op.params.template;
    if (!operators.length && transform.enabled && transform.rename?.template?.enabled)
        template = {
            ...transform.rename.template,
            template: transform.rename.template.template || DEFAULT_NAME_TEMPLATE,
            offset: transform.rename.template.indexStart || 1,
            indexScope: transform.rename.template.indexScope || 'region',
        };
    return template;
}

export function resolveNodeFlagPolicy(profile = {}, config = {}, operators = [], searchParams) {
    profile ||= {};
    const transform = resolveEffectiveNodeTransform(profile, config, searchParams);
    const validModes = ['auto', 'preserve', 'remove'];
    const globalTransform = config.defaultNodeTransform || {};
    const globalMode = validModes.includes(config.flagEmojiMode)
        ? config.flagEmojiMode
        : validModes.includes(globalTransform.flagEmojiMode)
          ? globalTransform.flagEmojiMode
          : typeof globalTransform.addFlagEmoji === 'boolean'
            ? globalTransform.addFlagEmoji
                ? 'auto'
                : 'remove'
            : config.enableFlagEmoji === false
              ? 'remove'
              : 'auto';
    const explicit = profile.flagEmojiMode || transform.flagEmojiMode;
    const presets = Array.isArray(config.nodeTransformPresets) ? config.nodeTransformPresets : [];
    const hasProfileTransform = Boolean(
        (profile.nodeTransform && Object.keys(profile.nodeTransform).length) ||
        presets.some((preset) => preset?.id === profile.nodeTransformPresetId && preset?.config)
    );
    let mode =
        profile.flagEmojiMode === 'inherit'
            ? globalMode
            : validModes.includes(profile.flagEmojiMode)
              ? profile.flagEmojiMode
              : validModes.includes(config.flagEmojiMode) && !hasProfileTransform
                ? globalMode
                : explicit === 'inherit'
                  ? globalMode
                  : validModes.includes(explicit)
                    ? explicit
                    : typeof transform.addFlagEmoji === 'boolean'
                      ? transform.addFlagEmoji
                          ? 'auto'
                          : 'remove'
                      : globalMode;
    const queryMode = searchParams?.get('emoji-mode');
    if (validModes.includes(queryMode)) mode = queryMode;
    else if (searchParams?.get('emoji') === 'true' || searchParams?.get('emoji') === 'false')
        mode = searchParams.get('emoji') === 'true' ? 'auto' : 'remove';
    const validPositions = ['prefix', 'suffix'];
    const inheritedPosition =
        profile.flagEmojiPosition === 'inherit' || !hasProfileTransform
            ? config.flagEmojiPosition
            : transform.flagEmojiPosition || config.flagEmojiPosition;
    const candidatePosition = validPositions.includes(profile.flagEmojiPosition)
        ? profile.flagEmojiPosition
        : inheritedPosition;
    const queryPosition = searchParams?.get('emoji-position');
    const position = validPositions.includes(queryPosition)
        ? queryPosition
        : candidatePosition === 'suffix'
          ? 'suffix'
          : 'prefix';
    const nameTemplate = resolveNodeNameTemplate(operators, transform)?.template;
    const requestedMode = mode;
    if (mode === 'auto' && nameTemplate !== undefined && !hasEmojiTemplate(nameTemplate))
        mode = 'remove';
    return { mode, requestedMode, position, template: hasEmojiTemplate(nameTemplate) };
}

/** 旧调用方仍可读取布尔开关；输出使用完整策略。 */
export function resolveFlagEmojiPolicy(nodeTransform = {}, config = {}, operators = []) {
    return resolveNodeFlagPolicy({ nodeTransform }, config, operators).mode === 'auto';
}
