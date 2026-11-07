package cn.wuziping.studio;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;

/** Original assistant runtime: native HTTP bridge, read-only SAF scanning, guarded cleanup and alarms. */
public final class AssistantTools {
    public interface Emit { void emit(JSONObject message); }
    private static final String PREF="assistant-v1",KEY_TREE="tree",KEY_TASKS="tasks",KEY_EVENTS="events",KEY_DELETES="deletes";
    private final Context ctx;private final ExecutorService io;private final Emit emit;private final PhoneActions phone;
    private final Map<String,HttpURLConnection> calls=new ConcurrentHashMap<>();
    public AssistantTools(Context context,ExecutorService executor,Emit out){ctx=context;io=executor;emit=out;phone=new PhoneActions(context);}

    private SharedPreferences prefs(){return ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
    private void send(String type,String id,String data,boolean ok){
        try{JSONObject o=new JSONObject();o.put("type","aiToolResult");o.put("id",id);o.put("ok",ok);o.put("data",data);emit.emit(o);}catch(JSONException ignored){}
    }
    private Uri tree(){
        String value=prefs().getString(KEY_TREE,"");if(value.isEmpty())return null;
        try{return Uri.parse(value);}catch(Exception e){return null;}
    }
    public void saveTree(Uri uri,int flags){
        try{ctx.getContentResolver().takePersistableUriPermission(uri,
            flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(Exception ignored){}
        prefs().edit().putString(KEY_TREE,uri.toString()).apply();
    }
    public boolean hasTree(){return tree()!=null;}
    public boolean canScheduleExact(){
        if(Build.VERSION.SDK_INT<31)return true;
        AlarmManager am=(AlarmManager)ctx.getSystemService(Context.ALARM_SERVICE);
        return am!=null&&am.canScheduleExactAlarms();
    }

    /* ---------- AI HTTP bridge: WebView CSP forbids external connect ---------- */
    public void aiRequest(JSONObject m){
        final String id=m.optString("id","");if(id.isEmpty())return;
        final String url=m.optString("url",""),key=m.optString("key","");
        JSONObject bodyObject=m.optJSONObject("body");
        final String body=bodyObject!=null?bodyObject.toString():m.optString("body","");
        if(!(url.startsWith("https://")||url.startsWith("http://"))||url.length()>300||body.length()>1000000){
            aiFail(id,"接口地址无效或请求过大");return;
        }
        io.execute(()->{
            HttpURLConnection conn=null;
            try{
                conn=(HttpURLConnection)new URL(url).openConnection();
                conn.setRequestMethod("POST");conn.setDoOutput(true);
                /* Never auto-follow redirects: HttpURLConnection would re-send the
                   Authorization header to the Location host, leaking the user's API key
                   to a server they never chose. A 3xx surfaces as an explicit error instead. */
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);conn.setReadTimeout(120000);
                conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
                conn.setRequestProperty("Accept","text/event-stream");
                if(!key.isEmpty())conn.setRequestProperty("Authorization","Bearer "+key);
                conn.getOutputStream().write(body.getBytes("UTF-8"));
                calls.put(id,conn);
                int code=conn.getResponseCode();
                if(code<200||code>=300){aiFail(id,"服务返回 "+code);return;}
                BufferedReader reader=new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                StringBuilder plain=new StringBuilder();String line;boolean streamed=false;
                while((line=reader.readLine())!=null){
                    if(line.startsWith("data:")){
                        streamed=true;String payload=line.substring(5).trim();
                        if(payload.equals("[DONE]"))break;
                        try{
                            JSONObject chunk=new JSONObject(payload);JSONArray choices=chunk.optJSONArray("choices");
                            if(choices!=null&&choices.length()>0){
                                JSONObject delta=choices.getJSONObject(0).optJSONObject("delta");
                                String text=delta!=null?delta.optString("content",""):"";
                                if(!text.isEmpty())aiChunk(id,text);
                            }
                        }catch(JSONException ignored){}
                    }else if(line.trim().startsWith("{"))plain.append(line);
                }
                if(!streamed){
                    try{JSONObject full=new JSONObject(plain.toString());JSONArray choices=full.optJSONArray("choices");
                        if(choices!=null&&choices.length()>0){
                            JSONObject msg=choices.getJSONObject(0).optJSONObject("message");
                            String text=msg!=null?msg.optString("content",""):"";
                            if(!text.isEmpty())aiChunk(id,text);
                        }
                    }catch(JSONException ignored){}
                }
                try{JSONObject done=new JSONObject();done.put("type","aiDone");done.put("id",id);emit.emit(done);}catch(JSONException ignored){}
            }catch(Exception e){
                String reason=e.getMessage()==null?"网络异常":e.getMessage();
                if(!key.isEmpty())reason=reason.replace(key,"***");
                aiFail(id,"请求失败："+reason);
            }finally{calls.remove(id);if(conn!=null)conn.disconnect();}
        });
    }
    private void aiChunk(String id,String text){
        try{JSONObject o=new JSONObject();o.put("type","aiChunk");o.put("id",id);o.put("text",text);emit.emit(o);}catch(JSONException ignored){}
    }
    private void aiFail(String id,String reason){
        try{JSONObject o=new JSONObject();o.put("type","aiError");o.put("id",id);o.put("message",reason);emit.emit(o);}catch(JSONException ignored){}
    }
    public void aiCancel(String id){HttpURLConnection c=calls.remove(id);if(c!=null)try{c.disconnect();}catch(Exception ignored){}}

    /* ---------- Tool cards ---------- */
    public void tool(final JSONObject m){
        final String id=m.optString("id",""),tool=m.optString("tool","");
        final JSONObject args=m.optJSONObject("args")!=null?m.optJSONObject("args"):new JSONObject();
        io.execute(()->{
            try{
                String result;
                if(tool.equals("authorizeTree"))result=hasTree()?"目录已授权":"请先点「授权目录」选择要整理的文件夹";
                else if(tool.equals("scanFiles"))result=scan().toString();
                else if(tool.equals("organizeFiles"))result=organize(args.optJSONArray("moves")).toString();
                else if(tool.equals("deleteFiles"))result=deleteFiles(args).toString();
                else if(tool.equals("writeWorkLog"))result=writeLog(args.optString("text",""));
                else if(tool.equals("scheduleTask"))result=schedule(args).toString();
                else if(tool.equals("listTasks"))result=tasks().toString();
                else if(tool.equals("cancelTask"))result=cancel(args.optString("id","")).toString();
                else if(PhoneActionPlan.isPhoneTool(tool))result=phone.run(tool,args);
                else result="未知工具："+tool;
                send("aiToolResult",id,result,true);
            }catch(Exception e){send("aiToolResult",id,"操作未完成："+(e.getMessage()==null?"":e.getMessage()),false);}
        });
    }
    private JSONObject scan()throws Exception{
        Uri root=tree();if(root==null)throw new IOException("请先授权一个目录");
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(root,DocumentsContract.getTreeDocumentId(root));
        Cursor c=ctx.getContentResolver().query(children,new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED},null,null,null);
        JSONArray items=new JSONArray();if(c==null)throw new IOException("目录不可读");
        try{
            Map<Long,Integer> sizes=new HashMap<>();
            while(c.moveToNext()){
                long size=c.isNull(3)?0:c.getLong(3);
                if(size>0)sizes.put(size,sizes.containsKey(size)?sizes.get(size)+1:1);
            }
            c.moveToFirst();
            do{
                if(items.length()>=400)break;
                String docId=c.getString(0),name=c.isNull(1)?"":c.getString(1),mime=c.isNull(2)?"":c.getString(2);
                long size=c.isNull(3)?0:c.getLong(3),modified=c.isNull(4)?0:c.getLong(4);
                String reason="保留";
                if(size==0&&!DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))reason="空文件";
                else if(size>0&&sizes.get(size)!=null&&sizes.get(size)>1)reason="疑似重复（同尺寸，需人工核对）";
                else if(Pattern.compile("temp|tmp|cache|bak|old|残留",Pattern.CASE_INSENSITIVE).matcher(name).find()&&modified>0&&System.currentTimeMillis()-modified>30L*86400000)reason="超期临时文件（30 天以上）";
                JSONObject item=new JSONObject();item.put("documentId",docId);item.put("name",name);
                item.put("mime",mime);item.put("size",size);item.put("modified",modified);item.put("reason",reason);
                items.put(item);
            }while(c.moveToNext());
        }finally{c.close();}
        JSONObject out=new JSONObject();out.put("readOnly",true);out.put("authorized",hasTree());
        out.put("generatedAt",System.currentTimeMillis());out.put("items",items);return out;
    }
    private JSONObject organize(JSONArray moves)throws Exception{
        Uri root=tree();if(root==null)throw new IOException("请先授权一个目录");
        JSONArray done=new JSONArray();int count=0;
        if(moves!=null)for(int i=0;i<moves.length()&&count<10;i++){
            JSONObject move=moves.getJSONObject(i);String docId=move.optString("documentId",""),name=move.optString("newName","");
            if(docId.isEmpty()||!name.matches("[^/\\\\:*?\"<>|]{1,120}"))continue;
            Uri target=DocumentsContract.renameDocument(ctx.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(root,docId),name);
            if(target!=null){done.put(name);count++;}
        }
        JSONObject out=new JSONObject();out.put("renamed",done);out.put("count",count);return out;
    }
    /** Only called after the page shows every path and the user confirms twice. Max 10 per batch. */
    private JSONObject deleteFiles(JSONObject args)throws Exception{
        Uri root=tree();if(root==null)throw new IOException("请先授权一个目录");
        if(!args.optBoolean("confirmed",false))throw new IOException("缺少二次确认");
        JSONArray ids=args.optJSONArray("documentIds");if(ids==null)throw new IOException("没有待删条目");
        JSONArray done=new JSONArray(),failed=new JSONArray();
        for(int i=0;i<ids.length()&&i<10;i++){
            String docId=ids.getString(i);
            try{
                Uri uri=DocumentsContract.buildDocumentUriUsingTree(root,docId);
                if(DocumentsContract.deleteDocument(ctx.getContentResolver(),uri)){done.put(docId);logDelete(docId);}
                else failed.put(docId);
            }catch(Exception e){failed.put(docId);}
        }
        JSONObject out=new JSONObject();out.put("deleted",done);out.put("failed",failed);
        out.put("note","Android 无统一回收站，删除不可恢复");return out;
    }
    private void logDelete(String docId){
        try{
            JSONArray log=new JSONArray(prefs().getString(KEY_DELETES,"[]"));
            JSONObject entry=new JSONObject();entry.put("documentId",docId);entry.put("at",System.currentTimeMillis());
            log.put(entry);while(log.length()>200)log.remove(0);
            prefs().edit().putString(KEY_DELETES,log.toString()).apply();
        }catch(Exception ignored){}
    }
    private String writeLog(String text){
        if(text.isEmpty())return "日志内容为空";
        try{
            JSONArray logs=new JSONArray(prefs().getString("workLogs","[]"));
            JSONObject entry=new JSONObject();entry.put("at",System.currentTimeMillis());entry.put("text",text.substring(0,Math.min(20000,text.length())));
            logs.put(entry);while(logs.length()>200)logs.remove(0);
            prefs().edit().putString("workLogs",logs.toString()).apply();
            return "已写入工作日志草稿（"+text.length()+" 字）";
        }catch(Exception e){return "日志写入失败";}
    }

