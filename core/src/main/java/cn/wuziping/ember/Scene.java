package cn.wuziping.ember;

import java.util.*;

/** Pixel world at 2x; UI in a 960x540 virtual landscape viewport. */
public final class Scene {
    public static final int W=960,H=540;
    public static final int CREAM=0xfff2e7cc,GOLD=0xffe9c481,MUTED=0xffacbdb8,INK=0xff121e2a,PANEL=0xf51b2c36;
    public float clock=0,camX=0,camY=0,joyX=0,joyY=0;
    private Painter p;private Game g;
    public void draw(Painter painter,Game game,float seconds){
        p=painter;g=game;clock=seconds;
        boolean town=g.inTown()||((g.mode==Game.TITLE||g.mode==8)&&!g.activeRun);
        float cx=town&&!g.inTown()?480:g.x,cy=town&&!g.inTown()?416:g.y;
        camX=Game.clamp(cx-240,0,(town?Town.WIDTH:Game.WORLD_W)-480);camY=Game.clamp(cy-135,0,(town?Town.HEIGHT:Game.WORLD_H)-270);
        if(town)townWorld();else world();
        if(g.mode==Game.TITLE){title();return;}
        if(g.mode==8){title();confirmNew();return;}
        if(g.mode==Game.HELP){help();return;}
        if(g.mode==Game.JOURNAL){journal();return;}
        if(g.mode==BodyJourney.MAP){bodyMap();return;}
        hud();controls();
        if(g.mode==Game.DIALOGUE){dialogue();return;}
        if(g.mode==Game.PAUSE)pause();else if(g.mode==Game.UPGRADE)upgrade();else if(g.mode==Game.DEAD||g.mode==Game.VICTORY)result();
    }
    private float sx(float x){return (x-camX)*2;}private float sy(float y){return (y-camY)*2;}
    private void world(){
        if(g.inBody())BodyRenderer.terrain(p,g,camX,camY,clock);
        else{
        p.rect(0,0,W,H,0xff193a2e);
        int tx=(int)camX/16,ty=(int)camY/16;
        for(int y=ty;y<=ty+18;y++)for(int x=tx;x<=tx+30;x++){
            int hash=(x*173+y*317)^((x*y)*13);boolean path=Math.abs(x*16-640)<23||Math.abs(y*16-480)<14||Game.dist(x*16,y*16,640,510)<48;
            int tile=(hash&31)+(path?32:0);
            p.image("tiles.png",tile%16*16,tile/16*16,16,16,sx(x*16),sy(y*16),32,32,1,false);
        }
        // Small details use a coordinate hash rather than per-frame randomness.
        for(int y=ty/3*3;y<ty+20;y+=3)for(int x=tx/3*3;x<tx+34;x+=3){
            int hash=Math.abs((x*341+y*83)^(x*y*17));if(hash%7==0)obj(8+hash%2,x*16+7,y*16+7,32,32);
        }
        obj(5,640,445,64,64);obj(4,640,513,44,44);obj(6,690,508,32,32);obj(11,602,499,40,40);obj(7,663,460,36,36);
        if(g.story.enabled){obj(5,Town.FOREST_GATE_X,Town.FOREST_GATE_Y,39,39);worldTag("中山大学入口",Town.FOREST_GATE_X,Town.FOREST_GATE_Y+6,0xffecd49c);}
        p.oval(sx(640)-45,sy(501)-40,90,75,0x10f6b755);
        }
        ArrayList<DrawItem> items=new ArrayList<>();
        if(!g.inBody())for(Game.Obstacle o:g.obstacles)if(o.x>camX-40&&o.x<camX+520&&o.y>camY-20&&o.y<camY+320)items.add(new DrawItem(o.y,o));
        for(Game.Enemy e:g.enemies)items.add(new DrawItem(e.y,e));items.add(new DrawItem(g.y,g));
        for(Game.Drop d:g.drops){int id=d.type==0?8:d.type==1?9:10;float bounce=(float)Math.sin(clock*4+d.x)*1.3f;icon(id,sx(d.x)-9,sy(d.y)-12+bounce,18);}
        Collections.sort(items,new Comparator<DrawItem>(){public int compare(DrawItem a,DrawItem b){return Float.compare(a.y,b.y);}});
        for(DrawItem item:items){
            if(item.object instanceof Game.Obstacle){Game.Obstacle o=(Game.Obstacle)item.object;int idx=o.kind==0?((int)o.x%3):3;
                float opacity=Game.dist(g.x,g.y,o.x,o.y-16)<27?.38f:1;
                object(idx,o.x,o.y,idx==3?38:55,idx==3?38:55,opacity);
            }else if(item.object instanceof Game.Enemy)enemy((Game.Enemy)item.object);else hero();
        }
        for(Game.Shot s:g.shots){p.oval(sx(s.x)-7,sy(s.y)-7,14,14,0x344c94a2);p.rect(sx(s.x)-3,sy(s.y)-3,6,6,0xffdab3dc);p.rect(sx(s.x)-1,sy(s.y)-2,3,3,0xffffe8c0);}
        if(g.skillFlash>0){
            float r=(1-g.skillFlash/.48f)*(68+g.upgrades[4]*9)*2;
            for(int j=0;j<48;j++){double a=j*Math.PI/24;float xx=sx(g.x)+(float)Math.cos(a)*r,yy=sy(g.y)-14+(float)Math.sin(a)*r*.7f;p.rect(xx,yy,5,5,0xfff2c77c);}
        }
        if(g.swing>0){for(int j=0;j<17;j++){double a=g.facing-1.1+j*.13;float rr=45+(1-g.swing/.2f)*24;
            p.rect(sx(g.x)+(float)Math.cos(a)*rr-2,sy(g.y)-15+(float)Math.sin(a)*rr-2,5,5,j%3==0?0xfffff5ca:0xffe0bb72);}}
        for(Game.Effect e:g.effects){p.text(e.text,sx(e.x),sy(e.y),16,e.color,1);}
        if(g.inBody())BodyRenderer.supplies(p,g,camX,camY,clock);
        for(int i=0;i<17;i++){
            float xx=(float)((i*71+Math.sin(clock*.25+i)*22)%W),yy=(float)((i*47+clock*(i%2==0?2:-2)+H*10)%H);
            p.rect(xx,yy,i%3==0?3:2,i%3==0?3:2,0x667cae78);
        }
        // Cinematic edge shading, without blurring any pixel art.
        p.rect(0,0,W,6,0x44101f20);p.rect(0,H-6,W,6,0x44101f20);
        p.rect(0,0,5,H,0x33101f20);p.rect(W-5,0,5,H,0x33101f20);
    }
    private static final class TownProp{int id;float x,y,size;TownProp(int i,float a,float b,float s){id=i;x=a;y=b;size=s;}}
    private void townWorld(){
        p.rect(0,0,W,H,0xff2c443d);int tx=(int)camX/16,ty=(int)camY/16;
        for(int yy=ty;yy<ty+19;yy++)for(int xx=tx;xx<tx+32;xx++){
            int wx=xx*16,wy=yy*16;boolean street=Math.abs(wx-480)<39||Math.abs(wy-432)<31||Game.dist(wx,wy,480,408)<108;
            boolean lane=(wy>250&&wy<318)||(wy>492&&wy<535)||(wy>620&&wy<658);
            int index=((xx*173+yy*71)&15)+(street?16:lane?32:0);
            p.image("town_tiles.png",index%16*16,index/16*16,16,16,sx(wx),sy(wy),32,32,1,false);
        }
        // Low boundary wall, brick joints and a traversable northern gate.
        for(int xx=64;xx<=888;xx+=16){if(xx<422||xx>534)wall(xx,78);wall(xx,678);}
        for(int yy=94;yy<680;yy+=16){wall(58,yy);wall(895,yy);}
        p.rect(sx(390),sy(343),360,2,0x556d8270);p.rect(sx(390),sy(479),360,2,0x556d8270);
        ArrayList<DrawItem> items=new ArrayList<>();
        for(Town.House h:Town.HOUSES)items.add(new DrawItem(h.y,h));
        for(Town.Npc n:Town.NPCS)items.add(new DrawItem(n.y,n));
        TownProp[] props={new TownProp(0,387,344,40),new TownProp(0,576,344,40),new TownProp(0,386,481,40),new TownProp(0,578,481,40),new TownProp(1,374,407,37),new TownProp(1,588,407,37),new TownProp(2,366,581,49),new TownProp(2,601,582,49),new TownProp(3,410,330,31),new TownProp(3,553,330,31),new TownProp(3,402,490,31),new TownProp(3,559,490,31),new TownProp(4,145,356,62),new TownProp(4,806,358,62),new TownProp(4,155,568,60),new TownProp(4,815,568,60),new TownProp(5,615,619,42),new TownProp(6,344,319,38),new TownProp(7,395,273,35)};
        for(TownProp prop:props)items.add(new DrawItem(prop.y,prop));
        items.add(new DrawItem(408,"fountain"));items.add(new DrawItem(121,"gate"));
        if(g.inTown())items.add(new DrawItem(g.y,g));
        items.add(new DrawItem(g.guest.y,g.guest));
        Collections.sort(items,new Comparator<DrawItem>(){public int compare(DrawItem a,DrawItem b){return Float.compare(a.y,b.y);}});
        for(DrawItem item:items){
            if(item.object instanceof Town.House){
                Town.House h=(Town.House)item.object;if(h.x+h.w/2<camX||h.x-h.w/2>camX+480||h.y<camY||h.y-h.h>camY+270)continue;
                float alpha=g.inTown()&&Math.abs(g.x-h.x)<h.w*.45f&&g.y<h.y-10&&g.y>h.y-h.h?.55f:1;
                townAsset(h.sprite,h.x,h.y,h.w,h.h,alpha);worldTag(h.name,h.x,h.y+4,0xffe2c997);
            }else if(item.object instanceof Town.Npc)npc((Town.Npc)item.object);
            else if(item.object instanceof TownGuest)guest();
            else if(item.object instanceof TownProp){TownProp q=(TownProp)item.object;
                if(q.id==0)p.oval(sx(q.x)-34,sy(q.y)-72,68,88,0x14ffd997);
                p.image("town_props.png",q.id*64,0,64,64,sx(q.x)-q.size,sy(q.y)-q.size*1.82f,q.size*2,q.size*2,1,false);
            }else if(item.object instanceof Game)hero();
            else if(item.object.equals("fountain")){townAsset(7,480,428,90,90,1);for(int j=0;j<6;j++){float yy=360+(clock*12+j*7)%33;p.rect(sx(480)+(j%2==0?-8:8),sy(yy),2,4,0xaaa7e6d4);}}
            else townAsset(6,480,130,148,114,1);
        }
        worldTag(g.body.enabled?"北门 · 血管入口":"北门 · 迷雾森林",480,140,GOLD);
        if(g.body.enabled){float xx=sx(480),yy=sy(112);for(int i=0;i<8;i++)p.rect(xx-34+i*10,yy-17+(float)Math.sin(clock*3+i)*4,4,4,0xffe4a4a5);}
        for(int j=0;j<14;j++){float xx=(j*79+(float)Math.sin(clock*.2+j)*12)%960,yy=(j*57+clock*2)%540;p.rect(xx,yy,2,2,0x66e3c18b);}
    }
    private void wall(float x,float y){p.rect(sx(x),sy(y),30,30,0xff3e5452);p.rect(sx(x),sy(y),30,5,0xff839081);p.rect(sx(x)+3,sy(y)+10,24,2,0xff5c7066);}
    private void townAsset(int id,float x,float y,float w,float h,float alpha){p.image("town.png",id%4*128,id/4*128,128,128,sx(x)-w,sy(y)-h*2,w*2,h*2,alpha,false);}
    private void worldTag(String text,float x,float y,int color){float w=text.length()*10+14;p.rect(sx(x)-w/2,sy(y)-10,w,17,0xc41b2a30);center(text,sx(x),sy(y)+2,10,color);}
    private void npc(Town.Npc n){
        float xx=sx(n.x),yy=sy(n.y);if(xx<-50||xx>1010||yy<-50||yy>600)return;
        int frame=(int)(clock*2+n.id)%4,slot=n.sprite*4+frame;
        p.oval(xx-13,yy-5,26,10,0x77102223);p.image("npcs.png",slot%8*32,slot/8*32,32,32,xx-27,yy-47,54,54,1,false);
        worldTag(n.name,n.x,n.y+11,0xfff2dfb2);
        float[] target=g.body.enabled?g.body.target(g):g.story.target();boolean quest=target!=null&&Game.dist(n.x,n.y,target[0],target[1])<2;
        boolean close=g.inTown()&&Game.dist(g.x,g.y,n.x,n.y)<43;
        if(quest&&!close){float bob=(float)Math.sin(clock*3)*3;p.rect(xx-9,yy-76+bob,18,21,0xff354b50);center(g.story.chapter==4?"?":"!",xx,yy-59+bob,18,GOLD);}
        if(close){p.oval(xx-22,yy-6,44,13,0x4468cab7);p.rect(xx+29,yy-40,50,17,0xcc203640);center("可交谈",xx+54,yy-27,10,0xffbce1cf);}
    }
    private static final class DrawItem{float y;Object object;DrawItem(float a,Object b){y=a;object=b;}}
    private void guest(){
        TownGuest n=g.guest;float xx=sx(n.x),yy=sy(n.y);if(xx<-60||xx>W+60||yy<-80||yy>H+90)return;
        int frame=n.moving?1+(int)(n.walk*5)%2:n.stage==2?3:0;
        p.oval(xx-17,yy-4,34,10,0x66132225);p.image("nailong.png",frame*64,0,64,64,xx-36,yy-68,72,72,1,!n.left);
        if(n.discovered)worldTag("奶龙",n.x,n.y+11,0xfff3d589);
        if(n.near(g)){p.oval(xx-23,yy-5,46,13,0x4468cab7);p.rect(xx-23,yy-86,46,16,0xdd253940);center(n.stage==2?"老朋友":"可交谈",xx,yy-74,10,0xfff1d68e);}
        if(n.stage==2&&Game.dist(g.x,g.y,n.x,n.y)<85){float bob=(float)Math.sin(clock*3)*2;center("♪",xx+29,yy-57+bob,16,GOLD);}
    }
    private void obj(int idx,float x,float y,float w,float h){object(idx,x,y,w,h,1);}
    private void object(int idx,float x,float y,float w,float h,float alpha){p.image("objects.png",idx%8*64,idx/8*64,64,64,sx(x)-w,sy(y)-h*1.75f,w*2,h*2,alpha,false);}
    private void hero(){
        float px=sx(g.x),py=sy(g.y);p.oval(px-14,py-5,28,10,0x6610201b);
        int frame=(int)(clock*7)%4;int col=(Math.sin(g.facing)<-.5?4:0)+frame;
        float alpha=g.invuln>0&&((int)(clock*15)%2==0)?.4f:1;
        if(g.dashTime>0){p.oval(px-24,py-12,48,18,0x4484d1bc);}
        p.image("actors.png",col*32,0,32,32,px-29,py-48,58,58,alpha,Math.cos(g.facing)<-.3);
        if(g.mode==Game.PLAY){p.rect(px-28,py-64,56,15,0x99132221);p.text(Game.HERO,px,py-53,11,CREAM,1);}
    }
    private void enemy(Game.Enemy e){
        float px=sx(e.x),py=sy(e.y);if(px<-90||px>W+90||py<-50||py>H+100)return;
        int frame=(int)(clock*(e.type==1?10:5)+e.id)%4,col=frame,row=1;float size=52;
        if(e.type==1){col+=4;size=46;}else if(e.type==2){row=2;size=62;}else if(e.type==3){row=2;col+=4;size=52;}else if(e.type==4){row=3;size=100;}
        if(e.windup>0){float xx=sx(e.targetX),yy=sy(e.targetY);if(e.bossAttack){p.oval(xx-106,yy-75,212,150,0x55d87153);for(int j=0;j<28;j++){double a=j*Math.PI/14;p.rect(xx+(float)Math.cos(a)*104,yy+(float)Math.sin(a)*74,5,5,0xffe9a169);}}else p.oval(px-65,py-55,130,100,0x55b988d0);}
        p.oval(px-size*.27f,py-4,size*.54f,10,0x6610201b);
        p.image(g.inBody()?"body_enemies.png":"actors.png",g.inBody()?frame*32:col*32,g.inBody()?e.type*32:row*32,32,32,px-size/2,py-size*.81f,size,size,1,e.x>g.x);
        if(e.hit>0)p.rect(px-4,py-size*.45f,8,8,0x99fff1bb);
        if(e.hp<e.maxHp||e.type==4){float w=e.type==4?82:36;p.rect(px-w/2-1,py-size*.83f-8,w+2,6,0xff132320);p.rect(px-w/2,py-size*.83f-7,w*e.hp/e.maxHp,4,e.type==4?0xffd6aa67:0xffc97b65);}
    }
    private void panel(float x,float y,float w,float h){
        p.rect(x+4,y+5,w,h,0x77101b21);p.rect(x,y,w,h,0xff75857c);p.rect(x+1,y+1,w-2,h-2,0xff253b43);p.rect(x+3,y+3,w-6,h-6,PANEL);
        p.rect(x+6,y+6,w-12,1,0xff425861);p.rect(x+6,y+h-7,w-12,1,0xff2d4149);
        for(int k=0;k<4;k++){float a=x+(k%2==0?0:w-6),b=y+(k<2?0:h-6);p.rect(a,b,6,6,0xffc5ae7c);p.rect(a+2,b+2,2,2,0xffe5c98c);}
    }
    private void border(float x,float y,float w,float h,int color){p.rect(x,y,w,2,color);p.rect(x,y+h-2,w,2,color);p.rect(x,y,2,h,color);p.rect(x+w-2,y,2,h,color);}
    private void icon(int idx,float x,float y,float size){p.image("icons.png",idx%8*32,idx/8*32,32,32,x,y,size,size,1,false);}
    private void label(String s,float x,float y,float size,int c){p.text(s,x,y,size,c,0);}
    private void center(String s,float x,float y,float size,int c){p.text(s,x,y,size,c,1);}
    private void button(String text,float x,float y,float w,float h,boolean primary){
        p.rect(x+3,y+4,w,h,0x880b1818);p.rect(x,y,w,h,primary?GOLD:0xff536c58);p.rect(x+2,y+2,w-4,h-4,primary?0xffb88c50:0xff253b33);
        p.rect(x+4,y+3,w-8,2,primary?0xfff4d79a:0xff729075);center(text,x+w/2,y+h/2+6,18,primary?0xff162b27:CREAM);
    }
    private void title(){
        p.rect(0,0,W,H,0x8a0a1919);p.rect(0,0,510,H,0xb5112422);
        label("全新篇章 · 梦入体内",62,65,14,GOLD);label("星火远征",56,142,56,CREAM);
        p.rect(62,162,42,3,GOLD);label("伍子平的体内冒险",62,197,20,0xffced5bc);
        label("沿血管穿越器官，清除病灶，迎接梦醒。",62,233,15,MUTED);
        boolean save=g.activeRun;
        button(save?"继续旅程":"开启体内远征",62,273,278,53,true);
        button(save?"开启新的远征":"旅者手册",62,340,278,43,false);
        label("档案",64,427,14,MUTED);label("最高区域  "+g.bestWave+" / 5",64,454,15,CREAM);label("累计击败  "+g.lifetimeKills,232,454,15,CREAM);
        label("器官副本  ·  血管转运  ·  击败触发空投",62,508,12,MUTED);p.text("v0.4.0",914,508,12,MUTED,2);
        panel(603,116,259,287);center("此行的旅者",733,148,13,GOLD);
        p.oval(670,322,120,25,0x77111f1c);
        int fr=(int)(clock*3)%4;p.image("actors.png",fr*32,0,32,32,654,174,160,160,1,false);
        center("伍子平",733,358,26,CREAM);center("星火剑士  ·  中山大学的梦行者",733,384,12,MUTED);
        icon(0,629,433,24);label("挥剑",658,452,14,CREAM);icon(1,718,433,24);label("星火",747,452,14,CREAM);icon(2,806,433,24);label("闪避",835,452,14,CREAM);
        if(save)label("已有未完成的旅程，点击主按钮继续。",62,406,12,GOLD);
    }
    private void hud(){
        panel(18,16,269,82);p.image("actors.png",0,0,32,32,22,25,37,37,1,false);label("伍子平",66,40,18,CREAM);label("等级 "+g.level,209,39,14,GOLD);
        p.rect(66,49,202,12,0xff142723);p.rect(67,50,200*g.hp/g.maxHp,10,0xffc57b65);center((int)g.hp+" / "+(int)g.maxHp,167,59,10,0xfffff0d4);
        p.rect(28,77,240,5,0xff142723);p.rect(28,77,240*(float)g.xp/g.requiredXp(),5,0xff7bbfa1);label("经验 "+g.xp+" / "+g.requiredXp(),29,93,9,MUTED);
        panel(325,16,310,56);center(g.inTown()?"中山大学 · "+(g.body.enabled?"梦境据点":"灯火长明"):g.inBody()?g.body.name()+" · 体内远征":"迷雾森林 · "+Game.WAVE_NAMES[g.wave-1],480,39,17,CREAM);center(g.inTown()?"安全区域  ·  可以交谈与补给":g.inBody()?BodyJourney.SUBTITLES[g.body.organ]+"  ·  "+time(g.elapsed):"第 "+g.wave+" / 5 波  ·  "+time(g.elapsed),480,59,11,MUTED);
        icon(9,654,21,23);label(""+g.gold,683,40,16,GOLD);smallToggle("札记",746,19,54);
        smallToggle(g.autoAttack?"自动 开":"自动 关",811,19,78);smallToggle("Ⅱ",902,19,38);
        panel(18,107,286,83);icon(11,29,118,24);label(g.body.enabled?(g.body.ending?"终章完成 · 梦醒时分":"梦入体内 · 净化 "+g.body.clearedCount()+" / 5"):g.story.enabled?g.story.chapterName():"当前委托",61,136,12,GOLD);
        wrapped(g.quest(),32,161,13,CREAM,254,18,2);label("点击查看任务与人物",32,182,10,MUTED);
        // Mini map deliberately omits any hidden off-screen collectible information.
        panel(826,75,114,89);p.rect(834,83,98,73,g.inTown()?0xff3e5250:0xff203e31);
        if(g.inTown()){
            p.rect(882,83,3,73,0xff9b9b7c);p.rect(834,126,98,3,0xff9b9b7c);
            for(Town.House h:Town.HOUSES)p.rect(834+(h.x-h.w/2)/Town.WIDTH*98,83+(h.y-h.h*.45f)/Town.HEIGHT*73,h.w/Town.WIDTH*98,6,0xff9b8990);
            for(Town.Npc n:Town.NPCS)p.rect(834+n.x/Town.WIDTH*98,83+n.y/Town.HEIGHT*73,2,2,0xffdfd0a3);
        }else{
            if(g.inBody())for(int yy=0;yy<73;yy+=3)for(int xx=0;xx<98;xx+=3)if(BodyJourney.inside(g.body.organ,xx/98f*1280,yy/73f*960,0))p.rect(834+xx,83+yy,3,3,0xff775566);
            p.rect(834+640f/Game.WORLD_W*98-1,83,2,73,0xff4d5d40);p.rect(834,83+480f/Game.WORLD_H*73,98,2,0xff4d5d40);
            for(Game.Enemy e:g.enemies)p.rect(834+e.x/Game.WORLD_W*98,83+e.y/Game.WORLD_H*73,2,2,e.type==4?GOLD:0xffb37964);
        }
        p.rect(834+g.x/g.worldWidth()*98-2,83+g.y/g.worldHeight()*73-2,4,4,0xffb1ead3);
        if(g.story.enabled){float[] target=g.body.enabled?g.body.target(g):g.story.target();if(target!=null){p.rect(834+target[0]/g.worldWidth()*98-2,83+target[1]/g.worldHeight()*73-2,4,4,GOLD);navigation(target[0],target[1]);}}
        if(g.body.enabled){bodyMini();if(g.inBody())label(g.body.weapon()+"  ·  攻击 "+(int)g.attack,29,211,11,GOLD);}
        if(g.banner>0){panel(315,87,420,45);center(g.bannerText,525,115,13,GOLD);}
        Game.Enemy boss=null;if(!g.inTown())for(Game.Enemy e:g.enemies)if(e.type==4)boss=e;
        if(boss!=null){center(g.inBody()?"增殖核心":"遗迹守卫",480,181,13,GOLD);p.rect(337,190,286,7,0xff172824);p.rect(338,191,284*boss.hp/boss.maxHp,5,0xffd2ab69);}
    }
    private void smallToggle(String s,float x,float y,float w){panel(x,y,w,31);center(s,x+w/2,y+21,12,CREAM);}
    private void controls(){
        p.oval(30,373,124,124,0x55233732);p.oval(36,379,112,112,0x553e5c47);
        p.oval(63+joyX*31,406+joyY*31,58,58,0x99718c6b);p.oval(69+joyX*31,412+joyY*31,46,46,0x998aa17c);
        center("移动",92,522,12,MUTED);
        if(g.inTown()){
            String interaction=g.story.interaction(g);boolean ready=!interaction.isEmpty();
            p.oval(790,372,114,114,ready?0xffc4a572:0xff677c7d);p.oval(794,376,106,106,0xee233e46);icon(11,825,405,44);
            center(ready?interaction:"靠近人物交谈",847,511,13,ready?GOLD:MUTED);
            center("与居民交谈，找到属于你的下一步。",467,515,12,MUTED);return;
        }
        if(g.inBody()){
            roundButton(857,465,38,0,"普攻",g.attackCd,g.attackDelay,0xffb89a61);
            roundButton(764,465,30,1,"星火斩",g.skillCd,8,0xffc17b51);
            roundButton(755,370,25,2,"闪避",g.dashCd,2.6f,0xff6d9b8d);
            roundButton(679,410,24,3,"药剂 ×"+g.potions,g.potionCd,3,0xffa87063);
            label("长按挥剑 · 点击全身图查看血管路线",325,520,11,MUTED);
            if(!g.story.interaction(g).isEmpty()){panel(348,281,264,34);center(g.story.interaction(g)+"  [E]",480,303,12,GOLD);}return;
        }
        roundButton(857,433,45,0,"普攻",g.attackCd,g.attackDelay,0xffb89a61);
        roundButton(761,441,34,1,"星火斩",g.skillCd,8,0xffc17b51);
        roundButton(851,334,29,2,"闪避",g.dashCd,2.6f,0xff6d9b8d);
        roundButton(746,347,24,3,"药剂 ×"+g.potions,g.potionCd,3,0xffa87063);
        label("长按普攻连续挥剑",362,520,11,0xffaec1a7);
        if(g.story.enabled&&!g.story.interaction(g).isEmpty()){panel(371,281,218,34);center(g.story.interaction(g)+"  [E]",480,303,13,GOLD);}
    }
    private void roundButton(float x,float y,float r,int ic,String s,float cd,float max,int c){
        p.oval(x-r-2,y-r+2,r*2+4,r*2+4,0x88121d1b);p.oval(x-r,y-r,r*2,r*2,c);p.oval(x-r+3,y-r+3,r*2-6,r*2-6,0xdd233b32);
        icon(ic,x-18,y-21,36);
        if(cd>.1){p.oval(x-r+3,y-r+3,r*2-6,r*2-6,0xbb142522);center(String.format(java.util.Locale.ROOT,"%.1f",cd),x,y+6,18,CREAM);}
        center(s,x,y+r+20,12,CREAM);
    }
    private void veil(){p.rect(0,0,W,H,0xbd0a1819);}
    private void upgrade(){
        veil();center("星火觉醒",480,105,35,CREAM);center("等级 "+g.level+" · 选择一项祝福",480,139,15,GOLD);
        for(int i=0;i<3;i++){
            int id=g.choices[i];float x=120+i*246;panel(x,181,228,240);border(x,181,228,240,i==0?GOLD:0xff55775f);
            label("0"+(i+1),x+18,208,12,MUTED);icon(upgradeIcon(id),x+81,223,66);
            center(Game.UPGRADE_NAMES[id],x+114,321,22,CREAM);
            String desc=Game.UPGRADE_DESC[id];if(desc.length()>17){center(desc.substring(0,Math.min(12,desc.length())),x+114,352,13,MUTED);center(desc.substring(Math.min(12,desc.length())),x+114,373,13,MUTED);}else center(desc,x+114,355,13,MUTED);
            center("点击选择",x+114,402,12,GOLD);
        }
        center("选择期间，时间暂停。",480,466,13,MUTED);
    }
    private int upgradeIcon(int id){int[] ids={0,4,5,2,1,6,7,10};return ids[id];}
    private void pause(){
        veil();panel(304,66,352,435);center("旅途小憩",480,111,29,CREAM);center("旅程已自动保存 · 简体中文",480,143,13,MUTED);
        button("继续旅程",340,181,280,46,true);button("旅者手册",340,240,280,40,false);
        button(g.sound?"声音：开启":"声音：关闭",340,293,280,40,false);button(g.story.enabled&&!g.inTown()?(g.body.enabled?"沿血管返回中山大学":"返回中山大学"):"继续探索",340,346,280,40,false);button("返回主界面",340,399,280,40,false);
        center("攻击 "+(int)g.attack+"  ·  移速 "+(int)g.speed+"  ·  击败 "+g.kills,480,474,12,MUTED);
    }
    private void help(){
        if(g.body.enabled||!g.activeRun){bodyHelp();return;}
        veil();panel(150,48,660,444);label("旅者手册",184,98,29,CREAM);label("让伍子平的星火，照亮这片遗迹。",185,128,14,MUTED);
        String[] lines={"左侧摇杆移动；城镇中靠近居民，点击交谈按钮或人物。","对话显示中文台词与选项；点击正文可显示整句或翻页。","先与沈砚交谈，再向北门旁的阿岚了解情况，即可出城。","森林中长按普攻挥剑；星火斩清理包围，闪避躲开重击。","拾取晶石升级；药剂恢复一半生命；第五波挑战首领。","通过营地石门或暂停菜单回城补给，战斗进度会保留。"};
        for(int i=0;i<lines.length;i++){label("0"+(i+1),185,178+i*34,12,GOLD);label(lines[i],219,178+i*34,13,CREAM);}
        label("简体中文  ·  桌面：WASD 移动，E 交谈，L 札记，J / K 战斗",185,405,11,MUTED);
        button("明白了，出发",340,432,280,42,true);
    }
    private void journal(){
        if(g.body.enabled){bodyJournal();return;}
        veil();panel(88,42,784,466);label("旅途札记",120,92,29,CREAM);label(g.story.enabled?g.story.chapterName():"旅者档案",121,120,14,GOLD);
        p.rect(491,145,1,260,0xff4a6266);label("此行的足迹",120,163,14,GOLD);
        String[] steps={"初到中山大学 · 寻找沈砚","林前准备 · 与阿岚交谈","北门出发 · 进入迷雾森林","迷雾森林 · 寻回星火","灯火归来 · 向守望人复命"};
        for(int i=0;i<steps.length;i++){int c=g.story.enabled&&g.story.chapter>i?0xff9fd3b3:i==g.story.chapter?GOLD:MUTED;icon(g.story.chapter>i?15:11,120,184+i*38,21);label(steps[i],153,201+i*38,14,c);}
        label("中山大学居民",525,163,14,GOLD);
        for(int i=0;i<6;i++){Town.Npc n=Town.NPCS[i];int slot=n.sprite*4;p.image("npcs.png",slot%8*32,slot/8*32,32,32,523,180+i*31,26,26,1,false);label(n.name+" · "+n.role,559,200+i*31,13,CREAM);}
        if(g.guest.discovered){label("隐藏相遇 · 奶龙",120,382,13,GOLD);label(g.guest.status(),525,382,11,g.guest.stage==2?0xffa9d4b4:MUTED);}
        label("等级 "+g.level+"  ·  攻击 "+(int)g.attack+"  ·  金币 "+g.gold,120,408,13,MUTED);label("累计击败 "+g.lifetimeKills+"  ·  最高区域 "+g.bestWave+"/5",525,408,12,MUTED);
        button("返回旅程",340,444,280,40,true);
    }
    private void confirmNew(){veil();panel(265,135,430,285);center("开启新的远征？",480,193,28,CREAM);center("本次未完成的旅程将被替换。",480,236,15,MUTED);button("确认，重新出发",310,294,340,46,true);button("保留原旅程",310,355,340,40,false);}
    private void result(){
        if(g.body.enabled){bodyResult();return;}
        veil();panel(265,69,430,403);boolean won=g.mode==Game.VICTORY;
        icon(won?15:0,448,95,64);center(won?"星火重燃":"此刻休整，明日再战",480,204,won?33:27,CREAM);
        center(won?"遗迹守卫已被击败，森林重获安宁。":g.lastCause,480,240,14,MUTED);
        center("等级 "+g.level+"    区域 "+g.wave+" / 5    用时 "+time(g.elapsed),480,283,17,GOLD);
        center("击败魔物 "+g.kills+"    本次金币 "+g.gold,480,316,15,CREAM);
        button(g.story.enabled?(won?"携星火返回中山大学":"回到中山大学休整"):"再次远征",310,350,340,46,true);button("返回主界面",310,410,340,36,false);
    }
    private void navigation(float x,float y){
        float xx=sx(x),yy=sy(y)-60;if(xx>=80&&xx<=800&&yy>=205&&yy<=350)return;
        float dx=x-g.x,dy=y-g.y;if(Game.dist(x,y,g.x,g.y)<50)return;
        panel(826,176,114,45);center(Math.abs(dx)>Math.abs(dy)?(dx>0?"→":"←"):(dy>0?"↓":"↑"),844,198,17,GOLD);
        label("任务方向",863,194,11,CREAM);label("距离 "+(int)Game.dist(x,y,g.x,g.y),863,211,10,MUTED);
    }
    private void bodyMini(){
        if(g.inTown()){panel(813,226,127,37);center("全身病灶 · 点击查看",876,250,10,GOLD);return;}
        panel(813,226,127,174);center("全身病灶  "+g.body.clearedCount()+"/5",876,247,11,GOLD);
        BodyRenderer.atlas(p,g,829,251,94,125,clock,false);
        center("点击展开 · 血管路线",876,390,9,MUTED);
    }
    private void bodyMap(){
        veil();panel(105,33,750,474);label("全身病灶 · 血管路线",137,79,26,CREAM);label("红色 待净化   金色 当前区域   绿色 已净化",138,107,12,MUTED);
        BodyRenderer.atlas(p,g,154,121,203,304,clock,true);
        label("沿血管依次前进",416,148,16,GOLD);
        for(int i=0;i<5;i++){
            boolean done=(g.body.cured&(1<<i))!=0;boolean current=i==g.body.organ;
            int color=done?0xff9ed5b7:current?GOLD:MUTED;
            p.rect(421,175+i*47,8,8,color);if(i<4)p.line(425,188+i*47,425,211+i*47,2,0xff975e79);
            label(BodyJourney.NAMES[i],444,184+i*47,16,color);
            label(done?"已净化 · 奖励已发放":current?(g.inTown()?"当前目的地":"战斗中") :"完成前一副本后开放",548,182+i*47,11,color);
        }
        label("首次通关奖励：金币 + 体魄上限 10 + 药剂 1",416,426,11,MUTED);
        button("返回旅程",340,450,280,38,true);
    }
    private void bodyJournal(){
        veil();panel(88,42,784,466);label("梦入体内 · 远征札记",120,92,27,CREAM);
        label(g.quest(),121,123,13,GOLD);p.rect(491,145,1,255,0xff4a6266);
        label("副本与首次通关奖励",120,163,14,GOLD);
        for(int i=0;i<5;i++){
            boolean done=(g.body.cured&(1<<i))!=0;int color=done?0xff9ed5b7:i==g.body.organ?GOLD:MUTED;
            label((done?"✓ ":"· ")+BodyJourney.NAMES[i],121,201+i*37,14,color);
            label(BodyJourney.REWARDS[i]+" 金币 / 体魄 +10"+(done?"  已领":""),244,201+i*37,12,color);
        }
        label("当前装备",525,163,14,GOLD);label(g.body.weapon(),525,200,20,CREAM);label("攻击 "+(int)g.attack+"  ·  生命上限 "+(int)g.maxHp,525,229,13,MUTED);
        label("当前器官的空投",525,269,14,GOLD);
        for(int slot=0;slot<2;slot++){int state=g.body.supply[g.body.organ*2+slot];String text=state==0?"未触发":state==1?"正在降落":state==2?"已落地 · 等待拾取":"已领取";label((slot==0?"药品 · 第 4 次击败":"武器 · 第 "+(g.body.organ==4?7:8)+" 次击败"),525,301+slot*47,12,CREAM);label(text,525,319+slot*47,11,state==3?0xff9ed5b7:GOLD);}
        if(g.guest.discovered){label("隐藏相遇 · 奶龙",120,382,13,GOLD);label(g.guest.status(),275,382,11,g.guest.stage==2?0xffa9d4b4:MUTED);}
        label(g.body.ending?"终章奖励已领取 · 远征完成":"完成全部副本，再找沈砚领取终章武器。",120,409,12,MUTED);
        button("返回旅程",340,444,280,40,true);
    }
    private void bodyHelp(){
        veil();panel(150,48,660,444);label("体内远征 · 旅者手册",184,98,27,CREAM);
        String[] lines={"从中山大学出发：向沈砚接取任务，再靠近北门血管入口。","五处副本依次开放；清除本处全部敌人，血管通向下一站。","第 4 次击败触发药品空投，第 8 次触发武器（终站为 7 次）。","空投落地后靠近拾取；右下角全身图可展开查看病灶。","每个副本首次通关奖励金币、生命上限与药剂；终章另有武器。","死亡显示《病入膏肓》，可回据点重整，保留已领取成长。"};
        for(int i=0;i<lines.length;i++){label("0"+(i+1),185,151+i*36,11,GOLD);label(lines[i],214,151+i*36,12,CREAM);}
        label("虚构的梦境冒险，器官地图与药品数值为游戏设定。",185,390,12,MUTED);
        label("桌面：WASD 移动 · J/K 战斗 · E 交谈转运 · M 全身图 · L 札记",185,413,10,MUTED);
        button("明白了，出发",340,432,280,42,true);
    }
    private void bodyResult(){
        boolean won=g.mode==Game.VICTORY;veil();panel(248,58,464,430);
        icon(won?15:3,451,80,58);center(won?"体内远征 · 五境净化":"《病入膏肓》",480,182,won?29:35,won?GOLD:0xffe5a29e);
        center(won?"全部器官副本已完成，沿血管返回梦境据点。":"梦境中的伍子平倒下了，远征还可以重新开始。",480,218,13,MUTED);
        if(!won)center("倒在 "+g.body.name()+" · "+g.lastCause,480,249,14,GOLD);
        else center("已发放 330 副本金币 · 生命上限累计 +50",480,249,14,GOLD);
        center("等级 "+g.level+"   击败 "+g.kills+"   用时 "+time(g.elapsed),480,281,14,CREAM);
        center(won?"再与沈砚交谈：150 金币 + 终章武器":"保留等级、装备与已领取奖励；当前副本重置",480,312,12,MUTED);
        button(won?"沿血管返回 · 领取终章奖励":"回中山大学重整",303,350,354,46,true);
        button("返回主界面",303,414,354,36,false);
    }
    private void dialogue(){
        Story.Dialogue d=g.story.dialogue;if(d==null)return;
        p.rect(0,0,960,540,0x35111e2a);panel(76,310,808,212);
        p.rect(104,292,170,32,0xffb99a65);p.rect(106,294,166,28,0xff283c48);label(d.speaker(),120,315,17,GOLD);
        label("故事对话",764,336,11,MUTED);p.text((d.page+1)+" / "+d.pages.length,855,336,11,MUTED,2);
        p.rect(97,344,109,145,0xff3b5359);p.rect(100,347,103,139,0xff1c303b);p.rect(105,352,93,1,0xff6f8178);
        if(d.speaker().equals(Game.HERO))p.image("actors.png",0,0,32,32,108,367,89,89,1,false);
        else if(d.npc==TownGuest.NPC)p.image("nailong.png",(g.guest.stage==2?3:0)*64,0,64,64,100,358,103,103,1,false);
        else if(d.npc>=0){int slot=d.npc*4;p.image("npcs.png",slot%8*32,slot/8*32,32,32,108,367,89,89,1,false);}
        else icon(11,120,384,63);
        center(d.npc==TownGuest.NPC?(g.guest.stage==2?"愿意等你的朋友":"角落里的小伙伴"):d.npc>=0&&!d.speaker().equals(Game.HERO)?Town.NPCS[d.npc].role:"长夜的来信",151,475,10,MUTED);
        String visible=d.text().substring(0,d.visible());wrapped(visible,232,371,17,CREAM,610,27,3);
        if(d.complete()&&d.last()){
            for(int i=0;i<d.options.length;i++)button(d.options[i],232+i*293,454,d.options.length==1?570:277,39,i==0);
        }else{
            label(d.complete()?"点击正文，继续故事":"点击正文，显示整句",232,482,12,MUTED);
            if(d.complete())center("▼",828,482+(float)Math.sin(clock*4)*2,15,GOLD);
        }
        label("点击选项继续，旅途会记住你的选择。",232,510,10,MUTED);
    }
    private void wrapped(String text,float x,float y,float size,int color,float width,float step,int maxLines){
        StringBuilder line=new StringBuilder();float used=0;int row=0;
        for(int i=0;i<text.length();i++){
            char c=text.charAt(i);float next=c<128?size*.56f:size;
            if((used+next>width||c=='\n')&&line.length()>0){label(line.toString(),x,y+row*step,size,color);row++;line.setLength(0);used=0;if(row>=maxLines)return;}
            if(c!='\n'){line.append(c);used+=next;}
        }
        if(line.length()>0&&row<maxLines)label(line.toString(),x,y+row*step,size,color);
    }
    public static String time(float seconds){int n=(int)seconds;return String.format(java.util.Locale.ROOT,"%02d:%02d",n/60,n%60);}
}
