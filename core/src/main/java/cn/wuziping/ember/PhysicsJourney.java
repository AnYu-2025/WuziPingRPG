package cn.wuziping.ember;

import java.io.*;

/** Physics puzzles: projectile, light reflection, circuit, wave interference, heat flow. */
public final class PhysicsJourney {
    public static final int MAP=13,JOURNAL=14,MAPS=5,WIDTH=1536,HEIGHT=1152,SAVE_BYTES=128;
    public static final float MIN_ANGLE=20,MAX_ANGLE=80,MIN_POWER=20,MAX_POWER=100;
    public static final String[] NAMES={"抛体靶场","光路迷宫","回路工坊","波的干涉","热流迷宫"};
    public static final String[] INSIGHTS={
        "抛体运动可分解为水平匀速与竖直匀加速，轨迹是抛物线。",
        "入射角等于反射角，光路可逆且最短。",
        "串联电路电流相等，并联电路电压相等，基尔霍夫定律守恒。",
        "两列相干波叠加，形成稳定的加强区和减弱区。",
        "热量从高温传向低温，直到热平衡，熵增不可逆。"
    };
    
    // 抛体靶场参数
    public static final float GRAVITY=320;
    public static final float[][] TARGETS={{1200,800},{1100,700},{1300,750}};
    
    // 光路迷宫参数
    public static final float[][] MIRRORS={{500,400},{800,600},{1100,400}};
    public static final float LIGHT_START_X=200,LIGHT_START_Y=576;
    public static final float LIGHT_END_X=1336,LIGHT_END_Y=576;
    
    // 回路工坊参数
    public static final float[][] CIRCUIT_NODES={{400,300},{700,300},{1000,300},{400,600},{700,600},{1000,600}};
    public static final int[][] CIRCUIT_EDGES={{0,1},{1,2},{3,4},{4,5},{0,3},{1,4},{2,5}};
    
    // 波的干涉参数
    public static final float WAVE_FREQ=1.0f,WAVE_SPEED=200;
    
    // 热流迷宫参数
    public static final int HEAT_COLS=24,HEAT_ROWS=18;
    public static final float HEAT_DIFFUSIVITY=0.15f;
    
    public boolean active=false,failed=false;
    public int level=0,solved=0;
    public float px=768,py=300;
    
    // 抛体靶场状态
    public float launchAngle=45,launchPower=50;
    public int targetHits=0;
    public float projectileX=-1,projectileY=-1,projectileVX=0,projectileVY=0;
    public boolean projectileActive=false;
    
    // 光路迷宫状态
    public int[] mirrorAngles={45,135,45}; // 每个镜面的角度
    public boolean lightReachedEnd=false;
    public float lightRayEndX=0,lightRayEndY=0;
    
    // 回路工坊状态
    public boolean[] wiresPlaced=new boolean[7];
    public int selectedNode=-1;
    public boolean circuitComplete=false;
    
    // 波的干涉状态
    public float source1X=400,source1Y=576;
    public float source2X=1136,source2Y=576;
    public float wavePhase=0;
    public boolean patternStable=false;
    public int stableFrames=0;
    
    // 热流迷宫状态
    public float[][] temperature=new float[HEAT_COLS][HEAT_ROWS];
    public int heatSourceX=2,heatSourceY=9;
    public int heatSinkX=21,heatSinkY=9;
    public boolean thermalEquilibrium=false;
    public float equilibriumTime=0;
    
    public boolean cleared(){return (solved&(1<<level))!=0;}
    public String name(){return level>=0&&level<MAPS?NAMES[level]:"";}
    /** Launch speed is scaled so the 900px target range is reachable by tuning power. */
    public float launchSpeed(){return 180+launchPower*7;}
    public String launchLabel(){return "角度 "+(int)launchAngle+"° · 力度 "+(int)launchPower;}
    public void adjust(Game g,int which,int delta){
        if(which==0)launchAngle=Game.clamp(launchAngle+delta,MIN_ANGLE,MAX_ANGLE);
        else launchPower=Game.clamp(launchPower+delta,MIN_POWER,MAX_POWER);
        g.announce(launchLabel());
    }
    
