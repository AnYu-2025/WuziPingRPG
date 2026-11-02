package cn.wuziping.ember;

/** Shared pixel scenery and blood-vessel transit visuals, independent of Android. */
public final class BodyRenderer {
    private static final int[] EDGE={0xff6d526b,0xff55818b,0xff9c6b80,0xff9b5868,0xff9b649e};
    private static final int[] VOID={0xff111c2b,0xff101f2d,0xff211c2b,0xff211929,0xff181426};
    public static void terrain(Painter p,Game g,float cx,float cy,float t){
        int region=g.body.organ;int tx=(int)cx/16,ty=(int)cy/16;p.rect(0,0,960,540,VOID[region]);
        for(int yy=ty;yy<=ty+18;yy++)for(int xx=tx;xx<=tx+31;xx++){
            int wx=xx*16,wy=yy*16;boolean inside=BodyJourney.inside(region,wx+8,wy+8,0);
            if(!inside)continue;
            boolean fold=BodyJourney.blocked(region,wx+8,wy+8,0);
            boolean vessel=Math.abs(wx-640)<24||Math.abs(wy-480)<16;
            int tile=((xx*173+yy*317)&31)+(vessel?32:0);
            p.image("body_tiles.png",tile%16*16,region*64+tile/16*16,16,16,(wx-cx)*2,(wy-cy)*2,32,32,1,false);
            if(fold){p.rect((wx-cx)*2,(wy-cy)*2,32,32,EDGE[region]);p.rect((wx-cx)*2+3,(wy-cy)*2+3,26,3,0xffcb9d9d);}
            else if(!BodyJourney.inside(region,wx+8,wy+8,18)){p.rect((wx-cx)*2+2,(wy-cy)*2+2,28,4,EDGE[region]);p.rect((wx-cx)*2+2,(wy-cy)*2+25,28,3,EDGE[region]);}
        }
        // Organ-specific structures: cartilage, alveoli, intestinal walls, liver lobules, nuclei.
        for(int yy=ty/4*4;yy<ty+21;yy+=4)for(int xx=tx/4*4;xx<tx+34;xx+=4){
            float wx=xx*16+27,wy=yy*16+29;
            if(!BodyJourney.inside(region,wx,wy,35)||Math.abs(wx-640)<65||Math.abs(wy-480)<32||g.blocked(wx,wy,15))continue;
            float sx=(wx-cx)*2,sy=(wy-cy)*2;int hash=Math.abs(xx*83+yy*179);
            if(region==0){p.oval(sx-19,sy-11,38,22,0xff60536e);p.oval(sx-13,sy-7,26,14,0xff332f45);}
            else if(region==1){for(int j=0;j<3;j++){float ox=j*13-13,oy=j%2*8;p.oval(sx+ox-14,sy+oy-14,28,28,0xff4c7e85);p.oval(sx+ox-11,sy+oy-11,22,22,0xff2e4e59);p.rect(sx+ox-6,sy+oy-8,3,3,0xff8dc6c2);}}
            else if(region==2){p.oval(sx-18,sy-8,36,16,0xff916578);p.oval(sx-13,sy-5,26,10,0xff533d51);}
            else if(region==3){p.oval(sx-22,sy-19,44,38,0xff714351);p.oval(sx-14,sy-13,28,26,0xff593543);p.rect(sx-3,sy-3,6,6,0xffbb7c7d);}
            else{p.oval(sx-24,sy-20,48,40,0xff64446f);p.oval(sx-19,sy-16,38,32,0xff362b4b);p.oval(sx-9,sy-8,18,16,hash%2==0?0xffa56c9e:0xff8a608d);}
        }
        // Blood cells travel along the central vessel; no random state is consumed by rendering.
        for(int i=0;i<16;i++){float wx=626+(i%3)*11,wy=100+(i*57+t*24)%720;if(!BodyJourney.inside(region,wx,wy,3))continue;float sx=(wx-cx)*2,sy=(wy-cy)*2;p.oval(sx-8,sy-5,16,10,0xffa45c6d);p.oval(sx-4,sy-2,8,4,0xff713e55);}
        float px=(BodyJourney.GATE_X-cx)*2,py=(BodyJourney.GATE_Y-cy)*2;
        p.oval(px-43,py-29,86,58,0xff573345);p.oval(px-34,py-23,68,46,0xffbf7585);p.oval(px-27,py-19,54,38,0xff4c334f);
        for(int j=0;j<12;j++){double a=j*Math.PI/6+t*.7;p.rect(px+(float)Math.cos(a)*29-2,py+(float)Math.sin(a)*19-2,4,4,0xffe7aaa7);}
        p.rect(px-67,py+30,134,19,0xe020293b);p.text("血管转运门",px,py+44,12,0xffe7bcac,1);
        for(int i=0;i<12;i++){float sx=(i*83+t*(i%2==0?4:-3)+9600)%960,sy=(i*53+t*5)%540;p.rect(sx,sy,2,2,0x7797a6c0);}
    }
    public static void supplies(Painter p,Game g,float cx,float cy,float clock){
        for(int i=g.body.organ*2;i<g.body.organ*2+2;i++){
            int state=g.body.supply[i];if(state!=1&&state!=2)continue;
            float x=(g.body.supplyX[i]-cx)*2,y=(g.body.supplyY[i]-cy)*2;
            if(x<-100||x>1060||y<-50||y>750)continue;
            int color=i%2==0?0xff9ed4c8:0xffe8c287;
            for(int j=0;j<12;j++){double a=j*Math.PI/6;p.rect(x+(float)Math.cos(a)*26,y+(float)Math.sin(a)*15,4,3,color);}
            float height=state==1?g.body.fall[i]*42:3+(float)Math.sin(clock*3)*2;
            float by=y-height;
            p.oval(x-14,y-4,28,8,0x77122230);p.rect(x-16,by-24,32,26,0xff243746);p.rect(x-14,by-22,28,22,color);p.rect(x-10,by-19,20,16,0xff53626c);
            if(i%2==0){p.rect(x-2,by-17,4,13,color);p.rect(x-6,by-13,12,4,color);}else{p.line(x-7,by-6,x+7,by-19,3,color);p.line(x-8,by-12,x-1,by-5,2,color);}
            if(state==1){p.line(x-14,by-22,x-29,by-62,1,0xffe9d7b8);p.line(x+14,by-22,x+29,by-62,1,0xffe9d7b8);p.oval(x-33,by-83,66,29,color);p.rect(x-32,by-67,64,7,0xff6e7f85);}
            else{p.rect(x-59,by-46,118,16,0xdd1b2c3b);p.text(i%2==0?"药品补给 · 靠近拾取":"武器补给 · 靠近拾取",x,by-34,10,color,1);}
        }
        if(g.body.transit>0){float a=g.body.transit/1.1f;for(int i=0;i<14;i++){float x=(i*79+clock*240)%960;p.rect(x,0,2,540,((int)(a*55)<<24)|0xc78d9b);}p.rect(0,0,960,7,0xffc78d9b);p.rect(0,533,960,7,0xffc78d9b);}
    }
    public static void atlas(Painter p,Game g,float x,float y,float w,float h,float clock,boolean labels){
        p.image("body_atlas.png",0,0,160,240,x,y,w,h,1,false);
        float[] nx={80,96,80,66,80},ny={64,91,142,116,161};
        for(int j=0;j<4;j++){
            int color=(g.body.cured&(1<<j))!=0?0xff7bbfa8:0xff895e7c;
            p.line(x+nx[j]/160*w,y+ny[j]/240*h,x+nx[j+1]/160*w,y+ny[j+1]/240*h,labels?3:2,color);
        }
        for(int i=0;i<5;i++){
            float xx=x+nx[i]/160*w,yy=y+ny[i]/240*h;boolean clear=(g.body.cured&(1<<i))!=0;
            int color=clear?0xff8ed0b7:i==g.body.organ?0xffefd092:0xffd47d91;
            float r=labels?7:3;if(i==g.body.organ){float pulse=2+(float)Math.sin(clock*4)*1.5f;p.oval(xx-r-pulse,yy-r-pulse,(r+pulse)*2,(r+pulse)*2,0x777c9aa7);}
            p.rect(xx-r,yy-r,r*2,r*2,color);
        }
    }
}
