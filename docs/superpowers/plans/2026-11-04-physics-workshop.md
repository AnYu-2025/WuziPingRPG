# 物理工坊 — 实现规格书

> **执行 agent 注意：** 本文档是完整的实现规格。你需要在 WuziPingRPG 项目的游戏模块（v0.7.0）上新增「物理工坊」主题，包含 5 张物理谜题地图、1 件新武器、1 位新 NPC 和 1 栋新建筑。所有文件路径相对于 `D:\大学生软件创新大赛\WuziPingRPG`。

---

## 1. 项目概述

**目标：** 以物理学为核心，新增 5 张谜题地图（抛体靶场、光路迷宫、回路工坊、波的干涉、热流迷宫），玩家通过操作物理现象解开谜题，获得奖励并记录发现。

**30 秒演示剧本：**
1. 进入中山大学 → 发现新建筑「格物堂」
2. 与 NPC「程理」交谈 → 进入物理工坊
3. 第一关「抛体靶场」→ 调整角度和力度击中目标
4. 第二关「光路迷宫」→ 放置镜面反射光线到终点
5. 通关后获得新武器「共振法杖·改」

**评分对应：**
- 题材创新：物理谜题 + RPG 探索，市面罕见
- 技术深度：物理模拟（抛体、光学、电路、波动、热力学）
- 应用价值：寓教于乐，物理学科实践

---

## 2. 基座现状（Game v0.7.0）

执行前需要了解的现有架构：

### 2.1 游戏核心
- **文件：** `core/src/main/java/cn/wuziping/ember/Game.java`
- **模式：** `TITLE=0, PLAY=1, UPGRADE=2, PAUSE=3, DEAD=4, VICTORY=5, HELP=6, JOURNAL=7, DIALOGUE=9`
- **世界尺寸：** `WORLD_W=1280, WORLD_H=960`
- **主角：** `伍子平`，坐标 `(x,y)`，生命 `hp/maxHp`，攻击 `attack`，速度 `speed`
- **存档格式：** 版本化二进制，magic `0x575A5052`，当前版本 v6

### 2.2 数学之旅（参考模板）
- **文件：** `core/src/main/java/cn/wuziping/ember/MathJourney.java`
- **结构：** 3 张谜题地图（等距花园、七桥星庭、翻向长廊）
- **尺寸：** `WIDTH=1536, HEIGHT=1152, SAVE_BYTES=50`
- **状态：** `active, failed, level, solved, px, py`（入口坐标）
- **方法：** `enter(), returnTown(), tick(), interact(), write(), read()`
- **完成奖励：** `gold+=60+20*level, maxHp+=8`
- **关键模式：** 纯谜题，无战斗；玩家通过移动触发机关

### 2.3 城镇系统
- **文件：** `core/src/main/java/cn/wuziping/ember/Town.java`
- **尺寸：** `WIDTH=1440, HEIGHT=1080`
- **NPC：** 6 位（沈砚、阿岚、陆铸、苏禾、知夏、阿满）
- **建筑：** 9 栋（镇务厅、星火铁匠铺、青叶药坊、归途旅舍、旧日书屋、河畔人家、风铃小屋、星图学舍、东庭花房）
- **入口触发：** `Game.dist(g.x,g.y,1140,620)<50` → "进入数学星庭"

### 2.4 武器系统
- **文件：** `core/src/main/java/cn/wuziping/ember/Arsenal.java`
- **现有武器：** 6 种（星火剑、疾风双刃、血晶长枪、脉冲弩炮、共振法杖、镇域重锤）
- **属性：** `POWER, DELAY, REACH, COLORS`
- **强化：** `forge[6]` 数组，每级 +12% 伤害

### 2.5 对话系统
- **文件：** `core/src/main/java/cn/wuziping/ember/Story.java`
- **结构：** `Dialogue` 类，含 `pages, options, actions`
- **触发：** `begin(g,npc,pages,options,actions)`
- **action 编码：** `>=300` 为数学之旅，`>=200` 为隐藏 NPC，`>=100` 为身体之旅

