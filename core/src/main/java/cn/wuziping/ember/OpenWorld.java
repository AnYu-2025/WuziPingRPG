package cn.wuziping.ember;

import java.io.*;

/** 开放世界主大陆：参考真实地理的五校区城池、两处遗址，以及沉沦大明疆域
 *  （沉没明土、应天遗城、滇黔遗民部落、明神都·中都遗宫）。
 *  地形由确定性噪声生成（珠江水系、北湖、南海岸、东山、淮泗沉湖），城池为手工布局。
 *  坐标为世界像素，16px 一格；渲染按 2x 像素风绘制。 */
public final class OpenWorld {
    public static final int W=5120,H=3840;
    public static final int GRASS=0,SAND=1,DEEP=2,SHALLOW=3,LAKE=4,RIVER=5,ROCK=6,SNOW=7,ROAD=8,PLAZA=9,FIELD=10;
    public static final int SOUTH=0,NORTH=1,EAST=2,ZHUHAI=3,SHENZHEN=4,RUIN_ANCIENT=5,RUIN_MED=6,
        SUNKEN_MING=7,MING_CITY=8,MING_TRIBE=9,MING_RUIN=10;

    public static final class Region{
        public final int id;public final String name,disc;public final float x,y;public final boolean city;public final boolean tribe;
        public final int[] b;public final int[] gates;
        Region(int i,String n,String d,float a,float b2,boolean c,boolean t,int[] bb,int[] gg){id=i;name=n;disc=d;x=a;y=b2;city=c;tribe=t;b=bb;gates=gg;}
        public boolean inside(float a,float c){return a>b[0]&&a<b[2]&&c>b[1]&&c<b[3];}
        public boolean settlement(){return city||tribe;}
    }
    /** 地理参考：南校珠江畔（广州）、北校越秀、东校小谷围、珠海唐家湾、深圳光明山；
     *  大明疆域参考淮泗沉湖（洪泽）、应天（南京）、滇黔遗民、凤阳中都。 */
    public static final Region[] REGIONS={
        new Region(SOUTH,"南校园 · 康乐园","人文社科 / 岭南红墙",1000,1500,true,false,new int[]{780,1300,1220,1700},new int[]{1000,1292,1000,1708,772,1500,1228,1500}),
        new Region(NORTH,"北校园 · 医科城","医科 / 越秀山下",1000,700,true,false,new int[]{780,500,1220,900},new int[]{1000,492,1000,908,772,700,1228,700}),
        new Region(EAST,"东校园 · 格致城","信息 / 化学 / 大学城",2500,1350,true,false,new int[]{2280,1150,2720,1550},new int[]{2500,1142,2500,1558,2272,1350,2728,1350}),
        new Region(ZHUHAI,"珠海校园 · 听涛城","海洋 / 天文 / 唐家湾",1050,2350,true,false,new int[]{830,2150,1270,2550},new int[]{1050,2142,1050,2558,822,2350,1278,2350}),
        new Region(SHENZHEN,"深圳校园 · 光明城","生物医学 / 材料 / 山湖",3150,750,true,false,new int[]{2930,550,3370,950},new int[]{3150,542,3150,958,2922,750,3378,750}),
        new Region(RUIN_ANCIENT,"上古遗址","星图祭坛 / 先民回响",550,1050,false,false,new int[]{430,930,670,1170},new int[0]),
        new Region(RUIN_MED,"中山医科大学遗址","合并前的医学院 / 旧解剖楼",1700,1900,false,false,new int[]{1580,1780,1820,2020},new int[0]),
        new Region(SUNKEN_MING,"沉沦明土 · 淮泗水国","沉没的帝国 / 水下城垣",1500,2900,false,false,new int[]{1000,2500,2100,3300},new int[0]),
        new Region(MING_CITY,"应天遗城 · 南明余绪","大明继承者城邦 / 皇族遗脉",2700,2900,true,false,new int[]{2480,2700,2920,3100},new int[]{2700,2692,2700,3108,2472,2900,2928,2900}),
        new Region(MING_TRIBE,"滇黔遗民 · 永历部落","大明继承者部落 / 山地遗民",3900,3200,false,true,new int[]{3700,3000,4100,3400},new int[0]),
        new Region(MING_RUIN,"明神都 · 中都遗宫","大明神都遗址 / 凤阳中都",4350,2050,false,false,new int[]{4050,1750,4700,2400},new int[0])
    };
    public static final String[] CITY_TAGS={"人文社科","医科","信息化学","海洋天文","生医材料"};

