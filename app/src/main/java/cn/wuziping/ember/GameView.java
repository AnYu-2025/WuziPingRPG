package cn.wuziping.ember;

import android.content.Context;
import android.graphics.*;
import android.view.*;
import java.io.*;
import java.util.*;

/** Native 2D Canvas app; simulation and touch input stay on the UI thread. */
public final class GameView extends View implements Painter {
    public final Game game;
    public final Controls controls=new Controls();
    private final Scene scene=new Scene();
    private final Viewport viewport=new Viewport();
    private final Paint paint=new Paint();
    private final Rect source=new Rect();
    private final RectF target=new RectF();
    private final HashMap<String,Bitmap> images=new HashMap<>();
    private final GameAudio audio;
    private Canvas canvas;
    private long lastTime=0,lastSave=0,startTime=System.nanoTime();
    private float scale=1,ox=0,oy=0,accumulator=0;
    private boolean suspended=false;
    public GameView(Context context,Game state){
        super(context);game=state;setFocusable(true);setFocusableInTouchMode(true);requestFocus();
        paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        for(String name:new String[]{"tiles.png","actors.png","objects.png","icons.png","town.png","town_tiles.png","town_props.png","npcs.png","body_tiles.png","body_enemies.png","body_atlas.png","nailong.png","bosses.png","weapons.png"}){
            try(InputStream s=context.getAssets().open(name)){BitmapFactory.Options opts=new BitmapFactory.Options();opts.inScaled=false;images.put(name,BitmapFactory.decodeStream(s,null,opts));}catch(IOException e){throw new IllegalStateException("Missing game asset: "+name,e);}
        }
        audio=new GameAudio(context);setContentDescription("伍子平星火远征，横屏二维像素动作游戏");
    }
    public void suspend(){suspended=true;game.pause();controls.clear();lastTime=0;audio.pause();}
    public void resumeView(){suspended=false;lastTime=0;postInvalidateOnAnimation();}
    public void dispose(){audio.release();for(Bitmap b:images.values())b.recycle();}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);canvas=c;
        long now=System.nanoTime();float dt=lastTime==0?0:Math.min(.1f,(now-lastTime)/1e9f);lastTime=now;
        if(!suspended){
            accumulator+=dt;int previous=game.mode;
            while(accumulator>=1f/60){game.update(1f/60,controls.input);controls.pulsesConsumed();accumulator-=1f/60;if(game.mode!=Game.PLAY)controls.clear();}
            if(previous!=game.mode||controls.dirty||now-lastSave>5_000_000_000L){((MainActivity)getContext()).persist(game);lastSave=now;controls.dirty=false;}
            while(!game.sounds.isEmpty())audio.effect(game.sounds.remove(),game.sound);
            audio.music(game.sound);
        }
        int il=0,it=0,ir=0,ib=0;
        if(android.os.Build.VERSION.SDK_INT>=28){WindowInsets insets=getRootWindowInsets();if(insets!=null&&insets.getDisplayCutout()!=null){DisplayCutout cutout=insets.getDisplayCutout();il=cutout.getSafeInsetLeft();it=cutout.getSafeInsetTop();ir=cutout.getSafeInsetRight();ib=cutout.getSafeInsetBottom();}}
        viewport.set(getWidth(),getHeight(),il,it,ir,ib);scale=viewport.scale;ox=oy=0;scene.layout=viewport;controls.layout=viewport;
        c.drawColor(Color.rgb(9,20,21));c.save();c.translate(ox,oy);c.scale(scale,scale);c.clipRect(0,0,viewport.width,viewport.height);
        scene.joyX=controls.input.mx;scene.joyY=controls.input.my;scene.draw(this,game,(now-startTime)/1e9f);c.restore();
        if(!suspended)postInvalidateOnAnimation();
    }
    @Override public boolean onTouchEvent(android.view.MotionEvent event){
        if(scale<=0)return true;
        int action=event.getActionMasked(),idx=event.getActionIndex();
        if(action==MotionEvent.ACTION_DOWN||action==MotionEvent.ACTION_POINTER_DOWN){controls.down(game,event.getPointerId(idx),(event.getX(idx)-ox)/scale,(event.getY(idx)-oy)/scale);performClick();}
        else if(action==MotionEvent.ACTION_MOVE){for(int n=0;n<event.getPointerCount();n++)controls.move(game,event.getPointerId(n),(event.getX(n)-ox)/scale,(event.getY(n)-oy)/scale);}
        else if(action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_POINTER_UP)controls.up(event.getPointerId(idx));
        else if(action==MotionEvent.ACTION_CANCEL)controls.clear();
        invalidate();return true;
    }
    @Override public boolean performClick(){super.performClick();return true;}
    @Override public boolean onKeyDown(int code,KeyEvent e){String k=key(code);if(k==null)return super.onKeyDown(code,e);if(e.getRepeatCount()==0)controls.key(game,k,true);return true;}
    @Override public boolean onKeyUp(int code,KeyEvent e){String k=key(code);if(k==null)return super.onKeyUp(code,e);controls.key(game,k,false);return true;}
    private String key(int code){switch(code){case KeyEvent.KEYCODE_W:return "W";case KeyEvent.KEYCODE_A:return "A";case KeyEvent.KEYCODE_S:return "S";case KeyEvent.KEYCODE_D:return "D";case KeyEvent.KEYCODE_J:return "J";case KeyEvent.KEYCODE_SPACE:return "SPACE";case KeyEvent.KEYCODE_K:return "K";case KeyEvent.KEYCODE_E:return "E";case KeyEvent.KEYCODE_L:return "L";case KeyEvent.KEYCODE_M:return "M";case KeyEvent.KEYCODE_B:return "B";case KeyEvent.KEYCODE_R:return "R";case KeyEvent.KEYCODE_Q:return "Q";case KeyEvent.KEYCODE_ENTER:return "ENTER";case KeyEvent.KEYCODE_SHIFT_LEFT:case KeyEvent.KEYCODE_SHIFT_RIGHT:return "SHIFT";case KeyEvent.KEYCODE_H:return "H";case KeyEvent.KEYCODE_ESCAPE:return "ESCAPE";case KeyEvent.KEYCODE_1:return "1";case KeyEvent.KEYCODE_2:return "2";case KeyEvent.KEYCODE_3:return "3";default:return null;}}
    @Override public void rect(float x,float y,float w,float h,int color){paint.setColor(color);paint.setAntiAlias(false);canvas.drawRect(x,y,x+w,y+h,paint);}
    @Override public void oval(float x,float y,float w,float h,int color){paint.setColor(color);paint.setAntiAlias(false);canvas.drawOval(x,y,x+w,y+h,paint);}
    @Override public void line(float x1,float y1,float x2,float y2,float width,int color){paint.setColor(color);paint.setStrokeWidth(width);paint.setAntiAlias(false);canvas.drawLine(x1,y1,x2,y2,paint);}
    @Override public void text(String s,float x,float y,float size,int color,int align){paint.setColor(color);paint.setAntiAlias(true);paint.setTextSize(size);paint.setTextAlign(align==1?Paint.Align.CENTER:align==2?Paint.Align.RIGHT:Paint.Align.LEFT);canvas.drawText(s,x,y,paint);paint.setAntiAlias(false);}
    @Override public void image(String name,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip){
        source.set(sx,sy,sx+sw,sy+sh);target.set(x,y,x+w,y+h);paint.setAlpha((int)(alpha*255));paint.setFilterBitmap(false);paint.setAntiAlias(false);
        if(flip){canvas.save();canvas.scale(-1,1,x+w/2,y+h/2);}canvas.drawBitmap(images.get(name),source,target,paint);if(flip)canvas.restore();paint.setAlpha(255);
    }
}