### 2.6 渲染系统
- **文件：** `core/src/main/java/cn/wuziping/ember/Scene.java`
- **方法：** `draw(Game g, Painter p)` 主渲染循环
- **地图绘制：** `drawMath()` 绘制数学之旅背景

---

## 3. 功能需求

### 3.1 核心功能（MVP）

| ID | 功能 | 描述 |
|----|------|------|
| F1 | 格物堂建筑 | 城镇新增建筑，入口触发物理工坊 |
| F2 | 程理 NPC | 物理向导，引导玩家进入工坊 |
| F3 | 抛体靶场 | 调整角度/力度，击中移动目标 |
| F4 | 光路迷宫 | 放置镜面，反射光线到终点 |
| F5 | 回路工坊 | 连接电路元件，点亮所有节点 |
| F6 | 波的干涉 | 调整波源位置，形成稳定干涉图样 |
| F7 | 热流迷宫 | 引导热量流动，平衡温度分布 |
| F8 | 共振法杖·改 | 通关奖励武器，扇形法弹 + 共振效果 |
| F9 | 发现札记 | 记录每关物理原理 |
| F10 | 存档扩展 | 保存物理工坊进度 |

### 3.2 增强功能（MVP 后）

| ID | 功能 | 描述 |
|----|------|------|
| F11 | 物理实验室 | 自由沙盒，组合不同物理现象 |
| F12 | 挑战模式 | 限时解谜，排行榜 |
| F13 | 多人协作 | 双人同步解谜（需网络） |

---

## 4. 技术设计

### 4.1 新增文件

| 文件 | 职责 |
|------|------|
| `PhysicsJourney.java` | 物理工坊核心逻辑，5 张地图状态机 |
| `PhysicsPuzzles.java` | 各关卡谜题实现（抛体、光路、电路、波动、热流） |
| `PhysicsRenderer.java` | 物理地图渲染（背景、机关、特效） |

### 4.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `Game.java` | 新增 `physics` 字段，`inPhysics()` 判断，`update()` 分支 |
| `Town.java` | 新增 `格物堂` 建筑，`程理` NPC |
| `Story.java` | 新增程理对话，物理工坊入口交互 |
| `Scene.java` | 新增 `drawPhysics()` 渲染方法 |
| `Arsenal.java` | 新增「共振法杖·改」武器（ID=6） |
| `SaveFormat` | 版本号 v6 → v7，新增物理工坊存档段 |

### 4.3 数据结构

