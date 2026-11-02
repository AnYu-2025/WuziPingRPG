# 奶龙像素素材

使用内置 `image_gen`，并未调用 CLI 或外部付费 API。参考图是用户本轮提供的奶龙图片。创作输出保留参考角色形象，生成四格透明像素精灵，不代表项目拥有原角色的创作归属。

- 生成原图：`docs/art/nailong-sheet-generated.png`。
- 游戏实际使用：`app/src/main/assets/nailong.png`，256×64 RGBA，四个 64×64 单元。
- 打包：`tools/pack-nailong.py`，只执行 alpha 包围盒裁切、最近邻尺寸适配和等大格排版，无重新绘制；生成源图保持不变。
- 帧顺序：站立、迈步一、迈步二、开心挥手。
- 透明度、轮廓、对话头像、世界角色和行走状态已通过程序及桌面渲染检查。小尺寸下保留绿色眼睛与浅色肚皮。

完整提示词：

```text
Use case: style-transfer. Asset type: transparent sprite sheet for a 2D top-down pixel RPG. Reference image: preserve the recognizable yellow chubby dragon character 奶龙 from the attached image, large rounded pear body, small head merged into neck, big round green eyes, pale cream belly, short arms, thick short legs and small toes. Convert this character into charming crisp SNES-style pixel art, limited palette, dark brown outline, no antialiasing, no gradients, no 3D shading. Create a single 2 by 2 evenly spaced sprite sheet on a genuinely transparent background, exactly four full-body sprites, one sprite centered in each equal quadrant, same scale and baseline within each quadrant, generous transparent padding. Top left: idle facing viewer slightly left, a lonely gentle expression, hands on belly. Top right: walking slightly left, left foot forward. Bottom left: walking slightly left, right foot forward. Bottom right: happy after being comforted, small warm smile, one hand raised in a friendly wave. Maintain consistent proportions and colors in all four frames. Front or slight three-quarter view suitable for the existing 2D RPG. Each character should feel designed on a 48 by 48 pixel grid enlarged with nearest-neighbor blocks. Entire body including both feet must fit inside its quadrant. No text, no labels, no checkerboard pattern, no frame borders, no shadows outside character, no environment. Output is a production game asset.
```
