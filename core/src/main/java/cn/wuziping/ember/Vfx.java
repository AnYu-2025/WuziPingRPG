package cn.wuziping.ember;

import java.util.ArrayList;

/** Transient combat juice. Never written into the save, so older journeys stay readable. */
public final class Vfx {
    public static final class Mote {
        public float x,y,vx,vy,life,max,size;
        public int color,shape;
    }
    public final ArrayList<Mote> motes=new ArrayList<Mote>();
    public final float[] gx=new float[5],gy=new float[5],ga=new float[5];
    public float shake,flash,nova;
    private int seed=1;

    public void clear(){
        motes.clear();shake=flash=nova=0;
        for(int i=0;i<gx.length;i++){gx[i]=gy[i]=ga[i]=0;}
    }
    public void tick(float dt){
        shake=Math.max(0,shake-dt*16);
        flash=Math.max(0,flash-dt*2.6f);
        nova=Math.max(0,nova-dt);
        for(int i=0;i<ga.length;i++)ga[i]=Math.max(0,ga[i]-dt*2.8f);
        for(int i=motes.size()-1;i>=0;i--){
            Mote m=motes.get(i);m.life-=dt;m.x+=m.vx*dt;m.y+=m.vy*dt;m.vy+=28*dt;m.vx*=Math.max(0,1-dt*1.4f);
            if(m.life<=0)motes.remove(i);
        }
    }
    public void trail(float x,float y){
        float dx=x-gx[0],dy=y-gy[0];
        if(ga[0]>0&&dx*dx+dy*dy<49)return;
        for(int i=gx.length-1;i>0;i--){gx[i]=gx[i-1];gy[i]=gy[i-1];ga[i]=ga[i-1];}
        gx[0]=x;gy[0]=y;ga[0]=1;
    }
    public void burst(float x,float y,int color,int count,float speed,float life,float size){
        for(int i=0;i<count&&motes.size()<200;i++)add(x,y,angle(),speed*(.4f+(i%5)*.13f),life*(.65f+(i%3)*.16f),size,color,i%3);
    }
    public void arc(float x,float y,float facing,float spread,int color,int count){
        for(int i=0;i<count&&motes.size()<200;i++){
            float a=facing-spread*.5f+spread*(i+0.5f)/count;
            add(x,y,a,48+(i%4)*22,.28f+(i%3)*.05f,3.2f,color,2);
        }
    }
    public void ring(float x,float y,int color,int count,float speed){
        for(int i=0;i<count&&motes.size()<200;i++)add(x,y,(float)(i*Math.PI*2/Math.max(1,count)),speed,.42f,3.4f,color,i%2);
    }
    public void kick(float amount){shake=Math.min(11,shake+amount);}
    private void add(float x,float y,float a,float speed,float life,float size,int color,int shape){
        Mote m=new Mote();m.x=x;m.y=y;m.vx=(float)Math.cos(a)*speed;m.vy=(float)Math.sin(a)*speed-16;
        m.life=m.max=life;m.size=size;m.color=color;m.shape=shape;motes.add(m);
    }
    private float angle(){seed=seed*1103515245+12345;return ((seed>>>8)&1023)/1023f*(float)(Math.PI*2);}
}
