package cn.wuziping.ember;

/** 开放世界像素渲染：地形/城池/遗址/营地/NPC/按键UI，全部 Painter 原语，2x 像素风。
 *  建筑按区域学科特色绘制（岭南红楼/医科红楼/现代工科/海洋天文/明式宫殿）。 */
public final class OpenWorldRenderer {
    private static int hash(int x,int y){int h=x*374761393+y*668265263;h=(h^(h>>>13))*1274126177;return (h^(h>>>16))&0x7fffffff;}

    /* ---------- 地形 ---------- */
    public static void terrain(Painter p,Game g,float camX,float camY,float W,float H,float clock){
        OpenWorld w=g.world;
        p.rect(0,0,W,H,0xff1c3a2c);
        int tw=OpenWorld.W/16;
        int tx0=(int)camX/16,ty0=(int)camY/16;
        for(int ty=ty0;ty<=ty0+H/32+2;ty++)for(int tx=tx0;tx<=tx0+W/32+2;tx++){
            if(tx<0||ty<0||tx>=tw||ty>=OpenWorld.H/16)continue;
            int t=w.tiles[ty*tw+tx];
            float x=(tx*16-camX)*2,y=(ty*16-camY)*2;
            int h=hash(tx,ty);
            int base;
            switch(t){
                case OpenWorld.SAND:base=0xffd8c08a;break;
                case OpenWorld.DEEP:base=0xff173a5e;break;
                case OpenWorld.SHALLOW:base=0xff2a6a8a;break;
                case OpenWorld.LAKE:base=0xff2a5a7a;break;
                case OpenWorld.RIVER:base=0xff2a6a8a;break;
                case OpenWorld.ROCK:base=0xff6a6a72;break;
                case OpenWorld.SNOW:base=0xffdfe6ea;break;
                case OpenWorld.ROAD:base=0xffb09a6a;break;
                case OpenWorld.PLAZA:base=0xffc8b088;break;
                case OpenWorld.FIELD:base=0xff7aa050;break;
                default:base=(h&3)==0?0xff2c5a3a:(h&3)==1?0xff285236:0xff306040;break;
            }
            p.rect(x,y,32,32,base);
            // 草地：草叶 + 花点
            if(t==OpenWorld.GRASS){
                if(h%5==0){p.rect(x+(h%22),y+((h>>3)%22),2,4,0xff3f7a4a);p.rect(x+(h%22)+3,y+((h>>3)%22)+2,2,3,0xff3f7a4a);}
                if(h%23==0)p.rect(x+(h%24),y+((h>>4)%24),3,3,h%2==0?0xffd88a9a:0xffe8c27a);
            }
            if(t==OpenWorld.FIELD){for(int r=0;r<4;r++)p.rect(x+2,y+4+r*8,28,2,0xff5f8a3a);}
            // 水面：波纹 + 岸线泡沫
            if(w.water(t)){
                float wv=(float)Math.sin(clock*1.5+tx*.7+ty*.3);
                if(wv>.3)p.rect(x+6+(h%12),y+10,8,2,0x66bfe0e8);
                if(wv>-.2&&wv<.1)p.rect(x+2+(h%16),y+22,6,2,0x449fd0dc);
                boolean shore=!w.water(w.tileAt(tx*16+8,(ty-1)*16+8))||!w.water(w.tileAt(tx*16+8,(ty+1)*16+8));
                if(shore)p.rect(x,y+(w.water(w.tileAt(tx*16+8,(ty-1)*16+8))?0:28),32,3,0x88e8f0e0);
            }
            // 路面：石板缝 + 车辙
            if(t==OpenWorld.ROAD){
                p.rect(x,y+15,32,1,0x33806a44);p.rect(x+15,y,1,32,0x22806a44);
                if(h%4==0)p.rect(x+(h%20),y+((h>>2)%20),4,2,0xff9a855a);
            }
            if(t==OpenWorld.PLAZA){p.rect(x,y,32,1,0x33ffffff);p.rect(x,y,1,32,0x22000000);p.rect(x+8,y+8,16,16,0x11000000);}
            if(t==OpenWorld.SNOW&&(h%4)==0)p.rect(x+(h%20),y+((h>>2)%20),3,3,0xffffffff);
            if(t==OpenWorld.ROCK&&(h%3)==0)p.rect(x+(h%20),y+((h>>2)%20),6,4,0xff57575f);
            // 植被：榕树/桄榔/凤凰木（康乐园），雪松（山地）
            if(t==OpenWorld.GRASS&&h%17==0)tree(p,x+16,y+16,h);
        }
    }
    private static void tree(Painter p,float x,float y,int h){
        int kind=h%3;
        p.oval(x-10,y-2,20,7,0x55102018);
        if(kind==0){ // 榕树：宽冠气根
            p.rect(x-2,y-16,4,16,0xff5a4632);
            p.oval(x-14,y-30,28,18,0xff2f6a3a);p.oval(x-10,y-34,20,14,0xff3f7a4a);
            p.rect(x-8,y-14,2,8,0xff5a4632);p.rect(x+6,y-14,2,8,0xff5a4632);
        }else if(kind==1){ // 桄榔：直干葵叶
            p.rect(x-2,y-24,4,24,0xff7a8a6a);
            for(int i=0;i<5;i++){double a=-Math.PI/2+(i-2)*.5;p.line(x,y-24,x+(float)Math.cos(a)*12,y-24+(float)Math.sin(a)*8,2,0xff3f7a4a);}
        }else{ // 凤凰木：红果
            p.rect(x-2,y-16,4,16,0xff5a4632);
            p.oval(x-12,y-28,24,16,0xff2f6a3a);
            p.rect(x-6,y-24,3,3,0xffc45c5a);p.rect(x+4,y-20,3,3,0xffc45c5a);
        }
    }

