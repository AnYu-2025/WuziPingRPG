package cn.wuziping.ember;

import java.io.*;
import java.util.*;

/** Six actual combat archetypes, forge progression and a kill-charged ultimate. */
public final class Arsenal {
    public static final int MENU=11,EMPTY_SAVE_BYTES=48;
    public static final String[] NAMES={"星火剑","疾风双刃","血晶长枪","脉冲弩炮","共振法杖","镇域重锤"};
    public static final String[] SKILLS={"旋刃风暴","疾风突袭","血晶贯流","脉冲齐射","共振震荡","镇域震地"};
    public static final String[] DESCS={"三连斩 · 近身均衡","高速连击 · 护身突袭","长距突刺 · 贯穿光束","远程弹丸 · 三向齐射","扇形法弹 · 共振震荡","环形重击 · 霸体震地"};
    public static final float[] POWER={1,.65f,1.35f,.9f,.65f,1.9f},DELAY={1,.52f,1.45f,1.2f,1.4f,2.05f},REACH={52,40,108,280,240,65};
    public static final int[] COLORS={0xffedc985,0xff9cdcc7,0xffda9aba,0xff83c9e4,0xffbca5ed,0xffe9a47e};
    public int selected=0,unlocked=1,combo=0;public float energy=0,shield=0;
    public final int[] forge=new int[6];
    public final ArrayList<Bolt> bolts=new ArrayList<>();
    public static final class Bolt {
        public float x,y,vx,vy,life,damage;public int pierce,color;public final HashSet<Integer> hit=new HashSet<>();
        Bolt(float a,float b,float angle,float velocity,float dmg,int count,int c){x=a;y=b;vx=(float)Math.cos(angle)*velocity;vy=(float)Math.sin(angle)*velocity;damage=dmg;pierce=count;life=2;color=c;}
    }
    public String name(){return NAMES[selected]+(forge[selected]>0?" +"+forge[selected]:"");}
    public boolean owned(int i){return i>=0&&i<6&&(unlocked&(1<<i))!=0;}
    public float damage(Game g){return g.attack*(POWER[selected]+forge[selected]*.12f);}
    public float delay(Game g){return g.attackDelay*DELAY[selected];}
    public int cost(int id){return 30+forge[id]*25;}
    public void unlock(Game g,int id){id=Math.min(5,Math.max(0,id));if(!owned(id)){unlocked|=1<<id;g.announce("新武器解锁 · "+NAMES[id]);}}
    public void equip(Game g,int id){if(owned(id)){selected=id;combo=0;g.announce("已装备 · "+name());}}
    public void upgrade(Game g,int id){if(!owned(id)||forge[id]>=3){g.announce("武器未解锁或强化已满");return;}int cost=cost(id);if(g.gold<cost){g.announce("强化金币不足 · 需要 "+cost);return;}g.gold-=cost;forge[id]++;g.announce(NAMES[id]+"强化 +"+forge[id]);}
    private Game.Enemy aim(Game g){Game.Enemy best=null;float distance=REACH[selected];for(Game.Enemy e:g.enemies){float d=Game.dist(g.x,g.y,e.x,e.y);if(d<distance){distance=d;best=e;}}if(best!=null)g.facing=(float)Math.atan2(best.y-g.y,best.x-g.x);return best;}
    private void fire(Game g,float angle,float damage,int pierce){if(bolts.size()<128)bolts.add(new Bolt(g.x,g.y,angle,selected==2?240:185,damage,pierce,COLORS[selected]));}
    public void attack(Game g){
        g.attackCd=delay(g);g.swing=selected==3||selected==4?0:.2f;aim(g);combo=(combo+1)%3;
        if(selected==3){fire(g,g.facing,damage(g),1);return;}
        if(selected==4){for(int j=-1;j<=1;j++)fire(g,g.facing+j*.22f,damage(g),1);return;}
        float reach=REACH[selected],cone=selected==2?.78f:selected==5?-1:.0f;
        for(Game.Enemy e:new ArrayList<Game.Enemy>(g.enemies)){
            float d=Game.dist(g.x,g.y,e.x,e.y),dot=d<1?1:((e.x-g.x)*(float)Math.cos(g.facing)+(e.y-g.y)*(float)Math.sin(g.facing))/d;
            if(d<reach+e.radius()&&dot>=cone){boolean finisher=combo==0;g.damageEnemy(e,damage(g)*(finisher?1.45f:1),finisher);}
        }
    }
    public void skill(Game g){
        g.skillCd=Math.max(3,7-g.upgrades[4]*.35f);g.skillFlash=.48f;aim(g);
        if(selected==2||selected==3){for(int j=-1;j<=1;j++)fire(g,g.facing+j*(selected==2?.10f:.30f),damage(g)*2.2f,selected==2?5:2);return;}
        float radius=selected==4?150:selected==5?110:85;
        if(selected==1||selected==5){shield=2.5f;g.invuln=Math.max(g.invuln,.5f);}
        if(selected==1){g.dashX=(float)Math.cos(g.facing);g.dashY=(float)Math.sin(g.facing);g.dashTime=.12f;}
        for(Game.Enemy e:new ArrayList<Game.Enemy>(g.enemies))if(Game.dist(g.x,g.y,e.x,e.y)<radius+e.radius())g.damageEnemy(e,damage(g)*(selected==5?3:2.5f),true);
    }
    public void ultimate(Game g){
        if(g.mode!=Game.PLAY||!g.inBody()||energy<100)return;energy=0;shield=4;g.invuln=1;g.skillFlash=.48f;
        for(Game.Enemy e:new ArrayList<Game.Enemy>(g.enemies))if(Game.dist(g.x,g.y,e.x,e.y)<190)g.damageEnemy(e,g.attack*5,true);
        energy=0;
        g.announce("免疫爆发 · 震荡清场 / 护盾四秒");
    }
    public void tick(Game g,float dt){
        shield=Math.max(0,shield-dt);
        for(int i=bolts.size()-1;i>=0;i--){Bolt b=bolts.get(i);b.life-=dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
            if(g.blocked(b.x,b.y,2))b.life=0;
            if(b.life>0)for(Game.Enemy e:new ArrayList<Game.Enemy>(g.enemies))if(!b.hit.contains(e.id)&&Game.dist(b.x,b.y,e.x,e.y)<e.radius()+6){b.hit.add(e.id);g.damageEnemy(e,b.damage,false);if(--b.pierce<=0){b.life=0;break;}}
            if(b.life<=0)bolts.remove(i);
        }
    }
    public void write(DataOutputStream o)throws IOException{
        o.writeInt(selected);o.writeInt(unlocked);o.writeFloat(energy);o.writeInt(combo);o.writeFloat(shield);for(int level:forge)o.writeInt(level);o.writeInt(bolts.size());
        for(Bolt b:bolts){o.writeFloat(b.x);o.writeFloat(b.y);o.writeFloat(b.vx);o.writeFloat(b.vy);o.writeFloat(b.life);o.writeFloat(b.damage);o.writeInt(b.pierce);o.writeInt(b.color);o.writeInt(b.hit.size());for(int id:b.hit)o.writeInt(id);}
    }
    public static Arsenal read(DataInputStream in)throws IOException{
        Arsenal a=new Arsenal();a.selected=in.readInt();a.unlocked=in.readInt();a.energy=in.readFloat();a.combo=in.readInt();a.shield=in.readFloat();
        if(a.selected<0||a.selected>5||a.unlocked<1||a.unlocked>63||!a.owned(a.selected)||!valid(a.energy,0,100)||a.combo<0||a.combo>2||!valid(a.shield,0,5))throw new IOException("Invalid arsenal");
        for(int i=0;i<6;i++){a.forge[i]=in.readInt();if(a.forge[i]<0||a.forge[i]>3)throw new IOException("Invalid forge");}
        int count=in.readInt();if(count<0||count>128)throw new IOException("Invalid friendly projectiles");
        while(count-->0){Bolt b=new Bolt(0,0,0,0,0,1,0);b.x=in.readFloat();b.y=in.readFloat();b.vx=in.readFloat();b.vy=in.readFloat();b.life=in.readFloat();b.damage=in.readFloat();b.pierce=in.readInt();b.color=in.readInt();int hits=in.readInt();
            if(!valid(b.x,0,1280)||!valid(b.y,0,960)||!valid(b.vx,-400,400)||!valid(b.vy,-400,400)||!valid(b.life,0,3)||!valid(b.damage,0,1000000)||b.pierce<1||b.pierce>5||hits<0||hits>5)throw new IOException("Invalid friendly projectile");while(hits-->0)b.hit.add(in.readInt());a.bolts.add(b);}
        return a;
    }
    private static boolean valid(float v,float min,float max){return !Float.isNaN(v)&&!Float.isInfinite(v)&&v>=min&&v<=max;}
}
