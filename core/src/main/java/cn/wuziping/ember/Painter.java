package cn.wuziping.ember;

/** Shared draw contract: Android Canvas and Java2D use exactly the same scene layout. */
public interface Painter {
    void rect(float x,float y,float w,float h,int color);
    void oval(float x,float y,float w,float h,int color);
    void line(float x1,float y1,float x2,float y2,float width,int color);
    void text(String s,float x,float y,float size,int color,int align);
    void image(String name,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip);
    default void imageRotated(String name,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip,float degrees,float pivotX,float pivotY){image(name,sx,sy,sw,sh,x,y,w,h,alpha,flip);}
}