```java
// PhysicsJourney.java
public final class PhysicsJourney {
    public static final int MAPS=5, WIDTH=1536, HEIGHT=1152, SAVE_BYTES=80;
    public static final String[] NAMES={"抛体靶场","光路迷宫","回路工坊","波的干涉","热流迷宫"};
    public static final String[] INSIGHTS={
        "抛体运动可分解为水平匀速与竖直匀加速。",
        "入射角等于反射角，光路可逆。",
        "串联电路电流相等，并联电路电压相等。",
        "两列相干波叠加，形成稳定的加强区和减弱区。",
        "热量从高温传向低温，直到热平衡。"
    };
    
    public boolean active=false, failed=false;
    public int level=0, solved=0; // bitmask
    public float px=768, py=300; // 入口坐标
    
    // 抛体靶场状态
    public float angle=45, power=50, targetX=1200, targetY=800;
    public int hits=0, requiredHits=3;
    
    // 光路迷宫状态
    public int[] mirrorX={400,600,800}, mirrorY={300,500,700};
    public int[] mirrorAngle={0,45,90}; // 0=水平, 1=45度, 2=垂直
    public boolean lightReached=false;
    
    // 回路工坊状态
    public int[] circuitNodes={0,1,2,3,4,5}; // 6个节点
    public boolean[] wirePlaced=new boolean[8]; // 8条可能的连线
    public boolean circuitComplete=false;
    
    // 波的干涉状态
    public float source1X=400, source1Y=576;
    public float source2X=1136, source2Y=576;
    public float frequency=1.0f, amplitude=1.0f;
    public boolean patternStable=false;
    
    // 热流迷宫状态
    public float[][] temperature=new float[32][24]; // 温度网格
    public int heatSources=2, heatSinks=2;
    public boolean thermalEquilibrium=false;
    
    public boolean cleared(){return (solved&(1<<level))!=0;}
    public String name(){return NAMES[level];}
    
    public void enter(Game g){
        active=true;
        if(cleared()&&level<4){level++;resetState();}
        g.story.area=Story.FOREST;
        g.x=px;g.y=py;
        g.mode=Game.PLAY;
        g.announce("物理 · "+name()+" / 观察与操作");
    }
    
    public void returnTown(Game g){
        px=g.x;py=g.y;
        g.story.area=Story.TOWN;
        g.x=1200;g.y=540; // 格物堂门口
        g.mode=Game.PLAY;
        g.announce("中山大学 · 格物堂");
    }
    
    public void tick(Game g,float dt){
        if(cleared())return;
        switch(level){
            case 0:tickProjectile(g,dt);break;
            case 1:tickLight(g,dt);break;
            case 2:tickCircuit(g,dt);break;
            case 3:tickWave(g,dt);break;
            case 4:tickHeat(g,dt);break;
        }
    }
    
    // 各关卡 tick 方法实现见 PhysicsPuzzles.java
}
```

### 4.4 谜题实现

#### 4.4.1 抛体靶场
```java
// PhysicsPuzzles.java
public static void tickProjectile(PhysicsJourney p, Game g, float dt){
    // 玩家移动调整发射位置
    // 靠近目标时，显示角度/力度调节 UI
    // 点击发射，计算抛体轨迹
    // 命中目标 → hits++
    // hits >= requiredHits → complete
}
```

**物理公式：**
- 水平位移：`x = v₀·cos(θ)·t`
- 竖直位移：`y = v₀·sin(θ)·t - ½·g·t²`
- 命中判定：`dist(landX, landY, targetX, targetY) < 30`

#### 4.4.2 光路迷宫
```java
public static void tickLight(PhysicsJourney p, Game g, float dt){
    // 玩家携带光源
    // 靠近镜面时，点击旋转（0° → 45° → 90° → 0°）
    // 光线追踪：从光源出发，遇镜面反射
    // 到达终点 → lightReached = true → complete
}
```

**反射算法：**
```java
// 入射向量 I，法向量 N
// 反射向量 R = I - 2·(I·N)·N
```

#### 4.4.3 回路工坊
```java
public static void tickCircuit(PhysicsJourney p, Game g, float dt){
    // 玩家移动经过导线节点
    // 点击放置/移除导线
    // 检查连通性（DFS/BFS）
    // 所有节点通电 → circuitComplete = true → complete
}
```

**连通性检查：**
```java
// 从电源节点出发，DFS 遍历所有可达节点
// 若所有目标节点都被访问到 → 电路完成
```

#### 4.4.4 波的干涉
```java
public static void tickWave(PhysicsJourney p, Game g, float dt){
    // 两个波源，玩家可调整位置
    // 观察干涉图样（加强区/减弱区）
    // 当图样稳定（振幅波动 < 阈值）→ patternStable = true → complete
}
```

**波动叠加：**
```java
// 两列波：y₁ = A·sin(k·r₁ - ω·t), y₂ = A·sin(k·r₂ - ω·t)
// 叠加：y = y₁ + y₂
// 加强条件：Δr = n·λ
// 减弱条件：Δr = (n+½)·λ
```

