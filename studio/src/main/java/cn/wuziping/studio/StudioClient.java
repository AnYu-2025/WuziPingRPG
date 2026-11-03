package cn.wuziping.studio;

import android.webkit.*;
import java.io.*;
import java.util.*;

/** Serves the session's assets inside WebView so the editor does not depend on loopback HTTP policy. */
public final class StudioClient {
    public interface Hooks { void pageFinished(); void pageFailed(String description); }
    private StudioClient(){}
    public static boolean allowsBridge(AssetServer server,String url){return url==null||url.equals("about:blank")||server.pathOf(url)!=null;}
    public static WebViewClient create(AssetServer server,Hooks hooks){
        return new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !server.owns(url);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !server.owns(request.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,String url){return intercept(server,url);}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return intercept(server,request.getUrl().toString());}
            @Override public void onPageFinished(WebView view,String url){if(hooks!=null&&server.owns(url))hooks.pageFinished();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(hooks!=null&&request.isForMainFrame())hooks.pageFailed(String.valueOf(error.getDescription()));}
        };
    }
    private static WebResourceResponse intercept(AssetServer server,String url){
        String path=server.pathOf(url);
        if(path==null){if(url!=null&&(url.startsWith("http://")||url.startsWith("https://")))return new WebResourceResponse("text/plain","utf-8",403,"Forbidden",new HashMap<String,String>(),new ByteArrayInputStream(new byte[0]));return null;}
        String mime=TextFiles.mime(path);boolean text=mime.startsWith("text/")||mime.equals("application/javascript")||mime.equals("application/json");
        Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy",server.policy());headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");
        try{byte[] body;try(InputStream in=server.open(path)){ByteArrayOutputStream buf=new ByteArrayOutputStream();byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1)buf.write(b,0,n);body=buf.toByteArray();}headers.put("Content-Length",Integer.toString(body.length));return new WebResourceResponse(mime,text?"utf-8":null,200,"OK",headers,new ByteArrayInputStream(body));}
        catch(IOException missing){return new WebResourceResponse("text/plain","utf-8",404,"Not Found",headers,new ByteArrayInputStream(new byte[0]));}
    }
}
