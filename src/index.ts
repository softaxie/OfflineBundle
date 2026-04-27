import { registerPlugin } from '@capacitor/core';
import type { OfflineBundlePlugin } from './definitions';

export const OfflineBundle = registerPlugin<OfflineBundlePlugin>('OfflineBundle');

export * from './definitions';
export * from './updater';
