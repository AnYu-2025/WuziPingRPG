package cn.wuziping.ember;

import java.util.*;

/** Pixel world at 2x; UI in a 960x540 virtual landscape viewport. */
public final class Scene {
    public float W=960,H=540;
    public Viewport layout=new Viewport();
    public static final int CREAM=0xfff6edd8,GOLD=0xffe8c27a,MUTED=0xffa9bbb6,INK=0xff0c141c,PANEL=0xf0101a22,EMBER=0xffe07a45;
    public float clock=0,camX=0,camY=0,joyX=0,joyY=0;
    private Painter p,root;private UiPainter ui;private Game g;
    public void draw(Painter painter,Game game,float seconds){
        p=root=painter;g=game;clock=seconds;W=layout.width;H=layout.height;
        boolean town=g.inTown()||((g.mode==Game.TITLE||g.mode==8)&&!g.activeRun);
        float cx=town&&!g.inTown()?480:g.x,cy=town&&!g.inTown()?416:g.y;
        camX=Game.clamp(cx-W/4,0,Math.max(0,(town?Town.WIDTH:g.worldWidth())-W/2));camY=Game.clamp(cy-H/4,0,Math.max(0,(town?Town.HEIGHT:g.worldHeight())-H/2));
        float kick=g.mode==Game.PLAY?g.vfx.shake*(g.effectsLevel==0?.35f:1):0;camX-=(float)Math.sin(seconds*48)*kick*.5f;camY-=(float)Math.cos(seconds*37)*kick*.32f;
        if(town)townWorld();else if(g.inPhysics()){physicsWorld();hero();impactOverlay();}else if(g.inMath()){MathRenderer.draw(p,g,camX,camY,W,H,clock);hero();impactOverlay();}else world();
        ui=new UiPainter(root);p=ui;anchor(0,0);
        if(g.mode==Game.TITLE){title();return;}
        if(g.mode==8){title();confirmNew();return;}
        if(g.mode==Game.HELP){help();return;}
        if(g.mode==Game.JOURNAL){journal();return;}
        if(g.mode==BodyJourney.MAP){bodyMap();return;}
        if(g.mode==MathJourney.MAP){worldMap();return;}
        if(g.mode==Arsenal.MENU){armory();return;}
        hud();controls();
        anchor(0,0);if(g.mode==Game.DIALOGUE){dialogue();return;}
        if(g.mode==Game.PAUSE)pause();else if(g.mode==Game.UPGRADE)upgrade();else if(g.mode==Game.DEAD||g.mode==Game.VICTORY)result();
    }
    private void anchor(int h,int v){ui.x=h<0?layout.left:h>0?layout.right:layout.centerX;ui.y=v<0?layout.top:v>0?layout.bottom:layout.centerY;}
    private float sx(float x){return (x-camX)*2;}private float sy(float y){return (y-camY)*2;}
    private void world(){
        if(g.inBody())BodyRenderer.terrain(p,g,camX,camY,clock,W,H);
        else{
        p.rect(0,0,W,H,0xff193a2e);
        int tx=(int)camX/16,ty=(int)camY/16;
        for(int y=ty;y<=ty+H/32+2;y++)for(int x=tx;x<=tx+W/32+2;x++){
            int hash=(x*173+y*317)^((x*y)*13);boolean path=Math.abs(x*16-640)<23||Math.abs(y*16-480)<14||Game.dist(x*16,y*16,640,510)<48;
            int tile=(hash&31)+(path?32:0);
            p.image("tiles.png",tile%16*16,tile/16*16,16,16,sx(x*16),sy(y*16),32,32,1,false);
        }
        // Small details use a coordinate hash rather than per-frame randomness.
        for(int y=ty/3*3;y<ty+H/32+3;y+=3)for(int x=tx/3*3;x<tx+W/32+4;x+=3){
            int hash=Math.abs((x*341+y*83)^(x*y*17));if(hash%7==0)obj(8+hash%2,x*16+7,y*16+7,32,32);
        }
        obj(5,640,445,64,64);obj(4,640,513,44,44);obj(6,690,508,32,32);obj(11,602,499,40,40);obj(7,663,460,36,36);
        if(g.story.enabled){obj(5,Town.FOREST_GATE_X,Town.FOREST_GATE_Y,39,39);worldTag("中山大学入口",Town.FOREST_GATE_X,Town.FOREST_GATE_Y+6,0xffecd49c);}
        p.oval(sx(640)-45,sy(501)-40,90,75,0x10f6b755);
        }
        drawCount=0;
        if(!g.inBody())for(Game.Obstacle o:g.obstacles)if(o.x>camX-40&&o.x<camX+W/2+40&&o.y>camY-20&&o.y<camY+H/2+50)addDraw(o.y,o);
        for(Game.Enemy e:g.enemies)addDraw(e.y,e);addDraw(g.y,g);
        for(Game.Drop d:g.drops){int id=d.type==0?8:d.type==1?9:10;float bounce=(float)Math.sin(clock*4+d.x)*1.3f;
            int glow=d.type==1?0x33e8c27a:d.type==2?0x3391e3a0:0x339fd7c8;p.oval(sx(d.x)-12,sy(d.y)-8,24,14,glow);
            float orbit=(float)(clock*2.2+d.x);p.rect(sx(d.x)+(float)Math.cos(orbit)*11,sy(d.y)-16+(float)Math.sin(orbit)*5,2,2,0xccfff1c2);
            icon(id,sx(d.x)-9,sy(d.y)-12+bounce,18);}
        sortDraw();
        for(int di=0;di<drawCount;di++){
            DrawItem item=drawPool[di];
            if(item.object instanceof Game.Obstacle){Game.Obstacle o=(Game.Obstacle)item.object;int idx=o.kind==0?((int)o.x%3):3;
                float opacity=Game.dist(g.x,g.y,o.x,o.y-16)<27?.38f:1;
                object(idx,o.x,o.y,idx==3?38:55,idx==3?38:55,opacity);
            }else if(item.object instanceof Game.Enemy)enemy((Game.Enemy)item.object);else hero();
        }
        for(Game.Shot s:g.shots){p.line(sx(s.x-s.vx*.045f),sy(s.y-s.vy*.045f),sx(s.x),sy(s.y),3,0x66dab3dc);p.oval(sx(s.x)-7,sy(s.y)-7,14,14,0x444c94a2);p.rect(sx(s.x)-3,sy(s.y)-3,6,6,0xffdab3dc);p.rect(sx(s.x)-1,sy(s.y)-2,3,3,0xffffe8c0);}
        if(g.skillFlash>0){
            float u=1-g.skillFlash/.48f,r=u*(68+g.upgrades[4]*9)*2,inner=r*.62f;
            p.oval(sx(g.x)-r,sy(g.y)-14-r*.7f,r*2,r*1.4f,0x22f2c77c);
            for(int j=0;j<40;j++){double a=j*Math.PI/20+clock;float xx=sx(g.x)+(float)Math.cos(a)*r,yy=sy(g.y)-14+(float)Math.sin(a)*r*.7f;p.rect(xx,yy,j%2==0?6:4,j%2==0?6:4,j%4==0?0xfffff5ca:0xfff2c77c);
                p.rect(sx(g.x)+(float)Math.cos(a)*inner,sy(g.y)-14+(float)Math.sin(a)*inner*.7f,3,3,0x88e07a45);}
        }
        if(g.swing>0&&(!g.inBody()||g.arsenal.selected!=3&&g.arsenal.selected!=4))slashTrail();
        popups();
        if(g.inBody()){
            for(Arsenal.Bolt b:g.arsenal.bolts){
                p.line(sx(b.x-b.vx*.07f),sy(b.y-b.vy*.07f),sx(b.x),sy(b.y),4,(0x66<<24)|(b.color&0xffffff));
                p.oval(sx(b.x)-8,sy(b.y)-8,16,16,(0x44<<24)|(b.color&0xffffff));p.rect(sx(b.x)-3,sy(b.y)-3,6,6,b.color);p.rect(sx(b.x)-1,sy(b.y)-1,2,2,0xfffff6df);
            }
            BodyRenderer.supplies(p,g,camX,camY,clock,W,H);
        }
        for(int i=0;i<17;i++){
            float xx=(float)((i*71+Math.sin(clock*.25+i)*22)%W),yy=(float)((i*47+clock*(i%2==0?2:-2)+H*10)%H);
            p.rect(xx,yy,i%3==0?3:2,i%3==0?3:2,0x667cae78);
        }
        // Cinematic edge shading, without blurring any pixel art.
        p.rect(0,0,W,6,0x44101f20);p.rect(0,H-6,W,6,0x44101f20);
        p.rect(0,0,5,H,0x33101f20);p.rect(W-5,0,5,H,0x33101f20);
        impactOverlay();
    }
    private void slashTrail(){
        float reach=g.inBody()?Arsenal.REACH[g.arsenal.selected]:52;
        int color=g.inBody()?Arsenal.COLORS[g.arsenal.selected]:0xffe0bb72;
        int steps=g.inBody()&&g.arsenal.selected==2?8:g.inBody()&&g.arsenal.selected==5?10:16;
        float spread=g.inBody()&&g.arsenal.selected==2?.7f:g.inBody()&&g.arsenal.selected==5?2.4f:1.9f;
        float grow=Game.clamp(1-g.swing/.2f,0,1);
        if(g.inBody()&&g.arsenal.selected==2){float r=26+(float)Math.sin(grow*Math.PI)*reach;float x=sx(g.x),y=sy(g.y)-18;float dx=(float)Math.cos(g.facing),dy=(float)Math.sin(g.facing);p.line(x+dx*12,y+dy*12,x+dx*r,y+dy*r,5,0x99da9aba);p.line(x+dx*12,y+dy*12,x+dx*r,y+dy*r,2,0xffffe6ed);return;}
        for(int j=0;j<steps;j++){
            double a=g.facing-spread*.5+grow*spread-j*.042;
            float rr=reach*(.85f-j*.012f);int alpha=Math.max(25,210-j*11);int c=(alpha<<24)|(color&0xffffff);
            float x=sx(g.x)+(float)Math.cos(a)*rr,y=sy(g.y)-18+(float)Math.sin(a)*rr*.86f;
            p.rect(x-2,y-2,j<3?5:3,j<3?5:3,j<2?0xfffff3d1:c);
        }
        if(g.inBody()&&g.arsenal.selected==5)p.oval(sx(g.x)-reach*.9f,sy(g.y)-reach*.4f,reach*1.8f,reach*.75f,(0x28<<24)|(color&0xffffff));
    }
    private void popups(){
        for(Game.Effect e:g.effects){
            float k=e.max<=0?1:Math.max(0,e.time/e.max);boolean crit=e.color==0xffffd37a;
            float size=(crit?21:15)*(0.84f+.3f*k);int alpha=(int)Math.min(255,k*340);
            float x=sx(e.x),y=sy(e.y);
            p.text(e.text,x+1,y+1,size,(alpha<<24)|0x140c08,1);
            p.text(e.text,x,y,size,(alpha<<24)|(e.color&0xffffff),1);
            if(crit)p.rect(x-3,y-size-2,2,2, (alpha<<24)|0xe8c27a);
        }
    }
    private void impactOverlay(){
        int moteIndex=0;for(Vfx.Mote m:g.vfx.motes){if(g.effectsLevel==0&&moteIndex++%2==1)continue;
            float k=m.max<=0?0:Math.max(0,m.life/m.max);int alpha=(int)(Math.min(1,k)*255);int c=(alpha<<24)|(m.color&0xffffff);
            float x=sx(m.x),y=sy(m.y),s=m.size*(.55f+.6f*k);
            if(m.shape==1)p.oval(x,y,s+1,s+1,c);else if(m.shape==2)p.rect(x,y,s*2.1f,2,c);else p.rect(x,y,s,s,c);
        }
        if(g.vfx.nova>0){
            float u=Math.max(0,1f-g.vfx.nova/.55f),r=34+u*220;
            p.oval(sx(g.x)-r,sy(g.y)-12-r*.62f,r*2,r*1.24f,0x33fff1c8);
            for(int j=0;j<28;j++){double a=j*Math.PI/14+clock*2;p.rect(sx(g.x)+(float)Math.cos(a)*r-2,sy(g.y)-10+(float)Math.sin(a)*r*.68f-2,5,5,j%2==0?0xfffff1c8:EMBER);}
        }
        if(g.vfx.flash>0){int a=(int)(Math.min(.5f,g.vfx.flash)*(g.effectsLevel==0?55:115));p.rect(0,0,W,H,(a<<24)|0xff4634);}
        if(!g.inTown()&&g.mode==Game.PLAY&&g.hp>0&&g.hp<g.maxHp*.34f){
            float pulse=g.effectsLevel==0?.35f:.4f+.28f*(float)Math.sin(clock*7);int a=(int)(pulse*86);
            p.rect(0,0,W,18,(a<<24)|0x9a2030);p.rect(0,H-18,W,18,(a<<24)|0x9a2030);p.rect(0,0,14,H,(a<<24)|0x9a2030);p.rect(W-14,0,14,H,(a<<24)|0x9a2030);
        }
    }
    private static final class TownProp{int id;float x,y,size;TownProp(int i,float a,float b,float s){id=i;x=a;y=b;size=s;}}
    private void townWorld(){
        p.rect(0,0,W,H,0xff2c443d);int tx=(int)camX/16,ty=(int)camY/16;
        for(int yy=ty;yy<ty+H/32+3;yy++)for(int xx=tx;xx<tx+W/32+3;xx++){
            int wx=xx*16,wy=yy*16;boolean street=Math.abs(wx-480)<39||Math.abs(wy-432)<31||Game.dist(wx,wy,480,408)<108;
            boolean lane=(wx>860&&Math.abs(wy-620)<32)||(wy>250&&wy<318)||(wy>492&&wy<535)||(wy>620&&wy<658);
            int index=((xx*173+yy*71)&15)+(street?16:lane?32:0);
            p.image("town_tiles.png",index%16*16,index/16*16,16,16,sx(wx),sy(wy),32,32,1,false);
        }
        // Low boundary wall, brick joints and a traversable northern gate.
        for(int xx=64;xx<=Town.WIDTH-72;xx+=16){if(xx<422||xx>534)wall(xx,78);wall(xx,Town.HEIGHT-42);}
        for(int yy=94;yy<Town.HEIGHT-40;yy+=16){wall(58,yy);wall(Town.WIDTH-65,yy);}
        p.rect(sx(390),sy(343),360,2,0x556d8270);p.rect(sx(390),sy(479),360,2,0x556d8270);
        drawCount=0;
        for(Town.House h:Town.HOUSES)addDraw(h.y,h);
        for(Town.Npc n:Town.NPCS)addDraw(n.y,n);
        for(TownProp prop:TOWN_PROPS)addDraw(prop.y,prop);
        addDraw(408,"fountain");addDraw(121,"gate");
        if(g.inTown())addDraw(g.y,g);
        addDraw(g.guest.y,g.guest);
        sortDraw();
        for(int di=0;di<drawCount;di++){
            DrawItem item=drawPool[di];
            if(item.object instanceof Town.House){
                Town.House h=(Town.House)item.object;if(h.x+h.w/2<camX||h.x-h.w/2>camX+W/2||h.y<camY||h.y-h.h>camY+H/2)continue;
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
        float mx=sx(1140),my=sy(620);p.oval(mx-50,my-29,100,58,0xff8f91bc);p.oval(mx-38,my-22,76,44,0xff162d43);worldTag("数学之门",1140,647,0xffcbbbe5);
        if(g.body.enabled){float xx=sx(480),yy=sy(112);for(int i=0;i<8;i++)p.rect(xx-34+i*10,yy-17+(float)Math.sin(clock*3+i)*4,4,4,0xffe4a4a5);}
        for(int j=0;j<14;j++){float xx=(j*79+(float)Math.sin(clock*.2+j)*12)%W,yy=(j*57+clock*2)%H;p.rect(xx,yy,2,2,0x66e3c18b);}
        impactOverlay();
    }
    private void wall(float x,float y){p.rect(sx(x),sy(y),30,30,0xff3e5452);p.rect(sx(x),sy(y),30,5,0xff839081);p.rect(sx(x)+3,sy(y)+10,24,2,0xff5c7066);}
    private void townAsset(int id,float x,float y,float w,float h,float alpha){p.image("town.png",id%4*128,id/4*128,128,128,sx(x)-w,sy(y)-h*2,w*2,h*2,alpha,false);}
    private void worldTag(String text,float x,float y,int color){float w=text.length()*10+14;p.rect(sx(x)-w/2,sy(y)-10,w,17,0xc41b2a30);center(text,sx(x),sy(y)+2,10,color);}
    private void npc(Town.Npc n){
        float xx=sx(n.x),yy=sy(n.y);if(xx<-50||xx>W+50||yy<-50||yy>H+60)return;
        int frame=(int)(clock*2+n.id)%4,slot=n.sprite*4+frame;
        p.oval(xx-13,yy-5,26,10,0x77102223);p.image("npcs.png",slot%8*32,slot/8*32,32,32,xx-27,yy-47,54,54,1,false);
        worldTag(n.name,n.x,n.y+11,0xfff2dfb2);
        float[] target=g.inTown()&&g.math.active?new float[]{1140,620}:g.body.enabled?g.body.target(g):g.story.target();boolean quest=target!=null&&Game.dist(n.x,n.y,target[0],target[1])<2;
        boolean close=g.inTown()&&Game.dist(g.x,g.y,n.x,n.y)<43;
        if(quest&&!close){float bob=(float)Math.sin(clock*3)*3;p.rect(xx-9,yy-76+bob,18,21,0xff354b50);center(g.story.chapter==4?"?":"!",xx,yy-59+bob,18,GOLD);}
        if(close){p.oval(xx-22,yy-6,44,13,0x4468cab7);p.rect(xx+29,yy-40,50,17,0xcc203640);center("可交谈",xx+54,yy-27,10,0xffbce1cf);}
    }
    private static final class DrawItem{float y;Object object;DrawItem(float a,Object b){y=a;object=b;}}
    private static final Comparator<DrawItem> DRAW_ORDER=new Comparator<DrawItem>(){public int compare(DrawItem a,DrawItem b){return Float.compare(a.y,b.y);}};
    private static final TownProp[] TOWN_PROPS={new TownProp(0,387,344,40),new TownProp(0,576,344,40),new TownProp(0,386,481,40),new TownProp(0,578,481,40),new TownProp(1,374,407,37),new TownProp(1,588,407,37),new TownProp(2,366,581,49),new TownProp(2,601,582,49),new TownProp(3,410,330,31),new TownProp(3,553,330,31),new TownProp(3,402,490,31),new TownProp(3,559,490,31),new TownProp(4,145,356,62),new TownProp(4,806,358,62),new TownProp(4,155,568,60),new TownProp(4,815,568,60),new TownProp(5,615,619,42),new TownProp(6,344,319,38),new TownProp(7,395,273,35),new TownProp(0,1060,590,40),new TownProp(0,1220,590,40),new TownProp(1,1040,708,37),new TownProp(1,1240,708,37),new TownProp(3,1020,622,31),new TownProp(3,1260,622,31),new TownProp(4,970,800,62),new TownProp(4,1320,800,62)};
    private DrawItem[] drawPool=new DrawItem[80];private int drawCount;
    /** Per-frame depth buffer: reuse objects instead of allocating a list and comparator every frame. */
    private void addDraw(float y,Object object){if(drawCount==drawPool.length)drawPool=java.util.Arrays.copyOf(drawPool,drawPool.length*2);DrawItem item=drawPool[drawCount];if(item==null){item=new DrawItem(y,object);drawPool[drawCount]=item;}else{item.y=y;item.object=object;}drawCount++;}
    private void sortDraw(){java.util.Arrays.sort(drawPool,0,drawCount,DRAW_ORDER);}
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
        int frame=(int)(clock*7)%4;int col=(Math.sin(g.facing)<-.5?4:0)+frame;boolean flip=Math.cos(g.facing)<-.3;
        float alpha=!g.inTown()&&!g.inMath()&&!g.inPhysics()&&g.invuln>0&&((int)(clock*15)%2==0)?.4f:1;
        for(int i=g.vfx.ga.length-1;i>=0;i--)if(g.vfx.ga[i]>0)p.image("actors.png",col*32,0,32,32,sx(g.vfx.gx[i])-29,sy(g.vfx.gy[i])-48,58,58,g.vfx.ga[i]*.38f,flip);
        if(g.dashTime>0){p.oval(px-26,py-14,52,20,0x5584d1bc);p.oval(px-16,py-10,32,12,0x339fd8cc);}
        p.image("actors.png",col*32,0,32,32,px-29,py-48,58,58,alpha,flip);
        if(g.body.enabled){
            int weapon=g.arsenal.selected;float progress=Game.clamp(1-g.swing/.2f,0,1),base=(float)Math.toDegrees(g.facing)+90;
            boolean striking=g.swing>0&&!g.inTown()&&!g.inMath()&&!g.inPhysics();float angle=base-25,extension=0;
            if(striking){
                if(weapon==2){angle=base;extension=(float)Math.sin(progress*Math.PI)*34;}
                else if(weapon==3||weapon==4){angle=base;extension=-(float)Math.sin(progress*Math.PI)*8;}
                else angle=base+(weapon==5?-125:-95)+(weapon==5?250:190)*progress;
            }
            float handX=px+(float)Math.cos(g.facing)*(11+extension),handY=py-19+(float)Math.sin(g.facing)*(8+extension*.65f),size=weapon==5?56:weapon==2?60:48;
            if(striking&&weapon!=3&&weapon!=4){
                for(int j=2;j>=1;j--)p.imageRotated("weapons.png",weapon*32,0,32,32,handX-size*.48f,handY-size*.8f,size,size,.12f*j,false,angle-j*15,handX,handY);
            }
            p.imageRotated("weapons.png",weapon*32,0,32,32,handX-size*.48f,handY-size*.8f,size,size,1,false,angle,handX,handY);
            if(g.inBody()&&g.arsenal.shield>0){p.oval(px-31,py-60,62,67,0x336fbbd6);for(int j=0;j<8;j++){double a=clock*3+j*Math.PI/4;p.rect(px+(float)Math.cos(a)*24,py-30+(float)Math.sin(a)*22,3,3,0xffc6eef2);}}
            if(g.inBody()&&g.arsenal.combo>0)center(g.arsenal.combo==2?"连击 ×2":"连击",px,py-76,10,GOLD);
        }
        if(g.mode==Game.PLAY){float tagW=Math.max(60,Math.min(112,g.heroName.codePointCount(0,g.heroName.length())*11+12));p.rect(px-tagW/2,py-66,tagW,16,0xcc101820);p.rect(px-tagW/2,py-66,tagW,2,GOLD);p.text(g.heroName,px,py-53,Math.min(11,100f/Math.max(1,g.heroName.codePointCount(0,g.heroName.length()))),CREAM,1);}
    }
    private void enemy(Game.Enemy e){
        float px=sx(e.x),py=sy(e.y);if(px<-90||px>W+90||py<-50||py>H+100)return;
        int frame=(int)(clock*(e.type==1?10:5)+e.id)%4,col=frame,row=1;float size=52;
        if(e.type==1){col+=4;size=46;}else if(e.type==2){row=2;size=62;}else if(e.type==3){row=2;col+=4;size=52;}else if(e.type==4){row=3;size=100;}
        if(e.windup>0){float xx=sx(e.targetX),yy=sy(e.targetY);if(e.bossAttack){p.oval(xx-106,yy-75,212,150,0x55d87153);p.line(xx-18,yy,xx+18,yy,2,0xfff0c9a2);p.line(xx,yy-12,xx,yy+12,2,0xfff0c9a2);for(int j=0;j<28;j++){double a=j*Math.PI/14;p.rect(xx+(float)Math.cos(a)*104,yy+(float)Math.sin(a)*74,5,5,0xffe9a169);}}else p.oval(px-65,py-55,130,100,0x55b988d0);}
        p.oval(px-size*.27f,py-4,size*.54f,10,0x6610201b);
        if(g.inBody()&&e.type==4)p.image("bosses.png",frame*64,Bosses.kind(g)*64,64,64,px-size/2,py-size*.81f,size,size,1,e.x>g.x);
        else p.image(g.inBody()?"body_enemies.png":"actors.png",g.inBody()?frame*32:col*32,g.inBody()?e.type*32:row*32,32,32,px-size/2,py-size*.81f,size,size,1,e.x>g.x);
        if(e.hit>0){float a=e.hit/.15f;p.oval(px-size*.32f,py-size*.62f,size*.64f,size*.5f,((int)(a*150)<<24)|0xfff6e2);p.rect(px-4,py-size*.45f,8,8,0xccfff1bb);}
        if(e.hp<e.maxHp||e.type==4){float w=e.type==4?82:36;p.rect(px-w/2-1,py-size*.83f-8,w+2,6,0xff132320);p.rect(px-w/2,py-size*.83f-7,w*e.hp/e.maxHp,4,e.type==4?0xffd6aa67:0xffc97b65);p.rect(px-w/2,py-size*.83f-7,w*e.hp/e.maxHp,1,0x66fff0d8);}
    }
    private void panel(float x,float y,float w,float h){
        p.rect(x+3,y+4,w,h,0x66060c12);p.rect(x,y,w,h,0xffe6d2a2);p.rect(x+1,y+1,w-2,h-2,0xff6a4038);
        p.rect(x+2,y+2,w-4,h-4,0xff24343e);p.rect(x+3,y+3,w-6,h-6,PANEL);
        p.rect(x+4,y+4,w-8,2,0x33f0d7a2);p.rect(x+4,y+h-5,w-8,1,0x226a4038);
        bracket(x+3,y+3,1,1);bracket(x+w-3,y+3,-1,1);bracket(x+3,y+h-3,1,-1);bracket(x+w-3,y+h-3,-1,-1);
    }
    private void bracket(float x,float y,int dx,int dy){
        p.rect(x+(dx<0?-7:0),y+(dy<0?-2:0),7,2,GOLD);p.rect(x+(dx<0?-2:0),y+(dy<0?-7:0),2,7,GOLD);
    }
    private void border(float x,float y,float w,float h,int color){p.rect(x,y,w,2,color);p.rect(x,y+h-2,w,2,color);p.rect(x,y,2,h,color);p.rect(x+w-2,y,2,h,color);}
    private void icon(int idx,float x,float y,float size){p.image("icons.png",idx%8*32,idx/8*32,32,32,x,y,size,size,1,false);}
    private void label(String s,float x,float y,float size,int c){p.text(s,x,y,size,c,0);}
    private void center(String s,float x,float y,float size,int c){p.text(s,x,y,size,c,1);}
    private void button(String text,float x,float y,float w,float h,boolean primary){
        p.rect(x+2,y+3,w,h,0x88060c10);p.rect(x,y,w,h,primary?0xfff3d7a4:0xff6d8f86);
        p.rect(x+2,y+2,w-4,h-4,primary?0xffc4924e:0xff1c3330);
        p.rect(x+2,y+2,w-4,2,primary?0x66fff1c8:0x447aa894);p.rect(x+2,y+h-4,w-4,2,primary?0x44805a28:0x44081412);
        if(primary){p.rect(x+10,y+h/2-3,6,6,0xfff6e4b4);p.rect(x+w-16,y+h/2-3,6,6,0xfff6e4b4);}
        center(text,x+w/2,y+h/2+6,18,primary?0xff1c140c:CREAM);
    }
    private void title(){
        root.rect(0,0,W,H,0xb0081014);root.rect(0,0,W,26,0x88060e12);root.rect(0,H-34,W,34,0x99060e12);
        root.rect(0,0,28,H,0xf0081014);root.rect(W-28,0,28,H,0xf0081014);
        for(int i=0;i<24;i++){
            float xx=(float)((i*97+Math.sin(clock*.35+i)*30+W*8)%W);
            float yy=(float)((H+40-(clock*(12+i%5)+i*37)%(H+40)));
            root.rect(xx,yy,i%4==0?3:2,i%4==0?3:2,i%3==0?0x66e07a45:i%3==1?0x55e8c27a:0x44c45c6a);
        }
        panel(36,28,356,484);p.rect(52,86,2,150,EMBER);
        label("全新篇章 · 数学星庭",68,72,14,GOLD);label("星火远征",62,142,54,CREAM);
        p.rect(64,158,48,3,GOLD);p.rect(116,158,10,3,EMBER);
        label("身体与数学的双境冒险",62,192,20,0xffe7dcc8);
        label("净化体内八境，走进数学星庭发现规律。",62,226,15,MUTED);
        boolean save=g.activeRun;
        button(save?"继续旅程":"开启体内远征",62,273,278,53,true);
        button(save?"开启新的远征":"旅者手册",62,340,278,43,false);
        p.rect(62,416,330,55,0x55101820);p.rect(62,416,330,1,GOLD);p.rect(62,470,330,1,0x556a4038);
        label("档案 · 点击打开札记",72,436,12,GOLD);
        label("最高区域  "+g.bestWave+" / 8",72,458,14,CREAM);label("累计击败  "+g.lifetimeKills,228,458,14,CREAM);
        label(!g.activeRun?"第一次玩？先看「旅者手册」了解操作，再出发。":"双主题世界  ·  走位解谜  ·  六类兵器",62,500,12,!g.activeRun?GOLD:MUTED);
        p.text(g.editorHost?"按手机返回键，随时回到天工编辑器":"v0.7.0",914,508,12,MUTED,2);
        smallToggle("修改名字 · "+g.heroName,588,454,292);
        panel(588,92,292,356);center("此行的旅者",734,124,13,GOLD);p.rect(648,136,172,1,0x55e8c27a);
        p.oval(646,292,176,30,0x33e07a45);p.oval(674,300,120,16,0x44101820);
        int fr=(int)(clock*3)%4;p.image("actors.png",fr*32,0,32,32,654,150,160,160,1,false);
        for(int j=0;j<6;j++){double a=clock*1.1+j*Math.PI/3;p.rect(734+(float)Math.cos(a)*78,246+(float)Math.sin(a)*34,3,3,j%2==0?GOLD:EMBER);}
        center(g.heroName,734,332,Math.min(26,250f/Math.max(1,g.heroName.codePointCount(0,g.heroName.length()))),CREAM);center("星火剑士  ·  中山大学的梦行者",734,358,12,MUTED);
        p.rect(648,376,172,1,0x336d8790);
        icon(0,640,396,24);label("挥剑",668,415,14,CREAM);icon(1,730,396,24);label("星火",758,415,14,CREAM);icon(2,818,396,24);label("闪避",846,415,14,CREAM);
        if(save)label("已有未完成的旅程，点击主按钮继续。",62,400,12,GOLD);
    }
    private void hud(){
        if(g.inPhysics()){physicsHud();return;}
        if(g.inMath()){mathHud();return;}
        anchor(-1,-1);
        panel(18,16,269,82);p.rect(22,22,3,66,0xffc45c6a);p.image("actors.png",0,0,32,32,28,25,37,37,1,false);label(g.heroName,70,40,Math.min(18,130f/Math.max(1,g.heroName.codePointCount(0,g.heroName.length()))),CREAM);label("等级 "+g.level,209,39,14,GOLD);
        p.rect(70,49,190,12,0xff142028);p.rect(71,50,188*g.hp/Math.max(1,g.maxHp),10,g.hp<g.maxHp*.34f?0xffe07a45:0xffc45c6a);p.rect(71,50,188*g.hp/Math.max(1,g.maxHp),2,0x66ffd5cc);center((int)g.hp+" / "+(int)g.maxHp,165,59,10,0xfffff0d4);
        label("经验 "+g.xp+" / "+g.requiredXp(),30,74,9,MUTED);
        p.rect(28,78,240,5,0xff142028);p.rect(28,78,240*(float)g.xp/g.requiredXp(),5,0xff7ec8b0);p.rect(28,78,240*(float)g.xp/g.requiredXp(),1,0x88e8fff0);
        anchor(0,-1);panel(325,16,310,56);p.rect(340,66,280,2,0x55e8c27a);center(g.inTown()?"中山大学 · "+(g.body.enabled?"梦境据点":"灯火长明"):g.inBody()?g.body.name()+" · 体内远征":"迷雾森林 · "+Game.WAVE_NAMES[g.wave-1],480,39,17,CREAM);center(g.inTown()?"安全区域  ·  可以交谈与补给":g.inBody()?BodyJourney.SUBTITLES[g.body.organ]+"  ·  "+time(g.elapsed):"第 "+g.wave+" / 5 波  ·  "+time(g.elapsed),480,59,11,MUTED);
        anchor(1,-1);icon(9,646,21,23);label(""+g.gold,674,40,16,GOLD);smallToggle("札记",716,19,58);
        smallToggle(g.autoAttack?"自动 开":"自动 关",780,19,76);smallToggle("菜单",862,19,78);
        anchor(-1,-1);panel(18,107,286,83);p.rect(22,116,3,64,g.body.ending?0xff8ed0b7:GOLD);icon(11,32,118,24);label(g.math.active?"数学星庭 · 发现 "+Integer.bitCount(g.math.solved)+" / 3":g.body.enabled?(g.body.ending?"终章完成 · 梦醒时分":"梦入体内 · 净化 "+g.body.clearedCount()+" / 8"):g.story.enabled?g.story.chapterName():"当前委托",64,136,12,GOLD);
        wrapped(g.quest(),32,161,13,CREAM,254,18,2);label("点击查看任务与人物",32,182,10,MUTED);
        // Mini map deliberately omits any hidden off-screen collectible information.
        anchor(1,-1);panel(826,75,114,89);p.rect(834,83,98,73,g.inTown()?0xff3e5250:0xff203e31);
        if(g.inTown()){
            p.rect(834+480f/Town.WIDTH*98,83,2,73,0xff9b9b7c);p.rect(834,83+432f/Town.HEIGHT*73,98,2,0xff9b9b7c);p.rect(834+1140f/Town.WIDTH*98-2,83+620f/Town.HEIGHT*73-2,4,4,0xffa6bfe9);
            for(Town.House h:Town.HOUSES)p.rect(834+(h.x-h.w/2)/Town.WIDTH*98,83+(h.y-h.h*.45f)/Town.HEIGHT*73,h.w/Town.WIDTH*98,6,0xff9b8990);
            for(Town.Npc n:Town.NPCS)p.rect(834+n.x/Town.WIDTH*98,83+n.y/Town.HEIGHT*73,2,2,0xffdfd0a3);
        }else{
            if(g.inBody())for(int yy=0;yy<73;yy+=3)for(int xx=0;xx<98;xx+=3)if(BodyJourney.inside(g.body.organ,xx/98f*1280,yy/73f*960,0))p.rect(834+xx,83+yy,3,3,0xff775566);
            p.rect(834+640f/Game.WORLD_W*98-1,83,2,73,0xff4d5d40);p.rect(834,83+480f/Game.WORLD_H*73,98,2,0xff4d5d40);
            for(Game.Enemy e:g.enemies)p.rect(834+e.x/Game.WORLD_W*98,83+e.y/Game.WORLD_H*73,2,2,e.type==4?GOLD:0xffb37964);
        }
        p.rect(834+g.x/g.worldWidth()*98-2,83+g.y/g.worldHeight()*73-2,4,4,0xffb1ead3);
        if(g.story.enabled){float[] target=g.inTown()&&g.math.active?new float[]{1140,620}:g.body.enabled?g.body.target(g):g.story.target();if(target!=null){p.rect(834+target[0]/g.worldWidth()*98-2,83+target[1]/g.worldHeight()*73-2,4,4,GOLD);navigation(target[0],target[1]);}}
        if(g.body.enabled){anchor(1,-1);bodyMini();anchor(-1,-1);
            panel(18,219,260,65);p.rect(22,226,3,50,Arsenal.COLORS[g.arsenal.selected]);p.image("weapons.png",g.arsenal.selected*32,0,32,32,30,228,34,34,1,false);label(g.arsenal.name(),70,240,14,GOLD);
            p.rect(70,250,128,4,0xff101820);p.rect(70,250,128*g.arsenal.energy/100f,4,g.arsenal.energy>=100?0xffffe7b0:0xffc5a6d9);label(Arsenal.DESCS[g.arsenal.selected],32,273,10,MUTED);smallToggle("武库",207,226,66);
        }
        anchor(0,-1);if(g.banner>0){panel(315,87,420,45);center(g.bannerText,525,115,13,GOLD);}
        Game.Enemy boss=null;if(!g.inTown())for(Game.Enemy e:g.enemies)if(e.type==4)boss=e;
        if(boss!=null){center(g.inBody()?Bosses.name(g)+(boss.hp<boss.maxHp*.6f?" · 狂暴":""):"遗迹守卫",480,181,13,GOLD);p.rect(337,190,286,7,0xff172824);p.rect(338,191,284*boss.hp/boss.maxHp,5,0xffd2ab69);}
    }
    private void smallToggle(String s,float x,float y,float w){
        p.rect(x+1,y+2,w,31,0x55060c10);p.rect(x,y,w,31,0xffc4a36a);p.rect(x+2,y+2,w-4,27,0xff16242c);
        p.rect(x+2,y+2,w-4,2,0x44f0d7a2);center(s,x+w/2,y+21,12,CREAM);
    }
    private void controls(){
        anchor(-1,1);
        p.oval(26,369,132,132,0x44060c10);p.oval(30,373,124,124,0xccd7b56a);p.oval(36,379,112,112,0xee121c26);
        for(int j=0;j<8;j++){double a=j*Math.PI/4;p.rect(92+(float)Math.cos(a)*48-1,435+(float)Math.sin(a)*48-1,3,3,0x88e8c27a);}
        float kx=63+joyX*31,ky=406+joyY*31;p.oval(kx-2,ky+2,62,62,0x66060c10);p.oval(kx,ky,58,58,0xddc4a36a);p.oval(kx+6,ky+6,46,46,0xee1c2c34);
        p.rect(kx+27,ky+16,4,26,0x66e8c27a);p.rect(kx+16,ky+27,26,4,0x66e8c27a);
        center("移动",92,508,12,MUTED);
        if(g.inMath()){
            anchor(1,1);String interaction=g.math.interaction(g);p.oval(790,372,114,114,0xffb9acd3);p.oval(794,376,106,106,0xff1b2b43);icon(11,825,405,44);center(interaction.isEmpty()?"靠近光门":interaction,847,511,12,GOLD);smallToggle("重走 [T]",741,337,132);
            anchor(0,1);center("观察脚印与光轨 · 你的发现会写入札记",467,508,12,MUTED);return;
        }
        if(g.inTown()){
            anchor(1,1);String interaction=g.story.interaction(g);boolean ready=!interaction.isEmpty();
            p.oval(790,372,114,114,ready?0xffc4a572:0xff677c7d);p.oval(794,376,106,106,0xee233e46);icon(11,825,405,44);
            center(ready?interaction:"靠近人物交谈",847,511,13,ready?GOLD:MUTED);
            anchor(0,1);center("与居民交谈，找到属于你的下一步。",467,508,12,MUTED);return;
        }
        anchor(1,1);if(g.inBody()){
            if(g.arsenal.energy>=100){float pulse=4+(float)Math.sin(clock*5)*2;p.oval(645-24-pulse,330-24-pulse,(24+pulse)*2,(24+pulse)*2,0x44ffe7b0);}
            meterRing(645,330,34,g.arsenal.energy/100f,0xffc5a6d9);
            roundButton(645,330,26,4,"爆发 "+(int)g.arsenal.energy+"%",0,1,0xffc5a6d9);
            roundButton(866,462,46,0,"普攻",g.attackCd,g.attackDelay,0xffb89a61);
            roundButton(768,470,38,1,Arsenal.SKILLS[g.arsenal.selected],g.skillCd,7,0xffc17b51);
            roundButton(770,362,33,2,"闪避",g.dashCd,2.6f,0xff6d9b8d);
            roundButton(700,414,28,3,"药剂 ×"+g.potions,g.potionCd,3,0xffa87063);
            anchor(0,1);label("长按挥剑 · 点击全身图查看血管路线",325,508,11,MUTED);
            if(!g.story.interaction(g).isEmpty()){anchor(0,0);panel(348,281,264,34);center(g.story.interaction(g)+"  [E]",480,303,12,GOLD);}return;
        }
        roundButton(866,428,52,0,"普攻",g.attackCd,g.attackDelay,0xffb89a61);
        roundButton(764,449,41,1,"星火斩",g.skillCd,8,0xffc17b51);
        roundButton(860,330,35,2,"闪避",g.dashCd,2.6f,0xff6d9b8d);
        roundButton(748,345,30,3,"药剂 ×"+g.potions,g.potionCd,3,0xffa87063);
        anchor(0,1);label("长按普攻连续挥剑",362,508,11,0xffaec1a7);
        if(g.story.enabled&&!g.story.interaction(g).isEmpty()){anchor(0,0);panel(371,281,218,34);center(g.story.interaction(g)+"  [E]",480,303,13,GOLD);}
    }
    private void roundButton(float x,float y,float r,int ic,String s,float cd,float max,int c){
        boolean ready=cd<=.1f;
        if(ready){float pulse=2+(float)Math.sin(clock*4+(x+y)*.01f)*1.6f;p.oval(x-r-pulse,y-r-pulse,(r+pulse)*2,(r+pulse)*2,(0x33<<24)|(c&0xffffff));}
        p.oval(x-r-1,y-r+3,r*2+2,r*2+2,0x66060c10);p.oval(x-r,y-r,r*2,r*2,0xffe6d2a4);p.oval(x-r+3,y-r+3,r*2-6,r*2-6,0xee152028);
        p.oval(x-r+6,y-r+6,r*2-12,r*2-12,(0x55<<24)|(c&0xffffff));
        icon(ic,x-18,y-21,36);
        if(!ready){p.oval(x-r+3,y-r+3,r*2-6,r*2-6,0xcc101820);meterRing(x,y,r+5,1f-cd/Math.max(.01f,max),GOLD);center(String.format(java.util.Locale.ROOT,"%.1f",cd),x,y+6,18,CREAM);}
        center(s,x,y+r+20,12,CREAM);
    }
    private void meterRing(float x,float y,float r,float frac,int color){
        int ticks=10,lit=(int)(Game.clamp(frac,0,1)*ticks);
        for(int i=0;i<ticks;i++){double a=-Math.PI/2+i*Math.PI*2/ticks;p.rect(x+(float)Math.cos(a)*r-1.5f,y+(float)Math.sin(a)*r-1.5f,3,3,i<lit?color:0x33ffffff);}
    }
    private void veil(){root.rect(0,0,W,H,g.mode==Game.DEAD?0xcc140e12:0xc00a1418);}
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
        button(g.sound?"声音：开":"声音：关",340,293,134,40,false);button(g.effectsLevel==0?"特效：柔和":"特效：标准",486,293,134,40,false);button(g.story.enabled&&!g.inTown()?(g.inBody()?"沿血管返回中山大学":"返回中山大学"):"继续探索",340,346,280,40,false);button("返回主界面",340,399,280,40,false);
        center("攻击 "+(int)g.attack+"  ·  移速 "+(int)g.speed+"  ·  击败 "+g.kills,480,474,12,MUTED);
        center("点击面板外的空白处，或按手机返回键，随时回到旅程",480,492,11,GOLD);
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
        if(g.math.active){mathJournal();return;}
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
        if(g.math.active){mathResult();return;}
        if(g.body.enabled){bodyResult();return;}
        veil();panel(265,69,430,403);boolean won=g.mode==Game.VICTORY;
        icon(won?15:0,448,95,64);center(won?"星火重燃":"此刻休整，明日再战",480,204,won?33:27,CREAM);
        center(won?"遗迹守卫已被击败，森林重获安宁。":g.lastCause,480,240,14,MUTED);
        center("等级 "+g.level+"    区域 "+g.wave+" / 5    用时 "+time(g.elapsed),480,283,17,GOLD);
        center("击败魔物 "+g.kills+"    本次金币 "+g.gold,480,316,15,CREAM);
        button(g.story.enabled?(won?"携星火返回中山大学":"回到中山大学休整"):"再次远征",310,350,340,46,true);button("返回主界面",310,410,340,36,false);
    }
    private void navigation(float x,float y){
        float xx=sx(x),yy=sy(y)-60;if(xx>=80&&xx<=W-160&&yy>=205&&yy<=350)return;
        float dx=x-g.x,dy=y-g.y;if(Game.dist(x,y,g.x,g.y)<50)return;
        panel(826,176,114,45);center(Math.abs(dx)>Math.abs(dy)?(dx>0?"→":"←"):(dy>0?"↓":"↑"),844,198,17,GOLD);
        label("任务方向",863,194,11,CREAM);label("距离 "+(int)Game.dist(x,y,g.x,g.y),863,211,10,MUTED);
    }
    private void armory(){
        veil();panel(88,42,784,466);label("旅者武库",119,91,28,CREAM);label("装备改变普攻与技能 · 击败守卫或拾取武器空投解锁",120,121,12,MUTED);p.text("金币 "+g.gold,827,91,15,GOLD,2);
        for(int i=0;i<6;i++){
            float x=120+(i%3)*240,y=146+(i/3)*132;boolean owned=g.arsenal.owned(i);panel(x,y,222,117);if(i==g.arsenal.selected)border(x,y,222,117,GOLD);
            p.rect(x+5,y+6,4,105,owned?Arsenal.COLORS[i]:(0x44<<24)|(Arsenal.COLORS[i]&0xffffff));
            if(i==g.arsenal.selected){float pulse=(float)Math.sin(clock*3)*1.2f;border(x-1-pulse,y-1-pulse,224+pulse*2,119+pulse*2,GOLD);}
            p.image("weapons.png",i*32,0,32,32,x+14,y+12,37,37,owned?1:.35f,false);label(Arsenal.NAMES[i]+(g.arsenal.forge[i]>0?" +"+g.arsenal.forge[i]:""),x+56,y+29,15,owned?CREAM:MUTED);
            label(Arsenal.DESCS[i],x+12,y+63,11,MUTED);
            smallToggle(owned?(i==g.arsenal.selected?"已装备":"装备"):"通关/空投解锁",x+10,y+76,96);
            smallToggle(g.arsenal.forge[i]>=3?"强化已满":"强化 "+g.arsenal.cost(i),x+116,y+76,96);
        }
        label("Q 快速轮换武器 · R 免疫爆发 · 爆发能量 "+(int)g.arsenal.energy+"%",120,419,12,MUTED);
        p.rect(560,400,250,5,0xff101820);p.rect(560,400,250*g.arsenal.energy/100f,5,g.arsenal.energy>=100?0xffffe7b0:0xffc5a6d9);
        button("返回旅程",340,444,280,40,true);
    }
    private void mathHud(){
        anchor(-1,-1);panel(18,16,269,82);label(g.heroName,35,43,Math.min(18,145f/Math.max(1,g.heroName.codePointCount(0,g.heroName.length()))),CREAM);label("数学行者",190,42,12,GOLD);p.rect(34,59,235,7,0xff293847);p.rect(34,59,235*g.hp/g.maxHp,7,0xff88bcad);label("体魄 "+(int)g.hp+" / "+(int)g.maxHp,35,86,11,MUTED);
        panel(18,107,286,96);label("数学 · "+g.math.name(),35,133,15,GOLD);wrapped(g.quest(),35,160,12,CREAM,250,19,2);label("先观察，再尝试",35,191,10,MUTED);
        anchor(0,-1);panel(325,16,310,56);center(g.math.name(),480,40,18,CREAM);center("脚步会让隐藏的规律显形",480,61,11,MUTED);
        if(g.banner>0){panel(313,88,424,45);center(g.bannerText,525,116,12,GOLD);}
        anchor(1,-1);smallToggle("札记",746,19,54);smallToggle("Ⅱ",902,19,38);panel(813,75,127,139);center("发现 "+Integer.bitCount(g.math.solved)+" / 3",876,98,12,GOLD);MathRenderer.minimap(p,g,824,106,105,62);String progress=g.math.level==0?"灯光 "+Integer.bitCount(g.math.circle)+" / 3":g.math.level==1?"桥梁 "+Integer.bitCount(g.math.bridges)+" / 7":"路标 "+Integer.bitCount(g.math.ribbon)+" / 3";center(progress,876,187,12,CREAM);center("光点是你与入口",876,204,9,MUTED);panel(813,226,127,37);center("主题地图 · 点击查看",876,250,10,GOLD);
    }
    private void physicsHud(){
        anchor(-1,-1);panel(18,16,269,82);label(g.heroName,35,43,Math.min(18,145f/Math.max(1,g.heroName.codePointCount(0,g.heroName.length()))),CREAM);label("物理学者",190,42,12,GOLD);p.rect(34,59,235,7,0xff293847);p.rect(34,59,235*g.hp/g.maxHp,7,0xff88bcad);label("体魄 "+(int)g.hp+" / "+(int)g.maxHp,35,86,11,MUTED);
        panel(18,107,286,96);label("物理 · "+g.physics.name(),35,133,15,GOLD);wrapped(g.quest(),35,160,12,CREAM,250,19,2);label("观察现象，找出规律",35,191,10,MUTED);
        anchor(0,-1);panel(325,16,310,56);center(g.physics.name(),480,40,18,CREAM);center("物理规律在操作中显现",480,61,11,MUTED);
        if(g.banner>0){panel(313,88,424,45);center(g.bannerText,525,116,12,GOLD);}
        anchor(1,-1);smallToggle("札记",746,19,54);smallToggle("Ⅱ",902,19,38);panel(813,75,127,139);center("发现 "+Integer.bitCount(g.physics.solved)+" / 5",876,98,12,GOLD);physicsMinimap();String progress=physicsProgress();center(progress,876,187,12,CREAM);center("光点是你与入口",876,204,9,MUTED);panel(813,226,127,37);center("主题地图 · 点击查看",876,250,10,GOLD);
    }
    private String physicsProgress(){
        switch(g.physics.level){
            case 0:return "命中 "+g.physics.targetHits+" / 3";
            case 1:return g.physics.lightReachedEnd?"光线到达":"调整镜面";
            case 2:return "导线 "+countWires()+" / 7";
            case 3:return g.physics.stableFrames>0?"稳定 "+g.physics.stableFrames+"/180":"调整波源";
            case 4:return g.physics.equilibriumTime>0?"平衡 "+(int)g.physics.equilibriumTime+"/3":"引导热量";
            default:return "";
        }
    }
    private int countWires(){int c=0;for(boolean w:g.physics.wiresPlaced)if(w)c++;return c;}
    private void physicsMinimap(){
        p.rect(824,106,105,62,0xff1a2a3a);
        float scaleX=105f/PhysicsJourney.WIDTH,scaleY=62f/PhysicsJourney.HEIGHT;
        // Draw player
        p.rect(824+g.physics.px*scaleX-2,106+g.physics.py*scaleY-2,4,4,0xffb1ead3);
        // Draw targets/nodes based on level
        if(g.physics.level==0){
            for(int i=0;i<3;i++){
                float tx=PhysicsJourney.TARGETS[i][0]*scaleX,ty=PhysicsJourney.TARGETS[i][1]*scaleY;
                p.rect(824+tx-3,106+ty-3,6,6,i<g.physics.targetHits?0xff4caf50:0xffff5722);
            }
        }else if(g.physics.level==1){
            for(int i=0;i<3;i++){
                float mx=PhysicsJourney.MIRRORS[i][0]*scaleX,my=PhysicsJourney.MIRRORS[i][1]*scaleY;
                p.rect(824+mx-2,106+my-2,4,4,0xffffff00);
            }
        }else if(g.physics.level==2){
            for(int i=0;i<6;i++){
                float nx=PhysicsJourney.CIRCUIT_NODES[i][0]*scaleX,ny=PhysicsJourney.CIRCUIT_NODES[i][1]*scaleY;
                p.rect(824+nx-2,106+ny-2,4,4,0xff4fc3f7);
            }
        }
    }
    private void physicsWorld(){
        // Simple colored background based on level
        int bgColor=g.physics.level==0?0xff5d8a6b:g.physics.level==1?0xff2c3e50:g.physics.level==2?0xff1e3a5f:g.physics.level==3?0xff4a148c:0xff8b2500;
        p.rect(0,0,W,H,bgColor);
        // Draw grid
        int gridColor=0x33ffffff;
        for(int x=0;x<W;x+=32)p.rect(x,0,1,H,gridColor);
        for(int y=0;y<H;y+=32)p.rect(0,y,W,1,gridColor);
        // Draw level-specific elements
        if(g.physics.level==0)drawProjectileRange();
        else if(g.physics.level==1)drawLightMaze();
        else if(g.physics.level==2)drawCircuitWorkshop();
        else if(g.physics.level==3)drawWaveInterference();
        else if(g.physics.level==4)drawHeatMaze();
        // Draw gate
        p.oval(sx(g.physics.gateX())-20,sy(g.physics.gateY())-20,40,40,0x88ffffff);
        p.text("出口",sx(g.physics.gateX()),sy(g.physics.gateY())-30,10,0xffffffff,1);
    }
    private void drawProjectileRange(){
        // Draw targets
        for(int i=0;i<3;i++){
            float tx=PhysicsJourney.TARGETS[i][0],ty=PhysicsJourney.TARGETS[i][1];
            int color=i<g.physics.targetHits?0xff4caf50:0xffff5722;
            p.oval(sx(tx)-15,sy(ty)-15,30,30,color);
            p.oval(sx(tx)-10,sy(ty)-10,20,20,0xffffffff);
            p.oval(sx(tx)-5,sy(ty)-5,10,10,color);
        }
        // Draw launch point
        p.oval(sx(300)-20,sy(800)-20,40,40,0xffffeb3b);
        p.text("发射点",sx(300),sy(800)-30,10,0xffffffff,1);
        // Draw projectile if active
        if(g.physics.projectileActive){
            p.oval(sx(g.physics.projectileX)-8,sy(g.physics.projectileY)-8,16,16,0xffff5722);
        }
    }
    private void drawLightMaze(){
        // Draw light source
        p.oval(sx(PhysicsJourney.LIGHT_START_X)-15,sy(PhysicsJourney.LIGHT_START_Y)-15,30,30,0xffffff00);
        p.text("光源",sx(PhysicsJourney.LIGHT_START_X),sy(PhysicsJourney.LIGHT_START_Y)-25,10,0xffffffff,1);
        // Draw end point
        p.oval(sx(PhysicsJourney.LIGHT_END_X)-15,sy(PhysicsJourney.LIGHT_END_Y)-15,30,30,0xff4caf50);
        p.text("终点",sx(PhysicsJourney.LIGHT_END_X),sy(PhysicsJourney.LIGHT_END_Y)-25,10,0xffffffff,1);
        // Draw mirrors
        for(int i=0;i<3;i++){
            float mx=PhysicsJourney.MIRRORS[i][0],my=PhysicsJourney.MIRRORS[i][1];
            p.rect(sx(mx)-20,sy(my)-3,40,6,0xffe0e0e0);
            p.text("M"+(i+1),sx(mx),sy(my)-15,9,0xffffffff,1);
        }
        // Draw light ray
        if(g.physics.lightRayEndX>0){
            p.line(sx(PhysicsJourney.LIGHT_START_X),sy(PhysicsJourney.LIGHT_START_Y),sx(g.physics.lightRayEndX),sy(g.physics.lightRayEndY),3,0xffffff00);
        }
    }
    private void drawCircuitWorkshop(){
        // Draw nodes
        for(int i=0;i<6;i++){
            float nx=PhysicsJourney.CIRCUIT_NODES[i][0],ny=PhysicsJourney.CIRCUIT_NODES[i][1];
            int color=i==g.physics.selectedNode?0xffffeb3b:0xff4fc3f7;
            p.oval(sx(nx)-12,sy(ny)-12,24,24,color);
            p.text("N"+(i+1),sx(nx),sy(ny)-20,9,0xffffffff,1);
        }
        // Draw wires
        for(int i=0;i<7;i++){
            if(g.physics.wiresPlaced[i]){
                int a=PhysicsJourney.CIRCUIT_EDGES[i][0],b=PhysicsJourney.CIRCUIT_EDGES[i][1];
                float ax=PhysicsJourney.CIRCUIT_NODES[a][0],ay=PhysicsJourney.CIRCUIT_NODES[a][1];
                float bx=PhysicsJourney.CIRCUIT_NODES[b][0],by=PhysicsJourney.CIRCUIT_NODES[b][1];
                p.line(sx(ax),sy(ay),sx(bx),sy(by),4,0xff4caf50);
            }
        }
    }
    private void drawWaveInterference(){
        // Draw wave sources
        p.oval(sx(g.physics.source1X)-15,sy(g.physics.source1Y)-15,30,30,0xffe1bee9);
        p.oval(sx(g.physics.source2X)-15,sy(g.physics.source2Y)-15,30,30,0xffe1bee9);
        // Draw waves
        for(int r=20;r<200;r+=20){
            int alpha=255-r;
            p.oval(sx(g.physics.source1X)-r,sy(g.physics.source1Y)-r,r*2,r*2,(alpha<<24)|0xffce93d8);
            p.oval(sx(g.physics.source2X)-r,sy(g.physics.source2Y)-r,r*2,r*2,(alpha<<24)|0xffce93d8);
        }
    }
    private void drawHeatMaze(){
        // Draw temperature grid
        float cellW=PhysicsJourney.WIDTH/PhysicsJourney.HEAT_COLS;
        float cellH=PhysicsJourney.HEIGHT/PhysicsJourney.HEAT_ROWS;
        for(int i=0;i<PhysicsJourney.HEAT_COLS;i++){
            for(int j=0;j<PhysicsJourney.HEAT_ROWS;j++){
                float temp=g.physics.temperature[i][j];
                int color=heatColor(temp);
                p.rect(sx(i*cellW),sy(j*cellH),cellW*2,cellH*2,color);
            }
        }
        // Draw heat source and sink
        p.oval(sx(g.physics.heatSourceX*cellW)-10,sy(g.physics.heatSourceY*cellH)-10,20,20,0xffff0000);
        p.oval(sx(g.physics.heatSinkX*cellW)-10,sy(g.physics.heatSinkY*cellH)-10,20,20,0xff0000ff);
    }
    private int heatColor(float temp){
        // Blue (cold) to Red (hot)
        int r=(int)(255*temp/100);
        int b=(int)(255*(100-temp)/100);
        return 0xff000000|(r<<16)|b;
    }
    private void worldMap(){
        veil();panel(88,40,784,468);label("星图 · 选择探索主题",119,88,27,CREAM);label("中山大学连接不同世界，身体与数学的进度分别保存。",120,119,12,MUTED);
        panel(120,145,340,278);panel(500,145,340,278);BodyRenderer.atlas(p,g,135,181,95,141,clock,false);
        label("身体 · 血流远征",237,190,18,GOLD);label("八个器官 / 高压战斗",237,221,12,MUTED);label("净化 "+g.body.clearedCount()+" / 8",237,251,14,CREAM);
        p.oval(535,195,100,70,0xff668b9b);p.oval(540,200,90,60,0xff16293c);p.line(535,290,588,226,3,0xffb9a8d2);p.line(588,226,638,290,3,0xffb9a8d2);p.line(535,290,638,290,3,0xffb9a8d2);
        label("数学 · 规律星庭",650,190,18,GOLD);label("几何轨迹 / 桥梁 / 翻向",650,221,11,MUTED);label("发现 "+Integer.bitCount(g.math.solved)+" / 3",650,251,14,CREAM);
        button("进入身体主题",145,365,290,42,true);button("进入数学主题",525,365,290,42,true);center("在中山大学可以切换主题；探索中请先从光门返回。",480,438,11,MUTED);button("返回旅程",340,455,280,37,false);
    }
    private void mathJournal(){
        veil();panel(88,42,784,466);label("数学 · 发现札记",120,92,29,CREAM);label("只记录已经亲自找到的规律。",120,122,13,MUTED);
        for(int i=0;i<3;i++){boolean done=(g.math.solved&(1<<i))!=0;label((done?"◆ ":"◇ ")+MathJourney.NAMES[i],122,170+i*78,17,done?GOLD:MUTED);wrapped(done?MathJourney.INSIGHTS[i]:"未发现。观察机关怎样回应自己的脚步。",150,198+i*78,12,done?CREAM:MUTED,640,20,2);}
        button("返回旅程",340,444,280,40,true);
    }
    private void mathResult(){
        veil();panel(265,99,430,355);center("星庭暂歇",480,160,32,CREAM);center("已经获得的发现和奖励会保留。",480,205,14,MUTED);center("回到中山大学后，可以重新尝试当前机关。",480,240,13,GOLD);button("返回中山大学",310,350,340,46,true);button("返回主界面",310,410,340,36,false);
    }
    private void bodyMini(){
        if(g.inTown()){panel(813,226,127,37);center("主题地图 · 点击查看",876,250,10,GOLD);return;}
        panel(813,226,127,174);center("全身病灶  "+g.body.clearedCount()+"/8",876,247,11,GOLD);
        BodyRenderer.atlas(p,g,829,251,94,125,clock,false);
        center("点击展开 · 血管路线",876,390,9,MUTED);
    }
    private void bodyMap(){
        veil();panel(105,33,750,474);label("全身病灶 · 血管路线",137,79,26,CREAM);label("红色 待净化   金色 当前区域   绿色 已净化",138,107,12,MUTED);
        BodyRenderer.atlas(p,g,154,121,203,304,clock,true);
        label("沿血管依次前进",416,148,16,GOLD);
        for(int i=0;i<8;i++){
            boolean done=(g.body.cured&(1<<i))!=0;boolean current=i==g.body.organ;
            int color=done?0xff9ed5b7:current?GOLD:MUTED;
            p.rect(421,166+i*31,8,8,color);if(i<7)p.line(425,179+i*31,425,195+i*31,2,0xff975e79);
            label(BodyJourney.NAMES[i],444,176+i*31,16,color);
            label(done?"已净化 · 奖励已发放":current?(g.inTown()?"当前目的地":"战斗中") :"完成前一副本后开放",548,175+i*31,11,color);
        }
        label("首次通关奖励：金币 + 体魄上限 10 + 药剂 1",416,426,11,MUTED);
        button("返回旅程",340,450,280,38,true);
    }
    private void bodyJournal(){
        veil();panel(88,42,784,466);label("梦入体内 · 远征札记",120,92,27,CREAM);
        label(g.quest(),121,123,13,GOLD);p.rect(491,145,1,255,0xff4a6266);
        label("副本与首次通关奖励",120,163,14,GOLD);
        for(int i=0;i<8;i++){
            boolean done=(g.body.cured&(1<<i))!=0;int color=done?0xff9ed5b7:i==g.body.organ?GOLD:MUTED;
            label((done?"✓ ":"· ")+BodyJourney.NAMES[i],121,192+i*25,14,color);
            label(BodyJourney.REWARDS[i]+" 金币 / 体魄 +10"+(done?"  已领":""),244,192+i*25,12,color);
        }
        label("当前装备",525,163,14,GOLD);label(g.arsenal.name(),525,200,20,CREAM);label("攻击 "+(int)g.attack+"  ·  生命上限 "+(int)g.maxHp,525,229,13,MUTED);
        label("当前器官的空投",525,269,14,GOLD);
        for(int slot=0;slot<2;slot++){int state=g.body.supply[g.body.organ*2+slot];String text=state==0?"未触发":state==1?"正在降落":state==2?"已落地 · 等待拾取":"已领取";label((slot==0?"药品 · 第 4 次击败":"武器 · 第 "+(g.body.organ==7?7:8)+" 次击败"),525,301+slot*47,12,CREAM);label(text,525,319+slot*47,11,state==3?0xff9ed5b7:GOLD);}
        if(g.guest.discovered){label("隐藏相遇 · 奶龙",120,382,13,GOLD);label(g.guest.status(),275,382,11,g.guest.stage==2?0xffa9d4b4:MUTED);}
        label(g.body.ending?"终章奖励已领取 · 远征完成":"完成全部副本，再找沈砚领取终章武器。",120,409,12,MUTED);
        button("返回旅程",340,444,280,40,true);
    }
    private void bodyHelp(){
        veil();panel(150,48,660,444);label("双境远征 · 旅者手册",184,98,27,CREAM);
        String[] lines={"从中山大学出发：向沈砚接取任务，再靠近北门血管入口。","八处副本依次开放；清除本处全部敌人，血管通向下一站。","第 4 次击败触发药品空投，第 8 次触发武器（脑部为 7 次）。","城镇右侧主题地图可进入数学星庭，用脚步寻找规律。","每个副本首次通关奖励金币、生命上限与药剂；终章另有武器。","死亡显示《病入膏肓》，可回据点重整，保留已领取成长。"};
        for(int i=0;i<lines.length;i++){label("0"+(i+1),185,151+i*36,11,GOLD);label(lines[i],214,151+i*36,12,CREAM);}
        label("数学机关可重走；原理在发现后记录，光门或暂停菜单可回城。",185,390,12,MUTED);
        label("桌面：WASD 移动 · J/K 战斗 · E 交谈转运 · M 地图 · N 主题 · T 重走 · L 札记",185,413,10,MUTED);
        button("明白了，出发",340,432,280,42,true);
    }
    private void bodyResult(){
        boolean won=g.mode==Game.VICTORY;veil();panel(248,58,464,430);
        icon(won?15:3,451,80,58);center(won?"体内远征 · 八境净化":"《病入膏肓》",480,182,won?29:35,won?GOLD:0xffe5a29e);
        center(won?"全部器官副本已完成，沿血管返回梦境据点。":"梦境中的旅人倒下了，远征还可以重新开始。",480,218,13,MUTED);
        if(!won)center("倒在 "+g.body.name()+" · "+g.lastCause,480,249,14,GOLD);
        else center("已发放 785 副本金币 · 生命上限累计 +80",480,249,14,GOLD);
        center("等级 "+g.level+"   击败 "+g.kills+"   用时 "+time(g.elapsed),480,281,14,CREAM);
        center(won?"再与沈砚交谈：180 金币 + 终章武器":"保留等级、装备与已领取奖励；当前副本重置",480,312,12,MUTED);
        button(won?"沿血管返回 · 领取终章奖励":"回中山大学重整",303,350,354,46,true);
        button("返回主界面",303,414,354,36,false);
    }
    private void dialogue(){
        Story.Dialogue d=g.story.dialogue;if(d==null)return;
        root.rect(0,0,W,H,0x40101820);panel(76,310,808,212);
        p.rect(104,290,186,34,0xffe6d2a2);p.rect(106,292,182,30,0xff1c2c36);p.rect(106,292,182,2,GOLD);String speaker=d.speaker().equals(Game.HERO)?g.heroName:d.speaker();label(speaker,120,315,Math.min(17,160f/Math.max(1,speaker.codePointCount(0,speaker.length()))),GOLD);
        label("故事对话",764,336,11,MUTED);p.text((d.page+1)+" / "+d.pages.length,855,336,11,MUTED,2);
        p.rect(97,344,109,145,0xffe6d2a2);p.rect(100,347,103,139,0xff1c303b);p.rect(105,352,93,2,EMBER);
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
