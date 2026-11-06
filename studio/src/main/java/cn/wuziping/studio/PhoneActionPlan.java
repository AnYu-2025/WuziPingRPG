package cn.wuziping.studio;

import java.util.Locale;

/**
 * Pure checks for phone-agent tools. No Android APIs, so the rules can run in the
 * plain Java test suite. The activity layer must launch only what this class accepts.
 * Silent SMS, real phone calls, and file deletion are not representable here.
 */
public final class PhoneActionPlan {
    public static final int APP_LIMIT=60;
    private static final String[] PHONE={"openUrl","dial","draftSms","shareText","openMaps","openSettings","openApp","readClipboard","writeClipboard","deviceContext","listApps","notificationStatus"};
    private static final String[] SCREENS={"wifi","bluetooth","location","apps","battery","notifications","accessibility","display","sound","wireless"};
    private PhoneActionPlan(){}

    public static boolean alarmMayRun(String action){
        return "remind".equals(action)||"dailyLog".equals(action)||"scanReport".equals(action);
    }
    public static boolean isPhoneTool(String tool){
        if(tool==null)return false;
        for(String name:PHONE)if(name.equals(tool))return true;
        return false;
    }
    /** Always false: timed work must not gain messaging or deletion. */
    public static boolean silentOutbound(String tool){return false;}

    public static final class Input {
        public String url="",number="",body="",text="",title="",query="",screen="",pkg="",label="",lat="",lng="";
    }
    public static final class Result {
        public final boolean ok;
        public final String error;
        public final String url,number,body,text,title,query,screen,pkg,label;
        public final boolean hasPoint;
        public final double lat,lng;
        private Result(boolean ok,String error,String url,String number,String body,String text,String title,String query,String screen,String pkg,String label,boolean hasPoint,double lat,double lng){
            this.ok=ok;this.error=error==null?"":error;
            this.url=n(url);this.number=n(number);this.body=n(body);this.text=n(text);this.title=n(title);
            this.query=n(query);this.screen=n(screen);this.pkg=n(pkg);this.label=n(label);
            this.hasPoint=hasPoint;this.lat=lat;this.lng=lng;
        }
        private static String n(String v){return v==null?"":v;}
        static Result bad(String error){return new Result(false,error,"","","","","","","","","",false,0,0);}
        static Result of(String url,String number,String body,String text,String title,String query,String screen,String pkg,String label,boolean hasPoint,double lat,double lng){
            return new Result(true,"",url,number,body,text,title,query,screen,pkg,label,hasPoint,lat,lng);
        }
    }