    public static final class Npc{
        public final int id,region,sprite;public final float x,y;public final String name,role;
        Npc(int i,int r,int s,String n,String ro,float a,float b){id=i;region=r;sprite=s;name=n;role=ro;x=a;y=b;}
    }
    public static final Npc[] NPCS={
        new Npc(0,SOUTH,0,"陈序","中文系守卷人",1000,1420),
        new Npc(1,SOUTH,1,"罗望","哲学系辩手",900,1560),
        new Npc(2,SOUTH,4,"梁思齐","历史系向导",1100,1560),
        new Npc(3,NORTH,3,"柯麟生","中山医守灯人",1000,620),
        new Npc(4,NORTH,4,"秦脉","解剖学讲师",900,780),
        new Npc(5,NORTH,2,"苏愈","药师",1100,780),
        new Npc(6,EAST,2,"方澄","超算中心工程师",2500,1270),
        new Npc(7,EAST,1,"何砚","化学材料楼炼金师",2400,1430),
        new Npc(8,EAST,4,"周律","电信学院研究员",2600,1430),
        new Npc(9,ZHUHAI,1,"林潮","海洋科学学院观测员",1050,2270),
        new Npc(10,ZHUHAI,4,"白帆","天琴计划台长",950,2430),
        new Npc(11,ZHUHAI,0,"阿汐","渔家向导",1150,2430),
        new Npc(12,SHENZHEN,2,"程材","材料实验室主管",3150,670),
        new Npc(13,SHENZHEN,3,"沈微","生医工程师",3050,830),
        new Npc(14,SHENZHEN,1,"高峡","山湖巡守",3250,830),
        new Npc(15,MING_CITY,0,"朱长烨","皇族遗脉 · 监国",2700,2820),
        new Npc(16,MING_CITY,4,"沈挽舟","余绪学士",2600,2980),
        new Npc(17,MING_CITY,2,"洪捷","锦衣卫后裔",2800,2980),
        new Npc(18,MING_TRIBE,1,"阿玥","永历遗民",3850,3150),
        new Npc(19,MING_TRIBE,3,"沐天行","滇黔土司",3950,3250)
    };
    public static final class Building{
        public final int region,sprite;public final float x,y,w,h;public final String name;
        Building(int r,int s,String n,float a,float b,float c,float d){region=r;sprite=s;name=n;x=a;y=b;w=c;h=d;}
        public boolean blocked(float a,float b,float r){return a+r>x-w*.39f&&a-r<x+w*.39f&&b+r>y-h*.43f&&b-r<y-7;}
    }
    public static final Building[] BUILDINGS={
        new Building(SOUTH,0,"怀士堂",1000,1380,150,110),
        new Building(SOUTH,4,"马丁堂",880,1470,120,95),
        new Building(SOUTH,2,"黑石屋",1120,1470,110,90),
        new Building(SOUTH,5,"陈寅恪故居",940,1620,120,90),
        new Building(SOUTH,6,"哲生堂",1120,1620,110,90),
        new Building(SOUTH,1,"南门牌坊",1000,1680,140,70),
        new Building(NORTH,0,"医科红楼",1000,580,150,110),
        new Building(NORTH,2,"解剖楼",880,680,120,95),
        new Building(NORTH,3,"博济纪念堂",1120,680,110,90),
        new Building(NORTH,5,"护理学舍",940,820,120,90),
        new Building(NORTH,4,"医学图书馆",1060,820,120,95),
        new Building(EAST,0,"超算中心",2500,1230,150,110),
        new Building(EAST,6,"信息管理学院楼",2380,1330,120,95),
        new Building(EAST,2,"化学材料综合楼",2620,1330,120,95),
        new Building(EAST,5,"生命科学大楼",2440,1470,120,90),
        new Building(EAST,4,"电子与信息楼",2600,1470,110,90),
        new Building(EAST,1,"东门牌坊",2500,1530,140,70),
        new Building(ZHUHAI,0,"教学实验大楼",1050,2230,170,100),
        new Building(ZHUHAI,6,"海琴楼",930,2330,120,95),
        new Building(ZHUHAI,4,"天琴中心",1170,2330,110,95),
        new Building(ZHUHAI,5,"若海餐厅",990,2470,120,90),
        new Building(ZHUHAI,1,"渔港码头",1120,2470,120,90),
        new Building(SHENZHEN,0,"光明堂",3150,630,150,110),
        new Building(SHENZHEN,6,"材料学院楼",3030,730,120,95),
        new Building(SHENZHEN,2,"医学院楼",3270,730,120,95),
        new Building(SHENZHEN,5,"山湖学舍",3090,870,120,90),
        new Building(SHENZHEN,4,"笃行楼",3210,870,120,95),
        new Building(MING_CITY,0,"奉天遗殿",2700,2780,170,120),
        new Building(MING_CITY,2,"锦衣卫署",2580,2880,120,95),
        new Building(MING_CITY,4,"国子监舍",2820,2880,120,95),
        new Building(MING_CITY,5,"太庙残祠",2640,3020,120,90),
        new Building(MING_CITY,1,"聚宝门楼",2700,3080,150,80),
        new Building(MING_TRIBE,5,"土司吊脚楼",3850,3120,120,95),
        new Building(MING_TRIBE,5,"议事长屋",3950,3200,130,95),
        new Building(MING_TRIBE,3,"晒谷架",3800,3260,90,70),
        new Building(MING_TRIBE,3,"祭火棚",3980,3300,90,70)
    };
    public static final class Camp{
        public final int id,region,tier,faction;public final float x,y;
        Camp(int i,int r,int t,int f,float a,float b){id=i;region=r;tier=t;faction=f;x=a;y=b;}
    }
    /** 营地：faction 0 面具部落 / 1 沉湖水鬼 / 2 遗宫傀甲。tier 决定强度与掉落。 */
    public static final Camp[] CAMPS={
        new Camp(0,SOUTH,1,0,620,1780),new Camp(1,SOUTH,1,0,1400,1200),
        new Camp(2,NORTH,1,0,600,420),new Camp(3,NORTH,2,0,1400,420),
        new Camp(4,EAST,2,0,2100,1000),new Camp(5,EAST,2,0,2900,1700),
        new Camp(6,ZHUHAI,2,0,600,2450),new Camp(7,ZHUHAI,3,0,1500,2600),
        new Camp(8,SHENZHEN,3,0,2800,400),new Camp(9,SHENZHEN,3,0,3500,1100),
        new Camp(10,RUIN_ANCIENT,3,0,610,1130),new Camp(11,RUIN_MED,2,0,1770,1975),
        new Camp(12,SUNKEN_MING,3,1,1250,2750),new Camp(13,SUNKEN_MING,3,1,1800,3080),
        new Camp(14,MING_CITY,2,0,2300,2600),new Camp(15,MING_CITY,3,2,3100,3200),
        new Camp(16,MING_TRIBE,3,0,3600,3450),new Camp(17,MING_TRIBE,3,2,4200,3050),
        new Camp(18,MING_RUIN,4,2,4250,1900),new Camp(19,MING_RUIN,4,2,4500,2250)
    };
    public static final class Road{public final float ax,ay,bx,by;Road(float a,float b,float c,float d){ax=a;ay=b;bx=c;by=d;}}
    public static final Road[] ROADS={
        new Road(1000,908,1000,1292),
        new Road(1228,1500,2272,1350),
        new Road(1000,1708,1050,2142),
        new Road(2728,1350,3150,958),
        new Road(1228,700,1580,1000),
        new Road(1220,1700,1580,1860),
        // 大明疆域官道与沉湖堤道
        new Road(1050,2558,1200,2900),
        new Road(1000,2900,2100,2900),
        new Road(2100,2900,2472,2900),
        new Road(2700,3108,3900,3200),
        new Road(2928,2900,4350,2400),
        new Road(2728,1350,4050,2050)
    };
    /** 可读石碑：遗址与沉湖的叙事碎片。 */
    public static final class Stele{
        public final int region;public final float x,y;public final String title;public final String[] pages;
        Stele(int r,float a,float b,String t,String[] p){region=r;x=a;y=b;title=t;pages=p;}
    }
    public static final Stele[] STELES={
        new Stele(RUIN_ANCIENT,550,1000,"星图残碑",new String[]{
            "旁白|碑面刻着一幅星图，线条被苔藓填满了大半。",
            "旁白|「先民观星以定四时，星火出于北辰。」落款早于任何朝代。"}),
        new Stele(RUIN_MED,1700,1850,"旧解剖楼铭",new String[]{
            "旁白|铭牌上写着中山医科大学的旧名，合并那年被人仔细擦过。",
            "旁白|「医者仁心，不以校名更迭而改。」"}),
        new Stele(SUNKEN_MING,1500,2830,"沉湖水位碑",new String[]{
            "旁白|石碑半没在水里，刻度停在一个再也回不去的年份。",
            "旁白|「淮泗泛溢，城郭尽没。大明之土，沉于泽国。」",
            "旁白|碑阴刻着逃难者的名字，密密麻麻，一直排到水线以下。"}),
        new Stele(MING_RUIN,4350,1980,"中都罢建诏",new String[]{
            "旁白|巨大的诏碑裂成两半，仍能读出「劳民伤财，罢中都役」几个字。",
            "旁白|神都未成而先弃。留下的台基，比任何建成的宫殿都庞大。",
            "旁白|「后世子孙，勿复营建。」——可惜后来的人，没有听。"}),
        new Stele(MING_TRIBE,3900,3150,"永历遗民誓",new String[]{
            "旁白|木牌上不是诏书，是誓约：「衣冠不改，火种不灭。」",
            "旁白|落款是几个早已散佚的年号，和一群不肯下山的人。"})
    };