    /* ---------- 建筑 / 城墙 / 遗址 / 营地 / NPC ---------- */
    public static void structures(Painter p,Game g,float camX,float camY,float W,float H,float clock){
        OpenWorld w=g.world;
        for(OpenWorld.Region rg:OpenWorld.REGIONS)if(rg.city){
            int[] b=rg.b;
            for(float x=b[0];x<=b[2];x+=16){wallSeg(p,camX,camY,x,b[1],nearGate(rg,x,b[1]));wallSeg(p,camX,camY,x,b[3],nearGate(rg,x,b[3]));}
            for(float y=b[1];y<=b[3];y+=16){wallSeg(p,camX,camY,b[0],y,nearGate(rg,b[0],y));wallSeg(p,camX,camY,b[2],y,nearGate(rg,b[2],y));}
            for(int i=0;i<rg.gates.length;i+=2)gate(p,camX,camY,rg.gates[i],rg.gates[i+1],clock);
            tag(p,camX,camY,rg.name,rg.x,b[1]-26,0xffe8c27a);
        }
        for(OpenWorld.Building bd:OpenWorld.BUILDINGS)building(p,camX,camY,W,H,bd,clock);
        // 遗址
        ruins(p,camX,camY,W,H,clock,OpenWorld.RUIN_ANCIENT);
        ruins(p,camX,camY,W,H,clock,OpenWorld.RUIN_MED);
        mingCapital(p,camX,camY,W,H,clock);
        sunken(p,camX,camY,W,H,clock);
        tribeVillage(p,camX,camY,W,H,clock);
        // 石碑
        for(OpenWorld.Stele s:OpenWorld.STELES)stele(p,camX,camY,W,H,s,clock);
        // 营地
        for(OpenWorld.Camp c:OpenWorld.CAMPS)camp(p,camX,camY,W,H,w,c,clock);
        // NPC
        for(OpenWorld.Npc n:OpenWorld.NPCS)npc(p,g,camX,camY,W,H,n,clock);
    }
    private static boolean nearGate(OpenWorld.Region rg,float x,float y){
        for(int i=0;i<rg.gates.length;i+=2)if(Game.dist(x,y,rg.gates[i],rg.gates[i+1])<34)return true;
        return false;
    }
    private static void wallSeg(Painter p,float camX,float camY,float x,float y,boolean gate){
        if(gate)return;
        float sx=(x-camX)*2,sy=(y-camY)*2;
        p.rect(sx,sy,30,30,0xff4a5a52);p.rect(sx,sy,30,4,0xff839081);
        p.rect(sx+2,sy+12,26,2,0xff5c7066);p.rect(sx+2,sy+22,26,2,0xff5c7066);
        p.rect(sx+2,sy-4,6,6,0xff5c7066);p.rect(sx+12,sy-4,6,6,0xff5c7066);p.rect(sx+22,sy-4,6,6,0xff5c7066); // 垛口
    }
    private static void gate(Painter p,float camX,float camY,float x,float y,float clock){
        float sx=(x-camX)*2,sy=(y-camY)*2;
        p.rect(sx-26,sy-42,12,46,0xff6a4038);p.rect(sx+14,sy-42,12,46,0xff6a4038);
        p.rect(sx-30,sy-52,60,12,0xff3f7a4a);p.rect(sx-30,sy-52,60,3,0xffe8d8a0);
        p.rect(sx-34,sy-46,6,6,0xffe8c27a);p.rect(sx+28,sy-46,6,6,0xffe8c27a); // 翘角
        // 旗
        float wav=(float)Math.sin(clock*3)*2;
        p.rect(sx-2,sy-70,3,20,0xff5a4632);p.rect(sx+1,sy-70,14,8,0xffc45c5a);p.rect(sx+1,sy-66+wav,14,2,0xffa04442);
    }
    private static void building(Painter p,float camX,float camY,float W,float H,OpenWorld.Building bd,float clock){
        float x=(bd.x-camX)*2,y=(bd.y-camY)*2;
        if(x<-240||x>W+240||y<-240||y>H+240)return;
        float bw=bd.w*2,bh=bd.h*2;
        int region=bd.region;
        // 台基
        p.rect(x-bw/2-6,y-8,bw+12,10,0xff9a948a);p.rect(x-bw/2-6,y-8,bw+12,2,0xffc0bab0);
        // 墙体
        int wall=region==OpenWorld.NORTH?0xffb05a4a:region==OpenWorld.MING_CITY?0xffa05040:region==OpenWorld.MING_TRIBE?0xff8a6a4a:0xff9a5a4a;
        p.rect(x-bw/2,y-bh*.62f,bw,bh*.62f-6,wall);
        // 砖缝
        for(int r=0;r<3;r++)p.rect(x-bw/2,y-bh*.62f+8+r*12,bw,1,0x22000000);
        // 屋顶：岭南/明式 绿琉璃 or 黄琉璃；医科白；海洋蓝；工科灰
        int roof=region==OpenWorld.MING_CITY||region==OpenWorld.MING_RUIN?0xffd8a83a:region==OpenWorld.ZHUHAI?0xff2a6a8a:region==OpenWorld.NORTH?0xffc8c8c0:region==OpenWorld.EAST||region==OpenWorld.SHENZHEN?0xff5a6a72:0xff3f7a4a;
        boolean modern=region==OpenWorld.EAST||region==OpenWorld.SHENZHEN;
        if(modern){
            p.rect(x-bw/2-4,y-bh,bw+8,bh*.4f,roof);
            p.rect(x-bw/2-4,y-bh,bw+8,3,0xffd0d8dc);
            for(int c=0;c<4;c++)p.rect(x-bw/2+6+c*(bw/4),y-bh*.55f,bw/4-8,bh*.3f,0xff9fd8e8); // 玻璃幕
        }else{
            // 中式大屋顶：正脊 + 垂脊 + 瓦垄 + 翘角
            p.rect(x-bw/2-8,y-bh,bw+16,bh*.42f,roof);
            p.rect(x-bw/2-8,y-bh,bw+16,4,0xffe8d8a0);
            for(int c=0;c<6;c++)p.rect(x-bw/2+4+c*(bw/6),y-bh+4,2,bh*.42f-4,0x33000000);
            p.rect(x-bw/2-12,y-bh+2,6,8,roof);p.rect(x+bw/2+6,y-bh+2,6,8,roof); // 翘角
            p.rect(x-bw/2-12,y-bh,5,4,0xffe8c27a);p.rect(x+bw/2+7,y-bh,5,4,0xffe8c27a);
        }
        // 门 + 窗（中式格窗 / 现代玻璃）
        p.rect(x-9,y-bh*.3f,18,bh*.3f-6,0xff4a3228);p.rect(x-9,y-bh*.3f,18,2,0xffe8d8a0);
        if(!modern){
            for(int s=-1;s<=1;s+=2){float wx=x+s*bw*.3f;
                p.rect(wx-7,y-bh*.52f,14,12,0xffe8d8a0);
                p.rect(wx-1,y-bh*.52f,2,12,0xff9a5a4a);p.rect(wx-7,y-bh*.46f,14,2,0xff9a5a4a);}
        }
        // 灯笼（中式）
        if(!modern){float sw=(float)Math.sin(clock*2+bd.x)*1.5f;
            p.rect(x-bw/2+4+sw,y-bh*.5f,5,7,0xffc45c5a);p.rect(x+bw/2-9-sw,y-bh*.5f,5,7,0xffc45c5a);}
        tag(p,camX,camY,bd.name,bd.x,bd.y+6,0xfff2dfb2);
    }
    private static void ruins(Painter p,float camX,float camY,float W,float H,float clock,int id){
        OpenWorld.Region rg=OpenWorld.REGIONS[id];
        float x=(rg.x-camX)*2,y=(rg.y-camY)*2;
        if(x<-300||x>W+300||y<-300||y>H+300)return;
        boolean med=id==OpenWorld.RUIN_MED;
        for(int i=0;i<5;i++){
            float cx=x-80+i*40,cy=y-20+(i%2)*24;int hgt=med?40:56-(i%3)*12;
            p.rect(cx,cy-hgt,12,hgt,med?0xffb8b8b0:0xff8a8a7a);
            p.rect(cx-2,cy-hgt,16,5,med?0xffd0d0c8:0xffa0a090);
            p.rect(cx+2,cy-hgt+6,3,hgt-8,0x33000000);
        }
        p.rect(x-40,y-10,80,16,med?0xff9a9a92:0xff7a7a6a);
        if(med){p.rect(x-30,y-46,60,36,0xffc8c8c0);p.rect(x-30,y-46,60,5,0xff8a5a4a);p.rect(x-8,y-30,16,20,0xff4a3228);}
        else{float gl=(float)Math.sin(clock*2)*.5f+.5f;p.oval(x-14,y-30,28,20,((int)(gl*120)<<24)|0x9fd8cc);}
        tag(p,camX,camY,rg.name,rg.x,rg.y+26,med?0xffc8c8c0:0xff9fd8cc);
    }
    /** 明神都·中都遗宫：凹字午门 + 白玉须弥座 + 蟠龙石础 + 三重城垣 + 琉璃碎。 */
    private static void mingCapital(Painter p,float camX,float camY,float W,float H,float clock){
        OpenWorld.Region rg=OpenWorld.REGIONS[OpenWorld.MING_RUIN];
        float x=(rg.x-camX)*2,y=(rg.y-camY)*2;
        if(x<-500||x>W+500||y<-500||y>H+500)return;
        // 三重城垣（残）
        for(int ring=0;ring<3;ring++){
            float rw=340-ring*90,rh=240-ring*60;
            p.rect(x-rw,y-rh,rw*2,6,0x668a8478);p.rect(x-rw,y+rh,rw*2,6,0x668a8478);
            p.rect(x-rw,y-rh,6,rh*2,0x668a8478);p.rect(x+rw,y-rh,6,rh*2,0x668a8478);
        }
        // 午门（凹字）+ 白玉须弥座
        p.rect(x-140,y-40,280,50,0xff9a4a3a);
        p.rect(x-140,y-40,40,90,0xff9a4a3a);p.rect(x+100,y-40,40,90,0xff9a4a3a); // 两观翼楼
        p.rect(x-146,y+8,292,14,0xffe8e4da); // 须弥座
        for(int i=0;i<14;i++)p.rect(x-140+i*20,y+12,8,6,0xffc8c0b0); // 束腰浮雕
        p.rect(x-146,y+8,292,2,0xffffffff);
        // 门洞
        p.rect(x-20,y-20,40,30,0xff3a2a22);p.rect(x-90,y-10,26,20,0xff3a2a22);p.rect(x+64,y-10,26,20,0xff3a2a22);
        // 蟠龙石础（巨型）
        for(int i=0;i<3;i++){float cx=x-70+i*70,cy=y+70;
            p.rect(cx-16,cy-10,32,14,0xffb0aca0);p.oval(cx-12,cy-16,24,10,0xffc8c4b8);
            p.rect(cx-8,cy-14,4,4,0xff8a8678);p.rect(cx+4,cy-14,4,4,0xff8a8678);}
        // 琉璃瓦碎
        for(int i=0;i<10;i++){int h=hash(i,7);p.rect(x-160+(h%320),y+40+((h>>3)%80),5,4,i%2==0?0xffd8a83a:0xff3f7a4a);}
        tag(p,camX,camY,rg.name,rg.x,rg.y+120,0xffd8a83a);
    }
    /** 沉沦明土：水下城垣 + 残殿 + 水位碑。 */
    private static void sunken(Painter p,float camX,float camY,float W,float H,float clock){
        OpenWorld.Region rg=OpenWorld.REGIONS[OpenWorld.SUNKEN_MING];
        float x=(rg.x-camX)*2,y=(rg.y-camY)*2;
        if(x<-400||x>W+400||y<-400||y>H+400)return;
        // 水下城墙轮廓
        p.rect(x-160,y-60,320,8,0x553a4a52);p.rect(x-160,y+60,320,8,0x553a4a52);
        p.rect(x-160,y-60,8,128,0x553a4a52);p.rect(x+152,y-60,8,128,0x553a4a52);
        // 残殿台基（中心岛）
        p.rect(x-50,y-20,100,26,0xff8a8478);p.rect(x-50,y-20,100,3,0xffb0aca0);
        p.rect(x-30,y-46,14,28,0xff9a948a);p.rect(x+16,y-46,14,28,0xff9a948a);
        float gl=(float)Math.sin(clock*1.2)*.5f+.5f;
        p.oval(x-60,y-10,120,30,((int)(gl*60)<<24)|0x9fd8cc);
        tag(p,camX,camY,rg.name,rg.x,rg.y+90,0xff9fd8cc);
    }
    /** 滇黔遗民部落：吊脚楼 + 梯田 + 祭火塘。 */
    private static void tribeVillage(Painter p,float camX,float camY,float W,float H,float clock){
        OpenWorld.Region rg=OpenWorld.REGIONS[OpenWorld.MING_TRIBE];
        float x=(rg.x-camX)*2,y=(rg.y-camY)*2;
        if(x<-300||x>W+300||y<-300||y>H+300)return;
        // 梯田
        for(int r=0;r<4;r++)p.rect(x-140,y+40+r*14,280,6,0xff5f8a3a);
        // 祭火塘
        float f=(float)Math.sin(clock*7)*2;
        p.oval(x-12,y-6,24,10,0xff5a4632);p.oval(x-6,y-14-f,12,12,0xffe07a45);p.rect(x-2,y-20-f,4,8,0xffffd37a);
        tag(p,camX,camY,rg.name,rg.x,rg.y+110,0xffe8c27a);
    }
    private static void stele(Painter p,float camX,float camY,float W,float H,OpenWorld.Stele s,float clock){
        float x=(s.x-camX)*2,y=(s.y-camY)*2;
        if(x<-80||x>W+80||y<-80||y>H+80)return;
        p.oval(x-10,y-2,20,6,0x55102018);
        p.rect(x-8,y-30,16,30,0xff9a948a);p.rect(x-8,y-30,16,3,0xffc0bab0);
        p.rect(x-5,y-24,10,2,0xff5a564c);p.rect(x-5,y-19,10,2,0xff5a564c);p.rect(x-5,y-14,10,2,0xff5a564c);
        float gl=(float)Math.sin(clock*2+s.x)*.5f+.5f;
        p.oval(x-12,y-36,24,10,((int)(gl*70)<<24)|0xe8c27a);
        tag(p,camX,camY,s.title,s.x,s.y+8,0xffe8c27a);
    }
    private static void camp(Painter p,float camX,float camY,float W,float H,OpenWorld w,OpenWorld.Camp c,float clock){
        float x=(c.x-camX)*2,y=(c.y-camY)*2;
        if(x<-120||x>W+120||y<-120||y>H+120)return;
        boolean cleared=(w.clearedCamps&(1<<c.id))!=0;
        int tent=c.faction==1?0xff3a5a6a:c.faction==2?0xff6a6a72:0xff7a4a3a;
        p.rect(x-20,y-26,40,26,cleared?0xff5a5a52:tent);
        p.rect(x-20,y-26,40,5,cleared?0xff6a6a62:0xff9a5a46);
        p.rect(x-5,y-14,10,14,0xff3a2a22);
        if(!cleared){float f=(float)Math.sin(clock*8+c.id)*2;p.oval(x+26,y-8,10,8,0xffe07a45);p.rect(x+29,y-14-f,4,6,0xffffd37a);}
        p.rect(x-32,y-34,6,34,0xff5a4a3a);p.rect(x-34,y-40,10,8,cleared?0xff6a6a62:c.faction==2?0xffd8a83a:0xffc45c6a);
        String name=c.faction==1?"沉湖水鬼":c.faction==2?"遗宫傀甲":"面具部落";
        tag(p,camX,camY,cleared?"营地 · 已净化":name,c.x,c.y+8,cleared?0xff9fd3b3:0xffe5a29e);
    }
    private static void npc(Painter p,Game g,float camX,float camY,float W,float H,OpenWorld.Npc n,float clock){
        float x=(n.x-camX)*2,y=(n.y-camY)*2;
        if(x<-60||x>W+60||y<-60||y>H+80)return;
        int frame=(int)(clock*2+n.id)%4,slot=n.sprite*4+frame;
        p.oval(x-13,y-5,26,10,0x77102223);
        p.image("npcs.png",slot%8*32,slot/8*32,32,32,x-27,y-47,54,54,1,false);
        // 学科/身份标识色带
        int band=n.region==OpenWorld.NORTH?0xffc8c8c0:n.region==OpenWorld.MING_CITY?0xffd8a83a:n.region==OpenWorld.MING_TRIBE?0xffc45c5a:n.region==OpenWorld.ZHUHAI?0xff2a6a8a:0xff3f7a4a;
        p.rect(x-13,y-48,26,3,band);
        tag(p,camX,camY,n.name+" · "+n.role,n.x,n.y+11,0xfff2dfb2);
        if(Game.dist(g.x,g.y,n.x,n.y)<43)p.oval(x-22,y-6,44,13,0x4468cab7);
        int st=g.world.stage[n.region];
        if(st==0||st==1){float bob=(float)Math.sin(clock*3)*3;p.rect(x-9,y-76+bob,18,21,0xff354b50);p.text(st==0?"!":"?",x,y-59+bob,18,0xffe8c27a,1);}
    }
    private static void tag(Painter p,float camX,float camY,String text,float x,float y,int color){
        float sx=(x-camX)*2,sy=(y-camY)*2;
        float w=text.length()*10+14;
        p.rect(sx-w/2,sy-10,w,17,0xc41b2a30);
        p.rect(sx-w/2,sy-10,w,1,0x33e8c27a);
        p.text(text,sx,sy+2,10,color,1);
    }

