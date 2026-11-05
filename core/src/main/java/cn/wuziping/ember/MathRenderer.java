package cn.wuziping.ember;

/** Themed geometry renderer: per-level palettes, animated light and explicit puzzle affordances. */
public final class MathRenderer {
    private static float sx(float x,float c){return (x-c)*2;}
    private static int alpha(int color,int a){return (a<<24)|(color&0xffffff);}
    private static final int[][] THEMES={
        {0xff0d2a2b,0xff163c3a,0xff7fd6b0,0xffe8c27a}, /* 等距花园 · 青绿 */
        {0xff101a35,0xff1b2a4a,0xffa9b8ff,0xffe8c27a}, /* 七桥星庭 · 星夜 */
        {0xff1b1230,0xff2a1c45,0xffc9a7f5,0xffef9ab4}  /* 翻向长廊 · 紫罗兰 */
    };
    public static void draw(Painter p,Game g,float cx,float cy,float width,float height,float time){
        MathJourney m=g.math;int[] theme=THEMES[m.level];
        int bg=theme[0],grid=theme[1],accent=theme[2],gold=theme[3];
        /* 地平线式渐变 + 细网格 + 呼吸星点 */
        p.rect(0,0,width,height,bg);
        for(int band=0;band<8;band++)p.rect(0,height*band/8,width,height/8+1,alpha(accent,4+band));
        int tx=(int)cx/32,ty=(int)cy/32;
        for(int y=ty;y<ty+height/64+3;y++)for(int x=tx;x<tx+width/64+3;x++){
            float a=sx(x*32,cx),b=sx(y*32,cy);
            p.rect(a,b,63,63,alpha(grid,(x+y)%2==0?38:22));
            p.rect(a,b,63,1,alpha(accent,18));p.rect(a,b,1,63,alpha(accent,18));
            p.rect(a+30,b+30,2,2,alpha(accent,55));
        }
        for(int j=0;j<44;j++){
            float x=140+(j*367)%1260,y=120+(j*233)%900;
            float a=sx(x,cx),b=sx(y,cy)+ (float)Math.sin(time*1.3+j)*3;
            int tw=110+(int)(90*Math.abs(Math.sin(time*.8+j*.7)));
            p.rect(a,b,9,2,alpha(accent,tw));p.rect(a+3,b-3,2,9,alpha(accent,tw));
        }
        /* 沿画布缓慢移动的光带 */
        float sweep=sx(((time*28)%1536),cx);
        p.rect(sweep,sx(120,cy),3,height,alpha(accent,26));
        if(m.level==0)garden(p,g,m,cx,cy,time,accent,gold,grid);
        else if(m.level==1)bridges(p,g,m,cx,cy,time,accent,gold,grid);
        else corridor(p,g,m,cx,cy,time,accent,gold,grid);
        /* 脚印余辉：越新越亮，末端带一点光晕 */
        for(int i=0;i<m.trailCount;i++){
            int j=(m.trailHead-1-i+128)%128;
            int a=28+(m.trailCount-i)*150/Math.max(1,m.trailCount);
            float x=sx(m.trailX[j],cx),y=sx(m.trailY[j],cy);
            p.oval(x-5,y-3,10,6,alpha(accent,a/3));
            p.rect(x-2,y-1,4,3,alpha(0xaddbcb,a));
        }
        float gx=sx(m.gateX(),cx),gy=sx(m.gateY(),cy);
        float pulse=4+(float)Math.sin(time*3)*2;
        p.oval(gx-38-pulse,gy-26-pulse,76+pulse*2,52+pulse*2,alpha(accent,40));
        p.oval(gx-29,gy-17,58,34,0xff497e95);p.oval(gx-21,gy-12,42,24,0xff172b40);
        p.text("光门",gx,gy+38,11,0xffd8e5d2,1);
        if(m.cleared()){
            p.oval(sx(g.x,cx)-70,sx(g.y,cy)-70,140,140,alpha(gold,26));
            p.oval(sx(g.x,cx)-48,sx(g.y,cy)-48,96,96,alpha(gold,44));
        }
    }
    private static void garden(Painter p,Game g,MathJourney m,float cx,float cy,float time,int accent,int gold,int grid){
        float ox=sx(768,cx),oy=sx(576,cy);
        /* 等距光晕与半径参考 */
        for(int r=0;r<4;r++)p.oval(ox-(180+r*26)*2,oy-(180+r*26)*2,(180+r*26)*4,(180+r*26)*4,alpha(accent,8));
        p.oval(ox-360,oy-360,720,720,alpha(accent,20));
        p.oval(ox-352,oy-352,704,704,alpha(accent,30));
        /* 圆环分段：已完成的段亮起，当前期望段呼吸 */
        int lit=m.circle,expected=m.nextBeacon();
        for(int j=0;j<160;j++){
            double a0=j*Math.PI/80,a1=(j+1)*Math.PI/80;
            int segment=(int)(a0/(Math.PI*2/3));
            boolean done=(lit&(1<<Math.min(2,segment)))!=0;
            int color=done?accent:segment==expected?gold:grid;
            int a=done?210:segment==expected?150+(int)(60*Math.abs(Math.sin(time*2.4))):90;
            float x0=sx(768+(float)Math.cos(a0)*180,cx),y0=sx(576+(float)Math.sin(a0)*180,cy);
            float x1=sx(768+(float)Math.cos(a1)*180,cx),y1=sx(576+(float)Math.sin(a1)*180,cy);
            p.line(x0,y0,x1,y1,done?7:5,alpha(color,a));
        }
        /* 方向箭头 */
        for(int k=0;k<8;k++){
            double a=k*Math.PI/4+.35;
            float x=768+(float)Math.cos(a)*180,y=576+(float)Math.sin(a)*180;
            float dx=-(float)Math.sin(a)*14,dy=(float)Math.cos(a)*14;
            p.line(sx(x+dx,cx),sx(y+dy,cy),sx(x,cx),sx(y,cy),2,alpha(accent,90));
            p.line(sx(x,cx),sx(y,cy),sx(x-dx+dy*.4f,cx),sx(y-dy-dx*.4f,cy),2,alpha(accent,90));
        }
        p.oval(ox-14,oy-14,28,28,alpha(gold,70));p.oval(ox-10,oy-10,20,20,0xffc7bf99);
        p.text("·",ox,oy+7,20,0xfff1d49c,1);
        p.line(ox,oy,sx(g.x,cx),sx(g.y,cy),1,alpha(accent,110));
        p.text("r = 180",ox+22,oy-18,10,alpha(accent,190),0);
        for(int i=0;i<3;i++){
            double a=i*Math.PI*2/3;
            float x=sx(768+(float)Math.cos(a)*180,cx),y=sx(576+(float)Math.sin(a)*180,cy);
            boolean on=(lit&(1<<i))!=0,next=i==expected&&!m.cleared();
            beacon(p,x,y,on,i+1,on?accent:next?gold:grid,next?time:0,alpha(accent,30));
            if(next)p.text("下一盏",x,y+44,10,gold,1);
            p.text(i==1?"+":"+",x,y-34,10,alpha(accent,150),1);
        }
        p.text("等距 · 按顺序 ① → ② → ③",sx(768,cx),sx(250,cy),12,alpha(accent,190),1);
    }
    private static void bridges(Painter p,Game g,MathJourney m,float cx,float cy,float time,int accent,int gold,int grid){
        /* 桥：未走暗、已走亮、当前边流动光点 */
        for(int i=0;i<7;i++){
            float[] a=MathJourney.NODES[MathJourney.EDGES[i][0]],b=MathJourney.NODES[MathJourney.EDGES[i][1]];
            float ax=sx(a[0],cx),ay=sx(a[1],cy),bx=sx(b[0],cx),by=sx(b[1],cy);
            boolean walked=(m.bridges&(1<<i))!=0,current=i==m.edge;
            p.line(ax,ay+8,bx,by+8,54,0xff0a1224);
            p.line(ax,ay,bx,by,46,alpha(grid,walked?90:150));
            p.line(ax,ay,bx,by,walked?16:current?20:12,walked?alpha(accent,225):current?alpha(gold,190):alpha(accent,80));
            p.line(ax,ay,bx,by,2,alpha(walked?gold:accent,walked?230:150));
            if(current){
                float t=(time*.7f)%1f,x=ax+(bx-ax)*t,y=ay+(by-ay)*t;
                p.oval(x-9,y-9,18,18,alpha(gold,200));
            }
            p.text(""+(i+1),(ax+bx)/2,(ay+by)/2-24,10,alpha(walked?gold:accent,160),1);
        }
        for(int i=0;i<5;i++){
            float x=sx(MathJourney.NODES[i][0],cx),y=sx(MathJourney.NODES[i][1],cy);
            boolean odd=MathJourney.DEGREE[i]%2==1,start=i==0||i==3,here=i==m.node;
            p.oval(x-58,y-48,116,96,alpha(odd?gold:accent,odd?50:26));
            p.oval(x-50,y-40,100,80,0xff3c4a62);p.oval(x-44,y-34,88,68,0xff24354c);
            beacon(p,x,y,here,i+1,here?gold:odd?gold:accent,here?time:0,alpha(accent,30));
            p.text("度 "+MathJourney.DEGREE[i],x,y+52,10,alpha(odd?gold:accent,220),1);
            if(start&&m.node<0&&m.bridges==0)p.text("起点候选",x,y-56,10,gold,1);
        }
        /* 七桥进度条 */
        float bx=sx(360,cx),by=sx(1010,cy);
        p.rect(bx,by,816,10,alpha(grid,180));
        for(int i=0;i<7;i++)if((m.bridges&(1<<i))!=0)p.rect(bx+i*116,by,110,10,accent);
        p.text("欧拉路径 · 奇数度顶点只能有 0 或 2 个",sx(768,cx),sx(160,cy),12,alpha(accent,190),1);
    }
    private static void corridor(Painter p,Game g,MathJourney m,float cx,float cy,float time,int accent,int gold,int grid){
        /* 长廊上下边界与流动光带 */
        p.rect(sx(330,cx),sx(410,cy),1720,12,alpha(accent,70));
        p.rect(sx(330,cx),sx(758,cy),1720,12,alpha(accent,70));
        for(int j=0;j<26;j++){
            float x=sx(340+j*33,cx),phase=(time*60+j*33)%860;
            p.rect(x,sx(420,cy)+0,2,676,alpha(accent,16));
            p.rect(x+phase*.1f,sx(430+ (j%3)*90,cy),18,2,alpha(accent,55));
        }
        /* 接缝能量柱 */
        for(int side=0;side<2;side++){
            float x=sx(side==0?360:1160,cx);
            p.rect(x-12,sx(420,cy),24,680,alpha(accent,45));
            p.rect(x-4,sx(420,cy),8,680,alpha(gold,120));
            for(int j=0;j<11;j++){
                float y=sx(440+j*58,cy)+ (float)Math.sin(time*2+j)*4;
                p.line(x-20,y+(side==0?-8:8),x,y,3,alpha(gold,190));
                p.line(x,y,x+20,y+(side==0?8:-8),3,alpha(gold,190));
            }
            p.text(side==0?"缝合 A":"缝合 B",x,sx(790,cy),10,alpha(accent,190),1);
        }
        /* 莫比乌斯扭转示意 */
        for(int j=0;j<7;j++){
            float x=sx(430+j*120,cx),y=sx(560+(float)Math.sin(time*.6+j)*18,cy);
            p.line(x,y,x+70,y+(j%2==0?24:-24),2,alpha(accent,60));
        }
        /* 幻影路标 */
        for(float[] d:MathJourney.DECOYS){
            float x=sx(d[0],cx),y=sx(d[1],cy);
            p.oval(x-22,y-22,44,44,alpha(0xffef9ab4,45));
            p.oval(x-16,y-16,32,32,alpha(0xffef9ab4,80));
            p.text("?",x,y+7,18,0xffffd9e4,1);
            p.text("幻影",x,y+40,9,0xffef9ab4,1);
        }
        for(int i=0;i<3;i++){
            boolean lit=(m.ribbon&(1<<i))!=0;
            float x=sx(MathJourney.MARKS[i][0],cx),y=sx(MathJourney.MARKS[i][1],cy);
            beacon(p,x,y,lit,i+1,lit?accent:gold,lit?time:0,alpha(accent,30));
            p.text(i==1?"−":"+",x,y-34,18,0xffd8c3e7,1);
        }
        p.text(m.orientation==0?"↑ 局部朝向 +":"↓ 局部朝向 −",sx(g.x,cx),sx(g.y,cy)-96,13,gold,1);
        p.text("穿越 "+m.crossings()+" / "+MathJourney.MAX_CROSSINGS,sx(768,cx),sx(170,cy),12,alpha(accent,200),1);
        for(int i=0;i<MathJourney.MAX_CROSSINGS;i++)p.rect(sx(600+i*56,cx),sx(190,cy),44,6,i<m.crossings()?gold:alpha(grid,200));
    }
    private static void beacon(Painter p,float x,float y,boolean lit,int index,int color,float time,int halo){
        float pulse=lit?3+(float)Math.sin(time*4)*2:0;
        p.oval(x-30-pulse,y-30-pulse,60+pulse*2,60+pulse*2,lit?alpha(color,70):halo);
        p.oval(x-24,y-24,48,48,lit?color:0xff5a5779);
        p.oval(x-18,y-18,36,36,0xff17263b);
        p.text(""+index,x,y+6,17,lit?0xffd4f2d4:0xffbaaace,1);
    }
    public static void minimap(Painter p,Game g,float x,float y,float w,float h){
        MathJourney m=g.math;int accent=THEMES[m.level][2],gold=THEMES[m.level][3];
        p.rect(x,y,w,h,0xff17263b);
        if(m.level==0){
            for(int i=0;i<64;i++){double a=i*Math.PI/32;p.rect(x+(768+(float)Math.cos(a)*180)/1536*w,y+(576+(float)Math.sin(a)*180)/1152*h,2,2,(m.circle&(1<<Math.min(2,(int)(a/(Math.PI*2/3)))))!=0?accent:0xff80aaa8);}
            double a=m.nextBeacon()*Math.PI*2/3;p.rect(x+(768+(float)Math.cos(a)*180)/1536*w-2,y+(576+(float)Math.sin(a)*180)/1152*h-2,5,5,gold);
        }else if(m.level==1){
            for(int i=0;i<7;i++){float[] a=MathJourney.NODES[MathJourney.EDGES[i][0]],b=MathJourney.NODES[MathJourney.EDGES[i][1]];p.line(x+a[0]/1536*w,y+a[1]/1152*h,x+b[0]/1536*w,y+b[1]/1152*h,2,(m.bridges&(1<<i))==0?0xff9784ae:accent);}
            for(int i=0;i<5;i++)if(MathJourney.DEGREE[i]%2==1)p.rect(x+MathJourney.NODES[i][0]/1536*w-2,y+MathJourney.NODES[i][1]/1152*h-2,5,5,gold);
        }else{
            p.rect(x+330f/1536*w,y+420f/1152*h,860f/1536*w,340f/1152*h,0xff445470);
            for(float[] a:MathJourney.MARKS)p.rect(x+a[0]/1536*w-1,y+a[1]/1152*h-1,3,3,0xffe0bad5);
            for(float[] d:MathJourney.DECOYS)p.rect(x+d[0]/1536*w-1,y+d[1]/1152*h-1,3,3,0xffef9ab4);
        }
        p.rect(x+m.gateX()/1536*w-2,y+m.gateY()/1152*h-2,4,4,0xffe6c28c);p.rect(x+g.x/1536*w-2,y+g.y/1152*h-2,4,4,0xffabf3d7);
    }
}
