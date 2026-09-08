/** Shared ownership rules for text editing versus file-manager shortcuts. */
export const isTextEditingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return ![
      'button',
      'submit',
      'reset',
      'checkbox',
      'radio',
      'range',
      'color',
      'file',
      'image',
      'hidden',
    ].includes(target.type);
  }
  // closest() also handles descendants of contenteditable and explicit
  // contenteditable=false islands (which must not inherit editing ownership).
  const editor = target.closest('[contenteditable]');
  return (
    target.isContentEditable || (!!editor && editor.getAttribute('contenteditable') !== 'false')
  );
};

export const hasSelectedText = (): boolean => {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
};