    /* ---------- 面具部落 / 水鬼 / 傀甲 ---------- */
    public static void tribesman(Painter p,Game g,Game.Enemy e,float camX,float camY,float clock){
        float x=(e.x-camX)*2,y=(e.y-camY)*2;
        OpenWorld.Camp c=e.campId>=0?OpenWorld.CAMPS[e.campId]:null;
        int faction=c==null?0:c.faction;
        boolean big=e.type==2,shaman=e.type==3;
        float s=big?1.35f:1f;
        float bob=(float)Math.sin(clock*(big?4:6)+e.id)*1.6f;
        int cloth=faction==1?0xff3a6a7a:faction==2?0xff8a8a92:shaman?0xff5c6ea8:big?0xff8a5a3c:0xff7a6a4a;
        int mask=faction==1?0xff9fd8cc:faction==2?0xffd8a83a:shaman?0xffd8cfe8:0xffe0cfa8;
        p.oval(x-14*s,y-5,28*s,10,0x77101a14);
        p.rect(x-8*s,y-12*s,5*s,12*s,0xff4a3a2a);p.rect(x+3*s,y-12*s,5*s,12*s,0xff4a3a2a);
        p.rect(x-11*s,y-30*s+bob,22*s,20*s,cloth);
        p.rect(x-11*s,y-24*s+bob,22*s,2,0x33000000);
        p.rect(x-15*s,y-28*s+bob,5*s,14*s,cloth);p.rect(x+10*s,y-28*s+bob,5*s,14*s,cloth);
        p.rect(x-10*s,y-46*s+bob,20*s,17*s,mask);
        p.rect(x-10*s,y-46*s+bob,20*s,3,0xffb89a68);
        p.rect(x-6*s,y-40*s+bob,4*s,4*s,0xff241a12);p.rect(x+2*s,y-40*s+bob,4*s,4*s,0xff241a12);
        p.rect(x-4*s,y-33*s+bob,8*s,2,0xffa8845c);
        if(faction==2){p.rect(x-12*s,y-50*s+bob,24*s,4,0xffd8a83a);} // 傀甲金冠
        else if(shaman){p.rect(x-2*s,y-56*s+bob,4*s,11*s,0xffc45c6a);p.rect(x-8*s,y-52*s+bob,4*s,8,0xffe8c27a);p.rect(x+4*s,y-52*s+bob,4*s,8,0xffe8c27a);}
        else if(big){p.rect(x-13*s,y-50*s+bob,5*s,6,0xffd8c8a0);p.rect(x+8*s,y-50*s+bob,5*s,6,0xffd8c8a0);}
        if(shaman){p.rect(x+15*s,y-44*s+bob,3*s,34*s,0xff6a5038);p.oval(x+13*s,y-50*s+bob,8*s,8*s,0xff9fd8cc);}
        else if(big){p.rect(x+14*s,y-40*s+bob,3*s,28*s,0xff6a5038);p.rect(x+11*s,y-44*s+bob,12*s,9*s,0xff8a8a92);}
        else{p.rect(x+14*s,y-34*s+bob,3*s,22*s,0xff6a5038);}
        if(e.hit>0){int a=(int)(e.hit/.15f*150);p.oval(x-14*s,y-46*s,28*s,36*s,(a<<24)|0xfff6e2);}
        if(e.hp<e.maxHp){float w=34*s;p.rect(x-w/2-1,y-56*s,w+2,6,0xff132320);p.rect(x-w/2,y-55*s,w*Math.max(0,e.hp/e.maxHp),4,0xffc97b65);}
    }

