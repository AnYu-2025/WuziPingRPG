package cn.wuziping.ember;

/** 开放世界像素渲染：地形/城池/遗址/营地/NPC，全部 Painter 原语，2x 像素风。 */
public final class OpenWorldRenderer {
    private static int hash(int x,int y){int h=x*374761393+y*668265263;h=(h^(h>>>13))*1274126177;return (h^(h>>>16))&0x7fffffff;}

    public static void terrain(Painter p,Game g,float camX,float camY,float W,float H,float clock){
        OpenWorld w=g.world;
        p.rect(0,0,W,H,0xff1c3a2c);
        int tx0=(int)camX/16,ty0=(int)camY/16;
        for(int ty=ty0;ty<=ty0+H/32+2;ty++)for(int tx=tx0;tx<=tx0+W/32+2;tx++){
            if(tx<0||ty<0||tx>=OpenWorld.W/16||ty>=OpenWorld.H/16)continue;
            int t=w.tiles[ty*(OpenWorld.W/16)+tx];
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
            // 像素细节
            if(t==OpenWorld.GRASS&&(h%7)==0)p.rect(x+(h%24),y+((h>>3)%24),3,3,0xff3f7a4a);
            if(t==OpenWorld.FIELD){for(int r=0;r<4;r++)p.rect(x+2,y+4+r*8,28,2,0xff5f8a3a);}
            if(t==OpenWorld.DEEP||t==OpenWorld.SHALLOW||t==OpenWorld.LAKE||t==OpenWorld.RIVER){
                float wv=(float)Math.sin(clock*1.5+tx*.7+ty*.3);
                if(wv>.4)p.rect(x+6+((h%12)),y+10,8,2,0x66bfe0e8);
            }
            if(t==OpenWorld.ROAD&&(h%5)==0)p.rect(x+(h%20),y+((h>>2)%20),3,2,0xff9a855a);
            if(t==OpenWorld.PLAZA){p.rect(x,y,32,1,0x33ffffff);p.rect(x,y,1,32,0x22000000);}
            if(t==OpenWorld.SNOW&&(h%4)==0)p.rect(x+(h%20),y+((h>>2)%20),3,3,0xffffffff);
            if(t==OpenWorld.ROCK&&(h%4)==0)p.rect(x+(h%20),y+((h>>2)%20),5,4,0xff57575f);
        }
    }

