import { Extension } from '../core/Extension';

/**
 * Register an extension with the Wisp host.
 * Call this from your extension's entry point after creating the extension instance.
 */
export const registerExtension = (extension: Extension): void => {
  const win = window as unknown as Record<string, unknown>;
  const register = win.__wisp_register__ as ((ext: unknown) => void) | undefined;
  if (typeof window !== 'undefined' && register) {
    register(extension);
  } else {
    console.warn(
      `[${extension.manifest.name}] Could not register extension: Wisp host not available. ` +
        `Make sure registerExtension() is called within the Wisp runtime.`,
    );
  }
};
