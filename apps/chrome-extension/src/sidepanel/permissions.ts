/**
 * Optional Chrome permissions.
 *
 * Downloads, bookmarks, and history are declared as optional so installing the
 * extension does not grant them silently. The executor refuses to use a
 * capability that has not been granted and tells the model to ask the user.
 */
import type { OptionalPermission } from '@gbl/shared';

export interface PermissionDescriptor {
  id: OptionalPermission;
  label: string;
  description: string;
  capability: string;
}

export const OPTIONAL_PERMISSIONS: readonly PermissionDescriptor[] = [
  {
    id: 'downloads',
    label: 'Downloads',
    description: 'Start, inspect, and cancel downloads requested by the agent.',
    capability: 'download_link · list_downloads · cancel_download',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    description: 'Search your bookmarks when you ask for a saved page.',
    capability: 'search_bookmarks',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Search the last 90 days of browsing history on request.',
    capability: 'search_history',
  },
] as const;

export type PermissionState = Record<OptionalPermission, boolean>;

export async function getPermissionState(): Promise<PermissionState> {
  const state: PermissionState = { downloads: false, bookmarks: false, history: false };
  await Promise.all(
    OPTIONAL_PERMISSIONS.map(async ({ id }) => {
      state[id] = await chrome.permissions.contains({ permissions: [id] }).catch(() => false);
    }),
  );
  return state;
}

export async function requestOptionalPermission(id: OptionalPermission): Promise<boolean> {
  try {
    return await chrome.permissions.request({ permissions: [id] });
  } catch {
    return false;
  }
}

export async function revokeOptionalPermission(id: OptionalPermission): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ permissions: [id] });
  } catch {
    return false;
  }
}
