import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Platform } from '../core/types.js';
import { WecomPlatform } from './wecom/index.js';
import { LarkPlatform } from './lark/index.js';
import { ConsolePlatform } from './console/index.js';

export class PlatformRegistry {
  private platforms = new Map<string, Platform>();

  register(p: Platform): void {
    this.platforms.set(p.name, p);
  }

  get(name: string): Platform {
    const p = this.platforms.get(name);
    if (!p) throw new Error(`platform not registered: ${name}`);
    return p;
  }

  all(): Platform[] {
    return Array.from(this.platforms.values());
  }
}

/** 按配置构建启用的平台集合 */
export function buildPlatforms(): PlatformRegistry {
  const registry = new PlatformRegistry();

  for (const name of config.platforms) {
    switch (name) {
      case 'wecom':
        if (!config.wecom) {
          logger.warn('PLATFORMS 含 wecom 但缺少 WECOM_BOT_ID/SECRET，跳过');
          continue;
        }
        registry.register(new WecomPlatform(config.wecom));
        break;
      case 'lark':
        if (!config.lark) {
          logger.warn('PLATFORMS 含 lark 但缺少 LARK_APP_ID/SECRET，跳过');
          continue;
        }
        registry.register(new LarkPlatform(config.lark));
        break;
      case 'console':
        registry.register(new ConsolePlatform());
        break;
      default:
        logger.warn({ name }, 'unknown platform, skipping');
    }
  }

  if (registry.all().length === 0) {
    throw new Error('no platform enabled; set PLATFORMS and matching credentials');
  }

  return registry;
}
