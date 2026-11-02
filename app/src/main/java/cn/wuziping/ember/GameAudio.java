package cn.wuziping.ember;

import android.content.Context;
import android.media.*;
import android.content.res.AssetFileDescriptor;
import java.util.*;

public final class GameAudio {
    private final SoundPool pool;
    private final HashMap<String,Integer> ids=new HashMap<>();
    private MediaPlayer music;
    private long lastPickup=0,lastHit=0;
    public GameAudio(Context context){
        AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        pool=new SoundPool.Builder().setMaxStreams(7).setAudioAttributes(attrs).build();
        for(String name:new String[]{"slash","hit","kill","hurt","dash","pickup","heal","skill","level","death","boss","warn"}){
            try(AssetFileDescriptor a=context.getAssets().openFd("audio/"+name+".wav")){ids.put(name,pool.load(a,1));}catch(Exception ignored){}
        }
        try(AssetFileDescriptor a=context.getAssets().openFd("audio/forest.wav")){
            music=new MediaPlayer();music.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());music.setDataSource(a.getFileDescriptor(),a.getStartOffset(),a.getLength());music.setLooping(true);music.setVolume(.3f,.3f);music.prepare();
        }catch(Exception ignored){music=null;}
    }
    public void effect(String name,boolean enabled){
        if(!enabled)return;long t=System.currentTimeMillis();
        if(name.equals("pickup")){if(t-lastPickup<75)return;lastPickup=t;}
        if(name.equals("hit")||name.equals("kill")){if(t-lastHit<65)return;lastHit=t;}
        Integer id=ids.get(name);if(id!=null)pool.play(id,.55f,.55f,1,0,1);
    }
    public void music(boolean enabled){if(music==null)return;if(enabled&&!music.isPlaying())music.start();else if(!enabled&&music.isPlaying())music.pause();}
    public void pause(){pool.autoPause();if(music!=null&&music.isPlaying())music.pause();}
    public void release(){pool.release();if(music!=null){music.release();music=null;}}
}
