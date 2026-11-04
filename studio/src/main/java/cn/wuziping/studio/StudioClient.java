package cn.wuziping.studio;

import android.webkit.*;
import java.io.*;
import java.net.URLDecoder;
import java.util.*;

/** Serves editor files inside WebView. The page itself is not loaded from 127.0.0.1, which some phones block. */
public final class StudioClient {
    public static final String ORIGIN="https://appassets.androidplatform.net/";
    public static final String PAGE=ORIGIN+"studio/index.html";
    public interface Hooks {
        void pageFinished();
        void pageFailed(String url,String description);
        void resourceFailed(String url,String description);
        void rendererGone(boolean crashed);
    }
    private StudioClient(){}
    public static boolean allowsBridge(AssetServer server,String url){return url==null||url.equals("about:blank")||url.startsWith("data:")||url.startsWith(ORIGIN)||(server!=null&&server.pathOf(url)!=null);}
    public static WebViewClient create(AssetServer server,Hooks hooks){
        return new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return cancel(server,url);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return cancel(server,request.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,String url){
                /* Loopback requests go straight to the local server so that it also works
                   on devices where request interception misbehaves. */
                if(server!=null&&server.owns(url))return null;
                return intercept(server,hooks,url);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(server!=null&&server.owns(url))return null;
                return intercept(server,hooks,url);
            }
            @Override public void onPageFinished(WebView view,String url){if(hooks!=null&&(url==null||url.startsWith(ORIGIN)||(server!=null&&server.owns(url))))hooks.pageFinished();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(hooks==null)return;
                String description=error==null?"资源加载失败":String.valueOf(error.getDescription());
                if(request==null)return;
                if(request.isForMainFrame())hooks.pageFailed(String.valueOf(request.getUrl()),description);
                else hooks.resourceFailed(String.valueOf(request.getUrl()),description);
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse errorResponse){
                if(hooks==null||request==null||errorResponse==null)return;
                String description="HTTP "+errorResponse.getStatusCode();
                if(request.isForMainFrame())hooks.pageFailed(String.valueOf(request.getUrl()),description);
                else hooks.resourceFailed(String.valueOf(request.getUrl()),description);
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                if(hooks!=null)hooks.rendererGone(detail!=null&&detail.didCrash());
                return true;
            }
        };
    }
    private static boolean cancel(AssetServer server,String url){if(url==null||url.startsWith(ORIGIN)||(server!=null&&server.owns(url)))return false;return url.startsWith("http://")||url.startsWith("https://");}
    private static String assetPath(AssetServer server,String url){
        if(url==null)return null;
        if(!url.startsWith(ORIGIN))return server==null?null:server.pathOf(url);
        String rest=url.substring(ORIGIN.length());int cut=rest.indexOf('?');if(cut>=0)rest=rest.substring(0,cut);cut=rest.indexOf('#');if(cut>=0)rest=rest.substring(0,cut);
        try{rest=URLDecoder.decode(rest,"UTF-8");}catch(Exception e){return null;}
        return TextFiles.validPath(rest)?rest:null;
    }
    private static WebResourceResponse intercept(AssetServer server,Hooks hooks,String url){
        String path=assetPath(server,url);
        if(path==null){
            if(url!=null&&url.startsWith(ORIGIN)){
                if(hooks!=null)hooks.resourceFailed(url,"未知资源路径");
                return new WebResourceResponse("text/plain","utf-8",404,"Not Found",new HashMap<String,String>(),new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }
        String mime=TextFiles.mime(path);boolean text=mime.startsWith("text/")||mime.equals("application/javascript")||mime.equals("application/json");
        Map<String,String> headers=new HashMap<>();headers.put("Content-Security-Policy",server.policy());headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");
        try{byte[] body;try(InputStream in=server.open(path)){ByteArrayOutputStream buf=new ByteArrayOutputStream();byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1)buf.write(b,0,n);body=buf.toByteArray();}headers.put("Content-Length",Integer.toString(body.length));return new WebResourceResponse(mime,text?"utf-8":null,200,"OK",headers,new ByteArrayInputStream(body));}
        catch(IOException missing){return new WebResourceResponse("text/plain","utf-8",404,"Not Found",headers,new ByteArrayInputStream(new byte[0]));}
        catch(Throwable failure){
            if(hooks!=null)hooks.resourceFailed(url,failure.getClass().getSimpleName()+": "+failure.getMessage());
            return new WebResourceResponse("text/plain","utf-8",500,"Asset Error",headers,new ByteArrayInputStream(new byte[0]));
        }
    }
}