    public String objective(Game g){
        if(g.inTown())return solved==31?"物理主题已完成 · 在札记回看发现":"从格物堂继续探索";
        if(cleared())return level==4?"所有谜题已解开 · 返回中山大学":"机关已回应 · 靠近入口继续前行";
        switch(level){
            case 0:return "调整角度和力度，击中 "+targetHits+"/3 个目标";
            case 1:return "旋转镜面，引导光线到达终点";
            case 2:return "连接导线，点亮所有节点 "+countWires()+"/7";
            case 3:return "调整波源位置，形成稳定干涉图样";
            case 4:return "引导热量流动，达到热平衡";
            default:return "";
        }
    }
    
    private int countWires(){int c=0;for(boolean w:wiresPlaced)if(w)c++;return c;}
    
    public void enter(Game g){
        active=true;
        if(cleared()&&level<4){level++;resetState();}
        g.story.area=Story.FOREST;
        g.x=px;g.y=py;
        g.mode=Game.PLAY;
        g.story.dialogue=null;
        g.vfx.clear();
        g.swing=g.skillFlash=g.dashTime=0;
        g.invuln=1;
        g.announce("物理 · "+name()+" / "+objective(g));
    }
    
    public void returnTown(Game g){
        px=g.x;py=g.y;
        g.story.area=Story.TOWN;
        g.x=1200;g.y=540;
        g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;
        g.story.dialogue=null;
        g.vfx.clear();
        g.announce("中山大学 · 格物堂");
    }
    
    public void resetState(){
        // Tuned launch parameters survive a retry; they are the player's chosen setup.
        targetHits=0;
        projectileActive=false;
        projectileX=projectileY=-1;
        mirrorAngles=new int[]{45,135,45};
        lightReachedEnd=false;
        wiresPlaced=new boolean[7];
        selectedNode=-1;
        circuitComplete=false;
        wavePhase=0;
        patternStable=false;
        stableFrames=0;
        source1X=400;source1Y=576;
        source2X=1136;source2Y=576;
        temperature=new float[HEAT_COLS][HEAT_ROWS];
        for(int i=0;i<HEAT_COLS;i++)for(int j=0;j<HEAT_ROWS;j++)temperature[i][j]=20;
        temperature[heatSourceX][heatSourceY]=100;
        thermalEquilibrium=false;
        equilibriumTime=0;
        px=768;py=300;
    }
    
    public void retry(Game g){
        if(!cleared())resetState();
        g.x=px;g.y=py;
        g.vfx.clear();
        g.announce("重新开始，已获得的奖励保留");
    }
    
    public void recover(Game g){
        failed=false;
        resetState();
        g.hp=g.maxHp;
        returnTown(g);
    }
    
    public String interaction(Game g){
        if(!active||g.inTown())return "";
        if(Game.dist(g.x,g.y,gateX(),gateY())<60){
            if(cleared()&&level<4)return "继续探索 · "+NAMES[level+1];
            return "返回中山大学";
        }
        return "";
    }
    
    public float gateX(){return 768;}
    public float gateY(){return 300;}
    
    public void interact(Game g){
        if(g.mode!=Game.PLAY||!active)return;
        if(Game.dist(g.x,g.y,gateX(),gateY())<60){
            if(cleared()&&level<4){
                g.story.begin(g,-1,new String[]{"旁白|你已解开当前谜题。是否前往下一关？"},
                    new String[]{"前往 "+NAMES[level+1],"返回城镇"},
                    new int[]{320,321});
            }else{
                g.story.begin(g,-1,new String[]{"旁白|可以沿光门回到中山大学。当前进度会保留。"},
                    new String[]{"返回中山大学","继续探索"},
                    new int[]{321,300});
            }
        }
    }
    
    public void action(Game g,int action){
        if(action==320&&cleared()&&level<4){
            level++;
            resetState();
            enter(g);
        }else if(action==321){
            returnTown(g);
        }
    }
    
    /** Idempotent: format 7 saves could finish the workshop before the reward weapon existed. */
    public void syncFinaleReward(Game g){
        if(solved==(1<<MAPS)-1)g.arsenal.unlock(g,Arsenal.RESONANCE_STAFF_PLUS);
    }
    
