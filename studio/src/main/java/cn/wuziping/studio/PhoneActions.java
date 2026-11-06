package cn.wuziping.studio;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.Looper;
import android.os.StatFs;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** User-approved phone actions. Opens drafts and screens; never sends SMS or places a call. */
public final class PhoneActions {
    private final Context ctx;
    public PhoneActions(Context context){ctx=context;}

    public String run(String tool,JSONObject args){
        PhoneActionPlan.Input in=new PhoneActionPlan.Input();
        if(args!=null){
            in.url=args.optString("url","");
            in.number=args.optString("number","");
            in.body=args.optString("body","");
            in.text=args.optString("text","");
            in.title=args.optString("title","");
            in.query=args.optString("query","");
            in.screen=args.optString("screen","");
            in.pkg=args.optString("package","");
            in.label=args.optString("label","");
            if(args.has("lat")&&!args.isNull("lat"))in.lat=String.valueOf(args.opt("lat"));
            if(args.has("lng")&&!args.isNull("lng"))in.lng=String.valueOf(args.opt("lng"));
        }
        PhoneActionPlan.Result plan=PhoneActionPlan.prepare(tool,in);
        if(!plan.ok)return plan.error;
        try{
            if("openUrl".equals(tool))return launch(new Intent(PhoneActionPlan.intentAction(tool),Uri.parse(plan.url)),"已打开链接，请在浏览器中查看。");
            if("dial".equals(tool))return launch(new Intent(PhoneActionPlan.intentAction(tool),Uri.parse(PhoneActionPlan.viewUri(plan))),"已打开拨号盘，尚未拨出。");
            if("draftSms".equals(tool)){
                Intent sms=new Intent(PhoneActionPlan.intentAction(tool),Uri.parse(PhoneActionPlan.viewUri(plan)));
                sms.putExtra("sms_body",plan.body);
                return launch(sms,"已打开短信草稿，尚未发送。请在短信应用里自己点发送。");
            }
            if("shareText".equals(tool)){
                Intent send=new Intent(PhoneActionPlan.intentAction(tool));
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT,plan.text);
                if(plan.title.length()>0)send.putExtra(Intent.EXTRA_SUBJECT,plan.title);
                Intent chooser=Intent.createChooser(send,plan.title.length()>0?plan.title:"分享");
                return launch(chooser,"已打开分享面板，内容还没送出。请在面板里选择目标应用。");
            }
            if("openMaps".equals(tool))return launch(new Intent(PhoneActionPlan.intentAction(tool),Uri.parse(PhoneActionPlan.viewUri(plan))),"已打开地图。");
            if("openSettings".equals(tool))return openSettings(plan.screen);
            if("openApp".equals(tool))return openApp(plan.pkg,plan.label);
            if("readClipboard".equals(tool))return readClipboard();
            if("writeClipboard".equals(tool))return writeClipboard(plan.text);
            if("deviceContext".equals(tool))return deviceContext();
            if("listApps".equals(tool))return listApps();
            if("notificationStatus".equals(tool))return notificationStatus().toString();
            return "未知工具："+tool;
        }catch(Exception e){
            return "操作未完成："+(e.getMessage()==null?"未知原因":e.getMessage());
        }
    }

    private String openSettings(String screen){
        if("notifications".equals(screen)&&Build.VERSION.SDK_INT<26){
            Intent details=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            details.setData(Uri.parse("package:"+ctx.getPackageName()));
            return launch(details,"已打开本应用的系统设置页。助手不会在设置里自动点击。");
        }
        Intent intent=new Intent(PhoneActionPlan.settingsAction(screen));
        if("notifications".equals(screen))intent.putExtra(Settings.EXTRA_APP_PACKAGE,ctx.getPackageName());
        return launch(intent,"已打开系统设置："+screen+"。助手不会在设置里自动点击。");
    }

    private String openApp(String pkg,String label){
        PackageManager pm=ctx.getPackageManager();
        String target=pkg;
        if(target.isEmpty()){
            List<ResolveInfo> matches=new ArrayList<>();
            List<ResolveInfo> all=launcherApps();
            String want=label.toLowerCase(Locale.ROOT);
            for(ResolveInfo info:all){
                if(info.activityInfo==null)continue;
                String name=appLabel(info).toLowerCase(Locale.ROOT);
                if(name.equals(want))matches.add(info);
            }
            if(matches.isEmpty()){
                for(ResolveInfo info:all){
                    if(info.activityInfo==null)continue;
                    String name=appLabel(info).toLowerCase(Locale.ROOT);
                    if(want.length()>=2&&name.contains(want))matches.add(info);
                }
            }
            if(matches.isEmpty())return "没有找到名为「"+label+"」的可启动应用。";
            if(matches.size()>1){
                StringBuilder names=new StringBuilder();
                int shown=0;
                for(ResolveInfo info:matches){
                    if(shown>=8)break;
                    if(shown>0)names.append("、");
                    names.append(appLabel(info)).append(" (").append(info.activityInfo.packageName).append(")");
                    shown++;
                }
                return "找到多个应用，请改用包名："+names;
            }
            target=matches.get(0).activityInfo.packageName;
        }
        Intent launch=pm.getLaunchIntentForPackage(target);
        if(launch==null)return "没有可启动的界面："+target;
        return launch(launch,"已打开应用："+target);
    }

    private String readClipboard(){
        AtomicReference<String> out=new AtomicReference<>("剪贴板是空的");
        runMain(()->{
            ClipboardManager cm=(ClipboardManager)ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if(cm==null||!cm.hasPrimaryClip()){out.set("剪贴板是空的");return;}
            ClipData clip=cm.getPrimaryClip();
            if(clip==null||clip.getItemCount()==0){out.set("剪贴板是空的");return;}
            CharSequence text=clip.getItemAt(0).coerceToText(ctx);
            String value=text==null?"":text.toString();
            if(value.isEmpty()){out.set("剪贴板是空的");return;}
            if(value.length()>4000)value=value.substring(0,4000);
            out.set(value);
        });
        return out.get();
    }

    private String writeClipboard(String text){
        AtomicReference<String> out=new AtomicReference<>("剪贴板不可用");
        runMain(()->{
            ClipboardManager cm=(ClipboardManager)ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if(cm==null){out.set("剪贴板不可用");return;}
            cm.setPrimaryClip(ClipData.newPlainText("ember",text));
            out.set("已写入剪贴板（"+text.length()+" 字）");
        });
        return out.get();
    }

    private String deviceContext(){
        try{
            JSONObject o=new JSONObject();
            BatteryManager bm=(BatteryManager)ctx.getSystemService(Context.BATTERY_SERVICE);
            int pct=bm==null?-1:bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if(pct<0||pct>100)pct=-1;
            boolean charging=false;
            if(bm!=null&&Build.VERSION.SDK_INT>=26){
                int status=bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS);
                charging=status==BatteryManager.BATTERY_STATUS_CHARGING||status==BatteryManager.BATTERY_STATUS_FULL;
            }else{
                try{
                    Intent sticky=ctx.registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                    if(sticky!=null){
                        int status=sticky.getIntExtra(BatteryManager.EXTRA_STATUS,-1);
                        charging=status==BatteryManager.BATTERY_STATUS_CHARGING||status==BatteryManager.BATTERY_STATUS_FULL;
                        if(pct<0){
                            int level=sticky.getIntExtra(BatteryManager.EXTRA_LEVEL,-1);
                            int scale=sticky.getIntExtra(BatteryManager.EXTRA_SCALE,-1);
                            if(level>=0&&scale>0)pct=Math.round(level*100f/scale);
                        }
                    }
                }catch(Exception ignored){}
            }
            o.put("batteryPercent",pct);
            o.put("charging",charging);
            o.put("network",network());
            o.put("locale",Locale.getDefault().toLanguageTag());
            try{
                StatFs fs=new StatFs(Environment.getDataDirectory().getAbsolutePath());
                o.put("storageFreeBytes",fs.getAvailableBytes());
                o.put("storageTotalBytes",fs.getTotalBytes());
                o.put("storageNote","数据分区剩余空间，不是整机外部存储");
            }catch(Exception e){o.put("storageFreeBytes",-1);o.put("storageTotalBytes",-1);}
            JSONObject notes=notificationStatus();
            o.put("notificationsEnabled",notes.optBoolean("enabled",false));
            JSONObject ax=new JSONObject();
            ax.put("serviceInstalled",false);
            ax.put("enabled",false);
            ax.put("note","本版没有无障碍服务，不能点击或输入其他应用。可让助手打开 screen=accessibility 的系统设置页，由你自己开关。");
            o.put("accessibility",ax);
            return o.toString();
        }catch(Exception e){return "暂时读不到设备状态";}
    }

    private String network(){
        try{
            ConnectivityManager cm=(ConnectivityManager)ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if(cm==null)return "unknown";
            if(Build.VERSION.SDK_INT>=23){
                Network net=cm.getActiveNetwork();
                if(net==null)return "none";
                NetworkCapabilities caps=cm.getNetworkCapabilities(net);
                if(caps==null)return "unknown";
                if(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))return "wifi";
                if(caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))return "cellular";
                if(caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))return "ethernet";
                return "other";
            }
            return "unknown";
        }catch(SecurityException se){return "unknown";}
    }

    private String listApps(){
        try{
            List<ResolveInfo> infos=launcherApps();
            Collections.sort(infos,new Comparator<ResolveInfo>(){
                @Override public int compare(ResolveInfo a,ResolveInfo b){return appLabel(a).compareToIgnoreCase(appLabel(b));}
            });
            JSONArray apps=new JSONArray();
            for(int i=0;i<infos.size()&&apps.length()<PhoneActionPlan.APP_LIMIT;i++){
                ResolveInfo info=infos.get(i);
                if(info.activityInfo==null)continue;
                JSONObject item=new JSONObject();
                item.put("label",appLabel(info));
                item.put("package",info.activityInfo.packageName);
                apps.put(item);
            }
            JSONObject out=new JSONObject();
            out.put("count",infos.size());
            out.put("shown",apps.length());
            out.put("truncated",infos.size()>apps.length());
            out.put("apps",apps);
            return out.toString();
        }catch(Exception e){return "暂时列不出应用";}
    }

    private List<ResolveInfo> launcherApps(){
        Intent launch=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> infos=ctx.getPackageManager().queryIntentActivities(launch,0);
        return infos==null?new ArrayList<ResolveInfo>():infos;
    }
    private String appLabel(ResolveInfo info){
        try{
            CharSequence label=info.loadLabel(ctx.getPackageManager());
            String text=label==null?"":label.toString().trim().replace('\n',' ');
            if(text.length()>80)text=text.substring(0,80);
            return text.isEmpty()?(info.activityInfo==null?"":info.activityInfo.packageName):text;
        }catch(Exception e){return info.activityInfo==null?"":info.activityInfo.packageName;}
    }

    private JSONObject notificationStatus(){
        JSONObject o=new JSONObject();
        try{
            boolean enabled=true;
            if(Build.VERSION.SDK_INT>=24){
                NotificationManager nm=(NotificationManager)ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                enabled=nm!=null&&nm.areNotificationsEnabled();
            }
            o.put("enabled",enabled);
            o.put("package",ctx.getPackageName());
            o.put("note",enabled?"本应用通知可用":"本应用通知被系统关掉了");
        }catch(Exception e){
            try{o.put("enabled",false);o.put("note","读不到通知开关");}catch(Exception ignored){}
        }
        return o;
    }

    private String launch(Intent intent,String ok){
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try{
            start(intent);
            return ok;
        }catch(ActivityNotFoundException e){return "这台手机没有能处理该操作的应用。";}
        catch(Exception e){return "未能打开："+(e.getMessage()==null?"未知原因":e.getMessage());}
    }
    private void start(final Intent intent)throws Exception{
        if(ctx instanceof Activity && Looper.myLooper()!=Looper.getMainLooper()){
            final Activity activity=(Activity)ctx;
            final AtomicReference<Exception> error=new AtomicReference<Exception>();
            final CountDownLatch latch=new CountDownLatch(1);
            activity.runOnUiThread(new Runnable(){public void run(){
                try{activity.startActivity(intent);}catch(Exception e){error.set(e);}finally{latch.countDown();}
            }});
            if(!latch.await(5,TimeUnit.SECONDS))throw new java.io.IOException("界面打开超时");
            if(error.get()!=null)throw error.get();
            return;
        }
        ctx.startActivity(intent);
    }
    private void runMain(final Runnable job){
        if(!(ctx instanceof Activity)||Looper.myLooper()==Looper.getMainLooper()){job.run();return;}
        final Activity activity=(Activity)ctx;
        final CountDownLatch latch=new CountDownLatch(1);
        activity.runOnUiThread(new Runnable(){public void run(){try{job.run();}finally{latch.countDown();}}});
        try{latch.await(3,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}
    }
}
