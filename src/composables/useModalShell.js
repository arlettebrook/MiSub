import { inject, onBeforeMount, onBeforeUpdate, onScopeDispose, provide } from 'vue';

export const modalShellKey = Symbol('modal-shell');

// A loaded dialog contributes its slots and controls to the shell that is already open.
// Mask the context below each Modal so dialogs opened from its body keep their own layer.
export function useModalShell(props, attrs, slots, emit) {
    const shell = props.shellHost ? null : inject(modalShellKey, null);
    provide(modalShellKey, null);
    if (!shell) return false;

    const content = { props, attrs, slots, emit };
    let previousSlots = {};
    let previousAttrs = {};
    const publish = () => {
        const changed = [slots, attrs].some((current, index) => {
            const previous = index === 0 ? previousSlots : previousAttrs;
            return (
                Object.keys(current).length !== Object.keys(previous).length ||
                Object.keys(current).some((key) => current[key] !== previous[key])
            );
        });
        previousSlots = { ...slots };
        previousAttrs = { ...attrs };
        if (shell.content.value !== content) shell.content.value = content;
        else if (changed) shell.revision.value++;
    };
    onBeforeMount(publish);
    onBeforeUpdate(publish);
    onScopeDispose(() => {
        if (shell.content.value === content) shell.content.value = null;
    });
    return true;
}