    public static Result prepare(String tool,Input in){
        if(in==null)in=new Input();
        if(!isPhoneTool(tool))return Result.bad("未知工具");
        if("openUrl".equals(tool)){
            String url=in.url==null?"":in.url.trim();
            if(!validHttpUrl(url))return Result.bad("只允许 http 或 https 链接");
            return Result.of(url,"","","","","","","","",false,0,0);
        }
        if("dial".equals(tool)){
            String number=digits(in.number);
            if(!number.matches("\\+?[0-9]{3,20}"))return Result.bad("号码格式无效");
            return Result.of("",number,"","","","","","","",false,0,0);
        }
        if("draftSms".equals(tool)){
            String number=digits(in.number);
            String body=clean(in.body,1000);
            if(!number.matches("\\+?[0-9]{3,20}"))return Result.bad("号码格式无效");
            if(body.trim().isEmpty())return Result.bad("短信正文为空");
            return Result.of("",number,body,"","","","","","",false,0,0);
        }
        if("shareText".equals(tool)){
            String text=clean(in.text,2000),title=clean(in.title,80);
            if(text.trim().isEmpty())return Result.bad("没有可分享的文本");
            return Result.of("","","",text,title,"","","","",false,0,0);
        }
        if("writeClipboard".equals(tool)){
            String text=clean(in.text,4000);
            if(text.isEmpty())return Result.bad("没有可写入的文本");
            return Result.of("","","",text,"","","","","",false,0,0);
        }
        if("openMaps".equals(tool)){
            String lat=in.lat==null?"":in.lat.trim(),lng=in.lng==null?"":in.lng.trim();
            if(!lat.isEmpty()||!lng.isEmpty()){
                try{
                    double la=Double.parseDouble(lat),ln=Double.parseDouble(lng);
                    if(Double.isNaN(la)||Double.isNaN(ln)||la<-90||la>90||ln<-180||ln>180)return Result.bad("坐标超出范围");
                    return Result.of("","","","","", "", "", "", clean(in.label,80), true, la, ln);
                }catch(NumberFormatException e){return Result.bad("坐标格式无效");}
            }
            String query=clean(in.query,200).trim();
            if(query.isEmpty())return Result.bad("请提供地点或坐标");
            return Result.of("","","","", "", query, "", "", clean(in.label,80), false, 0, 0);
        }
        if("openSettings".equals(tool)){
            String screen=in.screen==null?"":in.screen.trim().toLowerCase(Locale.ROOT);
            if(!knownScreen(screen))return Result.bad("不支持的设置页");
            return Result.of("","","","","","",screen,"","",false,0,0);
        }
        if("openApp".equals(tool)){
            String pkg=in.pkg==null?"":in.pkg.trim(),label=clean(in.label,80).trim();
            if(!pkg.isEmpty()&&!pkg.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+"))return Result.bad("包名格式无效");
            if(pkg.isEmpty()&&label.isEmpty())return Result.bad("请提供包名或应用名称");
            return Result.of("","","","","","","",pkg,label,false,0,0);
        }
        return Result.of("","","","","","","","","",false,0,0);
    }

    public static String intentAction(String tool){
        if("dial".equals(tool))return "android.intent.action.DIAL";
        if("draftSms".equals(tool))return "android.intent.action.SENDTO";
        if("shareText".equals(tool))return "android.intent.action.SEND";
        if("openUrl".equals(tool)||"openMaps".equals(tool))return "android.intent.action.VIEW";
        if("openSettings".equals(tool))return "android.settings.SETTINGS";
        return "";
    }
    public static String settingsAction(String screen){
        if("wifi".equals(screen))return "android.settings.WIFI_SETTINGS";
        if("bluetooth".equals(screen))return "android.settings.BLUETOOTH_SETTINGS";
        if("location".equals(screen))return "android.settings.LOCATION_SOURCE_SETTINGS";
        if("apps".equals(screen))return "android.settings.APPLICATION_SETTINGS";
        if("battery".equals(screen))return "android.settings.BATTERY_SAVER_SETTINGS";
        if("notifications".equals(screen))return "android.settings.APP_NOTIFICATION_SETTINGS";
        if("accessibility".equals(screen))return "android.settings.ACCESSIBILITY_SETTINGS";
        if("display".equals(screen))return "android.settings.DISPLAY_SETTINGS";
        if("sound".equals(screen))return "android.settings.SOUND_SETTINGS";
        if("wireless".equals(screen))return "android.settings.WIRELESS_SETTINGS";
        return "";
    }
    public static String viewUri(Result plan){
        if(plan==null||!plan.ok)return "";
        if(plan.url.length()>0)return plan.url;
        if(plan.number.length()>0&&plan.body.length()>0)return "smsto:"+plan.number;
        if(plan.number.length()>0)return "tel:"+plan.number;
        if(plan.hasPoint){
            String point=trimPoint(plan.lat)+","+trimPoint(plan.lng);
            String q=point;
            if(plan.label.length()>0)q=point+"("+plan.label+")";
            return "geo:"+point+"?q="+encode(q);
        }
        if(plan.query.length()>0)return "geo:0,0?q="+encode(plan.query);
        return "";
    }

    private static boolean knownScreen(String screen){for(String name:SCREENS)if(name.equals(screen))return true;return false;}
    private static String digits(String raw){return raw==null?"":raw.replace(" ","").replace("-","");}
    static String clean(String raw,int max){
        if(raw==null||max<=0)return "";
        StringBuilder out=new StringBuilder();
        for(int i=0;i<raw.length()&&out.length()<max;i++){
            char c=raw.charAt(i);
            if(c=='\n'||c=='\t'||c>=' ')out.append(c);
        }
        return out.toString();
    }
    static boolean validHttpUrl(String url){
        if(url==null)return false;
        String v=url.trim();
        if(v.length()<8||v.length()>500)return false;
        for(int i=0;i<v.length();i++){char c=v.charAt(i);if(c<=' '||c=='<'||c=='>')return false;}
        String lower=v.toLowerCase(Locale.ROOT);
        int scheme;
        if(lower.startsWith("https://"))scheme=8;
        else if(lower.startsWith("http://"))scheme=7;
        else return false;
        int cut=v.length();
        for(int i=scheme;i<v.length();i++){char c=v.charAt(i);if(c=='/'||c=='?'||c=='#'){cut=i;break;}}
        String hostPort=v.substring(scheme,cut);
        if(hostPort.isEmpty()||hostPort.indexOf('@')>=0)return false;
        if(hostPort.startsWith("[")){
            int end=hostPort.indexOf(']');
            if(end<=1)return false;
            String rest=hostPort.substring(end+1);
            return rest.isEmpty()||rest.matches(":[0-9]{1,5}");
        }
        String host=hostPort;
        int colon=hostPort.lastIndexOf(':');
        if(colon>=0){
            if(!hostPort.substring(colon+1).matches("[0-9]{1,5}"))return false;
            host=hostPort.substring(0,colon);
        }
        return host.matches("[A-Za-z0-9][A-Za-z0-9.-]*");
    }
    private static String trimPoint(double value){
        String text=Double.toString(value);
        if(text.endsWith(".0"))return text.substring(0,text.length()-2);
        return text;
    }
    static String encode(String raw){
        try{
            byte[] bytes=raw.getBytes("UTF-8");
            StringBuilder sb=new StringBuilder();
            for(byte b:bytes){
                int v=b&0xff;
                if((v>='A'&&v<='Z')||(v>='a'&&v<='z')||(v>='0'&&v<='9')||v=='-'||v=='_'||v=='.'||v=='~')sb.append((char)v);
                else sb.append(String.format(Locale.ROOT,"%%%02X",v));
            }
            return sb.toString();
        }catch(Exception e){return "";}
    }
}
