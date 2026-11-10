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
        if(android.os.Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams a=getWindow().getAttributes();a.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;getWindow().setAttributes(a);}
        immersive();saveFile=new AtomicFile(new File(getFilesDir(),"journey-v1.bin"));
        Game g=new Game();
        try(InputStream in=saveFile.openRead()){g=Game.load(in);}catch(FileNotFoundException firstJourney){/* No journey has been created yet. */}catch(Exception e){Toast.makeText(this,"旧存档无法读取，已进入新营地。",Toast.LENGTH_LONG).show();}
        view=new GameView(this,g);setContentView(view);
    }
    private void immersive(){
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if(android.os.Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(false);WindowInsetsController c=getWindow().getInsetsController();if(c!=null){c.hide(WindowInsets.Type.systemBars());c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);}}
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();}
    @Override protected void onPause(){super.onPause();if(view!=null){view.suspend();persist(view.game);}}
    @Override protected void onResume(){super.onResume();if(view!=null)view.resumeView();}
    @Override protected void onDestroy(){if(view!=null)view.dispose();super.onDestroy();}
    public boolean isEditorHost(){return getIntent().getBooleanExtra("editorHost",false);}
    @Override public void onBackPressed(){if(view!=null){if(view.game.mode==Game.TITLE){persist(view.game);finish();}else if(getIntent().getBooleanExtra("editorHost",false)){
        view.suspend();persist(view.game);
        new android.app.AlertDialog.Builder(this).setTitle("旅途小憩").setMessage(view.game.inHistory()?"退出历史副本后剧情从头开始，经验和成长保留。":"游戏进度已保存，可以回到编辑器继续创作。")
            .setPositiveButton("保存并返回编辑器",(d,w)->{if(view.game.inHistory())view.game.history.exit(view.game);persist(view.game);finish();})
            .setNegativeButton("继续游戏",(d,w)->resumeHostedGame())
            .setNeutralButton("游戏主界面",(d,w)->{view.game.title();view.resumeView();})
            .setOnCancelListener(d->resumeHostedGame()).show();
    }else{view.controls.back(view.game);persist(view.game);view.invalidate();}}}
    private void resumeHostedGame(){if(view.game.mode==Game.PAUSE)view.game.resume();view.resumeView();}
    public void persist(Game game){
        FileOutputStream out=null;
        try{out=saveFile.startWrite();game.save(out);saveFile.finishWrite(out);}
        catch(IOException e){if(out!=null)saveFile.failWrite(out);android.util.Log.e("WuziPing","Save failed",e);}
    }
    public void requestRename(){
        final android.widget.EditText input=new android.widget.EditText(this);input.setSingleLine(true);input.setText(view.game.heroName);input.selectAll();
        new android.app.AlertDialog.Builder(this).setTitle("旅人的名字").setMessage("最多 12 个字符，留空恢复为伍子平").setView(input).setPositiveButton("保存",(d,w)->{view.game.setHeroName(input.getText().toString());persist(view.game);view.invalidate();}).setNegativeButton("取消",null).show();
    }
}
