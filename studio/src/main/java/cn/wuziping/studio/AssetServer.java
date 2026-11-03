package cn.wuziping.studio;

import java.io.*;
import java.net.*;
import java.util.UUID;
import java.util.concurrent.*;

/** Loopback only, read-only static assets. No user-storage or bridge endpoints. */
public final class AssetServer implements Closeable {
    public interface Source {InputStream open(String path)throws IOException;}
    private final ServerSocket server;private final Source source;private final String token=UUID.randomUUID().toString();private final String policy;
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(2,4,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(16));
    public AssetServer(Source source,boolean preview)throws IOException{
        this.source=source;policy="default-src 'self' data: blob:; script-src 'self' 'unsafe-eval' "+(preview?"'unsafe-inline'":"'wasm-unsafe-eval'")+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src "+(preview?"'none'":"'self'")+"; frame-src 'none'; object-src 'none'; base-uri 'none'";
        server=new ServerSocket(0,16,InetAddress.getByName("127.0.0.1"));Thread acceptor=new Thread(()->{while(!server.isClosed())try{Socket socket=server.accept();try{pool.execute(()->serve(socket));}catch(RejectedExecutionException busy){socket.close();}}catch(IOException e){if(server.isClosed())break;try{Thread.sleep(30);}catch(InterruptedException closed){break;}}},"studio-assets");acceptor.setDaemon(true);acceptor.start();
    }
    public String base(){return "http://127.0.0.1:"+server.getLocalPort()+"/"+token+"/";}
    public boolean owns(String url){if(url==null)return false;String loopback="http://127.0.0.1:"+server.getLocalPort()+"/"+token+"/";String local="http://localhost:"+server.getLocalPort()+"/"+token+"/";return url.startsWith(loopback)||url.startsWith(local);}
    public String policy(){return policy;}
    /** Path inside this session, or null when the URL is not one of our assets. */
    public String pathOf(String url){if(!owns(url))return null;String rest=url.substring(url.indexOf("/"+token+"/")+token.length()+2);int cut=rest.indexOf('?');if(cut>=0)rest=rest.substring(0,cut);cut=rest.indexOf('#');if(cut>=0)rest=rest.substring(0,cut);try{rest=java.net.URLDecoder.decode(rest,"UTF-8");}catch(Exception e){return null;}return TextFiles.validPath(rest)?rest:null;}
    public InputStream open(String path)throws IOException{return source.open(path);}
    private void serve(Socket socket){try(Socket s=socket){s.setSoTimeout(5000);BufferedReader in=new BufferedReader(new InputStreamReader(s.getInputStream(),"UTF-8"));String line=boundedLine(in);if(line==null)return;String[] request=line.split(" ");if(request.length!=3||!request[0].equals("GET")&&!request[0].equals("HEAD")){response(s.getOutputStream(),405,"text/plain",null,false);return;}for(int i=0;i<80;i++){String h=boundedLine(in);if(h==null||h.isEmpty())break;if(i==79)throw new IOException("Headers too long");}
        String path=new URI(request[1]).getPath(),prefix="/"+token+"/";if(path==null||!path.startsWith(prefix)||!TextFiles.validPath(path.substring(prefix.length()))){response(s.getOutputStream(),404,"text/plain",null,false);return;}path=path.substring(prefix.length());try(InputStream resource=source.open(path)){response(s.getOutputStream(),200,TextFiles.mime(path),resource,request[0].equals("HEAD"));}catch(FileNotFoundException missing){response(s.getOutputStream(),404,"text/plain",null,false);}
    }catch(Exception ignored){/* A closed WebView or cancelled fetch is normal. */}}
    private String boundedLine(Reader in)throws IOException{StringBuilder b=new StringBuilder();for(int c;(c=in.read())!=-1;){if(c=='\n')return b.toString();if(c!='\r')b.append((char)c);if(b.length()>4096)throw new IOException("Header too long");}return b.length()==0?null:b.toString();}
    private void response(OutputStream out,int code,String mime,InputStream stream,boolean head)throws IOException{
        byte[] body=new byte[0];if(stream!=null){ByteArrayOutputStream buf=new ByteArrayOutputStream();byte[] b=new byte[16384];int n;while((n=stream.read(b))!=-1)buf.write(b,0,n);body=buf.toByteArray();}
        if(mime.startsWith("text/")||mime.equals("application/javascript")||mime.equals("application/json"))mime+="; charset=utf-8";
        String headers="HTTP/1.1 "+code+(code==200?" OK":code==404?" Not Found":" Method Not Allowed")+"\r\nContent-Type: "+mime+"\r\nContent-Length: "+body.length+"\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: "+policy+"\r\n\r\n";out.write(headers.getBytes("UTF-8"));if(!head)out.write(body);out.flush();
    }
    public void close()throws IOException{server.close();pool.shutdownNow();}
}
