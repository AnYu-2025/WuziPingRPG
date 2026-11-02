package cn.wuziping.ember;

import java.io.*;

/** Authored dream campaign. All enemies, rewards and medicine are fictional game rules. */
public final class BodyJourney {
    public static final int MAP=10, COUNT=8, ALL=255, SAVE_BYTES=303, LEGACY_SAVE_BYTES=195;
    public static final float GATE_X=640,GATE_Y=548;
    public static final String[] NAMES={"呼吸道","肺部","肠道","肝脏","细胞核心","心脏","肾脏","脑部"};
    public static final String[] SUBTITLES={"第一站 · 气流回廊","第二站 · 双肺穹顶","第三站 · 盘曲迷宫","第四站 · 肝叶暗潮","第五站 · 异常增殖巢穴","第六站 · 心室脉动","第七站 · 双肾回环","终站 · 神经迷城"};
    public static final String[] FOES={"游离病毒","疾行病毒","包膜病毒","异常增殖细胞","增殖核心"};
    public static final String[] WEAPONS={"星火短刃","脉冲短刃","气流长刃","共振双刃","净域光刃","星火·免疫之锋"};
    public static final int[] TARGETS={12,14,14,16,9,18,18,12},REWARDS={30,45,60,75,120,130,145,180};
    public boolean enabled=false,briefed=false,ending=false;
    public int organ=0,cured=0,weaponLevel=0;
    public final int[] kills=new int[COUNT],supply=new int[COUNT*2];
    public final float[] supplyX=new float[COUNT*2],supplyY=new float[COUNT*2],fall=new float[COUNT*2];
    public float transit=0;
    public boolean cleared(){return (cured&(1<<organ))!=0;}
    public int clearedCount(){return Integer.bitCount(cured);}
    public String name(){return NAMES[organ];}
    public String weapon(){return WEAPONS[weaponLevel];}
    public void show(Game g,int npc,String[] pages,String[] options,int... actions){g.story.begin(g,npc,pages,options,actions);}
    public void opening(Game g){
        show(g,-1,new String[]{
            "旁白|中山大学的夜里，伍子平因病发热，伏在桌边睡着了。醒来时，熟悉的校园浮在一片红色微光之中。",
            "伍子平|那些光，像流动的血液……我竟然在自己的身体里？",
            "沈砚|这是你的梦境。呼吸道、肺部、肠道和肝脏出现了敌人，深处还有异常增殖的细胞。沿血管前进，把它们逐一击退。",
            "旁白|先找广场北侧的沈砚领取任务。全身图记录净化进度。东庭数学之门也已开放，可从主题地图前往。"
        },new String[]{"踏入体内远征"},100);
    }
    public String objective(Game g){
        if(ending)return "梦境任务已完成 · 自由探索中山大学";
        if(cured==ALL)return "返回中山大学，向沈砚领取远征奖励";
        if(!briefed)return "与沈砚交谈，领取体内远征任务";
        if(g.inTown())return "从北门血管入口前往"+name();
        if(cleared())return name()+"已净化 · 前往血管转运门";
        return "清除"+name()+"敌人  "+g.waveKilled+" / "+TARGETS[organ];
    }
    public float[] target(Game g){
        if(g.inTown())return !briefed||cured==ALL?new float[]{Town.NPCS[0].x,Town.NPCS[0].y}:new float[]{Town.GATE_X,Town.GATE_Y};
        for(int i=organ*2;i<organ*2+2;i++)if(supply[i]==2)return new float[]{supplyX[i],supplyY[i]};
        return cleared()?new float[]{GATE_X,GATE_Y}:null;
    }
    public String interaction(Game g){
        if(g.inTown()){
            Town.Npc n=Town.nearest(g.x,g.y);if(n!=null)return "交谈 · "+n.name;
            if(Game.dist(g.x,g.y,Town.GATE_X,Town.GATE_Y)<48)return "血管入口 · "+name();
        }else if(Game.dist(g.x,g.y,GATE_X,GATE_Y)<47)return cleared()&&organ<COUNT-1?"血管转运 · "+NAMES[organ+1]:"血管转运 · 返回据点";
        return "";
    }
    public void interact(Game g){
        if(g.mode!=Game.PLAY)return;
        if(g.inTown()){
            Town.Npc n=Town.nearest(g.x,g.y);if(n!=null){g.story.talk(g,n.id);return;}
            if(Game.dist(g.x,g.y,Town.GATE_X,Town.GATE_Y)>=48){g.announce("靠近居民或北门血管入口");return;}
            if(!briefed){show(g,0,new String[]{"沈砚|先来广场找我。拿好补给，我们再开启血管通路。"},new String[]{"先领取任务"},100);return;}
            if(cured==ALL){show(g,0,new String[]{"沈砚|所有病灶都已净化，回来领取远征奖励吧。"},new String[]{"返回广场"},100);return;}
            show(g,1,new String[]{"阿岚|血流会把你送往"+name()+"。若已经净化当前区域，就会继续前往下一处病灶。"},new String[]{"沿血管出发","稍后出发"},102,100);
        }else if(Game.dist(g.x,g.y,GATE_X,GATE_Y)<47){
            if(cleared()&&organ<COUNT-1)show(g,-1,new String[]{"旁白|"+name()+"的病灶已经消散。血管转运通路已开启，下一站是"+NAMES[organ+1]+"。"},new String[]{"血管传送 · "+NAMES[organ+1],"回中山大学补给"},103,104);
            else show(g,-1,new String[]{"旁白|这条血管通往中山大学梦境据点。离开后，敌人、掉落与空投倒计时都会暂停。"},new String[]{"沿血管返回据点","继续战斗"},104,100);
        }
    }
    public boolean talk(Game g,int npc){
        if(!g.inTown()||g.mode!=Game.PLAY||npc<0||npc>=6||Game.dist(g.x,g.y,Town.NPCS[npc].x,Town.NPCS[npc].y)>43)return false;
        switch(npc){
            case 0:
                if(cured==ALL&&!ending)show(g,0,new String[]{"沈砚|八处病灶都已净化。你在梦里走遍了自己的身体，也终于找到了回来的路。","伍子平|原来那些平时察觉不到的地方，一直都在默默守护我。","沈砚|收下远征奖励：一百八十金币，以及终章武器「星火·免疫之锋」。天快亮了，好好休息吧。"},new String[]{"完成远征 · 领取奖励","稍后领取"},105,100);
                else if(!briefed)show(g,0,new String[]{"沈砚|伍子平，你要沿着血管，依次前往呼吸道、肺部、肠道、肝脏和细胞核心，再穿过心脏、肾脏，抵达脑部。","沈砚|前三站的敌人是病毒，后两站是异常增殖细胞；它们是梦境里的两类敌人。清除一处病灶，才会开放下一条血管。","沈砚|击败足够敌人后，补给会空投进来。药品帮助恢复，武器补给能提高攻击。先带上二十金币和一瓶药剂。"},new String[]{"接下体内远征任务","再想一想"},101,100);
                else show(g,0,new String[]{ending?"沈砚|晨光已经照进窗台。梦境的胜利留在这里，新的生活从认真照顾自己开始。":"沈砚|全身图上，红色是未净化的病灶，金色是当前区域，绿色是已经完成的区域。每处副本的奖励只能领取一次。"},new String[]{"继续旅程"},100);
                break;
            case 1:show(g,1,new String[]{"阿岚|北门已被梦境改造成血管入口。进入后，看准气流、肺泡、肠道和肝叶之间的通路。","阿岚|空投的虚线落点会提前出现。等降落伞消失，靠近箱子才能拾取。受伤就用药剂，别站在首领的红圈里。"},new String[]{"记住了"},100);break;
            case 2:show(g,2,new String[]{"陆铸|梦境里的武器也得磨利。二十五金币淬火一次，本次旅程攻击增加六点。",g.story.smithBought?"陆铸|淬火已经完成。击败敌人触发的武器空投，仍能继续强化你的装备。":"陆铸|空投武器与这次淬火可以叠加。"},g.story.smithBought?new String[]{"继续旅程"}:new String[]{"淬火 · 25 金币","暂时不用"},g.story.smithBought?new int[]{100}:new int[]{106,100});break;
            case 3:show(g,3,new String[]{"苏禾|梦境药剂每瓶十五金币，恢复一半生命，随身最多五瓶。副本里的药品空投也可以补充药袋。"},new String[]{"购买药剂 · 15 金币","暂时不用"},107,100);break;
            case 4:show(g,4,new String[]{"知夏|呼吸道像气流回廊，肺部是双叶穹顶，肠道盘成回环，肝脏分为左右肝叶。你的地图会随区域改变。","知夏|梦境把血管变成了传送通路。这里的战斗、药品和净化数值都是游戏设定，不能用来判断现实中的疾病。"},new String[]{"把这段旅途记下来"},100);break;
            case 5:show(g,5,new String[]{"阿满|一晚十金币，恢复全部生命。就算倒在梦里，你的等级、武器与已领取奖励也会保留。"},new String[]{"休息 · 10 金币","继续走走"},108,100);break;
        }return true;
    }
    public void action(Game g,int action){
        switch(action){
            case 101:if(!briefed){briefed=true;g.gold+=20;g.potions=Math.min(5,g.potions+1);g.announce("任务接取 · 北门血管通路已开启");}break;
            case 102:enter(g);break;
            case 103:if(cleared()&&organ<COUNT-1){next(g);}break;
            case 104:returnTown(g);break;
            case 105:if(cured==ALL&&!ending){ending=true;g.gold+=180;g.attack+=12;weaponLevel=5;g.hp=g.maxHp;g.announce("终章奖励 · 180 金币 / 免疫之锋 +12 攻击");show(g,-1,new String[]{"旁白|伍子平睁开眼。窗外是中山大学的晨光，桌上留着未写完的笔记。那场血色微光中的远征，变成了一段关于身体的奇妙梦境。"},new String[]{"梦醒 · 远征完成"},100);}break;
            case 106:if(!g.story.smithBought&&g.gold>=25){g.gold-=25;g.attack+=6;g.story.smithBought=true;g.announce("淬火完成 · 攻击 +6");}else g.announce(g.story.smithBought?"本次淬火已完成":"金币不足 · 需要 25");break;
            case 107:if(g.potions>=5)g.announce("药袋已满");else if(g.gold<15)g.announce("金币不足 · 需要 15");else{g.gold-=15;g.potions++;g.announce("获得梦境药剂 ×1");}break;
            case 108:if(g.hp>=g.maxHp)g.announce("生命已满，无需付费");else if(g.gold<10)g.announce("金币不足 · 需要 10");else{g.gold-=10;g.hp=g.maxHp;g.announce("一夜休息 · 生命全部恢复");}break;
            default:break;
        }
    }
    public void enter(Game g){
        if(!briefed||cured==ALL)return;g.math.active=false;
        if(cleared()&&organ<COUNT-1){next(g);return;}
        g.story.area=Story.FOREST;g.x=g.story.forestX;g.y=g.story.forestY;g.story.dialogue=null;
        g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.invuln=1;transit=1.1f;g.announce("血管传送 · "+name());
    }
    public void next(Game g){
        if(!cleared()||organ>=COUNT-1)return;
        // Sweep remaining loot before the irreversible region change; preserve every XP choice.
        int xp=0;for(Game.Drop d:g.drops){if(d.type==0)xp+=d.value;else if(d.type==1)g.gold+=d.value;else g.hp=Math.min(g.maxHp,g.hp+d.value);}
        organ++;g.wave=organ+1;g.waveSpawned=g.waveKilled=0;g.spawnTimer=1.5f;g.intermission=0;
        g.enemies.clear();g.shots.clear();g.drops.clear();g.effects.clear();g.arsenal.bolts.clear();g.story.forestX=640;g.story.forestY=510;
        g.story.area=Story.FOREST;g.x=640;g.y=510;g.story.dialogue=null;g.mode=Game.PLAY;
        if(xp>0)g.gainXp(xp);g.invuln=1;transit=1.1f;g.announce("沿血管抵达 · "+name());
    }
    public void returnTown(Game g){
        if(!g.inTown()){g.story.forestX=g.x;g.story.forestY=g.y;}
        g.story.area=Story.TOWN;g.x=480;g.y=cured==ALL?506:143;g.story.dialogue=null;
        g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;g.swing=g.skillFlash=g.dashTime=0;g.effects.clear();transit=0;
        g.announce("中山大学 · 梦境补给据点");
    }
    public void onKill(Game g){
        if(cleared())return;kills[organ]++;
        for(int slot=0;slot<2;slot++){int i=organ*2+slot,threshold=slot==0?4:(organ==COUNT-1?7:8);
            if(kills[organ]>=threshold&&supply[i]==0){
                float px=g.x,py=g.y;
                for(int attempt=0;attempt<80;attempt++){double a=attempt*2.4;float r=24+attempt*.9f;float xx=Game.clamp(g.x+(float)Math.cos(a)*r,45,1235),yy=Game.clamp(g.y+(float)Math.sin(a)*r,45,915);
                    if(!g.blocked(xx,yy,12)&&Game.dist(xx,yy,GATE_X,GATE_Y)>28){px=xx;py=yy;break;}}
                supply[i]=1;supplyX[i]=px;supplyY[i]=py;fall[i]=2.6f;g.announce(slot==0?"药品空投 · 正在降落":"武器空投 · 正在降落");
            }
        }
    }
    public void tick(Game g,float dt){
        transit=Math.max(0,transit-dt);
        for(int i=organ*2;i<organ*2+2;i++){
            if(supply[i]==1){fall[i]=Math.max(0,fall[i]-dt);if(fall[i]<=0){supply[i]=2;g.announce("补给已落地 · 靠近箱子拾取");}}
            if(supply[i]==2&&Game.dist(g.x,g.y,supplyX[i],supplyY[i])<19)claim(g,i);
        }
    }
    public void claim(Game g,int i){
        if(g.inTown()||i<organ*2||i>=organ*2+2||supply[i]!=2||Game.dist(g.x,g.y,supplyX[i],supplyY[i])>=19)return;
        supply[i]=3;
        if(i%2==0){g.potions=Math.min(5,g.potions+1);g.hp=Math.min(g.maxHp,g.hp+g.maxHp*.25f);g.announce("药品补给 · 药剂 +1 / 生命恢复 25%");}
        else{int rank=Math.min(4,organ+1);g.arsenal.unlock(g,Math.min(5,organ+1));g.attack+=4;weaponLevel=Math.max(weaponLevel,rank);g.announce("武器补给 · "+weapon()+" / 攻击 +4");}
        if(g.sounds.size()<32)g.sounds.add("pickup");
        g.vfx.burst(supplyX[i],supplyY[i],i%2==0?0xff9ed4c8:0xffe8c27a,16,52,.5f,3.2f);g.vfx.kick(1.6f);
    }
    public void clear(Game g){
        if(cleared())return;cured|=1<<organ;g.gold+=REWARDS[organ];g.maxHp+=10;g.hp=g.maxHp;g.potions=Math.min(5,g.potions+1);
        g.arsenal.unlock(g,Math.min(5,organ+1));g.announce(name()+"通关 · "+REWARDS[organ]+" 金币 / 体魄 +10");
        g.vfx.ring(g.x,g.y,0xffe8c27a,20,84);g.vfx.kick(3.5f);
        if(cured==ALL)g.finish(true);
    }
    public void settle(Game g,boolean won){
        g.bestWave=Math.max(g.bestWave,g.wave);g.lifetimeKills+=Math.max(0,g.kills-g.story.accountedKills);g.story.accountedKills=g.kills;
        if(won){if(!g.story.battleWon){g.bank+=g.gold;g.story.battleWon=true;}g.mode=Game.VICTORY;}
        else{g.story.defeated=true;g.hp=Math.max(1,g.maxHp*.5f);g.mode=Game.DEAD;}
    }
    public void recover(Game g){
        g.story.defeated=false;g.arsenal.bolts.clear();g.enemies.clear();g.shots.clear();g.drops.clear();g.waveSpawned=g.waveKilled=0;g.spawnTimer=1.5f;g.intermission=0;
        g.hp=g.maxHp;g.potions=Math.max(1,g.potions);g.story.forestX=640;g.story.forestY=510;returnTown(g);g.x=480;g.y=520;
        g.announce("梦境重整 · 当前器官重新挑战");
    }
    public void resume(Game g){if(g.story.defeated){recover(g);return;}if(cured==ALL&&!g.inTown()){returnTown(g);return;}g.mode=g.pendingUpgrades>0?Game.UPGRADE:Game.PLAY;}
    public int enemyType(Game g){if(g.waveSpawned==TARGETS[organ]-1)return 4;if(organ==3||organ==4||organ==7)return 3;float r=g.rand();return r<.45f?0:r<.75f?1:2;}
    public static boolean inside(int organ,float x,float y,float margin){
        float a=(x-640)/(500-margin),b=(y-480)/(370-margin);
        if(organ==0)return Math.abs(x-640)<95-margin&&y>90+margin&&y<480||y>=400&&((x-420)*(x-420)/90000f+(y-575)*(y-575)/62000f<1-margin/150f||(x-860)*(x-860)/90000f+(y-575)*(y-575)/62000f<1-margin/150f);
        if(organ==1)return (x-410)*(x-410)/((270-margin)*(270-margin))+(y-490)*(y-490)/((340-margin)*(340-margin))<1||(x-870)*(x-870)/((270-margin)*(270-margin))+(y-490)*(y-490)/((340-margin)*(340-margin))<1;
        if(organ==2)return Math.abs(x-640)<500-margin&&Math.abs(y-480)<340-margin;
        if(organ==3)return a*a+b*b<1&&y>180+(x-640)*.24f+margin;
        if(organ==5)return (x-490)*(x-490)/170000f+(y-430)*(y-430)/125000f<1||(x-790)*(x-790)/170000f+(y-430)*(y-430)/125000f<1;
        if(organ==6)return (x-430)*(x-430)/100000f+(y-480)*(y-480)/110000f<1||(x-850)*(x-850)/100000f+(y-480)*(y-480)/110000f<1||Math.abs(x-640)<130-margin&&Math.abs(y-480)<60-margin;
        if(organ==7)return a*a+b*b<1;
        return a*a+b*b<1;
    }
    public static boolean blocked(int organ,float x,float y,float r){
        if(!inside(organ,x,y,r))return true;
        // Intestinal folds form alternating passages, with a broad central access corridor.
        if(organ==2&&Math.abs(x-640)>55){for(int yy=300;yy<=660;yy+=120)if(Math.abs(y-yy)<12+r){boolean left=((yy-300)/120)%2==0;if(left&&x<860||!left&&x>420)return true;}}
        return false;
    }
    public void write(DataOutputStream o)throws IOException{
        o.writeBoolean(enabled);o.writeBoolean(briefed);o.writeBoolean(ending);o.writeInt(organ);o.writeInt(cured);o.writeInt(weaponLevel);
        for(int k:kills)o.writeInt(k);for(int i=0;i<COUNT*2;i++){o.writeInt(supply[i]);o.writeFloat(supplyX[i]);o.writeFloat(supplyY[i]);o.writeFloat(fall[i]);}
    }
    public static BodyJourney read(DataInputStream in)throws IOException{return read(in,COUNT);}
    public static BodyJourney read(DataInputStream in,int regions)throws IOException{
        BodyJourney b=new BodyJourney();b.enabled=in.readBoolean();b.briefed=in.readBoolean();b.ending=in.readBoolean();b.organ=in.readInt();b.cured=in.readInt();b.weaponLevel=in.readInt();
        if(b.organ<0||b.organ>=regions||b.cured<0||b.cured>((1<<regions)-1)||b.weaponLevel<0||b.weaponLevel>5||b.ending&&b.cured!=((1<<regions)-1))throw new IOException("Invalid body campaign");
        if(b.enabled&&b.cured!=((1<<b.organ)-1)&&b.cured!=((1<<(b.organ+1))-1))throw new IOException("Invalid organ order");
        for(int j=0;j<regions;j++){b.kills[j]=in.readInt();if(b.kills[j]<0||b.kills[j]>1000000)throw new IOException("Invalid organ kills");}
        for(int j=0;j<regions*2;j++){b.supply[j]=in.readInt();b.supplyX[j]=in.readFloat();b.supplyY[j]=in.readFloat();b.fall[j]=in.readFloat();
            if(b.supply[j]<0||b.supply[j]>3||(Float.isNaN(b.supplyX[j])||Float.isInfinite(b.supplyX[j]))||(Float.isNaN(b.supplyY[j])||Float.isInfinite(b.supplyY[j]))||(Float.isNaN(b.fall[j])||Float.isInfinite(b.fall[j]))||b.supplyX[j]<0||b.supplyX[j]>1280||b.supplyY[j]<0||b.supplyY[j]>960||b.fall[j]<0||b.fall[j]>3)throw new IOException("Invalid supply state");}
        if(regions==5&&b.enabled&&b.cured==31){b.ending=false;}
        return b;
    }
}