    /* ---------- 按键 UI：像素倒角 + 分段冷却 ---------- */
    public static void pixelButton(Painter p,float x,float y,float r,int icon,String label,float cd,float max,int accent,boolean ready){
        // 八角倒角底座
        p.rect(x-r+3,y-r+2,r*2-6,r*2,0x66060c10);
        p.rect(x-r+2,y-r,r*2-4,r*2,0xffe6d2a4);
        p.rect(x-r,y-r+2,r*2,r*2-4,0xffe6d2a4);
        p.rect(x-r+3,y-r+3,r*2-6,r*2-6,0xff152028);
        p.rect(x-r+2,y-r+2,r*2-4,2,0x66fff1c8);
        p.rect(x-r+2,y+r-4,r*2-4,2,0x44081412);
        // 内圈色
        p.oval(x-r+6,y-r+6,r*2-12,r*2-12,(0x55<<24)|(accent&0xffffff));
        if(ready){float pulse=2+(float)Math.sin(System.nanoTime()/1e8)*1.4f;p.oval(x-r-pulse,y-r-pulse,(r+pulse)*2,(r+pulse)*2,(0x22<<24)|(accent&0xffffff));}
        // 图标
        p.image("icons.png",icon%8*32,icon/8*32,32,32,x-16,y-18,32,32,1,false);
        // 分段冷却环
        if(!ready&&max>0){
            int ticks=12,lit=(int)(Game.clamp(1-cd/max,0,1)*ticks);
            for(int i=0;i<ticks;i++){double a=-Math.PI/2+i*Math.PI*2/ticks;
                p.rect(x+(float)Math.cos(a)*(r+3)-1.5f,y+(float)Math.sin(a)*(r+3)-1.5f,3,3,i<lit?0xffe8c27a:0x33ffffff);}
            p.oval(x-r+3,y-r+3,r*2-6,r*2-6,0xaa101820);
            p.text(String.format(java.util.Locale.ROOT,"%.1f",cd),x,y+5,16,0xfff6edd8,1);
        }
        p.text(label,x,y+r+16,11,0xfff6edd8,1);
    }

