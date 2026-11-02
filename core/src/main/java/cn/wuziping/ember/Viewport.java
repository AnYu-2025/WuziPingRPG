package cn.wuziping.ember;

/** Uniform pixel scale, window-filling world, independently anchored safe UI. */
public final class Viewport {
    public float scale=1,width=960,height=540,left=0,right=0,top=0,bottom=0,centerX=0,centerY=0;
    public void set(float w,float h,float il,float it,float ir,float ib){
        scale=Math.max(.01f,Math.min(Math.max(1,w-il-ir)/960,Math.max(1,h-it-ib)/540));width=w/scale;height=h/scale;
        left=il/scale;right=width-960-ir/scale;top=it/scale;bottom=height-540-ib/scale;
        centerX=(left+right)/2;centerY=(top+bottom)/2;
    }
}