    /* ---------- Scheduled tasks (never execute deletion) ---------- */
    private JSONArray taskArray()throws JSONException{return new JSONArray(prefs().getString(KEY_TASKS,"[]"));}
    private JSONObject tasks()throws Exception{
        JSONArray list=taskArray(),out=new JSONArray();
        for(int i=0;i<list.length();i++){
            JSONObject t=list.getJSONObject(i);JSONObject copy=new JSONObject();
            copy.put("id",t.optString("id"));copy.put("at",t.optLong("at"));copy.put("action",t.optString("action"));copy.put("fired",t.optBoolean("fired",false));
            out.put(copy);
        }
        JSONObject result=new JSONObject();result.put("tasks",out);result.put("events",new JSONArray(prefs().getString(KEY_EVENTS,"[]")));
        result.put("exactAlarmAllowed",canScheduleExact());result.put("bootRestore",true);return result;
    }
    private JSONObject schedule(JSONObject args)throws Exception{
        String action=args.optString("action","remind");
        if(!PhoneActionPlan.alarmMayRun(action))throw new IOException("不支持的任务类型");
        long at=args.optLong("at",0);if(at<=System.currentTimeMillis())throw new IOException("时间必须晚于现在");
        String id="task-"+System.currentTimeMillis();
        JSONArray list=taskArray();JSONObject t=new JSONObject();
        t.put("id",id);t.put("at",at);t.put("action",action);t.put("fired",false);list.put(t);
        prefs().edit().putString(KEY_TASKS,list.toString()).apply();
        arm(id,at,action);
        JSONObject out=new JSONObject();out.put("id",id);out.put("at",at);out.put("action",action);
        out.put("exactAlarmAllowed",canScheduleExact());return out;
    }
    private JSONObject cancel(String id)throws Exception{
        JSONArray list=taskArray(),kept=new JSONArray();
        for(int i=0;i<list.length();i++){JSONObject t=list.getJSONObject(i);if(!id.equals(t.optString("id")))kept.put(t);else disarm(t.optString("id"),t.optLong("at"),t.optString("action"));}
        prefs().edit().putString(KEY_TASKS,kept.toString()).apply();
        JSONObject out=new JSONObject();out.put("removed",id);return out;
    }
    private void arm(String id,long at,String action){
        AlarmManager am=(AlarmManager)ctx.getSystemService(Context.ALARM_SERVICE);if(am==null)return;
        PendingIntent pi=pending(id,at,action);
        try{
            if(Build.VERSION.SDK_INT>=23)am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,pi);
            else am.setExact(AlarmManager.RTC_WAKEUP,at,pi);
        }catch(SecurityException ignored){/* exact alarm not granted; task still listed for manual run */}
    }
    private void disarm(String id,long at,String action){
        AlarmManager am=(AlarmManager)ctx.getSystemService(Context.ALARM_SERVICE);
        if(am!=null)am.cancel(pending(id,at,action));
    }
    private PendingIntent pending(String id,long at,String action){
        Intent intent=new Intent(ctx,AssistantAlarmReceiver.class).setAction(AssistantAlarmReceiver.ACTION_TASK)
            .putExtra("id",id).putExtra("at",at).putExtra("action",action);
        int flags=PendingIntent.FLAG_UPDATE_CURRENT;
        if(Build.VERSION.SDK_INT>=23)flags|=PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx,(id+(int)at).hashCode()&0x7fffffff,intent,flags);
    }
    public void restoreAlarms(){
        try{JSONArray list=taskArray();for(int i=0;i<list.length();i++){
            JSONObject t=list.getJSONObject(i);
            if(!t.optBoolean("fired",false)&&t.optLong("at")>System.currentTimeMillis())
                arm(t.optString("id"),t.optLong("at"),t.optString("action"));
        }}catch(Exception ignored){}
    }
    public void recordEvent(String id,String action){
        try{
            JSONArray events=new JSONArray(prefs().getString(KEY_EVENTS,"[]"));
            JSONObject e=new JSONObject();e.put("id",id);e.put("action",action);e.put("at",System.currentTimeMillis());
            events.put(e);while(events.length()>100)events.remove(0);
            prefs().edit().putString(KEY_EVENTS,events.toString()).apply();
            JSONArray list=taskArray();
            for(int i=0;i<list.length();i++)if(id.equals(list.getJSONObject(i).optString("id"))){list.getJSONObject(i).put("fired",true);break;}
            prefs().edit().putString(KEY_TASKS,list.toString()).apply();
        }catch(Exception ignored){}
    }
    public void clearEvents(){prefs().edit().putString(KEY_EVENTS,"[]").apply();}
}
