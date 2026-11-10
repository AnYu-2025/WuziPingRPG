package cn.wuziping.ember;

import java.io.*;

/** Fictional narrative set during the wars of the Song-Jin transition. */
public final class HistoryJourney {
    public int stage=0;
    public byte[] suspended=new byte[0];
    public boolean active(){return stage==5||stage==6||stage==8||(stage==7&&suspended.length>0);}
    public boolean failed(){return stage==8;}
    public String objective(){return stage==5?"护住百姓 · 击退山道盗匪":stage==6?"守住渡口 · 击退金军追兵":stage==7?"残灯渡 · 已完成":"前往旧书屋与沈照交谈";}
    public boolean talk(Game g,int id){
        if(id<10||id>12||!g.inTown()||g.mode!=Game.PLAY)return false;
        if(id==10)g.story.begin(g,id,new String[]{"沈照|这张残破的路引，来自两宋之交。它上面没有名将的名字，只有一群逃难百姓的脚印。","沈照|战火将临安以北的道路切碎。我记得一处渡口，记得一个守桥的人，却忘了他们最后能否过河。","沈照|你愿意走进这段梦，替他们护住归途吗？你能带上自己的武器。倒下或退出后，这段故事会从头开始，但经验与成长会留下。"},new String[]{"进入 · 残灯渡","稍后再来"},new int[]{401,400});
        else if(id==11)g.story.begin(g,id,new String[]{"秦砚舟|我是替沈照修补残页的书吏。梦里那位持枪的渡卒，也叫秦砚舟。","秦砚舟|他总说守住渡口是军令，却偷偷把自己的干粮留给孩子。"},new String[]{"我记住了"},new int[]{400});
        else g.story.begin(g,id,new String[]{"小槐|梦里的人都在赶路，我负责数灯。一盏灯一个人，数不清的时候，就等他们回来再数。"},new String[]{"我会护住他们"},new int[]{400});
        return true;
    }
    private void clearFight(Game g){g.enemies.clear();g.shots.clear();g.drops.clear();g.arsenal.bolts.clear();g.effects.clear();g.vfx.clear();g.swing=g.skillFlash=g.dashTime=0;}
    public void start(Game g){
        try{ByteArrayOutputStream b=new ByteArrayOutputStream();g.save(b);suspended=b.toByteArray();}catch(IOException e){g.announce("无法保存原旅程，暂时不能进入历史副本");return;}
        restart(g);
    }
    private void prepare(Game g,int next){
        clearFight(g);stage=next;g.story.area=Story.FOREST;g.x=640;g.y=650;g.hp=g.maxHp;g.potions=Math.max(1,g.potions);g.invuln=1.5f;g.mode=Game.PLAY;
        int count=next==5?7:9;
        for(int i=0;i<count;i++){double a=Math.PI*2*i/count;int type=next==5?(i%3==0?2:0):(i==0?4:(i%3==0?3:2));g.spawnEnemy(type,640+(float)Math.cos(a)*210,460+(float)Math.sin(a)*150);Game.Enemy e=g.enemies.get(g.enemies.size()-1);e.hp*=next==5?1.65f:1.85f;e.maxHp=e.hp;}
    }
    public void restart(Game g){
        if(suspended.length==0){exit(g);return;}
        prepare(g,5);
        g.story.begin(g,10,new String[]{"旁白|建炎年间，烽火越过江淮。荒路上，携家南行的人把家当装进一辆吱呀作响的木车。","小槐|沈姐姐说，天黑前看见三盏灯，就能找到渡口。可是前面的林子里有人拿刀……","沈照|那些是趁乱劫掠的盗匪。别追远，先替车上的人打开路。","秦砚舟|我在渡口等你们。别让灯灭了。"},new String[]{"拔出武器 · 护送百姓"},new int[]{400});
    }
    public void update(Game g){
        if(g.mode!=Game.PLAY||!g.enemies.isEmpty())return;
        if(stage==5)g.story.begin(g,10,new String[]{"小槐|盗匪退了！可是河那边怎么有那么多火？","秦砚舟|金军追兵到了，渡船还没靠岸。你先带百姓上船，我来挡住他们。","沈照|不。我们一起守。让没有名字的人，也能写完自己的明天。"},new String[]{"前往渡口","撤回中山大学"},new int[]{410,411});
        else if(stage==7){exit(g);}
        else if(stage==6){stage=7;g.gold+=180;g.potions=Math.min(5,g.potions+1);g.story.begin(g,10,new String[]{"旁白|最后一只船离岸时，天边泛起微光。秦砚舟的枪折了，沈照把残页压在渡口的石头下。","小槐|一、二、三……都上船了！等天亮，我要把灯点给后来的人看。","沈照|史书里写得下朝代更替，也该有人记住那些互相扶持的人。","旁白|虚构故事完结。两宋之交的战争与迁徙属于真实历史；本章人物和渡口经过为原创虚构。获得 180 金币与药剂。"},new String[]{"带着灯火回家"},new int[]{411});}
    }
    public void defeat(Game g){stage=8;g.hp=1;g.gainXp(8);g.mode=Game.DEAD;g.announce("残灯未灭 · 经验 +8，成长保留");}
    public void action(Game g,int action){if(action==401)start(g);else if(action==410&&stage==5){prepare(g,6);g.announce("渡口决战 · 击退追兵");}else if(action==411)exit(g);}
    public void exit(Game g){
        if(suspended.length>0)try{Game old=Game.load(new ByteArrayInputStream(suspended));if(old.history.active()||old.history.suspended.length>0)throw new IOException("Invalid nested history snapshot");clearFight(g);g.enemies.addAll(old.enemies);g.shots.addAll(old.shots);g.drops.addAll(old.drops);g.arsenal.bolts.addAll(old.arsenal.bolts);g.waveSpawned=old.waveSpawned;g.waveKilled=old.waveKilled;g.spawnTimer=old.spawnTimer;g.intermission=old.intermission;}catch(IOException e){g.announce("原旅程无法恢复，请从备份恢复");return;}
        suspended=new byte[0];if(stage!=7)stage=0;g.story.area=Story.TOWN;g.x=570;g.y=390;g.hp=g.maxHp;g.invuln=1;g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.story.dialogue=null;g.announce("回到中山大学 · 经验与成长已保留");
    }
    public void write(DataOutputStream out)throws IOException{out.writeInt(stage);out.writeInt(suspended.length);out.write(suspended);}
    public static HistoryJourney read(DataInputStream in,int version)throws IOException{
        HistoryJourney h=new HistoryJourney();h.stage=in.readInt();if(h.stage<0||h.stage>(version>=10?8:4)||h.stage==9)throw new IOException("Invalid history state");
        if(version>=10){int n=in.readInt();if(n<0||n>4*1024*1024)throw new IOException("Invalid suspended journey");h.suspended=new byte[n];in.readFully(h.suspended);if(h.active()&&n==0)throw new IOException("Missing suspended journey");}return h;
    }
}
