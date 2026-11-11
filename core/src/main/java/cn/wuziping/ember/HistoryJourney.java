package cn.wuziping.ember;

import java.io.*;

/** Fictional narrative set during the wars of the Song-Jin transition. */
public final class HistoryJourney {
    public int stage=0;
    public byte[] suspended=new byte[0];
    public boolean active(){return stage==5||stage==6||stage==9||stage==8||(stage==7&&suspended.length>0);}
    public boolean failed(){return stage==8;}
    public String objective(){return stage==5?"护住百姓 · 击退山道盗匪":stage==9?"护送辎车 · 击退追来的斥候":stage==6?"守住渡口 · 击退金军追兵":stage==7?"残灯渡 · 已完成":"前往旧书屋与沈照交谈";}
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
        int count=next==5?6:next==9?7:9;
        for(int i=0;i<count;i++){double a=Math.PI*2*i/count;int type=next==5?(i%3==0?2:0):next==9?(i%2==0?2:3):(i==0?4:(i%3==0?3:2));g.spawnEnemy(type,640+(float)Math.cos(a)*210,460+(float)Math.sin(a)*150);Game.Enemy e=g.enemies.get(g.enemies.size()-1);e.hp*=next==5?1.45f:next==9?1.55f:1.85f;e.maxHp=e.hp;}
    }
    public void restart(Game g){
        if(suspended.length==0){exit(g);return;}
        prepare(g,5);
        g.story.begin(g,10,new String[]{
            "旁白|建炎年间，江淮道路因战争而拥塞。一辆载着药箱和旧书的木车在山道停下，雨水顺着车辕滴落。",
            "小槐|娘走散那天说，只要跟着灯走，就一定能找到船。我数了一路，可最后一盏灯不见了。",
            "沈照|你娘把路引交给了我。我不是官，也救不了所有人，但这条路上还有人等我们。",
            "秦砚舟|渡口只剩一艘船。我答应过守到最后一车，哪怕军令已经叫我撤走。",
            "伍子平|林里有脚步声。大家退到车后，我替你们开路。",
            "旁白|盗匪从雾中围上来。可以使用旅程中已获得的装备；倒下后从故事开头重来，但经验和成长保留。"
        },new String[]{"护车迎敌"},new int[]{400});
    }
    public void update(Game g){
        if(g.mode!=Game.PLAY||!g.enemies.isEmpty())return;
        if(stage==5)g.story.begin(g,10,new String[]{
            "旁白|盗匪散去，车轮却卡进泥沟。一个受伤的陌生人躺在路边，怀里仍抱着一卷路引。",
            "小槐|他刚才帮我挡住了一刀。沈姐姐，我们不能把他丢在这里。",
            "沈照|可渡口传来号角，追兵不会给我们太多时间。药箱和路引都要紧，我们只能先顾一边。",
            "秦砚舟|你来决定。我替你们拖住后面的人。"
        },new String[]{"先救伤者 · 药剂","先护路引 · 经验"},new int[]{410,412});
        else if(stage==9)g.story.begin(g,11,new String[]{
            "旁白|追来的斥候退去，渡口的灯却只亮了一半。河面起雾，船工说还需要片刻才能解开缆绳。",
            "秦砚舟|我的弟弟上个月也从这里过河。我守桥时没敢回头，后来只收到他的一片衣角。",
            "小槐|我可以数灯。等大家都上船，我再告诉你是不是少了一盏。",
            "沈照|把路引交给船工。河对岸的人需要知道谁还活着、谁在寻找家人。",
            "秦砚舟|追兵到了。你可以留下来与我守住渡口，也可以现在回城；回城后这段故事会从头开始。"
        },new String[]{"并肩守住渡口","撤回中山大学"},new int[]{413,411});
        else if(stage==7){exit(g);}
        else if(stage==6){stage=7;g.gold+=180;g.potions=Math.min(5,g.potions+1);g.story.begin(g,10,new String[]{
            "旁白|最后一只船离岸时天色微明。秦砚舟的枪折在桥头，他却仍在数着船上的身影。",
            "小槐|一、二、三……都上船了！你的那盏灯也在，秦大哥。",
            "秦砚舟|我不知道弟弟在哪里。但如果他还在路上，我希望也有人为他留一盏灯。",
            "沈照|我会把这份名单留给对岸的人。若以后有人问起，就说这一夜有人互相照看。",
            "伍子平|记住他们，比替这场仗编一个漂亮的结局更重要。",
            "旁白|两宋之交的战乱与迁徙是真实历史背景，本章人物、地点和情节为原创虚构。获得 180 金币和药剂。"
        },new String[]{"带着灯火回家"},new int[]{411});}
    }
    public void defeat(Game g){stage=8;g.hp=1;g.gainXp(8);g.mode=Game.DEAD;g.announce("残灯未灭 · 经验 +8，成长保留");}
    public void action(Game g,int action){if(action==401)start(g);else if((action==410||action==412)&&stage==5){prepare(g,9);if(action==410){g.potions=Math.min(5,g.potions+1);g.announce("你先救下伤者 · 药剂 +1");}else{g.gainXp(12);g.announce("你护住路引 · 经验 +12");}}else if(action==413&&stage==9){prepare(g,6);g.announce("渡口决战 · 击退追兵");}else if(action==411)exit(g);}
    public void exit(Game g){
        if(suspended.length>0)try{Game old=Game.load(new ByteArrayInputStream(suspended));if(old.history.active()||old.history.suspended.length>0)throw new IOException("Invalid nested history snapshot");clearFight(g);g.enemies.addAll(old.enemies);g.shots.addAll(old.shots);g.drops.addAll(old.drops);g.arsenal.bolts.addAll(old.arsenal.bolts);g.waveSpawned=old.waveSpawned;g.waveKilled=old.waveKilled;g.spawnTimer=old.spawnTimer;g.intermission=old.intermission;}catch(IOException e){g.announce("原旅程无法恢复，请从备份恢复");return;}
        suspended=new byte[0];if(stage!=7)stage=0;g.story.area=Story.TOWN;g.x=570;g.y=390;g.hp=g.maxHp;g.invuln=1;g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.story.dialogue=null;g.announce("回到中山大学 · 经验与成长已保留");
    }
    public void write(DataOutputStream out)throws IOException{out.writeInt(stage);out.writeInt(suspended.length);out.write(suspended);}
    public static HistoryJourney read(DataInputStream in,int version)throws IOException{
        HistoryJourney h=new HistoryJourney();h.stage=in.readInt();if(h.stage<0||h.stage>(version>=11?9:version>=10?8:4))throw new IOException("Invalid history state");
        if(version>=10){int n=in.readInt();if(n<0||n>4*1024*1024)throw new IOException("Invalid suspended journey");h.suspended=new byte[n];in.readFully(h.suspended);if(h.active()&&n==0)throw new IOException("Missing suspended journey");}return h;
    }
}