    /* ---------- 小地图 / 大地图 ---------- */
    public static void minimap(Painter p,Game g,float x,float y,float w,float h){
        p.rect(x,y,w,h,0xff12241c);
        float sx=w/OpenWorld.W,sy=h/OpenWorld.H;
        int tw=OpenWorld.W/16;
        for(int ty=0;ty<OpenWorld.H/16;ty+=4)for(int tx=0;tx<tw;tx+=4){
            int t=g.world.tiles[ty*tw+tx];
            int c=g.world.water(t)?0xff2a5a7a:t==OpenWorld.ROCK||t==OpenWorld.SNOW?0xff6a6a72:t==OpenWorld.SAND?0xffd8c08a:0xff2c5a3a;
            p.rect(x+tx*16*sx,y+ty*16*sy,4*16*sx+1,4*16*sy+1,c);
        }
        for(OpenWorld.Region rg:OpenWorld.REGIONS){
            int c=g.world.isDiscovered(rg.id)?(rg.settlement()?0xffe8c27a:0xff9fd8cc):0x66888888;
            p.rect(x+rg.x*sx-2,y+rg.y*sy-2,4,4,c);
        }
        for(Game.Enemy e:g.enemies)p.rect(x+e.x*sx-1,y+e.y*sy-1,2,2,0xffb37964);
        p.rect(x+g.x*sx-2,y+g.y*sy-2,4,4,0xffb1ead3);
    }
    public static void bigMap(Painter p,Game g,float W,float H,float clock){
        p.rect(0,0,W,H,0xf00a1418);
        float top=64,bottom=42,availH=Math.max(120,H-top-bottom);
        float mw=Math.min(W-120,availH*OpenWorld.W/OpenWorld.H),mh=mw*OpenWorld.H/OpenWorld.W;
        float mx=(W-mw)/2,my=top+(availH-mh)/2;
        p.rect(mx-4,my-4,mw+8,mh+8,0xffe6d2a2);p.rect(mx-2,my-2,mw+4,mh+4,0xff6a4038);
        float sx=mw/OpenWorld.W,sy=mh/OpenWorld.H;
        int tw=OpenWorld.W/16;
        for(int ty=0;ty<OpenWorld.H/16;ty+=2)for(int tx=0;tx<tw;tx+=2){
            int t=g.world.tiles[ty*tw+tx];
            int c;
            switch(t){
                case OpenWorld.DEEP:c=0xff173a5e;break;case OpenWorld.SHALLOW:case OpenWorld.RIVER:c=0xff2a6a8a;break;
                case OpenWorld.LAKE:c=0xff2a5a7a;break;case OpenWorld.SAND:c=0xffd8c08a;break;
                case OpenWorld.ROCK:c=0xff6a6a72;break;case OpenWorld.SNOW:c=0xffdfe6ea;break;
                case OpenWorld.ROAD:case OpenWorld.PLAZA:c=0xffb09a6a;break;case OpenWorld.FIELD:c=0xff7aa050;break;
                default:c=0xff2c5a3a;break;
            }
            p.rect(mx+tx*16*sx,my+ty*16*sy,2*16*sx+1,2*16*sy+1,c);
        }
        for(OpenWorld.Road r:OpenWorld.ROADS)p.line(mx+r.ax*sx,my+r.ay*sy,mx+r.bx*sx,my+r.by*sy,2,0xffe8d8a0);
        for(OpenWorld.Region rg:OpenWorld.REGIONS){
            boolean disc=g.world.isDiscovered(rg.id);
            float x=mx+rg.x*sx,y=my+rg.y*sy;
            int c=disc?(rg.settlement()?0xffe8c27a:0xff9fd8cc):0xff888888;
            p.rect(x-4,y-4,8,8,c);
            p.text(disc?rg.name:"？？？",x,y-10,11,disc?0xfff6edd8:0xff888888,1);
        }
        for(OpenWorld.Camp c:OpenWorld.CAMPS){
            boolean cleared=(g.world.clearedCamps&(1<<c.id))!=0;
            p.rect(mx+c.x*sx-2,my+c.y*sy-2,4,4,cleared?0xff9fd3b3:0xffc45c6a);
        }
        p.oval(mx+g.x*sx-4,my+g.y*sy-4,8,8,0xffb1ead3);
        p.text("大陆全图 · 五校区两遗址 · 沉沦大明",W/2,34,18,0xffe8c27a,1);
        p.text("金 城邦/校区  青 遗址  红 敌营  绿 已净化  浅绿 你",W/2,52,11,0xffa9bbb6,1);
        p.text("点击任意处或按返回键回到旅程 · 已发现 "+Integer.bitCount(g.world.discovered)+" / 11",W/2,H-18,11,0xffa9bbb6,1);
    }
}