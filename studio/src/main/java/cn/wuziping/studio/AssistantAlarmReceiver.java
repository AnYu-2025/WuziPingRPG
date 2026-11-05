package cn.wuziping.studio;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores assistant alarms after boot and records due tasks; never performs file deletion. */
public final class AssistantAlarmReceiver extends BroadcastReceiver {
    public static final String ACTION_TASK="cn.wuziping.studio.ASSISTANT_TASK";
    @Override public void onReceive(Context context,Intent intent){
        if(intent==null)return;
        AssistantTools tools=new AssistantTools(context,null,o->{});
        String action=intent.getAction();
        if(Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)){
            tools.restoreAlarms();return;
        }
        if(ACTION_TASK.equals(action)){
            String id=intent.getStringExtra("id"),kind=intent.getStringExtra("action");
            tools.recordEvent(id==null?"":id,kind==null?"remind":kind);
            tools.restoreAlarms();
        }
    }
}
