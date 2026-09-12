import { isTauri, transport } from '../transport';

export type AirDropErrorCode = 'unsupported' | 'invalid_paths' | 'unavailable' | 'launch_failed';

export class AirDropError extends Error {
  constructor(
    public readonly code: AirDropErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AirDropError';
  }
}

/** Opens Finder AirDrop, or the system recipient chooser for the selected files.
 * Resolution only means the UI request was initiated; it does not mean anything was sent.
 */
export const openAirDrop = async (paths: string[] = []): Promise<void> => {
  if (!isTauri()) {
    throw new AirDropError('unsupported', 'AirDrop is available only in the macOS desktop app');
  }
  try {
    await transport<void>('open_airdrop', { paths });
  } catch (error) {
    const details = error && typeof error === 'object' ? error : {};
    const code = 'code' in details ? details.code : undefined;
    const message =
      'message' in details && typeof details.message === 'string' ? details.message : String(error);
    const knownCodes: AirDropErrorCode[] = [
      'unsupported',
      'invalid_paths',
      'unavailable',
      'launch_failed',
    ];
    throw new AirDropError(
      knownCodes.includes(code as AirDropErrorCode) ? (code as AirDropErrorCode) : 'launch_failed',
      message,
    );
  }
};