#### 4.4.5 热流迷宫
```java
public static void tickHeat(PhysicsJourney p, Game g, float dt){
    // 温度网格，热源/热汇固定
    // 玩家放置隔热板/导热板
    // 模拟热传导（有限差分）
    // 达到热平衡 → thermalEquilibrium = true → complete
}
```

**热传导方程：**
```java
// ∂T/∂t = α·∇²T
// 离散化：T[i][j]^{n+1} = T[i][j]^n + α·dt·(T[i+1][j]+T[i-1][j]+T[i][j+1]+T[i][j-1]-4·T[i][j])/(dx²)
```

### 4.5 新武器：共振法杖·改

```java
// Arsenal.java 新增
public static final int RESONANCE_STAFF_PLUS=6;
// NAMES 数组扩展
public static final String[] NAMES={..., "共振法杖·改"};
// SKILLS 数组扩展
public static final String[] SKILLS={..., "共振连锁"};
// DESCS 数组扩展
public static final String[] DESCS={..., "扇形法弹 · 共振连锁"};
// POWER/DELAY/REACH/COLORS 数组扩展
public static final float[] POWER={..., 0.7f};
public static final float[] DELAY={..., 1.3f};
public static final float[] REACH={..., 260};
public static final int[] COLORS={..., 0xffd4a5f5};

// 攻击逻辑：发射 5 道扇形法弹，命中敌人后触发共振，对周围造成二次伤害
public void attackResonanceStaffPlus(Game g){
    // 发射 5 道法弹，角度间隔 15°
    for(int j=-2;j<=2;j++){
        fire(g, g.facing+j*0.26f, damage(g)*0.6f, 1);
    }
    // 命中时触发共振效果
    // 对命中点周围 80 像素内的敌人造成 50% 伤害
}
```

### 4.6 城镇新增

```java
// Town.java 修改
// 新增建筑
public static final House[] HOUSES={
    ...,
    new House(6,"格物堂",1200,540,158,126) // sprite=6 需新增
};

// 新增 NPC
public static final Npc[] NPCS={
    ...,
    new Npc(6,"程理","物理学者",1180,480)
};
```

### 4.7 对话系统

```java
// Story.java 修改
// 程理对话
public boolean talk(Game g, int id){
    ...
    if(id==6 && g.inTown()){
        begin(g,6,new String[]{
            "程理|格物堂是新开的物理工坊。这里有五种机关，分别对应不同的物理现象。",
            "程理|抛体靶场练习弹道计算，光路迷宫学习反射定律，回路工坊理解电路连接。",
            "程理|波的干涉展示叠加原理，热流迷宫模拟热传导。每通过一关，你都会获得新的发现。",
            "程理|全部通关后，我会送你一件特别的武器——共振法杖·改。它能引发连锁共振，清场效果极佳。"
        },new String[]{"进入物理工坊","稍后再来"},new int[]{310,300});
        return true;
    }
    ...
}

// action 310 → 进入物理工坊
if(action==310){g.physics.enter(g);return;}
```

### 4.8 存档格式扩展

```java
// Game.java save() 方法修改
public void save(OutputStream stream) throws IOException{
    // 版本号 v6 → v7
    out.writeInt(0x575A5052); // magic
    out.writeInt(7); // version
    
    // ... 现有存档内容 ...
    
    // 新增物理工坊存档段
    physics.write(out);
}

// Game.java load() 方法修改
public static Game load(InputStream stream) throws IOException{
    // 读取版本号
    int version = in.readInt();
    if(version < 7){
        // v6 存档迁移：初始化默认物理工坊状态
        game.physics = new PhysicsJourney();
    } else {
        // v7 存档：读取物理工坊状态
        game.physics = PhysicsJourney.read(in);
    }
}
```

---

## 5. UI/UX 设计

### 5.1 城镇界面

