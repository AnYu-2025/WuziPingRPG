package cn.wuziping.studio;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.webkit.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import cn.wuziping.ember.Game;

public final class EditorActivity extends Activity {
    private WebView web;private AssetServer assets;private PackedAssets packed;private AtomicFile workspace,gameSave;
    private final ExecutorService io=Executors.newSingleThreadExecutor();private JSONObject pendingExport;private boolean pickerOpen=false,workspaceReadOnly=false;
    private static final int OPEN=30,FOLDER=31,EXPORT=32,GAME_OUT=33,GAME_IN=34,MIC=35;
    private android.webkit.PermissionRequest pendingMicRequest;
    private static final int SOURCE_ASSETS=0,SOURCE_LOOPBACK=1,SOURCE_PACKAGED=2;
    private final android.os.Handler ui=new android.os.Handler(android.os.Looper.getMainLooper());
    private int source=SOURCE_ASSETS,probeCount=0,restoreResends=0;private boolean bootOk=false,bootFailureShown=false,rendererRecovery=false;
    private long bootStart=0,lastRestoreAt=0;private String lastPageError="",lastResourceError="",lastJsError="";
    private static int rendererRecoveries=0;
    private final Runnable bootWatchdog=new Runnable(){@Override public void run(){if(!bootOk&&web!=null){lastPageError="启动超时（"+sourceName()+"）";escalateTransport();}}};
    private final Set<String> trustedUris=Collections.synchronizedSet(new HashSet<String>());
    @Override public void onCreate(Bundle state){super.onCreate(state);try{getWindow().setStatusBarColor(0xffffffff);getWindow().setNavigationBarColor(android.os.Build.VERSION.SDK_INT>=26?0xffffffff:0xff1f2937);getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;if(android.os.Build.VERSION.SDK_INT>=26)light|=View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;getWindow().getDecorView().setSystemUiVisibility(light);
        workspace=new AtomicFile(new File(getFilesDir(),"studio-workspace-v1.json"));gameSave=new AtomicFile(new File(getFilesDir(),"journey-v1.bin"));trustedUris.addAll(getPreferences(0).getStringSet("trustedUris",new HashSet<String>()));
        packed=new PackedAssets(this);try{assets=new AssetServer(packed::open,false);}catch(IOException e){fatal("离线资源未能启动："+e.getMessage());return;}
        try{web=new WebView(this);}catch(RuntimeException e){fatal("系统 WebView 不可用，编辑器无法打开。请在系统设置中启用或更新 Android System WebView 后重试。");return;}
        web.setBackgroundColor(0xffffffff);web.setFocusable(true);web.setFocusableInTouchMode(true);web.setOverScrollMode(View.OVER_SCROLL_NEVER);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(false);settings.setSupportZoom(false);settings.setTextZoom(100);settings.setDefaultTextEncodingName("UTF-8");settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);if(android.os.Build.VERSION.SDK_INT>=33)settings.setAlgorithmicDarkeningAllowed(false);else if(android.os.Build.VERSION.SDK_INT>=29)settings.setForceDark(WebSettings.FORCE_DARK_OFF);if(android.os.Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(false);
        web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage message){
            if(message==null)return false;
            String line=message.messageLevel()+": "+message.message()+" @"+message.sourceId()+":"+message.lineNumber();
            if(message.messageLevel()==ConsoleMessage.MessageLevel.ERROR){lastJsError=line;android.util.Log.e("EmberStudio",line);}else android.util.Log.i("EmberStudio",line);
            return true;
        }
        /* 上课模式录音：WebView 的 getUserMedia 需要宿主授予音频采集资源，
           并在系统层持有 RECORD_AUDIO 运行时权限。 */
        @Override public void onPermissionRequest(final android.webkit.PermissionRequest request){
            runOnUiThread(()->{
                if(web==null||isFinishing()||isDestroyed()){try{request.deny();}catch(Exception ignored){}return;}
                java.util.List<String> needed=new java.util.ArrayList<>();
                boolean wantsAudio=false;
                for(String resource:request.getResources()){
                    if(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)){wantsAudio=true;break;}
                }
                if(!wantsAudio){try{request.deny();}catch(Exception ignored){}return;}
                if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){
                    try{request.grant(request.getResources());}catch(Exception e){try{request.deny();}catch(Exception ignored){}}
                }else{
                    pendingMicRequest=request;
                    try{requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},MIC);}
                    catch(Exception e){pendingMicRequest=null;try{request.deny();}catch(Exception ignored){}}
                }
            });
        }});
        web.setWebViewClient(StudioClient.create(assets,new StudioClient.Hooks(){
            public void pageFinished(){pageReady();}
            public void pageFailed(String url,String description){onPageFailed(url,description);}
            public void resourceFailed(String url,String description){onResourceFailed(url,description);}
            public void rendererGone(boolean crashed){onRendererGone();}
        }));
        web.addJavascriptInterface(new Bridge(),"StudioBridge");setContentView(web);web.requestFocus();startTransport();
    }catch(Throwable e){fatal("天工没能打开："+e.getClass().getSimpleName()+" "+e.getMessage());}}
    private void startTransport(){
        if(web==null||isFinishing()||isDestroyed())return;
        bootOk=false;probeCount=0;restoreResends=0;bootStart=android.os.SystemClock.uptimeMillis();lastPageError="";lastResourceError="";lastJsError="";
        ui.removeCallbacks(bootWatchdog);ui.postDelayed(bootWatchdog,8000);
        if(source==SOURCE_PACKAGED)loadPackagedPage();else web.loadUrl(source==SOURCE_LOOPBACK?assets.base()+"studio/index.html":StudioClient.PAGE);
    }
    private void loadPackagedPage(){
        try{
            String html=packed.readText("studio/index.html"),css=packed.readText("studio/style.css"),boot=packed.readText("studio/boot.js");
            String lectureCss="";
            try{lectureCss=packed.readText("studio/lecture.css");}catch(Throwable ignored){/* 旧包允许缺失 */}
            String app=packed.readText("studio/app.js").replace("</script","<\\/script");
            String policy="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'";
            html=html.replaceAll("(?is)<meta[^>]*Content-Security-Policy[^>]*>","<meta http-equiv=\"Content-Security-Policy\" content=\""+policy+"\">");
            html=html.contains("<link rel=\"stylesheet\" href=\"style.css\">")?html.replace("<link rel=\"stylesheet\" href=\"style.css\">","<style>"+css+"</style>"):html.replace("</head>","<style>"+css+"</style></head>");
            if(lectureCss.length()>0)html=html.contains("<link rel=\"stylesheet\" href=\"lecture.css\">")?html.replace("<link rel=\"stylesheet\" href=\"lecture.css\">","<style>"+lectureCss+"</style>"):html.replace("</head>","<style>"+lectureCss+"</style></head>");
            html=html.contains("<script src=\"boot.js\"></script>")?html.replace("<script src=\"boot.js\"></script>","<script>"+boot+"</script>"):html.replace("</body>","<script>"+boot+"</script></body>");
            html=html.contains("<script src=\"app.js\"></script>")?html.replace("<script src=\"app.js\"></script>","<script>"+app+"</script>"):html.replace("</body>","<script>"+app+"</script></body>");
            web.loadDataWithBaseURL(assets.base()+"studio/index.html",html,"text/html","UTF-8",null);
        }catch(Throwable e){lastPageError="内置页面读取失败："+e.getMessage();ui.removeCallbacks(bootWatchdog);showBootFailure();}
    }
    private void escalateTransport(){
        if(bootOk||web==null||isFinishing()||isDestroyed())return;
        ui.removeCallbacks(bootWatchdog);
        if(source==SOURCE_ASSETS)source=SOURCE_LOOPBACK;else if(source==SOURCE_LOOPBACK)source=SOURCE_PACKAGED;else{showBootFailure();return;}
        startTransport();
    }
    private void pageReady(){if(bootOk)return;ui.removeCallbacks(bootWatchdog);ui.postDelayed(bootWatchdog,8000);ui.postDelayed(this::probeBoot,900);}
    private void onPageFailed(String url,String description){
        if(bootOk)return;
        if(!currentPage(url)){onResourceFailed(url,description);return;}
        lastPageError=description;
        escalateTransport();
    }
    private boolean currentPage(String url){
        if(url==null)return true;
        if(source==SOURCE_ASSETS)return url.startsWith(StudioClient.PAGE);
        if(source==SOURCE_LOOPBACK)return url.startsWith(assets.base()+"studio/index.html");
        return true;
    }
    private void onResourceFailed(String url,String description){
        String at=url==null?"":url;
        if(at.endsWith("studio-game.png")||at.endsWith("favicon.ico"))return;
        lastResourceError=description+" "+at;
        android.util.Log.w("EmberStudio","resource "+at+" "+description);
    }
    private void probeBoot(){
        if(bootOk||web==null||isFinishing()||isDestroyed())return;
        final int at=source;
        web.evaluateJavascript("(function(){var e=window.__studioErrors||[];return {boot:window.__studioBootOk===true,studio:!!window.Studio,view:!!(window.Studio&&window.Studio.view),landing:window.__studioLandingReady===true,err:e.join(' | ').slice(0,600)};})()",raw->{
            if(bootOk||web==null||at!=source)return;
            boolean studio=false,view=false,landing=false;String err="";
            try{if(raw!=null){JSONObject o=new JSONObject(raw);studio=o.optBoolean("studio");view=o.optBoolean("view");landing=o.optBoolean("landing");err=o.optString("err");}}catch(Exception ignored){}
            if(err.length()>0)lastJsError=err;
            if(view||(studio&&landing)){bootOk=true;ui.removeCallbacks(bootWatchdog);return;}
            if(studio&&restoreResends<2&&android.os.SystemClock.uptimeMillis()-bootStart>3000&&android.os.SystemClock.uptimeMillis()-lastRestoreAt>3000){restoreResends++;deliverRestore();}
            probeCount++;
            if(probeCount<7&&android.os.SystemClock.uptimeMillis()-bootStart<9000)ui.postDelayed(this::probeBoot,1400);
            else escalateTransport();
        });
    }
    private void deliverRestore(){
        lastRestoreAt=android.os.SystemClock.uptimeMillis();
        io.execute(()->{JSONObject o=message("restore");try{if(workspace.getBaseFile().exists()||new File(workspace.getBaseFile().getPath()+".bak").exists()){try(InputStream in=workspace.openRead()){JSONObject data=new JSONObject(new String(TextFiles.read(in,32*1024*1024),"UTF-8"));if(data.optInt("version")!=1||data.optJSONArray("files")==null)throw new IOException("工作区格式错误");put(o,"data",data);}}else put(o,"data",JSONObject.NULL);}catch(Exception e){try{backup(workspace.getBaseFile(),"workspace-recovery-",".json");put(o,"error","旧工作区读取失败，已保留恢复副本。");}catch(IOException failed){workspaceReadOnly=true;put(o,"error","旧工作区读取失败，未覆盖原文件。请先另存重要内容。");}}event(o);});
    }
    private void onRendererGone(){
        bootOk=true;ui.removeCallbacks(bootWatchdog);
        if(rendererRecovery)return;rendererRecovery=true;
        if(web!=null){try{web.loadUrl("about:blank");}catch(Throwable ignored){}ViewParent parent=web.getParent();if(parent instanceof ViewGroup)((ViewGroup)parent).removeView(web);web.removeJavascriptInterface("StudioBridge");web.destroy();web=null;}
        if(rendererRecoveries++<1)recreate();else showBootFailure();
    }
    private String sourceName(){return source==SOURCE_LOOPBACK?"本地资源服务":source==SOURCE_PACKAGED?"内置内联页面":"appassets 拦截";}
    private void showBootFailure(){
        if(bootFailureShown||isFinishing()||isDestroyed())return;bootFailureShown=true;
        String agent="未知";try{agent=WebSettings.getDefaultUserAgent(this);}catch(Throwable ignored){}
        StringBuilder text=new StringBuilder("编辑器界面没有完成加载。常见原因是系统 WebView 版本过旧或被系统限制。\n\nWebView：").append(agent).append("\n\n加载方式：").append(sourceName());
        if(lastPageError.length()>0)text.append("\n页面错误：").append(lastPageError);
        if(lastResourceError.length()>0)text.append("\n资源错误：").append(lastResourceError);
        if(lastJsError.length()>0)text.append("\n脚本错误：").append(lastJsError);
        text.append("\n\n请到应用商店或系统设置更新 Android System WebView / Chrome 后重试。");
        String report=text.toString();
        new AlertDialog.Builder(this).setTitle("天工无法启动编辑器").setMessage(report)
            .setPositiveButton("重试",(d,w)->{bootFailureShown=false;if(web==null){rendererRecovery=false;recreate();return;}source=SOURCE_ASSETS;startTransport();})
            .setNeutralButton("复制诊断",(d,w)->{ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(clipboard!=null)clipboard.setPrimaryClip(ClipData.newPlainText("天工诊断",report));Toast.makeText(this,"诊断信息已复制。",Toast.LENGTH_SHORT).show();})
            .setNegativeButton("退出",(d,w)->finish()).show();
    }
    private void fatal(String text){TextView view=new TextView(this);view.setText(text);view.setPadding(30,60,30,30);setContentView(view);}
    private JSONObject message(String type){JSONObject o=new JSONObject();put(o,"type",type);return o;}
    private static void put(JSONObject o,String k,Object v){try{o.put(k,v);}catch(JSONException e){throw new IllegalArgumentException(e);}}
    private void event(JSONObject data){runOnUiThread(()->{if(web!=null&&!isFinishing()&&!isDestroyed()){String payload=data.toString().replace("\u2028","\\u2028").replace("\u2029","\\u2029");web.evaluateJavascript("window.StudioNative&&window.StudioNative.receive("+payload+")",null);}});}
    private void notice(String text){JSONObject o=message("notice");put(o,"message",text);event(o);}
    private void trust(Uri uri){synchronized(trustedUris){trustedUris.add(uri.toString());getPreferences(0).edit().putStringSet("trustedUris",new HashSet<>(trustedUris)).apply();}}
    private void persistGrant(Uri uri,int flags){try{getContentResolver().takePersistableUriPermission(uri,flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(SecurityException ignored){/* Some providers grant access only for this session. */}}
    public final class Bridge {
        @JavascriptInterface public void postMessage(String raw){if(raw==null||raw.length()>32*1024*1024)return;runOnUiThread(()->{if(web==null)return;try{JSONObject m=new JSONObject(raw);handle(m);}catch(Exception e){notice("操作未完成："+e.getMessage());}});}
    }
    private void handle(JSONObject m)throws Exception{
        String type=m.optString("type");
        if(type.equals("ready")){deliverRestore();return;}
        if(type.equals("jsError")){lastJsError=m.optString("kind")+": "+m.optString("detail");android.util.Log.e("EmberStudio",lastJsError);return;}
        if(type.equals("snapshot")){JSONObject data=m.getJSONObject("data");int id=m.optInt("id");if(data.optInt("version")!=1||data.getJSONArray("files").length()>160)throw new IOException("工作区过大");io.execute(()->{JSONObject o=message("snapshotSaved");put(o,"id",id);try{if(workspaceReadOnly)throw new IOException("请先恢复旧工作区");byte[] bytes=data.toString().getBytes("UTF-8");if(bytes.length>32*1024*1024)throw new IOException("工作区超过保存上限，请另存大文件");atomic(workspace,bytes);put(o,"ok",true);}catch(Exception e){put(o,"ok",false);}event(o);});return;}
        if(type.equals("open")){pick(OPEN,new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true));return;}
        if(type.equals("folder")){pick(FOLDER,new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE));return;}
        if(type.equals("export")){pendingExport=m;pick(EXPORT,new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/plain").putExtra(Intent.EXTRA_TITLE,new File(m.getString("path")).getName()));return;}
        if(type.equals("save")){writeDocument(m,Uri.parse(m.getString("uri")),false);return;}
        if(type.equals("play")){try{startActivity(new Intent(this,cn.wuziping.ember.MainActivity.class).putExtra("editorHost",true));}catch(Exception e){notice("游戏未能打开："+e.getMessage());}return;}
        if(type.equals("gameState")){JSONObject o=message("gameState");put(o,"exists",(gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists()));event(o);return;}
        if(type.equals("exportGame")){if(!(gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists())){notice("先进入游戏创建一次存档。");return;}pick(GAME_OUT,new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,"星火远征-存档.wzpsave"));return;}
        if(type.equals("importGame")){pick(GAME_IN,new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"));return;}
        if(type.equals("preview")){final JSONObject preview=m;io.execute(()->{try{File file=new File(getCacheDir(),"studio-preview.json");atomic(new AtomicFile(file),preview.toString().getBytes("UTF-8"));runOnUiThread(()->startActivity(new Intent(this,PreviewActivity.class)));}catch(Exception e){notice("预览失败："+e.getMessage());}});}
    }
    private void pick(int request,Intent intent){if(pickerOpen){notice("请先完成当前文件选择。");return;}intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{pickerOpen=true;startActivityForResult(intent,request);}catch(ActivityNotFoundException e){pickerOpen=false;notice("未找到系统文件选择器。");}}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode!=MIC||pendingMicRequest==null)return;
        boolean granted=grantResults!=null;
        if(granted)for(int result:grantResults)if(result!=android.content.pm.PackageManager.PERMISSION_GRANTED)granted=false;
        android.webkit.PermissionRequest request=pendingMicRequest;pendingMicRequest=null;
        try{
            if(granted)request.grant(request.getResources());
            else{request.deny();notice("麦克风权限被拒绝，上课模式无法录音。可在系统设置 → 应用 → 天工 → 权限中开启。");}
        }catch(Exception ignored){}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);pickerOpen=false;if(result!=RESULT_OK||data==null){if(request==EXPORT&&pendingExport!=null){JSONObject o=message("saved");put(o,"id",pendingExport.optString("id"));put(o,"ok",false);put(o,"message","已取消导出，草稿仍保留。");event(o);pendingExport=null;}return;}
        if(request==OPEN){final ArrayList<Uri> uris=new ArrayList<>();if(data.getClipData()!=null){ClipData clips=data.getClipData();for(int i=0;i<Math.min(160,clips.getItemCount());i++)uris.add(clips.getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());for(Uri uri:uris){persistGrant(uri,data.getFlags());trust(uri);}io.execute(()->importUris(uris));}
        else if(request==FOLDER&&data.getData()!=null){Uri uri=data.getData();persistGrant(uri,data.getFlags());io.execute(()->importTree(uri));}
        else if(request==EXPORT&&pendingExport!=null&&data.getData()!=null){Uri uri=data.getData();persistGrant(uri,data.getFlags());trust(uri);JSONObject payload=pendingExport;pendingExport=null;writeDocument(payload,uri,true);}
        else if(request==GAME_OUT&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try(InputStream in=gameSave.openRead();OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("文件无法写入");byte[] b=TextFiles.read(in,8*1024*1024);out.write(b);notice("游戏存档已导出，请妥善保留。");}catch(Exception e){notice("备份失败："+e.getMessage());}});}
        else if(request==GAME_IN&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try(InputStream in=getContentResolver().openInputStream(uri)){byte[] bytes=TextFiles.read(in,8*1024*1024);Game g=Game.load(new ByteArrayInputStream(bytes));runOnUiThread(()->new AlertDialog.Builder(this).setTitle("导入游戏存档？").setMessage("存档角色："+g.heroName+"\n等级："+g.level+"\n会替换当前游戏进度，替换前保留一份本地备份。").setNegativeButton("取消",null).setPositiveButton("导入",(d,w)->io.execute(()->{try{backupGame();atomic(gameSave,bytes);notice("游戏存档已导入。");}catch(Exception e){notice("导入失败："+e.getMessage());}})).show());}catch(Exception e){notice("这不是可用的游戏存档："+e.getMessage());}});}
    }
    private String fileName(Uri uri){try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())return c.getString(0);}catch(Exception ignored){}return "untitled.txt";}
    private JSONObject readDocument(Uri uri,String path)throws Exception{if(!TextFiles.validPath(path))throw new IOException("文件名不受支持");try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法打开文件");TextFiles.Decoded file=TextFiles.decode(TextFiles.read(in,TextFiles.LIMIT));JSONObject o=new JSONObject();put(o,"path",path);put(o,"text",file.text);put(o,"encoding",file.encoding);put(o,"uri",uri.toString());trust(uri);return o;}}
    private void importUris(List<Uri> uris){JSONArray files=new JSONArray();int skipped=0,total=0;for(Uri uri:uris)try{JSONObject file=readDocument(uri,fileName(uri));total+=file.getString("text").getBytes("UTF-8").length;if(total>12*1024*1024){skipped++;break;}files.put(file);}catch(Exception e){skipped++;}importResult(files,skipped,false);}
    private void importTree(Uri root){JSONArray files=new JSONArray();int[] budget={0,0,0};try{String id=DocumentsContract.getTreeDocumentId(root);String directory=fileName(DocumentsContract.buildDocumentUriUsingTree(root,id));if(!TextFiles.validPath(directory))directory="project";walkTree(root,id,directory+"/",files,budget,0);importResult(files,budget[1],budget[2]!=0);}catch(Exception e){notice("文件夹读取失败："+e.getMessage());}}
    private void walkTree(Uri root,String id,String prefix,JSONArray files,int[] budget,int depth)throws Exception{if(depth>10||files.length()>=160||budget[0]>12*1024*1024){budget[2]=1;return;}Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(root,id);try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){if(c==null)return;while(c.moveToNext()){if(files.length()>=160||budget[0]>12*1024*1024){budget[2]=1;break;}String childId=c.getString(0),name=c.getString(1),mime=c.getString(2),path=prefix+name;if(name.equals(".git")||name.equals("node_modules")||name.equals("__pycache__")){budget[1]++;continue;}if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))walkTree(root,childId,path+"/",files,budget,depth+1);else try{JSONObject f=readDocument(DocumentsContract.buildDocumentUriUsingTree(root,childId),path);budget[0]+=f.getString("text").getBytes("UTF-8").length;if(budget[0]<=12*1024*1024)files.put(f);else budget[2]=1;}catch(Exception e){budget[1]++;}}}}
    private void importResult(JSONArray files,int skipped,boolean limited){JSONObject o=message("imported");put(o,"files",files);put(o,"message","已导入 "+files.length()+" 个文本文件"+(skipped>0?"，跳过 "+skipped+" 项非文本、缓存或过大文件":"")+(limited?"；已达到 160 文件 / 12 MB 导入上限":""));event(o);}
    private void writeDocument(JSONObject m,Uri uri,boolean as){if(!trustedUris.contains(uri.toString())||!"content".equals(uri.getScheme())){notice("文件授权已失效，请重新打开文件或另存为。");return;}io.execute(()->{JSONObject o=message("saved");put(o,"id",m.optString("id"));put(o,"uri",uri.toString());String encoding=as?"UTF-8":m.optString("encoding","UTF-8");put(o,"encoding",encoding);try{byte[] bytes=TextFiles.encode(m.getString("text"),encoding);try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("文件无法写入");out.write(bytes);}put(o,"ok",true);}catch(Exception e){put(o,"ok",false);put(o,"message","写入失败："+e.getMessage()+"。草稿仍保留。");}event(o);});}
    private void backupGame()throws IOException{if(!gameSave.getBaseFile().exists()&&!new File(gameSave.getBaseFile().getPath()+".bak").exists())return;try(InputStream in=gameSave.openRead()){atomic(new AtomicFile(new File(getFilesDir(),"journey-backup-"+System.currentTimeMillis()+".wzpsave")),TextFiles.read(in,8*1024*1024));}}
    private static void atomic(AtomicFile file,byte[] bytes)throws IOException{FileOutputStream out=null;try{out=file.startWrite();out.write(bytes);file.finishWrite(out);}catch(IOException e){if(out!=null)file.failWrite(out);throw e;}}
    private void backup(File source,String prefix,String suffix)throws IOException{if(!source.exists())return;try(InputStream in=new FileInputStream(source)){atomic(new AtomicFile(new File(getFilesDir(),prefix+System.currentTimeMillis()+suffix)),TextFiles.read(in,32*1024*1024));}}
    @Override protected void onResume(){super.onResume();if(web!=null){JSONObject o=message("gameState");put(o,"exists",gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists());event(o);}}
    @Override protected void onPause(){if(web!=null)web.evaluateJavascript("window.Studio&&window.Studio.flush()",null);super.onPause();}
    @Override public void onBackPressed(){if(web==null){finish();return;}web.evaluateJavascript("(()=>{if(document.querySelector('dialog[open]')){document.querySelector('dialog[open]').close('cancel');return true;}if(document.body.classList.contains('drawer')){document.body.classList.remove('drawer');return true;}if(!document.getElementById('lounge').hidden){document.getElementById('codeTab').click();return true;}return false;})()",result->{if(!"true".equals(result))new AlertDialog.Builder(this).setTitle("退出天工？").setMessage("工作区草稿与游戏存档分别保留。").setNegativeButton("继续编辑",null).setPositiveButton("退出",(d,w)->{web.evaluateJavascript("window.Studio&&window.Studio.flush()",v->io.execute(()->runOnUiThread(this::finish)));}).show();});}
    @Override protected void onDestroy(){ui.removeCallbacksAndMessages(null);if(web!=null){web.removeJavascriptInterface("StudioBridge");web.destroy();web=null;}if(assets!=null)try{assets.close();}catch(IOException ignored){}if(packed!=null)packed.close();io.shutdown();super.onDestroy();}
}
