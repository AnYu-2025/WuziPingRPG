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
        PhoneActionPlan.Input in=new PhoneActionPlan.Input();
        in.url="javascript:alert(1)";
        check(!PhoneActionPlan.prepare("openUrl",in).ok,"javascript URLs are rejected");
        in.url="file:///sdcard/secret.txt";
        check(!PhoneActionPlan.prepare("openUrl",in).ok,"file URLs are rejected");
        in.url="https://user:secret@example.com/a";
        check(!PhoneActionPlan.prepare("openUrl",in).ok,"URLs with credentials are rejected");
        in.url="https://example.com:443/a?q=1";
        PhoneActionPlan.Result opened=PhoneActionPlan.prepare("openUrl",in);
        check(opened.ok&&opened.url.equals("https://example.com:443/a?q=1"),"https URLs with a port pass");
        in=new PhoneActionPlan.Input();
        in.number="+86 138-0000-0000";
        in.body="你好";
        PhoneActionPlan.Result sms=PhoneActionPlan.prepare("draftSms",in);
        check(sms.ok&&sms.number.equals("+8613800000000")&&sms.body.equals("你好"),"SMS draft keeps the number and body");
        check(PhoneActionPlan.viewUri(sms).equals("smsto:+8613800000000"),"SMS URI is smsto and does not encode a send");
        check("android.intent.action.SENDTO".equals(PhoneActionPlan.intentAction("draftSms")),"SMS opens SENDTO");
        check(!PhoneActionPlan.intentAction("draftSms").endsWith("CALL"),"SMS action is not a call");
        in=new PhoneActionPlan.Input();
        in.number="100 86";
        PhoneActionPlan.Result dial=PhoneActionPlan.prepare("dial",in);
        check(dial.ok&&"tel:10086".equals(PhoneActionPlan.viewUri(dial)),"dial URI is tel");
        check("android.intent.action.DIAL".equals(PhoneActionPlan.intentAction("dial")),"dial uses ACTION_DIAL");
        check(!PhoneActionPlan.intentAction("dial").endsWith("CALL"),"dial never uses ACTION_CALL");
        check(!PhoneActionPlan.silentOutbound("draftSms")&&!PhoneActionPlan.silentOutbound("shareText"),"phone tools cannot send silently");
        check(PhoneActionPlan.alarmMayRun("remind")&&PhoneActionPlan.alarmMayRun("dailyLog")&&PhoneActionPlan.alarmMayRun("scanReport"),"alarms stay on the three safe actions");
        for(String blocked:new String[]{"draftSms","openUrl","deleteFiles","shareText","dial","readClipboard"})check(!PhoneActionPlan.alarmMayRun(blocked),"alarm cannot run "+blocked);
        in=new PhoneActionPlan.Input();
        in.screen="accessibility";
        PhoneActionPlan.Result access=PhoneActionPlan.prepare("openSettings",in);
        check(access.ok&&"android.settings.ACCESSIBILITY_SETTINGS".equals(PhoneActionPlan.settingsAction(access.screen)),"accessibility only names the system settings screen");
        in.screen="adb";
        check(!PhoneActionPlan.prepare("openSettings",in).ok,"unknown settings screens are rejected");
        in=new PhoneActionPlan.Input();
        in.query="中山大学";
        PhoneActionPlan.Result map=PhoneActionPlan.prepare("openMaps",in);
        check(map.ok&&PhoneActionPlan.viewUri(map).startsWith("geo:0,0?q=")&&PhoneActionPlan.viewUri(map).contains("%"),"map query is a geo URI");
        in=new PhoneActionPlan.Input();
        in.lat="23.1";in.lng="200";
        check(!PhoneActionPlan.prepare("openMaps",in).ok,"map coordinates are bounded");
        in=new PhoneActionPlan.Input();
        in.pkg="rm -rf";
        check(!PhoneActionPlan.prepare("openApp",in).ok,"package names are strict");
        in.pkg="cn.wuziping.ember";
        check(PhoneActionPlan.prepare("openApp",in).ok,"dotted package names pass");
        check(PhoneActionPlan.APP_LIMIT<=80&&PhoneActionPlan.APP_LIMIT>0,"installed app list stays bounded");
        in=new PhoneActionPlan.Input();
        check(!PhoneActionPlan.prepare("shareText",in).ok,"empty share is rejected");
        in.text="hello";
        check(PhoneActionPlan.prepare("shareText",in).ok&&"android.intent.action.SEND".equals(PhoneActionPlan.intentAction("shareText")),"share is ACTION_SEND");
        check(PhoneActionPlan.isPhoneTool("deviceContext")&&!PhoneActionPlan.isPhoneTool("deleteFiles"),"phone tool set does not include deletion");
        System.out.println("ALL "+count+" STUDIO IO CHECKS PASSED");
    }
}
