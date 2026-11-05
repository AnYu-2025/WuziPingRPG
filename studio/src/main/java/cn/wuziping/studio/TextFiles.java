package cn.wuziping.studio;

import java.io.*;
import java.nio.*;
import java.nio.charset.*;

/** Encoding and path rules shared by imports, preview and the local asset server. */
public final class TextFiles {
    public static final int LIMIT=2*1024*1024;
    public static boolean validPath(String path){if(path==null||path.isEmpty()||path.length()>200||path.startsWith("/")||path.matches("(?s).*[\\x00-\\x1f\\\\:*?\"<>|].*"))return false;for(String part:path.split("/",-1))if(part.isEmpty()||part.equals(".")||part.equals(".."))return false;return true;}
    public static byte[] read(InputStream in,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>limit)throw new IOException("文件过大，单个文本文件最多 2 MB");out.write(buffer,0,n);}return out.toByteArray();}
    public static final class Decoded {public final String text,encoding;Decoded(String t,String e){text=t;encoding=e;}}
    public static Decoded decode(byte[] bytes)throws IOException{
        String encoding="UTF-8";int start=0;
        if(bytes.length>=2&&(bytes[0]&255)==255&&(bytes[1]&255)==254){encoding="UTF-16LE";start=2;}
        else if(bytes.length>=2&&(bytes[0]&255)==254&&(bytes[1]&255)==255){encoding="UTF-16BE";start=2;}
        else if(bytes.length>=3&&(bytes[0]&255)==239&&(bytes[1]&255)==187&&(bytes[2]&255)==191)start=3;
        if(start==0)for(byte b:bytes)if(b==0)throw new IOException("这是二进制文件，当前仅支持文本与代码");
        String text;
        try{text=strict(bytes,start,encoding);}catch(CharacterCodingException e){if(!encoding.equals("UTF-8"))throw new IOException("无法识别文本编码",e);encoding="GB18030";try{text=strict(bytes,0,encoding);}catch(CharacterCodingException bad){throw new IOException("无法识别文本编码",bad);}}
        int control=0;for(int i=0;i<text.length();i++){char c=text.charAt(i);if(c==0)throw new IOException("不支持二进制文件");if(c<32&&c!='\n'&&c!='\r'&&c!='\t'&&c!='\f')control++;}if(control>Math.max(2,text.length()/100))throw new IOException("不支持二进制文件");return new Decoded(text,encoding);
    }
    private static String strict(byte[] b,int offset,String encoding)throws CharacterCodingException{return Charset.forName(encoding).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b,offset,b.length-offset)).toString();}
    public static byte[] encode(String text,String encoding)throws IOException{
        if(!encoding.equals("UTF-8")&&!encoding.equals("GB18030")&&!encoding.equals("UTF-16LE")&&!encoding.equals("UTF-16BE"))throw new IOException("不支持的保存编码");
        try{ByteBuffer buffer=Charset.forName(encoding).newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(text));ByteArrayOutputStream out=new ByteArrayOutputStream();if(encoding.equals("UTF-16LE")){out.write(255);out.write(254);}if(encoding.equals("UTF-16BE")){out.write(254);out.write(255);}byte[] b=new byte[buffer.remaining()];buffer.get(b);out.write(b);return out.toByteArray();}catch(CharacterCodingException e){throw new IOException("当前编码无法保存这些字符，请使用另存为 UTF-8",e);}
    }
    public static String mime(String path){String n=path.toLowerCase(java.util.Locale.ROOT);if(n.endsWith(".html")||n.endsWith(".htm"))return "text/html";if(n.endsWith(".js")||n.endsWith(".mjs"))return "application/javascript";if(n.endsWith(".css"))return "text/css";if(n.endsWith(".json"))return "application/json";if(n.endsWith(".wasm"))return "application/wasm";if(n.endsWith(".zip"))return "application/zip";if(n.endsWith(".png"))return "image/png";if(n.endsWith(".jpg")||n.endsWith(".jpeg"))return "image/jpeg";if(n.endsWith(".webp"))return "image/webp";if(n.endsWith(".gif"))return "image/gif";if(n.endsWith(".svg"))return "image/svg+xml";return "text/plain";}
}