    private void complete(Game g){
        if(cleared())return;
        solved|=1<<level;
        int reward=80+30*level;
        g.gold+=reward;
        g.maxHp+=10;
        g.hp=Math.min(g.maxHp,g.hp+25);
        g.vfx.ring(g.x,g.y,0xffa5d8f0,32,80);
        boolean finale=solved==(1<<MAPS)-1;
        if(finale)syncFinaleReward(g);
        g.announce("发现已记入札记 · "+reward+" 金币 / 体魄 +10"+(finale?" / 共振法杖·改":""));
        
        String[] pages=new String[]{
            "旁白|物理现象背后藏着简洁的规律。你用观察和实验验证了它。",
            "旅途札记|"+INSIGHTS[level],
            finale?"旅途札记|五个谜题全部解开。共振法杖·改已经收入武库，去武库装备它，让法弹引发连锁共振。":"旅途札记|把这次发现带到下一关。物理规律在不同场景中反复出现。"
        };
        g.story.begin(g,-1,pages,new String[]{"收好发现 · 继续探索"},new int[]{300});
    }
    
    public void tick(Game g,float dt){
        if(!active||cleared()){return;}
        
        switch(level){
            case 0:tickProjectile(g,dt);break;
            case 1:tickLight(g,dt);break;
            case 2:tickCircuit(g,dt);break;
            case 3:tickWave(g,dt);break;
            case 4:tickHeat(g,dt);break;
        }
    }
    
    // 抛体靶场：靠近发射点按操作键发射，命中3次通关
    private void tickProjectile(Game g,float dt){
        if(projectileActive){
            projectileVY+=GRAVITY*dt;
            projectileX+=projectileVX*dt;
            projectileY+=projectileVY*dt;
            
            // 检查命中
            for(int i=0;i<3;i++){
                if(i<targetHits)continue; // 已命中的跳过
                float tx=TARGETS[i][0],ty=TARGETS[i][1];
                if(Game.dist(projectileX,projectileY,tx,ty)<35){
                    targetHits++;
                    projectileActive=false;
                    g.vfx.ring(tx,ty,0xffffeb3b,20,50);
                    g.announce("命中目标 "+targetHits+"/3");
                    if(targetHits>=3)complete(g);
                    break;
                }
            }
            
            // 出界
            if(projectileX<0||projectileX>WIDTH||projectileY>HEIGHT){
                projectileActive=false;
                g.announce("未命中，再试一次");
            }
        }else{
            // 靠近发射点时，按操作键发射
            if(Game.dist(g.x,g.y,300,800)<50&&g.swing>0&&!projectileActive){
                launchProjectile(g);
                g.swing=0;
            }
        }
    }
    
    private void launchProjectile(Game g){
        float radians=(float)(launchAngle*Math.PI/180);
        float speed=launchSpeed();
        projectileX=300;
        projectileY=800;
        projectileVX=(float)Math.cos(radians)*speed;
        projectileVY=-(float)Math.sin(radians)*speed;
        projectileActive=true;
        g.vfx.burst(300,800,0xffffeb3b,8,40,.3f,2);
    }
    
    // 光路迷宫：旋转镜面，使光线到达终点
    private void tickLight(Game g,float dt){
        // 靠近镜面时，按操作键旋转
        if(g.swing>0){
            for(int i=0;i<3;i++){
                float mx=MIRRORS[i][0],my=MIRRORS[i][1];
                if(Game.dist(g.x,g.y,mx,my)<40){
                    mirrorAngles[i]=(mirrorAngles[i]+45)%360;
                    g.vfx.ring(mx,my,0xffffff00,12,30);
                    g.announce("旋转镜面");
                    g.swing=0;
                    break;
                }
            }
        }
        
        // 追踪光线
        traceLightRay(g);
        
        if(lightReachedEnd&&!cleared()){
            complete(g);
        }
    }
    
