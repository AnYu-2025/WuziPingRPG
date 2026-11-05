package cn.wuziping.ember;

import java.io.*;

/** Movement puzzles with ordered beacons, degree-gated bridges and mirrored seam markers. */
public final class MathJourney {
    public static final int MAP=12,WIDTH=1536,HEIGHT=1152,SAVE_BYTES=50;
    public static final String[] NAMES={"等距花园","七桥星庭","翻向长廊"};
    public static final String[] INSIGHTS={"圆上的点到圆心距离相同。走弦会离圆心更近。","每条边只走一次的连通图，奇数度顶点只能有零个或两个。","长条两端反向粘合，绕一圈局部朝向翻转，再绕一圈复原。"};
    public static final float[][] NODES={{460,780},{1000,780},{1000,400},{460,400},{730,210}};
    public static final int[][] EDGES={{0,1},{1,2},{2,3},{3,0},{3,4},{4,2},{0,2}};
    public static final float[][] MARKS={{540,480},{940,700},{780,590}};
    /** 幻影路标：碰上会抹掉进度，位置避开三处真标记的常规走线。 */
    public static final float[][] DECOYS={{700,700},{1000,500}};
    public static final int[] DEGREE={3,2,4,3,2};
    public static final int MAX_CROSSINGS=6;
    public boolean active=false,failed=false;
    public int level=0,solved=0,circle=0,bridges=0,node=-1,edge=-1,orientation=0,ribbon=0;
    public float seam=0,offBand=0,px=768,py=300;
    public final float[] trailX=new float[128],trailY=new float[128];public int trailCount=0,trailHead=0;
    public boolean cleared(){return (solved&(1<<level))!=0;}
    public String name(){return NAMES[level];}
    /** 下一盏该点亮的灯；等距花园按顺序推进。 */
    public int nextBeacon(){return level==0?Math.min(2,Math.max(0,ribbon)):0;}
    public int crossings(){return level==2?Math.max(0,node):0;}
    public String objective(Game g){
        if(g.inTown())return solved==7?"数学主题已完成 · 在札记回看发现":"从东庭数学之门继续探索";
        if(cleared())return level==2?"长廊已回应 · 返回中山大学":"机关已回应 · 靠近入口继续前行";
        if(level==0)return "按顺序点亮第 "+(nextBeacon()+1)+" 盏灯 · 别离开圆环";
        if(level==1)return "从奇数度星台起步 · 七座桥各走一次 · "+Integer.bitCount(bridges)+"/7";
        return "避开幻影路标 · 接缝穿越 "+crossings()+"/"+MAX_CROSSINGS+" · 路标 "+Integer.bitCount(ribbon)+"/3";
    }
    public void enter(Game g){
        active=true;if(cleared()&&level<2){level++;resetState();}
        g.story.area=Story.FOREST;g.x=px;g.y=py;g.mode=Game.PLAY;g.story.dialogue=null;g.vfx.clear();g.swing=g.skillFlash=g.dashTime=0;g.invuln=1;
        g.announce("数学 · "+name()+" / "+objective(g));
    }
    public void returnTown(Game g){px=g.x;py=g.y;g.story.area=Story.TOWN;g.x=1080;g.y=660;g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.story.dialogue=null;g.vfx.clear();g.announce("中山大学 · 东庭");}
    public void resetState(){
        circle=bridges=ribbon=orientation=0;node=edge=-1;offBand=seam=0;trailCount=trailHead=0;
        px=level==1?460:level==2?650:768;py=level==1?870:level==2?590:300;
        if(level==2)node=0; /* 借用为接缝穿越计数 */
    }
    public void retry(Game g){if(!cleared())resetState();g.x=px;g.y=py;g.vfx.clear();g.announce("脚印重新开始，已获得的奖励保留");}
    public void recover(Game g){failed=false;resetState();g.hp=g.maxHp;returnTown(g);}
    public void defeat(Game g){failed=true;g.hp=Math.max(1,g.maxHp*.5f);g.mode=Game.DEAD;}
    public String interaction(Game g){if(!g.inMath())return "";return Game.dist(g.x,g.y,gateX(),gateY())<60?(cleared()&&level<2?"继续探索 · "+NAMES[level+1]:"返回中山大学"):"";}
    public float gateX(){return level==1?460:level==2?650:768;}
    public float gateY(){return level==1?870:level==2?590:300;}
    public void interact(Game g){
        if(g.mode!=Game.PLAY||interaction(g).isEmpty())return;
        g.story.begin(g,-1,new String[]{cleared()?"旁白|你的脚印让机关亮了起来。先前的发现已记入札记，奖励也已保存。":"旁白|可以沿光门回到中山大学。当前机关与脚印会保留，随时可以继续。"},cleared()&&level<2?new String[]{"前往下一座星庭","返回中山大学"}:new String[]{"返回中山大学","继续观察"},cleared()&&level<2?new int[]{301,302}:new int[]{302,300});
    }
    public void action(Game g,int action){if(action==301&&cleared()&&level<2)enter(g);else if(action==302)returnTown(g);}
    private void complete(Game g){
        if(cleared())return;solved|=1<<level;g.gold+=60+20*level;g.maxHp+=8;g.hp=Math.min(g.maxHp,g.hp+20);g.vfx.ring(g.x,g.y,0xff9de0d0,28,70);
        g.announce("发现已记入札记 · "+(60+20*level)+" 金币 / 体魄 +8");
        g.story.begin(g,-1,new String[]{"旁白|光轨终于连成了完整的图形。你靠自己的脚步找到了规律。","旅途札记|"+INSIGHTS[level],level==2?"旅途札记|这只是理想化的莫比乌斯带接缝模型。这里的箭头表示局部坐标朝向，并不代表带子有两张面。":"旅途札记|顺序、起点和朝向都是约束的一部分。试着解释失败的走法为什么行不通。"},new String[]{"收好发现 · 继续探索"},new int[]{300});
    }
    private void resetPattern(Game g,String reason){circle=bridges=ribbon=0;node=level==2?0:-1;edge=-1;offBand=0;g.announce(reason);}
    public void tick(Game g,float dt){
        int last=(trailHead+127)%128;if(trailCount==0||Game.dist(g.x,g.y,trailX[last],trailY[last])>10){trailX[trailHead]=g.x;trailY[trailHead]=g.y;trailHead=(trailHead+1)%128;trailCount=Math.min(128,trailCount+1);}
        seam=Math.max(0,seam-dt);if(cleared())return;
        if(level==0)garden(g,dt);
        else if(level==1)bridges(g);
        else corridor(g);
    }
    /** 等距花园：灯必须按 ①②③ 顺序点亮，且始终贴着半径 180 的圆。 */
    private void garden(Game g,float dt){
        float distance=Game.dist(g.x,g.y,768,576);
        if(circle!=0&&Math.abs(distance-180)>18){offBand+=dt;if(offBand>.15f){resetPattern(g,"灯光熄灭了，脚印离开了那条轨迹");return;}}
        else offBand=0;
        int expected=nextBeacon();
        double a=expected*Math.PI*2/3;
        float x=768+(float)Math.cos(a)*180,y=576+(float)Math.sin(a)*180;
        if(Game.dist(g.x,g.y,x,y)<18&&(circle&(1<<expected))==0){
            circle|=1<<expected;ribbon=expected+1;
            g.vfx.ring(x,y,0xffa5dfcf,10,30);
            g.announce(expected==2?"三盏灯连成了等距的轨迹":"第 "+(expected+1)+" 盏灯亮了 · 继续沿圆走");
        }
        if(circle==7)complete(g);
    }
    private void bridges(Game g){
        if(node<0){
            for(int i=0;i<5;i++)if(Game.dist(g.x,g.y,NODES[i][0],NODES[i][1])<23){
                if(DEGREE[i]%2==0){if(seam<=0){g.announce("偶数度星台不是起点 · 从奇数度的 ① 或 ④ 出发");seam=.35f;}return;}
                node=i;g.announce("从 "+DEGREE[i]+" 条桥的星台起笔");break;
            }
            return;
        }
        if(edge<0){
            if(Game.dist(g.x,g.y,NODES[node][0],NODES[node][1])<26)return;
            float nearest=12;int candidate=-1;
            for(int i=0;i<7;i++)if(EDGES[i][0]==node||EDGES[i][1]==node){float distance=distanceToEdge(g.x,g.y,i);if(distance<nearest){nearest=distance;candidate=i;}}
            if(candidate>=0){if((bridges&(1<<candidate))!=0){resetPattern(g,"这座桥已有脚印，光轨重新散开了");return;}edge=candidate;}
            if(edge<0){resetPattern(g,"脚印离开了桥面");}return;
        }
        if(distanceToEdge(g.x,g.y,edge)>15){resetPattern(g,"脚印离开了桥面");return;}
        int other=EDGES[edge][0]==node?EDGES[edge][1]:EDGES[edge][0];
        if(Game.dist(g.x,g.y,NODES[other][0],NODES[other][1])<16){bridges|=1<<edge;node=other;edge=-1;g.vfx.ring(g.x,g.y,0xffd6beed,10,30);if(bridges==127)complete(g);}
        else if(Game.dist(g.x,g.y,NODES[node][0],NODES[node][1])<16)edge=-1;
    }
    /** 翻向长廊：幻影路标会抹掉进度，接缝穿越次数有限。 */
    private void corridor(Game g){
        for(float[] d:DECOYS)if(Game.dist(g.x,g.y,d[0],d[1])<23){
            if(ribbon!=0)resetPattern(g,"碰到了幻影路标，先前的记号散开了");
            return;
        }
        if(seam<=0&&(g.x>=1160||g.x<=360)){
            g.x=g.x>=1160?392:1128;g.y=1180-g.y;orientation^=1;seam=.3f;
            node=Math.max(0,node)+1;g.vfx.ring(g.x,g.y,0xffc3b5ef,16,42);
            if(node>MAX_CROSSINGS){resetPattern(g,"接缝承受不住这么多次穿越，记号重新散开");return;}
            g.announce("接缝另一侧，箭头的朝向变了 · "+node+"/"+MAX_CROSSINGS);
        }
        for(int i=0;i<3;i++)if(Game.dist(g.x,g.y,MARKS[i][0],MARKS[i][1])<23&&orientation==(i==1?1:0))ribbon|=1<<i;
        if(ribbon==7)complete(g);
    }
    public static float distanceToEdge(float x,float y,int i){float[] a=NODES[EDGES[i][0]],b=NODES[EDGES[i][1]];float dx=b[0]-a[0],dy=b[1]-a[1],t=Game.clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);return Game.dist(x,y,a[0]+t*dx,a[1]+t*dy);}
    public boolean blocked(float x,float y,float r){if(level==2)return x<330+r||x>1190-r||y<420+r||y>760-r;return x<150+r||x>1386-r||y<140+r||y>1012-r;}
    public void write(DataOutputStream o)throws IOException{o.writeBoolean(active);o.writeBoolean(failed);int[] a={level,solved,circle,bridges,node,edge,orientation,ribbon};for(int v:a)o.writeInt(v);o.writeFloat(seam);o.writeFloat(offBand);o.writeFloat(px);o.writeFloat(py);}
    public static MathJourney read(DataInputStream in)throws IOException{
        MathJourney m=new MathJourney();m.active=in.readBoolean();m.failed=in.readBoolean();m.level=in.readInt();m.solved=in.readInt();m.circle=in.readInt();m.bridges=in.readInt();m.node=in.readInt();m.edge=in.readInt();m.orientation=in.readInt();m.ribbon=in.readInt();m.seam=in.readFloat();m.offBand=in.readFloat();m.px=in.readFloat();m.py=in.readFloat();
        if(m.level<0||m.level>2||m.solved<0||m.solved>7||m.solved!=((1<<m.level)-1)&&m.solved!=((1<<(m.level+1))-1)||m.circle<0||m.circle>7||m.bridges<0||m.bridges>127||m.node< -1||m.node>8||m.edge< -1||m.edge>6||m.orientation<0||m.orientation>1||m.ribbon<0||m.ribbon>7||!valid(m.seam,0,.4f)||!valid(m.offBand,0,.3f)||!valid(m.px,0,WIDTH)||!valid(m.py,0,HEIGHT))throw new IOException("Invalid mathematics journey");
        return m;
    }
    private static boolean valid(float n,float min,float max){return !Float.isNaN(n)&&!Float.isInfinite(n)&&n>=min&&n<=max;}
}