    public static void structures(Painter p,Game g,float camX,float camY,float W,float H,float clock){
        OpenWorld w=g.world;
        // 城墙
        for(OpenWorld.Region rg:OpenWorld.REGIONS)if(rg.city){
            int[] b=rg.b;
            for(float x=b[0];x<=b[2];x+=16){wallSeg(p,camX,camY,x,b[1],nearGate(rg,x,b[1]));wallSeg(p,camX,camY,x,b[3],nearGate(rg,x,b[3]));}
            for(float y=b[1];y<=b[3];y+=16){wallSeg(p,camX,camY,b[0],y,nearGate(rg,b[0],y));wallSeg(p,camX,camY,b[2],y,nearGate(rg,b[2],y));}
            // 城门楼
            for(int i=0;i<rg.gates.length;i+=2)gate(p,camX,camY,rg.gates[i],rg.gates[i+1]);
            tag(p,camX,camY,rg.name+" · "+OpenWorld.CITY_TAGS[rg.id],rg.x,b[1]-24,0xffe8c27a);
        }
        // 建筑
        for(OpenWorld.Building bd:OpenWorld.BUILDINGS){
            float x=(bd.x-camX)*2,y=(bd.y-camY)*2;
            if(x<-200||x>W+200||y<-200||y>H+200)continue;
            float bw=bd.w*2,bh=bd.h*2;
            // 墙体
            p.rect(x-bw/2,y-bh*.6f,bw,bh*.6f,0xff8a5a4a);
            p.rect(x-bw/2,y-bh*.6f,bw,4,0xffa06a56);
            // 屋顶（岭南红墙绿瓦 / 医科白 / 海洋蓝）
            int roof=bd.region==OpenWorld.ZHUHAI?0xff2a6a8a:bd.region==OpenWorld.NORTH?0xffc8c8c0:0xff3f7a4a;
            p.rect(x-bw/2-6,y-bh,bw+12,bh*.42f,roof);
            p.rect(x-bw/2-6,y-bh,bw+12,4,0xffe8d8a0);
            // 门与窗
            p.rect(x-8,y-bh*.28f,16,bh*.28f,0xff4a3228);
            p.rect(x-bw*.3f,y-bh*.5f,10,10,0xffe8d8a0);p.rect(x+bw*.3f-10,y-bh*.5f,10,10,0xffe8d8a0);
            tag(p,camX,camY,bd.name,bd.x,bd.y+6,0xfff2dfb2);
        }
        // 遗址
        ruins(p,g,camX,camY,W,H,clock,OpenWorld.RUIN_ANCIENT);
        ruins(p,g,camX,camY,W,H,clock,OpenWorld.RUIN_MED);
        // 营地
        for(OpenWorld.Camp c:OpenWorld.CAMPS){
            float x=(c.x-camX)*2,y=(c.y-camY)*2;
            if(x<-120||x>W+120||y<-120||y>H+120)continue;
            boolean cleared=(w.clearedCamps&(1<<c.id))!=0;
            // 帐篷
            p.rect(x-20,y-26,40,26,cleared?0xff5a5a52:0xff7a4a3a);
            p.rect(x-20,y-26,40,5,cleared?0xff6a6a62:0xff9a5a46);
            p.rect(x-5,y-14,10,14,0xff3a2a22);
            // 篝火
            if(!cleared){float f=(float)Math.sin(clock*8+c.id)*2;p.oval(x+26,y-8,10,8,0xffe07a45);p.rect(x+29,y-14-f,4,6,0xffffd37a);}
            // 图腾
            p.rect(x-32,y-34,6,34,0xff5a4a3a);p.rect(x-34,y-40,10,8,cleared?0xff6a6a62:0xffc45c6a);
            tag(p,camX,camY,cleared?"营地 · 已净化":"面具部落",c.x,c.y+8,cleared?0xff9fd3b3:0xffe5a29e);
        }
        // NPC
        for(OpenWorld.Npc n:OpenWorld.NPCS){
            float x=(n.x-camX)*2,y=(n.y-camY)*2;
            if(x<-60||x>W+60||y<-60||y>H+80)continue;
            int frame=(int)(clock*2+n.id)%4,slot=n.sprite*4+frame;
            p.oval(x-13,y-5,26,10,0x77102223);
            p.image("npcs.png",slot%8*32,slot/8*32,32,32,x-27,y-47,54,54,1,false);
            tag(p,camX,camY,n.name+" · "+n.role,n.x,n.y+11,0xfff2dfb2);
            boolean close=Game.dist(g.x,g.y,n.x,n.y)<43;
            if(close){p.oval(x-22,y-6,44,13,0x4468cab7);}
            int st=w.stage[n.region];
            if(st==0){float bob=(float)Math.sin(clock*3)*3;p.rect(x-9,y-76+bob,18,21,0xff354b50);p.text("!",x,y-59+bob,18,0xffe8c27a,1);}
            else if(st==1){float bob=(float)Math.sin(clock*3)*3;p.rect(x-9,y-76+bob,18,21,0xff354b50);p.text("?",x,y-59+bob,18,0xffe8c27a,1);}
        }
    }
    private static boolean nearGate(OpenWorld.Region rg,float x,float y){
        for(int i=0;i<rg.gates.length;i+=2)if(Game.dist(x,y,rg.gates[i],rg.gates[i+1])<34)return true;
        return false;
    }
    private static void wallSeg(Painter p,float camX,float camY,float x,float y,boolean gate){
        if(gate)return;
        float sx=(x-camX)*2,sy=(y-camY)*2;
        p.rect(sx,sy,30,30,0xff3e5452);p.rect(sx,sy,30,5,0xff839081);p.rect(sx+3,sy+10,24,2,0xff5c7066);
    }
    private static void gate(Painter p,float camX,float camY,float x,float y){
        float sx=(x-camX)*2,sy=(y-camY)*2;
        p.rect(sx-24,sy-40,10,44,0xff6a4038);p.rect(sx+14,sy-40,10,44,0xff6a4038);
        p.rect(sx-28,sy-48,56,10,0xff3f7a4a);p.rect(sx-28,sy-48,56,3,0xffe8d8a0);
    }
    private static void ruins(Painter p,Game g,float camX,float camY,float W,float H,float clock,int id){
        OpenWorld.Region rg=OpenWorld.REGIONS[id];
        float x=(rg.x-camX)*2,y=(rg.y-camY)*2;
        if(x<-300||x>W+300||y<-300||y>H+300)return;
        boolean med=id==OpenWorld.RUIN_MED;
        // 断柱
        for(int i=0;i<5;i++){
            float cx=x-80+i*40,cy=y-20+(i%2)*24;
            int hgt=med?40:56-(i%3)*12;
            p.rect(cx,cy-hgt,12,hgt,med?0xffb8b8b0:0xff8a8a7a);
            p.rect(cx-2,cy-hgt,16,5,med?0xffd0d0c8:0xffa0a090);
        }
        // 祭坛 / 旧楼基
        p.rect(x-40,y-10,80,16,med?0xff9a9a92:0xff7a7a6a);
        if(med){p.rect(x-30,y-46,60,36,0xffc8c8c0);p.rect(x-30,y-46,60,5,0xff8a5a4a);p.rect(x-8,y-30,16,20,0xff4a3228);}
        else{float gl=(float)Math.sin(clock*2)*.5f+.5f;p.oval(x-14,y-30,28,20,((int)(gl*120)<<24)|0x9fd8cc);}
        tag(p,camX,camY,rg.name,rg.x,rg.y+26,med?0xffc8c8c0:0xff9fd8cc);
    }
    /** 面具部落：戴木质面具的小怪，按兵种换配色与持械，不复用森林史莱姆贴图。 */
    public static void tribesman(Painter p,Game g,Game.Enemy e,float camX,float camY,float clock){
        float x=(e.x-camX)*2,y=(e.y-camY)*2;
        boolean big=e.type==2,shaman=e.type==3;
        float s=big?1.35f:1f;
        float bob=(float)Math.sin(clock*(big?4:6)+e.id)*1.6f;
        int cloth=shaman?0xff5c6ea8:big?0xff8a5a3c:0xff7a6a4a;
        int mask=shaman?0xffd8cfe8:0xffe0cfa8;
        p.oval(x-14*s,y-5,28*s,10,0x77101a14);
        // 腿
        p.rect(x-8*s,y-12*s,5*s,12*s,0xff4a3a2a);p.rect(x+3*s,y-12*s,5*s,12*s,0xff4a3a2a);
        // 躯干（草编护甲）
        p.rect(x-11*s,y-30*s+bob,22*s,20*s,cloth);
        p.rect(x-11*s,y-24*s+bob,22*s,2,0x33000000);
        // 手臂
        p.rect(x-15*s,y-28*s+bob,5*s,14*s,cloth);p.rect(x+10*s,y-28*s+bob,5*s,14*s,cloth);
        // 木面具
        p.rect(x-10*s,y-46*s+bob,20*s,17*s,mask);
        p.rect(x-10*s,y-46*s+bob,20*s,3,0xffb89a68);
        // 面具眼孔与刻纹
        p.rect(x-6*s,y-40*s+bob,4*s,4*s,0xff241a12);p.rect(x+2*s,y-40*s+bob,4*s,4*s,0xff241a12);
        p.rect(x-4*s,y-33*s+bob,8*s,2,0xffa8845c);
        // 头饰：萨满羽冠 / 巨汉角
        if(shaman){p.rect(x-2*s,y-56*s+bob,4*s,11*s,0xffc45c6a);p.rect(x-8*s,y-52*s+bob,4*s,8,0xffe8c27a);p.rect(x+4*s,y-52*s+bob,4*s,8,0xffe8c27a);}
        else if(big){p.rect(x-13*s,y-50*s+bob,5*s,6,0xffd8c8a0);p.rect(x+8*s,y-50*s+bob,5*s,6,0xffd8c8a0);}
        // 持械：萨满法杖 / 巨汉石斧 / 普通木棒
        if(shaman){p.rect(x+15*s,y-44*s+bob,3*s,34*s,0xff6a5038);p.oval(x+13*s,y-50*s+bob,8*s,8*s,0xff9fd8cc);}
        else if(big){p.rect(x+14*s,y-40*s+bob,3*s,28*s,0xff6a5038);p.rect(x+11*s,y-44*s+bob,12*s,9*s,0xff8a8a92);}
        else{p.rect(x+14*s,y-34*s+bob,3*s,22*s,0xff6a5038);}
        if(e.hit>0){int a=(int)(e.hit/.15f*150);p.oval(x-14*s,y-46*s,28*s,36*s,(a<<24)|0xfff6e2);}
        if(e.hp<e.maxHp){float w=34*s;p.rect(x-w/2-1,y-56*s,w+2,6,0xff132320);p.rect(x-w/2,y-55*s,w*Math.max(0,e.hp/e.maxHp),4,0xffc97b65);}
    }
    private static void tag(Painter p,float camX,float camY,String text,float x,float y,int color){
        float sx=(x-camX)*2,sy=(y-camY)*2;
        float w=text.length()*10+14;
        p.rect(sx-w/2,sy-10,w,17,0xc41b2a30);
        p.text(text,sx,sy+2,10,color,1);
    }

