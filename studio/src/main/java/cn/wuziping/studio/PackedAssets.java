package cn.wuziping.studio;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import java.io.*;
import java.util.*;
import java.util.zip.*;

/** Reads packaged files even when AssetManager cannot see them. */
public final class PackedAssets implements Closeable {
    private final Context context;
    private ZipFile[] packs;
    public PackedAssets(Context context){this.context=context;}
    public InputStream open(String path)throws IOException{
        String[] names=path.equals("studio/index.html")?new String[]{"studio/index.html","studio/editor.page","editor.page"}:new String[]{path};
        IOException last=new FileNotFoundException(path);
        for(String name:names){
            String[] variants=name.indexOf('/')<0?new String[]{name}:new String[]{name,name.replace('/','\\')};
            for(String variant:variants){
                try{return context.getAssets().open(variant);}catch(IOException asset){last=asset;}
                InputStream packed=fromApk(variant);
                if(packed!=null)return packed;
            }
        }
        throw last;
    }
    public String readText(String path)throws IOException{
        try(InputStream in=open(path)){ByteArrayOutputStream buf=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)buf.write(b,0,n);return buf.toString("UTF-8");}
    }
    private InputStream fromApk(String path){
        String entry="assets/"+path;
        for(ZipFile zip:packs()){ZipEntry item=zip.getEntry(entry);if(item!=null)try{return zip.getInputStream(item);}catch(IOException ignored){}}
        return null;
    }
    private ZipFile[] packs(){
        if(packs!=null)return packs;
        ApplicationInfo info=context.getApplicationInfo();
        List<String> paths=new ArrayList<>();
        if(info.sourceDir!=null)paths.add(info.sourceDir);
        if(info.splitSourceDirs!=null)Collections.addAll(paths,info.splitSourceDirs);
        List<ZipFile> opened=new ArrayList<>();
        for(String path:paths)try{opened.add(new ZipFile(path));}catch(IOException ignored){}
        packs=opened.toArray(new ZipFile[0]);
        return packs;
    }
    public void close(){if(packs==null)return;for(ZipFile zip:packs)try{zip.close();}catch(IOException ignored){}packs=null;}
}
