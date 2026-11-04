package cn.wuziping.ember;

/** Authored town geometry shared by collision, rendering and navigation. */
public final class Town {
    public static final int WIDTH=1440,HEIGHT=1080;
    public static final float GATE_X=480,GATE_Y=112,FOREST_GATE_X=640,FOREST_GATE_Y=548;
    public static final class Npc {
        public final int id,sprite; public final float x,y; public final String name,role;
        Npc(int i,String n,String r,float a,float b){id=i;sprite=i;name=n;role=r;x=a;y=b;}
    }
    public static final class House {
        public final float x,y,w,h;public final int sprite; public final String name;
        House(int s,String n,float a,float b,float c,float d){sprite=s;name=n;x=a;y=b;w=c;h=d;}
        public boolean blocked(float a,float b,float r){return a+r>x-w*.39f&&a-r<x+w*.39f&&b+r>y-h*.43f&&b-r<y-7;}
    }
    public static final Npc[] NPCS={
        new Npc(0,"沈砚","守望人",480,317),
        new Npc(1,"阿岚","巡林人",535,174),
        new Npc(2,"陆铸","铁匠",333,493),
        new Npc(3,"苏禾","药师",633,306),
        new Npc(4,"知夏","学者",543,263),
        new Npc(5,"阿满","旅店掌柜",632,504),
        new Npc(6,"程理","物理学者",1180,480)
    };
    public static final House[] HOUSES={
        new House(0,"镇务厅",267,278,138,118),
        new House(1,"星火铁匠铺",258,494,138,118),
        new House(2,"青叶药坊",701,280,128,110),
        new House(3,"归途旅舍",709,498,146,122),
        new House(4,"旧日书屋",480,226,126,106),
        new House(5,"河畔人家",250,643,112,92),
        new House(5,"风铃小屋",710,643,112,92),
        new House(4,"星图学舍",1140,488,168,132),
        new House(6,"格物堂",1200,540,158,126),
        new House(5,"东庭花房",1150,890,148,116)
    };
    public static boolean blocked(float x,float y,float r){
        if(x-r<72||x+r>WIDTH-72||y-r<92||y+r>HEIGHT-60)return true;
        for(House house:HOUSES)if(house.blocked(x,y,r))return true;
        return Game.dist(x,y,480,408)<r+23;
    }
    public static Npc nearest(float x,float y){
        Npc result=null;float best=43;
        for(Npc n:NPCS){float d=Game.dist(x,y,n.x,n.y);if(d<best){best=d;result=n;}}
        return result;
    }
}