```
┌─────────────────────────────────────────────────────────┐
│                    中山大学                              │
│                                                         │
│   镇务厅●    ●星火铁匠铺    ●青叶药坊                    │
│                                                         │
│        ●旧日书屋         ●归途旅舍                       │
│                                                         │
│   ●河畔人家    ●风铃小屋                                │
│                                                         │
│                    ★格物堂●    ●星图学舍                 │
│                        ↑                                 │
│                      程理NPC                            │
│                    ●东庭花房                             │
└─────────────────────────────────────────────────────────┘
```

### 5.2 物理工坊地图选择

```
┌─────────────────────────────────────────────────────────┐
│                   物理工坊 · 格物堂                      │
│                                                         │
│   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐        │
│   │抛体 │  │光路 │  │回路 │  │波动 │  │热流 │        │
│   │靶场 │  │迷宫 │  │工坊 │  │干涉 │  │迷宫 │        │
│   └─────┘  └─────┘  └─────┘  └─────┘  └─────┘        │
│    ✓已完成   当前关卡   🔒未解锁   🔒未解锁   🔒未解锁  │
│                                                         │
│   [进入关卡]  [返回城镇]                                 │
└─────────────────────────────────────────────────────────┘
```

### 5.3 抛体靶场 UI

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                        🎯 目标                          │
│                                                         │
│   角度: [====●=====] 45°                                │
│   力度: [======●===] 50%                                │
│                                                         │
│        ↗ 轨迹预览                                       │
│       /                                                 │
│      /                                                  │
│   ⚡发射点                                              │
│                                                         │
│   命中: 2/3    [发射]  [重置]  [返回]                   │
└─────────────────────────────────────────────────────────┘
```

### 5.4 光路迷宫 UI

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   💡光源 ─────→ ╲ 镜面1                                 │
│                  │                                       │
│                  ↓                                       │
│               ╲ 镜面2                                    │
│                │                                         │
│                ↓                                         │
│   终点 ●←──── ╲ 镜面3                                    │
│                                                         │
│   [旋转镜面]  [重置]  [返回]                             │
└─────────────────────────────────────────────────────────┘
```

### 5.5 发现札记

```
┌─────────────────────────────────────────────────────────┐
│                   旅途札记 · 物理发现                    │
│                                                         │
│   ✓ 抛体靶场                                            │
│     "抛体运动可分解为水平匀速与竖直匀加速。"             │
│                                                         │
│   ✓ 光路迷宫                                            │
│     "入射角等于反射角，光路可逆。"                       │
│                                                         │
│   ○ 回路工坊                                            │
│     "串联电路电流相等，并联电路电压相等。"               │
│                                                         │
│   🔒 波的干涉                                           │
│   🔒 热流迷宫                                           │
│                                                         │
│   [返回]                                                │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 渲染设计

### 6.1 物理地图背景

```java
// PhysicsRenderer.java
public static void drawBackground(Painter p, int level){
    switch(level){
        case 0: // 抛体靶场 - 绿色草地 + 靶子
            p.fillRect(0,0,WIDTH,HEIGHT,0xff8bc34a);
            p.fillCircle(1200,800,30,0xffff5722);
            p.fillCircle(1200,800,20,0xffffffff);
            p.fillCircle(1200,800,10,0xffff5722);
            break;
        case 1: // 光路迷宫 - 暗色背景 + 网格
            p.fillRect(0,0,WIDTH,HEIGHT,0xff263238);
            for(int i=0;i<WIDTH;i+=48)p.drawLine(i,0,i,HEIGHT,0xff37474f);
            for(int j=0;j<HEIGHT;j+=48)p.drawLine(0,j,WIDTH,j,0xff37474f);
            break;
        case 2: // 回路工坊 - 蓝色电路板
            p.fillRect(0,0,WIDTH,HEIGHT,0xff1565c0);
            // 绘制电路节点和连线
            break;
        case 3: // 波的干涉 - 紫色波动背景
            p.fillRect(0,0,WIDTH,HEIGHT,0xff4a148c);
            // 绘制波形
            break;
        case 4: // 热流迷宫 - 红黑渐变
            // 根据温度网格绘制热力图
            break;
    }
}
```

### 6.2 特效

```java
// 抛体轨迹
public static void drawProjectileTrail(Painter p, float[] trailX, float[] trailY, int count){
    for(int i=1;i<count;i++){
        int alpha = 255 * i / count;
        p.drawLine(trailX[i-1],trailY[i-1],trailX[i],trailY[i],(alpha<<24)|0xffffeb3b);
    }
}

