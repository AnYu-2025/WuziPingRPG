import { createRegistry, type CodecRegistry } from '@photo/io';
import { pngCodec } from './node-png.js';

/**
 * Node 端的能力注册表。
 *
 * 内置 BMP / PPM 由 `@photo/io` 提供（零依赖，任何端都有）；
 * PNG 由本壳基于 zlib 注册进来。
 *
 * 注意这里**没有**任何条件分支去判断"当前是不是 Node" ——
 * 因为这段代码本来就跑在 Node 上。能力差异在装配处一次说清，
 * 而不是散落在内核里到处 if。
 */
export function createNodeRegistry(): CodecRegistry {
  const registry = createRegistry();
  registry.register(pngCodec);
  return registry;
}