    private void traceLightRay(Game g){
        float x=LIGHT_START_X,y=LIGHT_START_Y;
        float dx=1,dy=0; // 初始方向：向右
        
        for(int bounce=0;bounce<10;bounce++){
            // 找最近的镜面交点
            float nearestDist=Float.MAX_VALUE;
            int nearestMirror=-1;
            
            for(int i=0;i<3;i++){
                float mx=MIRRORS[i][0],my=MIRRORS[i][1];
                float angle=mirrorAngles[i]*3.14159f/180;
                float nx=-(float)Math.sin(angle),ny=(float)Math.cos(angle); // 法向量
                
                // 射线与镜面交点计算（简化）
                float toMirrorX=mx-x,toMirrorY=my-y;
                float t=toMirrorX*dx+toMirrorY*dy;
                if(t>0&&t<nearestDist){
                    // 检查是否接近镜面
                    float hitX=x+dx*t,hitY=y+dy*t;
                    if(Game.dist(hitX,hitY,mx,my)<60){
                        nearestDist=t;
                        nearestMirror=i;
                    }
                }
            }
            
            if(nearestMirror>=0){
                // 反射
                float mx=MIRRORS[nearestMirror][0],my=MIRRORS[nearestMirror][1];
                float angle=mirrorAngles[nearestMirror]*3.14159f/180;
                float nx=-(float)Math.sin(angle),ny=(float)Math.cos(angle);
                
                // R = I - 2(I·N)N
                float dot=dx*nx+dy*ny;
                dx=dx-2*dot*nx;
                dy=dy-2*dot*ny;
                
                x=mx+dx*10;
                y=my+dy*10;
            }else{
                // 没有更多反射，检查是否到达终点
                break;
            }
        }
        
        lightRayEndX=x+dx*500;
        lightRayEndY=y+dy*500;
        lightReachedEnd=Game.dist(lightRayEndX,lightRayEndY,LIGHT_END_X,LIGHT_END_Y)<80;
    }
    
    // 回路工坊：连接导线，使所有节点通电
    private void tickCircuit(Game g,float dt){
        // 靠近节点时，按操作键选择/连接
        if(g.swing>0){
            for(int i=0;i<6;i++){
                float nx=CIRCUIT_NODES[i][0],ny=CIRCUIT_NODES[i][1];
                if(Game.dist(g.x,g.y,nx,ny)<35){
                    if(selectedNode<0){
                        selectedNode=i;
                        g.announce("选择节点 "+(i+1));
                    }else if(selectedNode!=i){
                        // 尝试连接
                        int edge=findEdge(selectedNode,i);
                        if(edge>=0&&!wiresPlaced[edge]){
                            wiresPlaced[edge]=true;
                            g.vfx.ring(nx,ny,0xff4fc3f7,15,40);
                            g.announce("连接导线");
                        }
                        selectedNode=-1;
                    }
                    g.swing=0;
                    break;
                }
            }
        }
        
        // 检查电路是否完成
        circuitComplete=checkCircuitComplete();
        if(circuitComplete&&!cleared()){
            complete(g);
        }
    }
    
    private int findEdge(int a,int b){
        for(int i=0;i<CIRCUIT_EDGES.length;i++){
            if((CIRCUIT_EDGES[i][0]==a&&CIRCUIT_EDGES[i][1]==b)||
               (CIRCUIT_EDGES[i][0]==b&&CIRCUIT_EDGES[i][1]==a)){
                return i;
            }
        }
        return -1;
    }
    
    private boolean checkCircuitComplete(){
        // 所有边都已连接
        for(boolean w:wiresPlaced)if(!w)return false;
        return true;
    }
    
    // 波的干涉：调整波源，形成稳定干涉图样
    private void tickWave(Game g,float dt){
        wavePhase+=WAVE_FREQ*dt*6;
        
        // 移动波源（玩家靠近时推动）
        if(Game.dist(g.x,g.y,source1X,source1Y)<30){
            source1X+=(g.x-source1X)*0.1f;
            source1Y+=(g.y-source1Y)*0.1f;
        }
        if(Game.dist(g.x,g.y,source2X,source2Y)<30){
            source2X+=(g.x-source2X)*0.1f;
            source2Y+=(g.y-source2Y)*0.1f;
        }
        
        // 检查干涉图样是否稳定（简化：两波源距离在某个范围内）
        float dist=Game.dist(source1X,source1Y,source2X,source2Y);
        boolean stable=dist>400&&dist<600;
        
        if(stable){
            stableFrames++;
            if(stableFrames>180&&!cleared()){ // 3秒稳定
                patternStable=true;
                complete(g);
            }
        }else{
            stableFrames=Math.max(0,stableFrames-2);
        }
    }
    
