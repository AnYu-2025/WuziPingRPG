package cn.wuziping.ember;

import java.io.*;

/** Chapter one: quest state, map travel, NPC services and authored Chinese dialogue. */
public final class Story {
    public static final int FOREST=0,TOWN=1;
    private static final int CLOSE=0,ACCEPT=1,PREPARE=2,SMITH=3,POTION=4,REST=5,REPORT=6,SIDE=7,ENTER=8,RETURN=9;
    public boolean enabled=false,smithBought=false,sideClaimed=false,battleWon=false,defeated=false;
    public int area=FOREST,chapter=0,accountedKills=0;
    public float forestX=640,forestY=510;
    public Dialogue dialogue;
    public static final class Dialogue {
        public final int npc;public final String[] pages,options;public final int[] actions;
        public int page=0;public float age=0;public boolean revealed=false;
        Dialogue(int n,String[] p,String[] o,int[] a){npc=n;pages=p;options=o;actions=a;}
        public String speaker(){String s=pages[page];int split=s.indexOf('|');return split<0?"旁白":s.substring(0,split);}
        public String text(){String s=pages[page];int split=s.indexOf('|');return split<0?s:s.substring(split+1);}
        public int visible(){return revealed?text().length():Math.min(text().length(),(int)(age*30));}
        public boolean complete(){return visible()>=text().length();}
        public boolean last(){return page==pages.length-1;}
    }
    void begin(Game g,int npc,String[] pages,String[] options,int[] actions){String[] renamed=pages.clone();for(int k=0;k<renamed.length;k++){int split=renamed[k].indexOf('|');if(split>=0)renamed[k]=renamed[k].substring(0,split+1)+renamed[k].substring(split+1).replace(Game.HERO,g.heroName);}
        dialogue=new Dialogue(npc,renamed,options,actions);g.mode=Game.DIALOGUE;g.swing=g.skillFlash=0;}
    public void tick(float dt){if(dialogue!=null)dialogue.age+=dt;}
    public void opening(Game g){
        begin(g,-1,new String[]{
            "旁白|夜色落在中山大学的屋檐上。钟楼已经三夜没有响起，街角的灯却仍为远行的人亮着。",
            "伍子平|信上写着：若星火熄灭，就到中山大学来。我到了，写信的人又在哪里？",
            "旁白|广场北侧的守望人沈砚正在等你。靠近人物后，点击「交谈」或按 E，可以开始对话。"
        },new String[]{"进入中山大学"},new int[]{CLOSE});
    }
    public String objective(){
        switch(chapter){case 0:return "与广场北侧的沈砚交谈";case 1:return "向北门旁的阿岚了解迷雾";case 2:return "从北门前往迷雾森林";case 3:return "击败遗迹守卫，寻回失落星火";case 4:return "返回中山大学，向沈砚交付星火";default:return "星火已归来，自由探索中山大学";}
    }
    public String chapterName(){return chapter>=5?"序章完成 · 归来的灯火":"序章 · 长夜里的来信";}
    public float[] target(){
        if(area==FOREST)return battleWon?new float[]{Town.FOREST_GATE_X,Town.FOREST_GATE_Y}:null;
        if(chapter==0||chapter==4)return new float[]{Town.NPCS[0].x,Town.NPCS[0].y};
        if(chapter==1)return new float[]{Town.NPCS[1].x,Town.NPCS[1].y};
        if(chapter==2||chapter==3)return new float[]{Town.GATE_X,Town.GATE_Y};
        return null;
    }
    public String interaction(Game g){
        if(g.inHistory())return "";
        if(g.inPhysics())return g.physics.interaction(g);
        if(g.inMath())return g.math.interaction(g);
        if(g.inTown()&&Game.dist(g.x,g.y,1200,540)<50)return "进入物理工坊";
        if(g.inTown()&&Game.dist(g.x,g.y,1140,620)<50)return "进入数学星庭";
        if(g.guest.near(g))return "交谈 · 奶龙";
        if(g.body.enabled)return g.body.interaction(g);
        if(g.inTown()){
            Town.Npc npc=Town.nearest(g.x,g.y);if(npc!=null)return "交谈 · "+npc.name;
            if(Game.dist(g.x,g.y,Town.GATE_X,Town.GATE_Y)<48)return "前往迷雾森林";
        }else if(enabled&&Game.dist(g.x,g.y,Town.FOREST_GATE_X,Town.FOREST_GATE_Y)<47)return "返回中山大学";
        return "";
    }
    public void interact(Game g){
        if(g.mode!=Game.PLAY||!enabled)return;
        if(g.inHistory())return;
        if(g.inPhysics()){g.physics.interact(g);return;}
        if(g.inMath()){g.math.interact(g);return;}
        if(g.inTown()&&Game.dist(g.x,g.y,1200,540)<50){g.physics.enter(g);return;}
        if(g.inTown()&&Game.dist(g.x,g.y,1140,620)<50){g.math.enter(g);return;}
        if(g.guest.near(g)){g.guest.talk(g);return;}
        if(g.body.enabled){g.body.interact(g);return;}
        if(g.inTown()){
            Town.Npc npc=Town.nearest(g.x,g.y);if(npc!=null){talk(g,npc.id);return;}
            if(Game.dist(g.x,g.y,Town.GATE_X,Town.GATE_Y)<48){
                if(chapter<2)begin(g,1,new String[]{"阿岚|先别急着入林。守望人有事托付你，出发前也来找我说几句话。我们得让你平安回来。"},new String[]{"我先去准备"},new int[]{CLOSE});
                else begin(g,1,new String[]{"阿岚|穿过这道门，就是迷雾森林。若需要补给，可从林中营地的石门返回城镇。准备出发了吗？"},new String[]{"进入森林","再逛一会儿"},new int[]{ENTER,CLOSE});
            }else g.announce("靠近人物或城门，再点击交谈。");
        }else if(Game.dist(g.x,g.y,Town.FOREST_GATE_X,Town.FOREST_GATE_Y)<47){
            begin(g,-1,new String[]{"旁白|石门后的灯光通往中山大学。回城期间森林战斗暂停，已有的成长与战斗进度都会保留。"},new String[]{"返回中山大学","留在森林"},new int[]{RETURN,CLOSE});
        }
    }
    public boolean talk(Game g,int id){
        if(id==TownGuest.NPC)return g.guest.talk(g);
        if(id>=10&&id<=12&&g.inTown()&&g.mode==Game.PLAY&&Game.dist(g.x,g.y,Town.NPCS[id].x,Town.NPCS[id].y)<43)return g.history.talk(g,id);
        if(id==6&&g.inTown()&&g.mode==Game.PLAY&&Game.dist(g.x,g.y,Town.NPCS[6].x,Town.NPCS[6].y)<43){begin(g,6,new String[]{"程理|格物堂是新开的物理工坊。这里有五种机关，分别对应不同的物理现象。","程理|抛体靶场练习弹道计算，光路迷宫学习反射定律，回路工坊理解电路连接。","程理|波的干涉展示叠加原理，热流迷宫模拟热传导。每通过一关，你都会获得新的发现。","程理|五关全部解开后，共振法杖·改会收进武库，它的法弹能引发连锁共振。准备好探索物理的奥秘了吗？"},new String[]{"进入物理工坊","稍后再来"},new int[]{310,300});return true;}
        if(id==4&&g.inTown()&&g.mode==Game.PLAY&&Game.dist(g.x,g.y,Town.NPCS[4].x,Town.NPCS[4].y)<43){begin(g,4,new String[]{"知夏|东庭新开了一道数学之门。那里的路会记住脚印，机关会回应不同的走法。","知夏|先观察，再试一试。你的发现会写进札记，那里不会提前写好走法。"},new String[]{"带我去东庭","我自己走过去"},new int[]{303,300});return true;}
        if(g.body.enabled&&g.body.talk(g,id))return true; // 体内篇只认前六位居民；开发者彩蛋继续走通用对话
        if(!g.inTown()||g.mode!=Game.PLAY||id<0||id>=Town.NPCS.length||Game.dist(g.x,g.y,Town.NPCS[id].x,Town.NPCS[id].y)>43)return false;
        switch(id){
            case 0:
                if(chapter==0)begin(g,0,new String[]{
                    "沈砚|你就是伍子平吧？那封信是我写的。中山大学的星火失踪后，北方的迷雾一夜比一夜浓。",
                    "伍子平|星火究竟是什么？为什么连遗迹的守卫也开始攻击行人？",
                    "沈砚|它是引路的灯，也是守卫的心。请去森林深处找回它。出发前，先问问北门旁的巡林人阿岚。",
                    "沈砚|这二十枚金币是镇上的心意。你可以找陆铸修整佩剑，或向苏禾买些药剂。愿你平安归来。"
                },new String[]{"接下寻回星火的委托","我再考虑一下"},new int[]{ACCEPT,CLOSE});
                else if(chapter==4)begin(g,0,new String[]{
                    "沈砚|你回来了！这温暖的光……是失落的星火。你真的做到了。",
                    "伍子平|守卫被迷雾侵蚀了。它倒下时，仍朝着城镇的方向伸出手。它一直记得自己的职责。",
                    "沈砚|那就让它守护的灯继续亮下去。替中山大学收下这份谢礼吧，今夜钟声会为你响起。"
                },new String[]{"交付星火 · 领取 120 金币","稍后再来"},new int[]{REPORT,CLOSE});
                else if(chapter>=5)begin(g,0,new String[]{"沈砚|灯亮起来以后，镇上的人又开始谈论明天了。伍子平，中山大学永远欢迎你。","伍子平|等下一封信到来之前，我想先在这里歇一歇。"},new String[]{"愿灯火长明"},new int[]{CLOSE});
                else begin(g,0,new String[]{"沈砚|我会守在这里。若不知道下一步做什么，打开右上角的任务札记；镇上的每一盏灯，都会等你回来。"},new String[]{"我记住了"},new int[]{CLOSE});
                break;
            case 1:
                if(chapter==1)begin(g,1,new String[]{
                    "阿岚|我认得你的剑。昨夜林中的石像睁开眼，连蝙蝠都不敢靠近它。",
                    "伍子平|我该怎么穿过那片迷雾？",
                    "阿岚|别贪刀。红色圆圈出现时先离开，用闪避躲开重击。普攻能接连挥剑，星火斩适合清开包围。",
                    "阿岚|再带一瓶药吧。准备好后走近北门，我会替你打开通向森林的路。"
                },new String[]{"准备就绪 · 领取药剂","再听听镇上的消息"},new int[]{PREPARE,CLOSE});
                else begin(g,1,new String[]{battleWon?"阿岚|林里的风清了。下次路过营地时，替我看看那座守卫的遗迹。":"阿岚|北门通向迷雾森林。记得药剂能恢复一半生命，回城时森林里的进度会为你保留。"},new String[]{"谢谢提醒"},new int[]{CLOSE});
                break;
            case 2:
                begin(g,2,new String[]{"陆铸|剑口上的缺损，和人心里的犹豫一样，都得慢慢磨平。我可以替你的星火剑重新淬火。",smithBought?"陆铸|这把剑已经淬过火了。往后的锋芒，要靠你在战斗中磨出来。":"陆铸|二十五枚金币，攻击力永久增加六点，持续到本次旅程结束。要试试吗？"},smithBought?new String[]{"看看炉火，继续上路"}:new String[]{"淬火佩剑 · 25 金币","暂时不用"},smithBought?new int[]{CLOSE}:new int[]{SMITH,CLOSE});
                break;
            case 3:
                begin(g,3,new String[]{"苏禾|迷雾不会替你包扎伤口，药剂会。十五枚金币一瓶，随身最多带五瓶。","苏禾|若你在林里击败十二只魔物，我也会给你一份补给，算是感谢你替采药人清路。"},new String[]{"购买药剂 · 15 金币",sideClaimed?"补给已领取":"领取清路补给 · "+Math.min(g.kills,12)+"/12"},new int[]{POTION,SIDE});
                break;
            case 4:
                begin(g,4,new String[]{"知夏|旧书里说，第一位点灯人把星火留在这里，是为了让迷路的人看见回家的方向。","伍子平|所以它从来就不属于某一个人？","知夏|是啊。有人守着它，有人寻回它，也有人把它的故事讲给后来的人听。这也是一种守护。"},new String[]{"把这段故事记在心里"},new int[]{CLOSE});
                break;
            case 5:
                begin(g,5,new String[]{"阿满|路过是客，回来也是客。旅舍还有热汤和空床，赶路的人总得好好睡一觉。","阿满|住一晚十枚金币，恢复全部生命。外面的战斗会停在你离开的地方，不必急着赶路。"},new String[]{"休息一晚 · 10 金币","再去镇上走走"},new int[]{REST,CLOSE});
                break;
            case 6:
                begin(g,6,new String[]{"程理|格物堂是新开的物理工坊。这里有五种机关，分别对应不同的物理现象。","程理|抛体靶场练习弹道计算，光路迷宫学习反射定律，回路工坊理解电路连接。","程理|波的干涉展示叠加原理，热流迷宫模拟热传导。每通过一关，你都会获得新的发现。","程理|五关全部解开后，共振法杖·改会收进武库，它的法弹能引发连锁共振。准备好探索物理的奥秘了吗？"},new String[]{"进入物理工坊","稍后再来"},new int[]{310,300});
                break;
            case 7:
                begin(g,7,new String[]{"朱华鸿|嘘——你居然找到我了。我是这个世界的建造者之一。","朱华鸿|每一块砖、每一盏灯，都从我手里经过。不过我最得意的，还是那些藏在角落里的彩蛋。","朱华鸿|你能走到这里，说明你是个细心的旅人。这份好奇心，比星火还珍贵。"},new String[]{"谢谢你的创造"},new int[]{CLOSE});
                break;
            case 8:
                begin(g,8,new String[]{"李梓宁|嘿，旅人。我是负责让这个世界动起来的人。","李梓宁|你挥剑时的弧度、钟楼的灯光、甚至风吹过的方向，都是我一笔一笔画出来的。","李梓宁|有人说，最好的画面是你注意不到的那些。我觉得你说得对——因为你正在好好体验这个世界。"},new String[]{"你的画很美"},new int[]{CLOSE});
                break;
            case 9:
                begin(g,9,new String[]{"伍子安|你来了。我是最后一个藏在这里的人。","伍子安|他们负责造世界，我负责往里面塞故事。每一段对话、每一个选择，都有我想说的话。","伍子安|星火为什么灭了？因为它在等一个愿意找回它的人。你找到了——不只是星火，还有我们。","伍子安|谢谢你走完这条路。后面的故事，由你来写。"},new String[]{"我会继续走下去"},new int[]{CLOSE});
                break;
        }
        return true;
    }
    public void advance(Game g){
        if(dialogue==null||g.mode!=Game.DIALOGUE)return;
        if(!dialogue.complete()){dialogue.revealed=true;return;}
        if(!dialogue.last()){dialogue.page++;dialogue.age=0;dialogue.revealed=false;}
    }
    public void choose(Game g,int index){
        Dialogue d=dialogue;if(d==null||g.mode!=Game.DIALOGUE||!d.last()||!d.complete()||index<0||index>=d.actions.length)return;
        int action=d.actions[index];dialogue=null;g.mode=Game.PLAY;
        if(action>=400&&action<=411){g.history.action(g,action);return;}
        if(action==310){g.physics.enter(g);return;}
        if(action>=300){if(action==303){g.x=1080;g.y=660;g.announce("东庭 · 数学之门在前方");}else if(action>=320)g.physics.action(g,action);else g.math.action(g,action);return;}
        if(d.npc==TownGuest.NPC&&action>=200){g.guest.action(g,action);return;}
        if(g.body.enabled&&action>=100){g.body.action(g,action);return;}
        switch(action){
            case ACCEPT:if(chapter==0){chapter=1;g.gold+=20;g.announce("已接取主线 · 寻回失落星火");}break;
            case PREPARE:if(chapter==1){chapter=2;g.potions=Math.min(5,g.potions+1);g.announce("准备完成 · 北门已开放");}break;
            case SMITH:
                if(smithBought)break;
                if(g.gold<25){reply(g,2,"金币还差一些。清理林里的魔物后，再来找我吧。");break;}
                g.gold-=25;g.attack+=6;smithBought=true;reply(g,2,"淬火完成。攻击力增加六点。带着它，把星火找回来。");break;
            case POTION:
                if(g.potions>=5){reply(g,3,"药袋已经装满了，留些位置给林中的补给吧。");break;}
                if(g.gold<15){reply(g,3,"金币不够也别逞强。清理十二只魔物后，可以来领取一份补给。");break;}
                g.gold-=15;g.potions++;reply(g,3,"药剂收好了。恢复一半生命，记得在需要的时候使用。");break;
            case REST:
                if(g.hp>=g.maxHp){reply(g,5,"你现在精神很好，留着金币买些别的东西吧。热汤可以随时来喝。");break;}
                if(g.gold<10){reply(g,5,"金币还不够住店。别急，城镇里很安全，先整顿一下再上路。");break;}
                g.gold-=10;g.hp=g.maxHp;reply(g,5,"一夜好眠。生命已经全部恢复。愿你今天也平安回来。");break;
            case REPORT:
                if(chapter==4){chapter=5;g.gold+=120;g.hp=g.maxHp;g.announce("序章完成 · 归来的灯火");reply(g,0,"星火已经回到灯座。去和镇上的人聊聊吧，这是属于大家的新一天。");}break;
            case SIDE:
                if(sideClaimed){reply(g,3,"这份补给已经交给你了。路上当心。");break;}
                if(g.kills<12){reply(g,3,"清路还没有完成。等击败十二只魔物后再来，我会替你留着。");break;}
                sideClaimed=true;g.gold+=30;g.potions=Math.min(5,g.potions+2);reply(g,3,"采药人说路上安全多了。三十枚金币和两瓶药剂，愿你用得上。");break;
            case ENTER:enterForest(g);break;
            case RETURN:enterTown(g);break;
            default:break;
        }
    }
    private void reply(Game g,int npc,String text){begin(g,npc,new String[]{Town.NPCS[npc].name+"|"+text},new String[]{"继续旅程"},new int[]{CLOSE});}
    public void enterForest(Game g){
        if(g.body.enabled){g.body.enter(g);return;}
        if(!enabled||chapter<2)return;
        area=FOREST;g.x=forestX;g.y=forestY;g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.invuln=1;dialogue=null;
        if(chapter==2)chapter=3;g.announce(battleWon?"迷雾已散 · 遗迹静候旅人":"进入迷雾森林 · 星火仍在前方");
    }
    public void enterTown(Game g){
        if(g.inHistory()){g.history.exit(g);return;}
        if(g.inMath()){g.math.returnTown(g);return;}
        if(g.body.enabled){g.body.returnTown(g);return;}
        if(!enabled)return;
        if(area==FOREST){forestX=g.x;forestY=g.y;}
        area=TOWN;g.x=480;g.y=battleWon?506:143;g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;
        g.swing=g.skillFlash=g.dashTime=0;g.effects.clear();dialogue=null;g.announce("中山大学 · 灯火为你而留");
    }
    public void settle(Game g,boolean won){
        g.bestWave=Math.max(g.bestWave,g.wave);g.lifetimeKills+=Math.max(0,g.kills-accountedKills);accountedKills=g.kills;
        if(won){if(!battleWon){battleWon=true;chapter=Math.max(chapter,4);g.bank+=g.gold;}g.mode=Game.VICTORY;}
        else {defeated=true;g.hp=Math.max(1,g.maxHp*.5f);g.mode=Game.DEAD;}
    }
    public void recover(Game g){
        if(g.body.enabled){g.body.recover(g);return;}
        if(!defeated)return;
        defeated=false;g.enemies.clear();g.shots.clear();g.drops.clear();g.waveSpawned=g.waveKilled=0;g.spawnTimer=1.3f;g.intermission=0;
        g.hp=g.maxHp;g.potions=Math.max(1,g.potions);enterTown(g);g.x=480;g.y=520;g.announce("苏禾将你救回镇中 · 当前波次重新准备");
    }
    public void write(DataOutputStream o)throws IOException{
        o.writeBoolean(enabled);o.writeInt(area);o.writeInt(chapter);o.writeBoolean(smithBought);o.writeBoolean(sideClaimed);o.writeBoolean(battleWon);o.writeBoolean(defeated);o.writeInt(accountedKills);o.writeFloat(forestX);o.writeFloat(forestY);
    }
    public static Story read(DataInputStream i)throws IOException{
        Story s=new Story();s.enabled=i.readBoolean();s.area=i.readInt();s.chapter=i.readInt();s.smithBought=i.readBoolean();s.sideClaimed=i.readBoolean();s.battleWon=i.readBoolean();s.defeated=i.readBoolean();s.accountedKills=i.readInt();s.forestX=i.readFloat();s.forestY=i.readFloat();
        if(s.area<0||s.area>1||s.chapter<0||s.chapter>5||s.accountedKills<0||Float.isNaN(s.forestX)||Float.isNaN(s.forestY)||Float.isInfinite(s.forestX)||Float.isInfinite(s.forestY))throw new IOException("Invalid story state");
        s.forestX=Game.clamp(s.forestX,18,Game.WORLD_W-18);s.forestY=Game.clamp(s.forestY,18,Game.WORLD_H-18);return s;
    }
}
