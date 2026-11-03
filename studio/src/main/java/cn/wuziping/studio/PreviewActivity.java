package cn.wuziping.studio;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

/** Untrusted HTML lives in a separate WebView with no JavaScript interface. */
public final class PreviewActivity extends Activity {
    private WebView web;private AssetServer server;
    @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(0xff131b27);getWindow().setNavigationBarColor(0xff131b27);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);Button back=new Button(this);back.setText("‹  返回编辑器 · HTML 预览");back.setOnClickListener(v->finish());layout.addView(back,new LinearLayout.LayoutParams(-1,48));web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        try{JSONObject data;try(InputStream in=new FileInputStream(new File(getCacheDir(),"studio-preview.json"))){data=new JSONObject(new String(TextFiles.read(in,32*1024*1024),"UTF-8"));}Map<String,byte[]> files=new HashMap<>();JSONArray list=data.getJSONArray("files");for(int i=0;i<list.length();i++){JSONObject f=list.getJSONObject(i);String p=f.getString("path");if(TextFiles.validPath(p))files.put(p,f.getString("text").getBytes("UTF-8"));}String path=data.getString("path");if(!files.containsKey(path)||!TextFiles.validPath(path))throw new IOException("没有可预览的文件");server=new AssetServer(p->{byte[] bytes=files.get(p);if(bytes==null)throw new FileNotFoundException();return new ByteArrayInputStream(bytes);},true);
            web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setDomStorageEnabled(false);if(android.os.Build.VERSION.SDK_INT>=26)web.getSettings().setSafeBrowsingEnabled(false);web.setWebChromeClient(new WebChromeClient());web.setWebViewClient(StudioClient.create(server,null));web.loadUrl(server.base()+android.net.Uri.encode(path,"/"));
        }catch(Exception e){Toast.makeText(this,"预览失败："+e.getMessage(),Toast.LENGTH_LONG).show();finish();}
    }
    @Override protected void onDestroy(){if(web!=null)web.destroy();if(server!=null)try{server.close();}catch(IOException ignored){}super.onDestroy();}
}
