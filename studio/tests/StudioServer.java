package cn.wuziping.studio.tests;
import cn.wuziping.studio.AssetServer;
import java.io.*;
import java.nio.file.*;

/** Desktop preview serves the identical bundled assets with the Android server's CSP. */
public final class StudioServer {
    public static void main(String[] args)throws Exception{
        Path root=Paths.get(args[0]).toAbsolutePath();AssetServer server=new AssetServer(path->{Path target=root.resolve(path).normalize();if(!target.startsWith(root))throw new FileNotFoundException();return Files.newInputStream(target);},args.length>2&&args[2].equals("preview"));
        String url=server.base()+"studio/index.html";Files.write(Paths.get(args[1]),url.getBytes("UTF-8"));System.out.println(url);Runtime.getRuntime().addShutdownHook(new Thread(()->{try{server.close();}catch(Exception ignored){}}));new java.util.concurrent.CountDownLatch(1).await();
    }
}
