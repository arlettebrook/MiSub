// Subscription UA values are maintained here for both the frontend and backend.
export const USER_AGENT_PRESETS = Object.freeze(
    [
        { label: 'MiSub', value: 'MiSub' },
        { label: 'Clash Verge', value: 'clash-verge/v2.5.10' },
        { label: 'Clash Meta', value: 'clash.meta/v1.19.33' },
        { label: 'v2rayN', value: 'v2rayN/7.25.6' },
        { label: 'Shadowrocket', value: 'Shadowrocket/2.2.93' },
        { label: 'Mozilla', value: 'Mozilla/5.0' },
    ].map(Object.freeze)
);

export const DEFAULT_USER_AGENT = USER_AGENT_PRESETS.find(
    (preset) => preset.label === 'Clash Verge'
).value;

export function getUserAgentState(userAgent) {
    const value = typeof userAgent === 'string' ? userAgent.trim() : '';
    if (!value) return { type: 'default', value: DEFAULT_USER_AGENT };
    const preset = USER_AGENT_PRESETS.find((item) => item.value === value);
    return { type: preset ? 'preset' : 'custom', value };
}

export function validateUserAgent(userAgent) {
    if (userAgent == null) return { valid: true };
    if (typeof userAgent !== 'string') {
        return { valid: false, code: 'type', message: 'User-Agent must be a string.' };
    }
    // Validate before trimming: CR/LF must not disappear into the default option.
    if (/[\r\n]/.test(userAgent)) {
        return {
            valid: false,
            code: 'lineBreaks',
            message: 'User-Agent cannot contain line breaks.',
        };
    }
    // RFC 9110 permits visible octets, space, HTAB and obs-text (0x80-0xFF).
    if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(userAgent)) {
        return {
            valid: false,
            code: 'controls',
            message: 'User-Agent cannot contain control characters.',
        };
    }
    // Fetch Headers accepts ByteString values, not arbitrary Unicode strings.
    if (/[^\u0000-\u00FF]/.test(userAgent)) {
        return {
            valid: false,
            code: 'encoding',
            message: 'User-Agent contains characters that cannot be sent in an HTTP header.',
        };
    }
    return { valid: true };
}
