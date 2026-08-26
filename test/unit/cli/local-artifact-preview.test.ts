import { describe, expect, it, vi } from 'vitest';
import {
  openLocalArtifact,
  type LocalArtifactLaunchRequest,
} from '../../../src/cli/local-artifact-preview.js';

describe('local artifact preview runtime', () => {
  it.each([
    {
      platform: 'win32',
      environment: {},
      path: 'C:\\reports with spaces\\graph & 100% ^!.html',
      executable: 'rundll32.exe',
      prefixArguments: ['url.dll,FileProtocolHandler'],
      windowsHide: true,
    },
    {
      platform: 'darwin',
      environment: {},
      path: '/tmp/graph "quoted" & $(echo unsafe).html',
      executable: '/usr/bin/open',
      prefixArguments: [],
      windowsHide: false,
    },
    {
      platform: 'linux',
      environment: { DISPLAY: ':99' },
      path: '/tmp/graph "quoted"; $(echo unsafe).html',
      executable: 'xdg-open',
      prefixArguments: [],
      windowsHide: false,
    },
  ])(
    'uses one shell-free path argument on $platform',
    async ({ platform, environment, path, executable, prefixArguments, windowsHide }) => {
      const requests: LocalArtifactLaunchRequest[] = [];

      await openLocalArtifact(path, {
        platform,
        environment,
        launch: async (request) => {
          requests.push(request);
        },
      });

      expect(requests).toEqual([
        {
          executable,
          arguments: [...prefixArguments, path],
          shell: false,
          windowsHide,
        },
      ]);
    },
  );

  it('fails explicitly for unsupported, relative, and headless environments', async () => {
    const launch = vi.fn(async () => undefined);

    await expect(openLocalArtifact('/tmp/graph.html', { platform: 'aix', launch })).rejects.toThrow(
      'Local preview is not supported on aix.',
    );
    await expect(
      openLocalArtifact('relative.html', { platform: 'linux', environment: {}, launch }),
    ).rejects.toThrow('The local artifact path must be absolute.');
    await expect(
      openLocalArtifact('/tmp/graph.html', { platform: 'linux', environment: {}, launch }),
    ).rejects.toThrow('No graphical Linux session is available.');
    expect(launch).not.toHaveBeenCalled();
  });

  it('wraps missing launchers and forwards cancellation without executing a shell', async () => {
    const missingLauncher = Object.assign(new Error('spawn xdg-open ENOENT'), {
      code: 'ENOENT',
    });
    await expect(
      openLocalArtifact('/tmp/graph.html', {
        platform: 'linux',
        environment: { WAYLAND_DISPLAY: 'wayland-0' },
        launch: async () => {
          throw missingLauncher;
        },
      }),
    ).rejects.toMatchObject({
      name: 'LocalArtifactPreviewError',
      message: 'The platform launcher failed: spawn xdg-open ENOENT',
      cause: missingLauncher,
    });

    const controller = new AbortController();
    controller.abort(new Error('Canceled by test.'));
    await expect(
      openLocalArtifact('/tmp/graph.html', {
        platform: 'linux',
        environment: { DISPLAY: ':99' },
        signal: controller.signal,
        launch: async (request) => request.signal?.throwIfAborted(),
      }),
    ).rejects.toThrow('The platform launcher failed: Canceled by test.');
  });
});
