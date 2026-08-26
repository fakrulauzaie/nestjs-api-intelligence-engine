import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';

export interface LocalArtifactLaunchRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly shell: false;
  readonly windowsHide: boolean;
  readonly signal?: AbortSignal | undefined;
}

export type LocalArtifactLauncher = (request: LocalArtifactLaunchRequest) => Promise<void>;

export interface LocalArtifactPreviewOptions {
  readonly platform?: NodeJS.Platform | string | undefined;
  readonly environment?: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly launch?: LocalArtifactLauncher | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class LocalArtifactPreviewError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalArtifactPreviewError';
  }
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function launchRequestForPlatform(
  absolutePath: string,
  platform: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal: AbortSignal | undefined,
): LocalArtifactLaunchRequest {
  if (platform === 'win32') {
    if (!win32.isAbsolute(absolutePath)) {
      throw new LocalArtifactPreviewError('The local artifact path must be absolute.');
    }
    return {
      executable: 'rundll32.exe',
      arguments: ['url.dll,FileProtocolHandler', absolutePath],
      shell: false,
      windowsHide: true,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  if (platform === 'darwin') {
    if (!posix.isAbsolute(absolutePath)) {
      throw new LocalArtifactPreviewError('The local artifact path must be absolute.');
    }
    return {
      executable: '/usr/bin/open',
      arguments: [absolutePath],
      shell: false,
      windowsHide: false,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  if (platform === 'linux') {
    if (!posix.isAbsolute(absolutePath)) {
      throw new LocalArtifactPreviewError('The local artifact path must be absolute.');
    }
    if (!hasValue(environment.DISPLAY) && !hasValue(environment.WAYLAND_DISPLAY)) {
      throw new LocalArtifactPreviewError('No graphical Linux session is available.');
    }
    return {
      executable: 'xdg-open',
      arguments: [absolutePath],
      shell: false,
      windowsHide: false,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  throw new LocalArtifactPreviewError(`Local preview is not supported on ${platform}.`);
}

const executeFile: LocalArtifactLauncher = async (request) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      request.executable,
      [...request.arguments],
      {
        shell: request.shell,
        windowsHide: request.windowsHide,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
      (error) => {
        if (error === null) resolve();
        else reject(error);
      },
    );
  });

export async function openLocalArtifact(
  absolutePath: string,
  options: LocalArtifactPreviewOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const request = launchRequestForPlatform(
    absolutePath,
    platform,
    options.environment ?? process.env,
    options.signal,
  );

  try {
    await (options.launch ?? executeFile)(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The platform launcher failed.';
    throw new LocalArtifactPreviewError(`The platform launcher failed: ${detail}`, {
      cause: error,
    });
  }
}
