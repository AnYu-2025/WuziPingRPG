package cn.wuziping.ember;

final class UiPainter implements Painter {
    private final Painter target;float x,y;
    UiPainter(Painter p){target=p;}
    public void rect(float a,float b,float w,float h,int c){target.rect(a+x,b+y,w,h,c);}
    public void oval(float a,float b,float w,float h,int c){target.oval(a+x,b+y,w,h,c);}
    public void line(float a,float b,float c,float d,float w,int color){target.line(a+x,b+y,c+x,d+y,w,color);}
    public void text(String s,float a,float b,float size,int c,int align){target.text(s,a+x,b+y,size,c,align);}
    public void image(String n,int sx,int sy,int sw,int sh,float a,float b,float w,float h,float alpha,boolean flip){target.image(n,sx,sy,sw,sh,a+x,b+y,w,h,alpha,flip);}
}
