/**
 * 示例图生成 —— 让应用与冒烟测试**不依赖任何文件**就能跑通全链路。
 *
 * 两个用途：
 *   - UI 上的"新建示例图"：用户还没打开图片时也能试预设、试滑杆；
 *   - 冒烟测试的素材：一条命令跑完"导入 → 预览 → 调参 → 导出"，
 *     不需要往仓库里塞一张几 MB 的测试图片。
 *
 * 刻意用**确定性的**图案（径向渐变 + 低频条纹），不用随机噪声：
 * 同样的输入永远得到同样的输出，渲染结果才能被断言。
 * 图案同时含色彩层次与边缘细节，因此暗角、对比、锐化这些效果的
 * 差别在肉眼和断言里都看得见 —— 纯色图会让"效果没生效"看不出来。
 */
import type { PixelBuffer } from '@photo/core';

export function createSampleImage(width = 1600, height = 1067): PixelBuffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const stripe = Math.sin(x / 37) * Math.cos(y / 29);
      data[o] = 120 + 110 * (1 - r) + stripe * 14;
      data[o + 1] = 90 + 120 * (1 - r) * (x / w) + stripe * 10;
      data[o + 2] = 160 + 80 * r + stripe * 12;
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