// 光线
public static void drawLightRay(Painter p, float x1, float y1, float x2, float y2){
    p.drawLine(x1,y1,x2,y2,0xffffff00);
    p.fillCircle(x2,y2,4,0xffffeb3b);
}

// 波动
public static void drawWave(Painter p, float centerX, float centerY, float phase, float amplitude){
    for(int r=0;r<200;r+=8){
        int alpha = (int)(255 * (1 - r/200f));
        float y = amplitude * (float)Math.sin(r*0.1f + phase);
        p.fillCircle(centerX+r, centerY+y, 3, (alpha<<24)|0xffe1bee9);
        p.fillCircle(centerX-r, centerY-y, 3, (alpha<<24)|0xffe1bee9);
    }
}

// 热流
public static void drawHeatmap(Painter p, float[][] temp, int cols, int rows, float cellW, float cellH){
    for(int i=0;i<cols;i++){
        for(int j=0;j<rows;j++){
            float t = temp[i][j];
            int color = heatColor(t); // 蓝→红渐变
            p.fillRect(i*cellW, j*cellH, cellW, cellH, color);
        }
    }
}
```

---

## 7. 实现步骤

### 阶段一：基础框架（1天）

1. 创建 `PhysicsJourney.java`，实现基础状态机
2. 在 `Game.java` 中添加 `physics` 字段和 `inPhysics()` 判断
3. 修改 `Town.java`，添加格物堂建筑和程理 NPC
4. 修改 `Story.java`，添加程理对话和进入物理工坊的逻辑

### 阶段二：抛体靶场（1天）

1. 实现抛体运动物理模拟
2. 添加角度/力度调节 UI
3. 实现命中判定和计分
4. 添加轨迹预览和特效

### 阶段三：光路迷宫（1天）

1. 实现光线反射算法
2. 添加镜面旋转交互
3. 实现光路追踪和终点判定
4. 添加光线特效

### 阶段四：回路工坊（1天）

1. 实现电路连通性检查（DFS/BFS）
2. 添加导线放置/移除交互
3. 实现通电状态可视化
4. 添加电流流动特效

### 阶段五：波的干涉（1天）

1. 实现波动叠加算法
2. 添加波源位置调节
3. 实现干涉图样渲染
4. 添加稳定判定逻辑

### 阶段六：热流迷宫（1天）

1. 实现热传导有限差分模拟
2. 添加隔热板/导热板交互
3. 实现热力图渲染
4. 添加热平衡判定

### 阶段七：武器与奖励（0.5天）

1. 在 `Arsenal.java` 中添加共振法杖·改
2. 实现扇形法弹发射逻辑
3. 实现共振连锁伤害计算
4. 添加通关奖励发放

### 阶段八：存档与渲染（0.5天）

1. 扩展存档格式 v6 → v7
2. 实现物理工坊状态序列化
3. 添加存档迁移逻辑（v6 → v7）
4. 完善 `PhysicsRenderer.java` 渲染

### 阶段九：测试与优化（1天）

1. 单元测试各关卡物理模拟
2. 集成测试存档读写
3. 性能测试（60fps 稳定性）
4. 平衡性调整（难度、奖励）

---

## 8. 验收标准

### 8.1 功能验收

| ID | 验收项 | 通过条件 |
|----|--------|---------|
| V1 | 格物堂入口 | 城镇中出现格物堂建筑，靠近显示"进入物理工坊" |
| V2 | 程理对话 | 与程理交谈可了解物理工坊功能，选择进入 |
| V3 | 抛体靶场 | 调整角度/力度，3 次命中目标后通关 |
| V4 | 光路迷宫 | 旋转镜面，光线到达终点后通关 |
| V5 | 回路工坊 | 连接所有节点，电路通电后通关 |
| V6 | 波的干涉 | 调整波源，形成稳定干涉图样后通关 |
| V7 | 热流迷宫 | 放置导热板，达到热平衡后通关 |
| V8 | 共振法杖·改 | 通关后获得新武器，可装备使用 |
| V9 | 发现札记 | 每关通关后记录物理原理，可在札记查看 |
| V10 | 存档保存 | 保存游戏后重新加载，物理工坊进度保留 |

### 8.2 性能验收

| 指标 | 目标 |
|------|------|
| 物理模拟帧率 | ≥ 60fps |
| 光线追踪延迟 | < 16ms |
| 热传导计算延迟 | < 16ms |
| APK 增量 | < 3MB |

### 8.3 兼容性验收

- Android 8.0+ (API 26+)
- 存档向下兼容（v6 → v7 自动迁移）

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 物理模拟精度不足 | 谜题体验差 | 增加容错判定范围，提供视觉辅助 |
| 光路迷宫性能 | 卡顿 | 限制反射次数上限（最多 10 次） |
| 热流迷宫计算量 | 帧率下降 | 降低网格分辨率（32×24），使用定点数 |
| 存档格式变更 | 旧存档丢失 | 实现 v6 → v7 自动迁移，保留旧数据 |
| 武器平衡性 | 过强/过弱 | 调整伤害系数，测试多场景 |

---

## 10. 后续迭代方向

- **物理实验室：** 自由组合不同物理现象，创造复杂机关
- **挑战模式：** 限时解谜，排行榜竞争
- **多人协作：** 双人同步解谜，需要配合操作
- **物理教程：** 每关开始前播放简短物理原理动画
- **成就系统：** 收集所有物理发现，解锁隐藏内容

---

## 11. 参考资源

- 抛体运动：https://en.wikipedia.org/wiki/Projectile_motion
- 光的反射：https://en.wikipedia.org/wiki/Reflection_(physics)
- 电路分析：https://en.wikipedia.org/wiki/Electronic_analysis
- 波的干涉：https://en.wikipedia.org/wiki/Wave_interference
- 热传导：https://en.wikipedia.org/wiki/Heat_equation

---

## 12. 附录：现有代码参考

### 12.1 MathJourney 状态机模式

```java
// 参考 MathJourney.java 的 enter/returnTown/tick/interact 模式
public void enter(Game g){
    active=true;
    if(cleared()&&level<MAX_LEVEL){level++;resetState();}
    g.story.area=Story.FOREST;
    g.x=px;g.y=py;
    g.mode=Game.PLAY;
    g.announce("主题 · "+name()+" / 提示文字");
}

public void returnTown(Game g){
    px=g.x;py=g.y;
    g.story.area=Story.TOWN;
    g.x=入口X;g.y=入口Y;
    g.mode=Game.PLAY;
    g.announce("中山大学 · 区域名");
}
```

### 12.2 Story 对话模式

```java
// 参考 Story.java 的 begin/action 模式
begin(g, npcId, new String[]{
    "NPC名|第一句对话",
    "NPC名|第二句对话",
    "NPC名|第三句对话"
}, new String[]{"选项1","选项2"}, new int[]{ACTION_CODE, CLOSE});

// action 处理
if(action==ACTION_CODE){
    // 执行对应逻辑
    return;
}
```

### 12.3 Arsenal 武器模式

```java
// 参考 Arsenal.java 的 attack/skill 模式
public void attack(Game g){
    g.attackCd=delay(g);
    g.swing=.2f;
    aim(g);
    // 发射弹丸或近战判定
    fire(g, angle, damage, pierce);
}
```