    // 热流迷宫：模拟热传导，达到热平衡
    private void tickHeat(Game g,float dt){
        // 有限差分法模拟热传导
        float[][] newTemp=new float[HEAT_COLS][HEAT_ROWS];
        for(int i=0;i<HEAT_COLS;i++){
            for(int j=0;j<HEAT_ROWS;j++){
                if(i==heatSourceX&&j==heatSourceY){
                    newTemp[i][j]=100; // 热源恒温
                }else if(i==heatSinkX&&j==heatSinkY){
                    newTemp[i][j]=0; // 热汇恒温
                }else{
                    float sum=0;
                    int count=0;
                    if(i>0){sum+=temperature[i-1][j];count++;}
                    if(i<HEAT_COLS-1){sum+=temperature[i+1][j];count++;}
                    if(j>0){sum+=temperature[i][j-1];count++;}
                    if(j<HEAT_ROWS-1){sum+=temperature[i][j+1];count++;}
                    newTemp[i][j]=temperature[i][j]+HEAT_DIFFUSIVITY*dt*(sum/count-temperature[i][j]);
                }
            }
        }
        temperature=newTemp;
        
        // 检查热平衡（中心区域温度变化小于阈值）
        float centerTemp=temperature[HEAT_COLS/2][HEAT_ROWS/2];
        boolean balanced=Math.abs(centerTemp-50)<5;
        
        if(balanced){
            equilibriumTime+=dt;
            if(equilibriumTime>3&&!cleared()){ // 3秒平衡
                thermalEquilibrium=true;
                complete(g);
            }
        }else{
            equilibriumTime=0;
        }
        
        // 玩家移动影响热传导（靠近时加速）
        int cellX=(int)(g.x/WIDTH*HEAT_COLS);
        int cellY=(int)(g.y/HEIGHT*HEAT_ROWS);
        if(cellX>=0&&cellX<HEAT_COLS&&cellY>=0&&cellY<HEAT_ROWS){
            temperature[cellX][cellY]=Game.clamp(temperature[cellX][cellY]+dt*10,0,100);
        }
    }
    
    public boolean blocked(float x,float y,float r){
        return x<100+r||x>WIDTH-100-r||y<100+r||y>HEIGHT-100-r;
    }
    
    public void write(DataOutputStream o)throws IOException{write(o,true);}
    /** Format 7 and earlier did not persist tuned launch parameters. */
    public void write(DataOutputStream o,boolean includeLaunch)throws IOException{
        o.writeBoolean(active);
        o.writeBoolean(failed);
        o.writeInt(level);
        o.writeInt(solved);
        o.writeFloat(px);
        o.writeFloat(py);
        o.writeInt(targetHits);
        for(int a:mirrorAngles)o.writeInt(a);
        for(boolean w:wiresPlaced)o.writeBoolean(w);
        o.writeFloat(source1X);o.writeFloat(source1Y);
        o.writeFloat(source2X);o.writeFloat(source2Y);
        for(int i=0;i<HEAT_COLS;i++)for(int j=0;j<HEAT_ROWS;j++)o.writeFloat(temperature[i][j]);
        if(includeLaunch){o.writeFloat(launchAngle);o.writeFloat(launchPower);}
    }
    
    public static PhysicsJourney read(DataInputStream in)throws IOException{return read(in,8);}
    public static PhysicsJourney read(DataInputStream in,int version)throws IOException{
        PhysicsJourney p=new PhysicsJourney();
        p.active=in.readBoolean();
        p.failed=in.readBoolean();
        p.level=in.readInt();
        p.solved=in.readInt();
        p.px=in.readFloat();
        p.py=in.readFloat();
        p.targetHits=in.readInt();
        for(int i=0;i<3;i++)p.mirrorAngles[i]=in.readInt();
        for(int i=0;i<7;i++)p.wiresPlaced[i]=in.readBoolean();
        p.source1X=in.readFloat();p.source1Y=in.readFloat();
        p.source2X=in.readFloat();p.source2Y=in.readFloat();
        for(int i=0;i<HEAT_COLS;i++)for(int j=0;j<HEAT_ROWS;j++)p.temperature[i][j]=in.readFloat();
        if(version>=8){
            p.launchAngle=in.readFloat();p.launchPower=in.readFloat();
            if(Float.isNaN(p.launchAngle)||Float.isNaN(p.launchPower)||Float.isInfinite(p.launchAngle)||Float.isInfinite(p.launchPower)
                ||p.launchAngle<MIN_ANGLE||p.launchAngle>MAX_ANGLE||p.launchPower<MIN_POWER||p.launchPower>MAX_POWER)
                throw new IOException("Invalid launch parameters");
        }
        
        if(p.level<0||p.level>=MAPS)throw new IOException("Invalid physics level");
        if(p.solved<0||p.solved>=(1<<MAPS))throw new IOException("Invalid physics solved mask");
        return p;
    }
}
