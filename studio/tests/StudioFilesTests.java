package cn.wuziping.studio.tests;
import cn.wuziping.studio.*;
import java.io.*;
import java.net.*;
import java.util.*;
public final class StudioFilesTests {
    private static int count;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);count++;System.out.println("PASS "+message);}
    public static void main(String[] args)throws Exception{
        check(TextFiles.validPath("数学/helpers.py"),"Unicode project paths are supported");
        for(String path:new String[]{"../save.bin","a/../file","/etc/passwd","a\\b","a//b","a/./b","a\nb\nc","a|b",""})check(!TextFiles.validPath(path),"Reject unsafe path "+path.replace('\n','?'));
        String source="print('你好，伍子平！')\n";
        for(String encoding:new String[]{"UTF-8","UTF-16LE","UTF-16BE","GB18030"}){byte[] bytes=TextFiles.encode(source,encoding);TextFiles.Decoded decoded=TextFiles.decode(bytes);check(decoded.text.equals(source)&&decoded.encoding.equals(encoding),encoding+" import/save round trip retains Chinese");}
        check(TextFiles.decode(new byte[]{(byte)239,(byte)187,(byte)191,65}).text.equals("A"),"UTF-8 BOM is stripped from editor text");
        boolean rejected=false;try{TextFiles.decode(new byte[]{65,0,42});}catch(IOException expected){rejected=true;}check(rejected,"Binary files cannot silently become editable text");
        rejected=false;try{TextFiles.read(new ByteArrayInputStream(new byte[20]),12);}catch(IOException expected){rejected=true;}check(rejected,"Import limit is enforced before a large file is retained");
        rejected=false;try{TextFiles.encode("😀","GB18030-bad");}catch(IOException expected){rejected=true;}check(rejected,"Unsupported save encodings fail before writing");
        Map<String,byte[]> resources=new HashMap<>();resources.put("studio/app.js","console.log(1)".getBytes("UTF-8"));resources.put("studio/python.asm.wasm",new byte[]{0,97,115,109});
        try(AssetServer server=new AssetServer(p->{if(!resources.containsKey(p))throw new FileNotFoundException();return new ByteArrayInputStream(resources.get(p));},false)){
            URL url=new URL(server.base()+"studio/app.js");check(url.getHost().equals("127.0.0.1"),"Asset server binds only to loopback");HttpURLConnection c=(HttpURLConnection)url.openConnection();check(c.getResponseCode()==200,"Bundled script is served offline");check(c.getHeaderField("Content-Security-Policy").contains("frame-src 'none'"),"Editor CSP prevents user-created frames from acquiring the native bridge");check(c.getContentLength()=="console.log(1)".length(),"Served assets declare Content-Length");check(new String(TextFiles.read(c.getInputStream(),100),"UTF-8").equals("console.log(1)"),"HTTP resource bytes match source exactly");c.disconnect();
            check("studio/app.js".equals(server.pathOf(server.base()+"studio/app.js")),"Session URL maps back to the asset path");
            check(server.pathOf(server.base().replace("127.0.0.1","localhost")+"studio/app.js").equals("studio/app.js"),"localhost loopback maps to the same asset");
            check(server.pathOf(server.base()+"%2e%2e/journey-v1.bin")==null,"Encoded traversal is not an asset path");
            c=(HttpURLConnection)new URL(server.base()+"studio/python.asm.wasm").openConnection();check(c.getContentType().equals("application/wasm"),"WASM receives the correct MIME for streaming compilation");c.disconnect();
            for(String path:new String[]{"%2e%2e/journey-v1.bin","studio/%2e%2e/journey-v1.bin","missing.js"}){c=(HttpURLConnection)new URL(server.base()+path).openConnection();check(c.getResponseCode()==404,"Server denies traversal or unavailable asset "+path);c.disconnect();}
            c=(HttpURLConnection)new URL(server.base()+"studio/app.js").openConnection();c.setRequestMethod("POST");check(c.getResponseCode()==405,"Static server cannot accept filesystem mutations");c.disconnect();
            String invalid=server.base().replaceFirst("/[0-9a-f-]{36}/","/wrong-token/");c=(HttpURLConnection)new URL(invalid+"studio/app.js").openConnection();check(c.getResponseCode()==404,"Other loopback clients cannot use a guessed session prefix");c.disconnect();
        }
        try(AssetServer preview=new AssetServer(p->new ByteArrayInputStream("<h1>你好</h1>".getBytes("UTF-8")),true)){
            HttpURLConnection c=(HttpURLConnection)new URL(preview.base()+"index.html").openConnection();check(c.getContentType().equals("text/html; charset=utf-8"),"HTML preview declares UTF-8 even without a user meta tag");check(c.getHeaderField("Content-Security-Policy").contains("'unsafe-inline'")&&c.getHeaderField("Content-Security-Policy").contains("connect-src 'none'"),"Separate preview permits local page scripts and denies external connections");c.disconnect();
        }
        System.out.println("ALL "+count+" STUDIO IO CHECKS PASSED");
    }
}
