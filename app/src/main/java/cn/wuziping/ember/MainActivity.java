package cn.wuziping.ember;

import android.app.Activity;
import android.os.Bundle;
import android.view.*;
import android.util.AtomicFile;
import android.widget.Toast;
import java.io.*;

public final class MainActivity extends Activity {
    private GameView view;
    private AtomicFile saveFile;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(android.os.Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams a=getWindow().getAttributes();a.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;getWindow().setAttributes(a);}
        immersive();saveFile=new AtomicFile(new File(getFilesDir(),"journey-v1.bin"));
        Game g=new Game();
        if(saveFile.getBaseFile().exists()){
            try(InputStream in=saveFile.openRead()){g=Game.load(in);}catch(Exception e){Toast.makeText(this,"旧存档无法读取，已进入新营地。",Toast.LENGTH_LONG).show();}
        }
        view=new GameView(this,g);setContentView(view);
    }
    private void immersive(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();}
    @Override protected void onPause(){super.onPause();if(view!=null){view.suspend();persist(view.game);}}
    @Override protected void onResume(){super.onResume();if(view!=null)view.resumeView();}
    @Override protected void onDestroy(){if(view!=null)view.dispose();super.onDestroy();}
    @Override public void onBackPressed(){if(view!=null){if(view.game.mode==Game.TITLE){persist(view.game);finish();}else{view.controls.back(view.game);persist(view.game);view.invalidate();}}}
    public void persist(Game game){
        FileOutputStream out=null;
        try{out=saveFile.startWrite();game.save(out);saveFile.finishWrite(out);}
        catch(IOException e){if(out!=null)saveFile.failWrite(out);android.util.Log.e("WuziPing","Save failed",e);}
    }
}