    public boolean enabled=false;
    public int discovered=0,clearedCamps=0;
    public final int[] stage=new int[REGIONS.length];
    public final long[] campCd=new long[CAMPS.length];
    public final int[] campProgress=new int[CAMPS.length];
    public final byte[] tiles=new byte[(W/16)*(H/16)];
    public int lastRegion=-1;
    public float time=0;

    public OpenWorld(){generate();}

    /* ---------- 地形生成：真实地理参考 ---------- */
    private static int hash(int x,int y){int h=x*374761393+y*668265263;h=(h^(h>>>13))*1274126177;return (h^(h>>>16))&0x7fffffff;}
    private static float noise(float x,float y){
        int xi=(int)Math.floor(x),yi=(int)Math.floor(y);float fx=x-xi,fy=y-yi;
        fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);
        float a=hash(xi,yi)/2147483648f,b=hash(xi+1,yi)/2147483648f,c=hash(xi,yi+1)/2147483648f,d=hash(xi+1,yi+1)/2147483648f;
        return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
    }
    private void generate(){
        int tw=W/16,th=H/16;
        for(int ty=0;ty<th;ty++)for(int tx=0;tx<tw;tx++){
            float x=tx*16+8,y=ty*16+8;
            int t=GRASS;
            // 东部山脉（深圳光明山）：以山脊为轴的双 octave 高度场
            if(x>2560){
                float ridge=Game.clamp((x-2560)/2200f,0,1);
                float band=1f-Math.min(1,Math.abs(y-1500)/1600f);
                float m=ridge*.60f+band*.20f+noise(x*.0022f+40,y*.0022f+9)*.34f;
                if(m>.74f)t=ROCK;
                if(m>.95f)t=SNOW;
            }
            // 北部湖泊（越秀山麓湖）与深圳山湖
            if(Game.dist(x,y,1500,430)<150+noise(x*.02f,y*.02f)*40)t=LAKE;
            if(Game.dist(x,y,3450,500)<110+noise(x*.02f+7,y*.02f)*30)t=LAKE;
            // 沉沦明土：淮泗沉湖（洪泽），中心深水区
            float sd=Game.dist(x,y,1500,2900);
            if(sd<300+noise(x*.01f,y*.01f)*40)t=DEEP;
            else if(sd<430+noise(x*.01f+5,y*.01f)*50)t=SHALLOW;
            // 南部海岸线（南海）
            float coast=H-240+noise(x*.008f,3)*70;
            if(y>coast)t=DEEP;else if(y>coast-46)t=SHALLOW;else if(y>coast-78)t=SAND;
            // 珠江水系
            float riverY=1980+noise(x*.005f,11)*120;
            if(Math.abs(y-riverY)<34)t=RIVER;
            float branch=1180+noise(x*.007f,23)*60;
            if(x>1900&&x<2900&&Math.abs(y-branch)<26)t=RIVER;
            // 农田（大学城周边）
            if(t==GRASS&&x>1900&&x<2300&&y>1500&&y<1900&&noise(x*.03f,y*.03f)>.6f)t=FIELD;
            tiles[ty*tw+tx]=(byte)t;
        }
        for(Road r:ROADS)stampRoad(r);
        // 城池广场
        for(Region rg:REGIONS)if(rg.city){
            for(int ty=rg.b[1]/16;ty<rg.b[3]/16;ty++)for(int tx=rg.b[0]/16;tx<rg.b[2]/16;tx++){
                float x=tx*16+8,y=ty*16+8;
                boolean plaza=Math.abs(x-rg.x)<40||Math.abs(y-rg.y)<40;
                tiles[ty*tw+tx]=(byte)(plaza?PLAZA:ROAD);
            }
        }
        // 遗址石基（可步行）
        for(Region rg:REGIONS)if(!rg.city&&!rg.tribe&&rg.id!=SUNKEN_MING)
            for(int ty=rg.b[1]/16;ty<rg.b[3]/16;ty++)for(int tx=rg.b[0]/16;tx<rg.b[2]/16;tx++)tiles[ty*tw+tx]=(byte)ROAD;
        // 沉湖中心岛（残殿台基）与堤道已铺；岛上铺石
        for(int ty=2840/16;ty<2960/16;ty++)for(int tx=1440/16;tx<1560/16;tx++)tiles[ty*tw+tx]=(byte)ROAD;
        // 部落地面：草地 + 十字土路 + 梯田
        Region tr=REGIONS[MING_TRIBE];
        for(int ty=tr.b[1]/16;ty<tr.b[3]/16;ty++)for(int tx=tr.b[0]/16;tx<tr.b[2]/16;tx++){
            float x=tx*16+8,y=ty*16+8;
            boolean path=Math.abs(x-tr.x)<24||Math.abs(y-tr.y)<24;
            tiles[ty*tw+tx]=(byte)(path?ROAD:(noise(x*.05f,y*.05f)>.62f?FIELD:GRASS));
        }
    }
    private void stampRoad(Road r){
        int tw=W/16;float len=Game.dist(r.ax,r.ay,r.bx,r.by);int steps=(int)(len/8);
        for(int i=0;i<=steps;i++){
            float x=r.ax+(r.bx-r.ax)*i/steps,y=r.ay+(r.by-r.ay)*i/steps;
            for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
                int tx=(int)(x/16)+dx,ty=(int)(y/16)+dy;
                if(tx<0||ty<0||tx>=W/16||ty>=H/16)continue;
                tiles[ty*tw+tx]=(byte)ROAD; // 道路跨水即桥/堤，保证连通
            }
        }
    }
    public int tileAt(float x,float y){
        int tx=(int)(x/16),ty=(int)(y/16);
        if(tx<0||ty<0||tx>=W/16||ty>=H/16)return DEEP;
        return tiles[ty*(W/16)+tx];
    }
    public boolean water(int t){return t==DEEP||t==SHALLOW||t==LAKE||t==RIVER;}

    /* ---------- 碰撞 ---------- */
    public boolean terrainBlocked(float x,float y,float r){
        if(x-r<16||x+r>W-16||y-r<16||y+r>H-16)return true;
        int t=tileAt(x,y);
        if(t==DEEP||t==LAKE||t==ROCK||t==SNOW)return true;
        for(Region rg:REGIONS)if(rg.city){
            int[] b=rg.b;
            boolean inX=x>b[0]-r&&x<b[2]+r,inY=y>b[1]-r&&y<b[3]+r;
            if(inX&&inY){
                boolean nearV=(Math.abs(x-b[0])<10+r||Math.abs(x-b[2])<10+r)&&y>b[1]&&y<b[3];
                boolean nearH=(Math.abs(y-b[1])<10+r||Math.abs(y-b[3])<10+r)&&x>b[0]&&x<b[2];
                if(nearV||nearH){
                    boolean gate=false;
                    for(int i=0;i<rg.gates.length;i+=2)if(Game.dist(x,y,rg.gates[i],rg.gates[i+1])<34+r)gate=true;
                    if(!gate)return true;
                }
            }
        }
        return false;
    }
    public boolean blocked(float x,float y,float r){
        if(terrainBlocked(x,y,r))return true;
        for(Building bd:BUILDINGS)if(bd.blocked(x,y,r))return true;
        return false;
    }

    /* ---------- 区域 / 解锁 ---------- */
    public int regionAt(float x,float y){
        for(Region rg:REGIONS)if(rg.inside(x,y))return rg.id;
        return -1;
    }
    public boolean isDiscovered(int id){return (discovered&(1<<id))!=0;}
    public void discover(Game g,int id){
        if(id<0||isDiscovered(id))return;
        discovered|=1<<id;
        g.announce("发现 · "+REGIONS[id].name);
        g.popup(g.x,g.y-30,"解锁 "+REGIONS[id].name,0xffe8c27a);
    }
    public Npc nearestNpc(float x,float y){
        Npc best=null;float bd=43;
        for(Npc n:NPCS){float d=Game.dist(x,y,n.x,n.y);if(d<bd){bd=d;best=n;}}
        return best;
    }
    public Stele nearestStele(float x,float y){
        Stele best=null;float bd=40;
        for(Stele s:STELES){float d=Game.dist(x,y,s.x,s.y);if(d<bd){bd=d;best=s;}}
        return best;
    }
    public float[] guideTarget(Game g){
        int here=regionAt(g.x,g.y);
        if(here>=0&&!REGIONS[here].settlement()){
            for(Camp c:CAMPS)if(c.region==here&&(clearedCamps&(1<<c.id))==0)return new float[]{c.x,c.y};
            return null;
        }
        Npc n=guideNpc(g);
        return n==null?null:new float[]{n.x,n.y};
    }
    public Npc guideNpc(Game g){
        int here=regionAt(g.x,g.y);
        Npc best=null;float bd=Float.MAX_VALUE;
        for(Npc n:NPCS){
            if(stage[n.region]>=2)continue;
            if(here>=0&&n.region!=here)continue;
            float d=Game.dist(g.x,g.y,n.x,n.y);
            if(d<bd){bd=d;best=n;}
        }
        if(best!=null)return best;
        for(Npc n:NPCS){
            if(stage[n.region]>=2)continue;
            float d=Game.dist(g.x,g.y,n.x,n.y);
            if(d<bd){bd=d;best=n;}
        }
        return best;
    }

    /* ---------- 营地刷怪 ---------- */
    public void tick(Game g,float dt){
        time+=dt;
        int r=regionAt(g.x,g.y);
        if(r!=lastRegion){lastRegion=r;if(r>=0)discover(g,r);}
        for(Camp c:CAMPS){
            if(campCd[c.id]>0){campCd[c.id]-=dt;continue;}
            if(Game.dist(g.x,g.y,c.x,c.y)>420)continue;
            int alive=0;for(Game.Enemy e:g.enemies)if(e.id<0&&e.campId==c.id)alive++;
            if(alive>=4)continue;
            for(int n=0;n<24;n++){
                double ang=g.rand()*Math.PI*2;float rad=30+g.rand()*70;
                float a=c.x+(float)Math.cos(ang)*rad,b=c.y+(float)Math.sin(ang)*rad;
                if(!blocked(a,b,8)){spawnCampEnemy(g,c,a,b);break;}
            }
        }
    }
    private void spawnCampEnemy(Game g,Camp c,float a,float b){
        int type=c.tier>=4?(g.rand()<.4?2:g.rand()<.5?3:1):c.tier>=3?(g.rand()<.25?2:g.rand()<.5?3:1):c.tier==2?(g.rand()<.4?2:g.rand()<.6?1:0):0;
        float hp=(type==2?75:type==3?42:type==1?26:30)*(1+c.tier*.5f);
        Game.Enemy e=new Game.Enemy(type,-1-c.id,a,b,hp);
        e.campId=c.id;e.homeX=c.x;e.homeY=c.y;
        g.enemies.add(e);
    }
    public void onCampKill(Game g,Game.Enemy e){
        if(e.campId<0)return;
        Camp c=CAMPS[e.campId];
        g.gold+=2+c.tier*2;
        campProgress[e.campId]++;
        if(campProgress[e.campId]>=8&&(clearedCamps&(1<<c.id))==0){
            clearedCamps|=1<<c.id;
            g.gold+=20*c.tier;g.announce("营地净化 · "+REGIONS[c.region].name+" 郊外");
        }
    }

    /* ---------- 对话 / 剧情 ---------- */
    public String interaction(Game g){
        Npc n=nearestNpc(g.x,g.y);
        if(n!=null)return "交谈 · "+n.name;
        Stele s=nearestStele(g.x,g.y);
        if(s!=null)return "读碑 · "+s.title;
        return "";
    }
    public void readStele(Game g,Stele s){
        String[] pages=new String[s.pages.length+1];
        System.arraycopy(s.pages,0,pages,0,s.pages.length);
        pages[s.pages.length]=Game.HERO+"|我把这段文字记进了札记。";
        g.story.begin(g,-1,pages,new String[]{"合上拓片"},new int[]{500});
    }
    public void talk(Game g,Npc n){
        int r=n.region;int st=stage[r];
        String[] pages;String[] opts;int[] acts;
        if(st==0){
            pages=new String[]{
                n.name+"|"+welcome(r,n),
                n.name+"|"+quest(r),
                Game.HERO+"|我明白了。这就去把郊外的敌人清一清。"
            };
            opts=new String[]{"接下委托","再逛逛"};acts=new int[]{700+r*10+1,500};
        }else if(st==1){
            int need=6;int done=campKillsForRegion(r);
            if(done>=need){
                pages=new String[]{n.name+"|"+thanks(r),Game.HERO+"|郊外已经安静多了。"};
                opts=new String[]{"交付委托 · 领取奖励","稍后再来"};acts=new int[]{700+r*10+2,500};
            }else{
                pages=new String[]{n.name+"|"+quest(r)+"（"+done+"/"+need+"）",n.name+"|敌人就在城外营地，小心它们的投石手。"};
                opts=new String[]{"我这就去","再准备一下"};acts=new int[]{500,500};
            }
        }else{
            pages=new String[]{n.name+"|"+lore(r,n),Game.HERO+"|这段故事，我记下了。"};
            opts=new String[]{"继续旅程"};acts=new int[]{500};
        }
        g.story.begin(g,n.id,pages,opts,acts);
    }
    private int campKillsForRegion(int r){int s=0;for(Camp c:CAMPS)if(c.region==r)s+=campProgress[c.id];return s;}
    private String welcome(int r,Npc n){
        switch(r){
            case SOUTH:return "康乐园的红墙绿瓦，藏着岭南百年的书声。我是"+n.name+"，守着一院中文系的旧卷。";
            case NORTH:return "北校园依越秀山而建，医科的灯彻夜不熄。我是"+n.name+"，愿你带着一双稳的手离开。";
            case EAST:return "大学城小谷围岛上，格致城的机房与化学楼比邻。我是"+n.name+"，这里的规律都写在电路里。";
            case ZHUHAI:return "唐家湾的海风把天文台的圆顶吹得发亮。我是"+n.name+"，潮声里藏着海洋的学问。";
            case SHENZHEN:return "光明城背靠山湖，材料炉火与生医工程同在。我是"+n.name+"，山湖会记住你的脚步。";
            case MING_CITY:return "应天遗城仍用着大明的年号。我是"+n.name+"，皇族遗脉，守着一座不肯改名的城。";
            case MING_TRIBE:return "山下的朝代换了几轮，山上的火种没灭。我是"+n.name+"，永历遗民，衣冠不改。";
            default:return "你竟走到这里。";
        }
    }
    private String quest(int r){
        switch(r){
            case SOUTH:return "城外面具部落翻乱了岭南的田埂。替我清剿六只，让书声重新安静。";
            case NORTH:return "越秀山麓的面具部落惊扰了药圃。清剿六只，采药人才敢出门。";
            case EAST:return "岛外的面具部落偷拆实验器材。清剿六只，格致城才能安心做实验。";
            case ZHUHAI:return "海岸的面具部落掀翻了渔排。清剿六只，渔家才敢出海。";
            case SHENZHEN:return "山道的面具部落堵了材料运输。清剿六只，炉火才能续上。";
            case MING_CITY:return "沉湖的水鬼与遗宫的傀甲逼近城垣。清剿六只，应天的灯才能续亮。";
            case MING_TRIBE:return "山口的傀甲堵了盐道。清剿六只，遗民的火塘才能添柴。";
            default:return "遗址周围不太平，清剿六只面具部落吧。";
        }
    }
    private String thanks(int r){
        switch(r){
            case SOUTH:return "田埂安静了，书声又起。这份谢礼，是康乐园的心意。";
            case NORTH:return "药圃无恙，医者仁心有了着落。收下这份谢礼。";
            case EAST:return "器材保住了，规律仍在电路里闪光。这是格致城的谢礼。";
            case ZHUHAI:return "渔排出海了，潮声里多了笑声。听涛城谢你。";
            case SHENZHEN:return "山道通了，炉火续上了。光明城记你的情。";
            case MING_CITY:return "城垣无恙。这份谢礼用的是旧库的银子，成色比新朝的好。";
            case MING_TRIBE:return "盐道通了。遗民不多言，火塘边给你留了位置。";
            default:return "遗址安静了些，先民的回响更清晰了。";
        }
    }
    private String lore(int r,Npc n){
        switch(r){
            case SOUTH:return "怀士堂 1917 年落成，红砖绿瓦、双塔高耸。孙中山先生曾在此说：要立志做大事，不可做大官。";
            case NORTH:return "医科红楼的楹联是「医病医身医心，救人救国救世」。柯麟老院长讲「三基三严」，中山医的灯就这样传下来。";
            case EAST:return "超算中心的机器昼夜不熄，化学材料综合楼的炉火映着谷河。规律写在电路里，也写在烧瓶里。";
            case ZHUHAI:return "教学实验大楼全长五百七十一米，是亚洲最长的单体教学楼。天琴计划的圆顶指向南海，要听引力波的声音。";
            case SHENZHEN:return "深圳校区山水相融、红墙绿瓦，新医科新工科在此扎根。材料学院楼与医学院楼隔湖相望。";
            case MING_CITY:return "奉天遗殿的琉璃瓦是当年从沉湖里捞上来的。监国说，瓦在，城就在。";
            case MING_TRIBE:return "土司的吊脚楼朝北开门。问为什么，答：北边是故都的方向。";
            default:return "残垣上的刻痕，比任何书都老。";
        }
    }
    public void action(Game g,int act){
        if(act<700||act>799)return;
        int r=(act-700)/10,step=(act-700)%10;
        if(r>=REGIONS.length)return;
        if(step==1){stage[r]=1;g.announce("已接取 · "+REGIONS[r].name+" 委托");if(AcademyTrial.TRIALS[r]!=null)g.trial.begin(g,r);}
        else if(step==2){
            if(stage[r]==1&&campKillsForRegion(r)>=6){
                stage[r]=2;int reward=40+REGIONS[r].id*15;g.gold+=reward;g.potions=Math.min(5,g.potions+1);
                g.announce("委托完成 · +"+reward+" 金币");
            }
        }
    }
    public String objective(Game g){
        int r=regionAt(g.x,g.y);
        if(r>=0&&!REGIONS[r].settlement()){
            int done=0;for(Camp c:CAMPS)if(c.region==r)done+=campProgress[c.id];
            boolean clean=(clearedCamps&(1<<ruinCamp(r)))!=0;
            String shortName=r==RUIN_MED?"中山医大遗址":r==RUIN_ANCIENT?"上古遗址":r==SUNKEN_MING?"沉沦明土":"明神都遗宫";
            return clean?shortName+" 已净化 · 残垣归于寂静":"清剿"+shortName+"的敌营 "+Math.min(8,done)+"/8";
        }
        String city=r>=0?REGIONS[r].name.split(" · ")[0]:"";
        if(r>=0&&stage[r]==1)return city+"委托 · 清剿敌营 "+Math.min(6,campKillsForRegion(r))+"/6";
        if(r>=0&&stage[r]==0)return "与"+city+"的居民交谈";
        return "自由探索 · 五校区两遗址与沉沦大明";
    }
    private int ruinCamp(int region){for(Camp c:CAMPS)if(c.region==region)return c.id;return 0;}

    /* ---------- 存档 ---------- */
    public void write(DataOutputStream o)throws IOException{
        o.writeBoolean(enabled);o.writeInt(discovered);o.writeInt(clearedCamps);
        o.writeInt(stage.length);for(int s:stage)o.writeInt(s);
        o.writeInt(campCd.length);for(long c:campCd)o.writeLong(c);
        o.writeInt(campProgress.length);for(int c:campProgress)o.writeInt(c);
        o.writeFloat(time);
    }
    public static OpenWorld read(DataInputStream i,int version)throws IOException{
        OpenWorld w=new OpenWorld();
        w.enabled=i.readBoolean();w.discovered=i.readInt();w.clearedCamps=i.readInt();
        if(version>=13){
            int ns=i.readInt();for(int k=0;k<ns;k++){int v=i.readInt();if(k<w.stage.length)w.stage[k]=v;}
            int nc=i.readInt();for(int k=0;k<nc;k++){long v=i.readLong();if(k<w.campCd.length)w.campCd[k]=v;}
            int np=i.readInt();for(int k=0;k<np;k++){int v=i.readInt();if(k<w.campProgress.length)w.campProgress[k]=v;}
        }else{
            for(int k=0;k<7;k++)w.stage[k]=i.readInt();
            for(int k=0;k<12;k++)w.campCd[k]=i.readLong();
            for(int k=0;k<12;k++)w.campProgress[k]=i.readInt();
        }
        w.time=i.readFloat();
        return w;
    }
}