    /** HUD 小地图：缩略大陆 + 城池/遗址/玩家/敌人。 */
    public static void minimap(Painter p,Game g,float x,float y,float w,float h){
        p.rect(x,y,w,h,0xff12241c);
        float sx=w/OpenWorld.W,sy=h/OpenWorld.H;
        // 粗略水陆
        for(int ty=0;ty<OpenWorld.H/16;ty+=4)for(int tx=0;tx<OpenWorld.W/16;tx+=4){
            int t=g.world.tiles[ty*(OpenWorld.W/16)+tx];
            int c=t==OpenWorld.DEEP||t==OpenWorld.LAKE||t==OpenWorld.RIVER||t==OpenWorld.SHALLOW?0xff2a5a7a:t==OpenWorld.ROCK||t==OpenWorld.SNOW?0xff6a6a72:t==OpenWorld.SAND?0xffd8c08a:0xff2c5a3a;
            p.rect(x+tx*16*sx,y+ty*16*sy,4*16*sx+1,4*16*sy+1,c);
        }
        for(OpenWorld.Region rg:OpenWorld.REGIONS){
            int c=g.world.isDiscovered(rg.id)?(rg.city?0xffe8c27a:0xff9fd8cc):0x66888888;
            p.rect(x+rg.x*sx-2,y+rg.y*sy-2,4,4,c);
        }
        for(Game.Enemy e:g.enemies)p.rect(x+e.x*sx-1,y+e.y*sy-1,2,2,0xffb37964);
        p.rect(x+g.x*sx-2,y+g.y*sy-2,4,4,0xffb1ead3);
    }

