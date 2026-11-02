package cn.wuziping.ember;

/** Geometry is drawn from the same coordinates used by movement validation. */
public final class MathRenderer {
    private static float sx(float x,float c){return (x-c)*2;}
    public static void draw(Painter p,Game g,float cx,float cy,float width,float height,float time){
        MathJourney m=g.math;p.rect(0,0,width,height,0xff111b30);
        int tx=(int)cx/32,ty=(int)cy/32;
        for(int y=ty;y<ty+height/64+3;y++)for(int x=tx;x<tx+width/64+3;x++){p.rect(sx(x*32,cx),sx(y*32,cy),63,63,(x+y)%2==0?0xff1b2b41:0xff1d2e45);p.rect(sx(x*32,cx)+30,sx(y*32,cy)+30,2,2,0xff54727c);}
        for(int j=0;j<36;j++){float x=180+(j*367)%1150,y=160+(j*233)%830;float a=sx(x,cx),b=sx(y,cy);p.rect(a,b,10,2,0x446d8caa);p.rect(a+4,b-4,2,10,0x446d8caa);}
        if(m.level==0){
            for(int j=0;j<160;j++){double a=j*Math.PI/80;float x=768+(float)Math.cos(a)*180,y=576+(float)Math.sin(a)*180;p.rect(sx(x,cx)-3,sx(y,cy)-3,6,6,m.circle>0?0xff82b7b4:0xff3b596b);}
            float ox=sx(768,cx),oy=sx(576,cy);p.oval(ox-12,oy-12,24,24,0xffc7bf99);p.text("·",ox,oy+6,20,0xfff1d49c,1);
            for(int i=0;i<3;i++){double a=i*Math.PI*2/3;beacon(p,sx(768+(float)Math.cos(a)*180,cx),sx(576+(float)Math.sin(a)*180,cy),(m.circle&(1<<i))!=0,i+1);}
            if(m.circle!=0)p.line(ox,oy,sx(g.x,cx),sx(g.y,cy),1,0x447bcebd);
        }else if(m.level==1){
            for(int i=0;i<7;i++){float[] a=MathJourney.NODES[MathJourney.EDGES[i][0]],b=MathJourney.NODES[MathJourney.EDGES[i][1]];p.line(sx(a[0],cx),sx(a[1],cy)+5,sx(b[0],cx),sx(b[1],cy)+5,50,0xff111b30);p.line(sx(a[0],cx),sx(a[1],cy),sx(b[0],cx),sx(b[1],cy),43,(m.bridges&(1<<i))!=0?0xff6b9e96:0xff48516d);p.line(sx(a[0],cx),sx(a[1],cy),sx(b[0],cx),sx(b[1],cy),2,0xffbaa7c8);}
            for(int i=0;i<5;i++){float x=sx(MathJourney.NODES[i][0],cx),y=sx(MathJourney.NODES[i][1],cy);p.oval(x-50,y-40,100,80,0xff3c4a62);p.oval(x-44,y-34,88,68,0xff24354c);beacon(p,x,y,i==m.node,i+1);}
        }else{
            p.rect(sx(330,cx),sx(415,cy),1720,10,0xffb6a4d3);p.rect(sx(330,cx),sx(760,cy),1720,10,0xffb6a4d3);
            for(int side=0;side<2;side++){float x=sx(side==0?360:1160,cx);p.rect(x-6,sx(420,cy),12,680,0xffb49cd5);for(int j=0;j<9;j++){float y=sx(450+j*34,cy);p.line(x-17,y+(side==0?-8:8),x,y,3,0xffe7c2e5);p.line(x,y,x+17,y+(side==0?8:-8),3,0xffe7c2e5);}}
            for(int i=0;i<3;i++){boolean lit=(m.ribbon&(1<<i))!=0;beacon(p,sx(MathJourney.MARKS[i][0],cx),sx(MathJourney.MARKS[i][1],cy),lit,i+1);p.text(i==1?"−":"+",sx(MathJourney.MARKS[i][0],cx),sx(MathJourney.MARKS[i][1],cy)-28,21,0xffd8c3e7,1);}
            p.text(m.orientation==0?"↑ 局部朝向":"↓ 局部朝向",sx(g.x,cx),sx(g.y,cy)-90,12,0xffd8c3e7,1);
        }
        for(int i=0;i<m.trailCount;i++){int j=(m.trailHead-1-i+128)%128;int alpha=70+(m.trailCount-i)*130/Math.max(1,m.trailCount);p.rect(sx(m.trailX[j],cx)-2,sx(m.trailY[j],cy)-1,4,3,(alpha<<24)|0xaddbcb);}
        float gateX=sx(m.gateX(),cx),gateY=sx(m.gateY(),cy);p.oval(gateX-29,gateY-17,58,34,0xff497e95);p.oval(gateX-21,gateY-12,42,24,0xff172b40);p.text("光门",gateX,gateY+38,11,0xffd8e5d2,1);
    }
    private static void beacon(Painter p,float x,float y,boolean lit,int index){p.oval(x-24,y-24,48,48,lit?0xff79bdab:0xff5a5779);p.oval(x-18,y-18,36,36,0xff17263b);p.text(""+index,x,y+6,17,lit?0xffd4f2d4:0xffbaaace,1);}
    public static void minimap(Painter p,Game g,float x,float y,float w,float h){
        MathJourney m=g.math;p.rect(x,y,w,h,0xff17263b);
        if(m.level==0){for(int i=0;i<64;i++){double a=i*Math.PI/32;p.rect(x+(768+(float)Math.cos(a)*180)/1536*w,y+(576+(float)Math.sin(a)*180)/1152*h,2,2,0xff80aaa8);}}
        else if(m.level==1){for(int i=0;i<7;i++){float[] a=MathJourney.NODES[MathJourney.EDGES[i][0]],b=MathJourney.NODES[MathJourney.EDGES[i][1]];p.line(x+a[0]/1536*w,y+a[1]/1152*h,x+b[0]/1536*w,y+b[1]/1152*h,2,(m.bridges&(1<<i))==0?0xff9784ae:0xff94dfc8);}}
        else{p.rect(x+330f/1536*w,y+420f/1152*h,860f/1536*w,340f/1152*h,0xff445470);for(float[] a:MathJourney.MARKS)p.rect(x+a[0]/1536*w-1,y+a[1]/1152*h-1,3,3,0xffe0bad5);}
        p.rect(x+m.gateX()/1536*w-2,y+m.gateY()/1152*h-2,4,4,0xffe6c28c);p.rect(x+g.x/1536*w-2,y+g.y/1152*h-2,4,4,0xffabf3d7);
    }
}
