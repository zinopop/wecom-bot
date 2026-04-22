import type { Platform } from '../core/types.js';

export type PlatformFactory = () => Platform | null | Promise<Platform | null>;

export type { Platform };