    /** 大地图全屏：五校区 + 遗址 + 营地 + 道路，标注发现状态。 */
    public static void bigMap(Painter p,Game g,float W,float H,float clock){
        p.rect(0,0,W,H,0xf00a1418);
        // 顶部留标题、底部留提示，按可用高度反算宽度，避免地图顶出屏幕。
        float top=64,bottom=42,availH=Math.max(120,H-top-bottom);
        float mw=Math.min(W-120,availH*OpenWorld.W/OpenWorld.H),mh=mw*OpenWorld.H/OpenWorld.W;
        float mx=(W-mw)/2,my=top+(availH-mh)/2;
        p.rect(mx-4,my-4,mw+8,mh+8,0xffe6d2a2);p.rect(mx-2,my-2,mw+4,mh+4,0xff6a4038);
        float sx=mw/OpenWorld.W,sy=mh/OpenWorld.H;
        for(int ty=0;ty<OpenWorld.H/16;ty+=2)for(int tx=0;tx<OpenWorld.W/16;tx+=2){
            int t=g.world.tiles[ty*(OpenWorld.W/16)+tx];
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
        // 道路
        for(OpenWorld.Road r:OpenWorld.ROADS)p.line(mx+r.ax*sx,my+r.ay*sy,mx+r.bx*sx,my+r.by*sy,2,0xffe8d8a0);
        // 城池/遗址
        for(OpenWorld.Region rg:OpenWorld.REGIONS){
            boolean disc=g.world.isDiscovered(rg.id);
            float x=mx+rg.x*sx,y=my+rg.y*sy;
            int c=disc?(rg.city?0xffe8c27a:0xff9fd8cc):0xff888888;
            p.rect(x-4,y-4,8,8,c);
            p.text(disc?rg.name:"？？？",x,y-10,11,disc?0xfff6edd8:0xff888888,1);
            if(rg.city&&disc)p.text(OpenWorld.CITY_TAGS[rg.id],x,y+16,9,0xffa9bbb6,1);
        }
        // 营地
        for(OpenWorld.Camp c:OpenWorld.CAMPS){
            boolean cleared=(g.world.clearedCamps&(1<<c.id))!=0;
            p.rect(mx+c.x*sx-2,my+c.y*sy-2,4,4,cleared?0xff9fd3b3:0xffc45c6a);
        }
        // 玩家
        float px=mx+g.x*sx,py=my+g.y*sy;
        p.oval(px-4,py-4,8,8,0xffb1ead3);
        p.text("大陆全图 · 中山大学五校区两遗址",W/2,34,18,0xffe8c27a,1);
        p.text("金 校区   青 遗址   红面具部落营地   绿 已净化   浅绿 你的位置",W/2,52,11,0xffa9bbb6,1);
        p.text("点击任意处或按返回键回到旅程 · 已发现 "+Integer.bitCount(g.world.discovered)+" / 7",W/2,H-18,11,0xffa9bbb6,1);
    }
}