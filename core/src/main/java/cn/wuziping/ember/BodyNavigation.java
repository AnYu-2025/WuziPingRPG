package cn.wuziping.ember;

import java.util.Arrays;

/** One cached flow field per player grid cell; organ walls cannot strand a chasing enemy. */
public final class BodyNavigation {
    private static final int STEP=16,W=80,H=60;
    private final int[] distance=new int[W*H],queue=new int[W*H];
    private final boolean[] solid=new boolean[W*H];
    private int region=-1,target=-1;
    public float dx,dy;
    public void prepare(Game g){
        int organ=g.body.organ,cell=cell(g.x,g.y);
        if(region==organ&&target==cell)return;
        if(region!=organ){for(int y=0;y<H;y++)for(int x=0;x<W;x++)solid[y*W+x]=BodyJourney.blocked(organ,x*STEP+8,y*STEP+8,11);}
        region=organ;target=cell;Arrays.fill(distance,-1);
        int source=-1;float best=Float.MAX_VALUE;
        for(int y=Math.max(0,cell/W-2);y<=Math.min(H-1,cell/W+2);y++)for(int x=Math.max(0,cell%W-2);x<=Math.min(W-1,cell%W+2);x++){
            int i=y*W+x;float d=Game.dist(g.x,g.y,x*STEP+8,y*STEP+8);if(!solid[i]&&d<best){source=i;best=d;}}
        if(source<0)return;int head=0,tail=0;queue[tail++]=source;distance[source]=0;
        while(head<tail){int i=queue[head++],x=i%W,y=i/W;
            if(x>0)tail=visit(i-1,i,tail);if(x<W-1)tail=visit(i+1,i,tail);if(y>0)tail=visit(i-W,i,tail);if(y<H-1)tail=visit(i+W,i,tail);
        }
    }
    private int visit(int to,int from,int tail){if(!solid[to]&&distance[to]<0){distance[to]=distance[from]+1;queue[tail++]=to;}return tail;}
    private int cell(float x,float y){return Math.min(H-1,Math.max(0,(int)y/STEP))*W+Math.min(W-1,Math.max(0,(int)x/STEP));}
    public void direction(Game g,Game.Enemy e){
        dx=g.x-e.x;dy=g.y-e.y;float d=Game.dist(e.x,e.y,g.x,g.y);boolean clear=true;
        for(float along=8;along<d;along+=12)if(BodyJourney.blocked(region,e.x+dx/d*along,e.y+dy/d*along,10)){clear=false;break;}
        if(clear)return;
        int c=cell(e.x,e.y),cx=c%W,cy=c/W;int best=-1,cost=Integer.MAX_VALUE;float nearest=Float.MAX_VALUE;
        for(int y=Math.max(0,cy-1);y<=Math.min(H-1,cy+1);y++)for(int x=Math.max(0,cx-1);x<=Math.min(W-1,cx+1);x++){
            int i=y*W+x;if(distance[i]<0)continue;
            if(x!=cx&&y!=cy&&(solid[cy*W+x]||solid[y*W+cx]))continue;
            float reach=Game.dist(e.x,e.y,x*STEP+8,y*STEP+8);
            if(distance[i]<cost||distance[i]==cost&&reach<nearest){best=i;cost=distance[i];nearest=reach;}
        }
        if(best>=0){dx=best%W*STEP+8-e.x;dy=best/W*STEP+8-e.y;}
    }
}
