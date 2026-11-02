package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

public final class StoryTests {
    private static int count=0;
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);count++;System.out.println("PASS "+message);}
    private static void finishDialogue(Game g,int choice){
        Story.Dialogue d=g.story.dialogue;if(d==null)throw new AssertionError("Missing dialogue");
        while(!d.last()){d.revealed=true;g.story.advance(g);}d.revealed=true;g.story.choose(g,choice);
    }
    private static void close(Game g){while(g.mode==Game.DIALOGUE)finishDialogue(g,0);}
    private static void at(Game g,int npc){g.x=Town.NPCS[npc].x;g.y=Town.NPCS[npc].y+24;g.mode=Game.PLAY;}
    private static Game town(){Game g=new Game();g.startAdventure();finishDialogue(g,0);return g;}
    private static void accept(Game g){at(g,0);g.story.talk(g,0);finishDialogue(g,0);}
    private static void prepare(Game g){accept(g);at(g,1);g.story.talk(g,1);finishDialogue(g,0);}
    private static Game roundTrip(Game g)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();g.save(b);return Game.load(new ByteArrayInputStream(b.toByteArray()));}
    private static boolean reachable(boolean[][] seen,float x,float y,int radius){
        for(int yy=0;yy<seen[0].length;yy++)for(int xx=0;xx<seen.length;xx++)if(seen[xx][yy]&&Game.dist(xx*8,yy*8,x,y)<radius)return true;return false;
    }
    public static void main(String[] args)throws Exception{
        Game g=new Game();g.startAdventure();check(g.inTown()&&g.mode==Game.DIALOGUE&&g.activeRun,"New journey begins with Chinese opening in town");
        for(int tick=0;tick<300;tick++)g.update(.05f,new Game.Input());check(g.enemies.isEmpty()&&g.elapsed==0,"Opening and town do not spawn combat or advance forest time");
        String first=g.story.dialogue.text();g.story.advance(g);check(g.story.dialogue.page==1&&first.length()>0,"Completed typewriter line advances to next story page");close(g);
        check(!g.story.talk(g,0),"NPC conversation requires physical proximity");at(g,0);check(g.story.talk(g,0)&&g.story.chapter==0,"Opening NPC dialogue does not prematurely accept quest");
        finishDialogue(g,1);check(g.story.chapter==0&&g.gold==0,"Declining quest has no reward or progression side effects");
        g.story.talk(g,0);finishDialogue(g,0);check(g.story.chapter==1&&g.gold==20,"Accepting quest grants its reward once");
        g.story.talk(g,0);close(g);check(g.gold==20,"Repeated mayor conversations cannot farm quest reward");
        g.x=480;g.y=112;g.story.interact(g);close(g);check(g.inTown()&&g.story.chapter==1,"Northern gate remains locked until ranger preparation");
        at(g,1);g.story.talk(g,1);finishDialogue(g,0);check(g.story.chapter==2&&g.potions==4,"Ranger advances quest and supplies one potion");
        g.story.talk(g,1);close(g);check(g.potions==4,"Ranger supply cannot be repeated");
        float hp=g.hp;g.hurt(1000,"test");g.slash();g.castSkill();check(g.hp==hp&&g.attackCd==0&&g.skillCd==0,"Town is a safe area with no combat actions");
        check(g.blocked(480,408,6),"Plaza fountain has a real collision footprint");
        Town.House house=Town.HOUSES[0];check(g.blocked(house.x,house.y-20,6),"Town buildings have collision footprints");
        boolean[][] seen=new boolean[Town.WIDTH/8][Town.HEIGHT/8];ArrayDeque<int[]> queue=new ArrayDeque<>();queue.add(new int[]{60,65});seen[60][65]=true;
        int[][] directions={{1,0},{-1,0},{0,1},{0,-1}};
        while(!queue.isEmpty()){int[] cell=queue.remove();for(int[] step:directions){int xx=cell[0]+step[0],yy=cell[1]+step[1];if(xx>=0&&yy>=0&&xx<seen.length&&yy<seen[0].length&&!seen[xx][yy]&&!g.blocked(xx*8,yy*8,6)){seen[xx][yy]=true;queue.add(new int[]{xx,yy});}}}
        for(Town.Npc n:Town.NPCS)check(reachable(seen,n.x,n.y,32),"Town collision map provides a walkable route to "+n.name);
        check(reachable(seen,Town.GATE_X,Town.GATE_Y,35),"Northern gate is reachable from the arrival plaza");
        g.story.enterForest(g);check(!g.inTown()&&g.story.chapter==3&&g.mode==Game.PLAY,"Prepared journey enters forest with main quest active");
        g.wave=2;g.waveSpawned=4;g.waveKilled=2;g.spawnEnemy(0,700,520);g.enemies.get(0).hp=12;g.x=630;g.y=530;g.skillCd=3;
        g.story.enterTown(g);float timer=g.skillCd;for(int tick=0;tick<100;tick++)g.update(.05f,new Game.Input());
        check(g.enemies.size()==1&&g.enemies.get(0).hp==12&&g.skillCd==timer&&g.wave==2,"Returning to town freezes and preserves forest encounter");
        g.story.enterForest(g);check(g.x==630&&g.y==530&&g.waveSpawned==4,"Reentering forest restores player position and wave progress");
        g.story.enterTown(g);g.gold=80;at(g,2);g.story.talk(g,2);float attack=g.attack;finishDialogue(g,0);close(g);
        check(g.story.smithBought&&g.attack==attack+6&&g.gold==55,"Blacksmith service charges gold and improves attack");
        g.story.talk(g,2);close(g);check(g.attack==attack+6&&g.gold==55,"Blacksmith cannot charge or apply upgrade twice");
        g.potions=3;at(g,3);g.story.talk(g,3);finishDialogue(g,0);close(g);check(g.potions==4&&g.gold==40,"Apothecary purchase updates stock and wallet");
        g.potions=5;g.story.talk(g,3);finishDialogue(g,0);close(g);check(g.potions==5&&g.gold==40,"Full potion bag does not consume gold");
        g.kills=11;g.story.talk(g,3);finishDialogue(g,1);close(g);check(!g.story.sideClaimed,"Supply quest rejects incomplete requirements");
        g.kills=12;g.story.talk(g,3);finishDialogue(g,1);close(g);check(g.story.sideClaimed&&g.gold==70,"Supply quest grants completion reward");
        g.story.talk(g,3);finishDialogue(g,1);close(g);check(g.gold==70,"Supply quest reward is idempotent");
        at(g,5);g.hp=35;g.story.talk(g,5);finishDialogue(g,0);close(g);check(g.hp==g.maxHp&&g.gold==60,"Inn restores health after payment");
        g.story.talk(g,5);finishDialogue(g,0);close(g);check(g.gold==60,"Inn does not charge an already healthy traveller");
        Game restored=roundTrip(g);check(restored.inTown()&&restored.story.chapter==3&&restored.story.smithBought&&restored.story.sideClaimed&&restored.gold==60,"Version two snapshot restores map, quests, services and wallet");restored.resume();check(restored.mode==Game.PLAY,"Saved town journey resumes safely");
        g.story.enterForest(g);g.wave=5;g.finish(true);check(g.mode==Game.VICTORY&&g.activeRun&&g.story.chapter==4,"Boss victory leaves a resumable return-to-town story");
        int bank=g.bank,kills=g.lifetimeKills;g.finish(true);check(g.bank==bank&&g.lifetimeKills==kills,"Story battle settlement cannot be duplicated");
        g.story.enterTown(g);at(g,0);g.story.talk(g,0);int gold=g.gold;finishDialogue(g,0);close(g);check(g.story.chapter==5&&g.gold==gold+120,"Returning starfire completes chapter and awards gold");
        g.story.talk(g,0);close(g);check(g.gold==gold+120,"Main quest completion reward cannot be repeated");
        restored=roundTrip(g);restored.resume();check(restored.story.chapter==5&&restored.inTown(),"Completed chapter survives app restart");
        g=town();prepare(g);g.story.enterForest(g);g.invuln=0;g.hurt(999,"test");check(g.mode==Game.DEAD&&g.activeRun&&g.story.defeated,"Story defeat retains the journey");
        restored=roundTrip(g);restored.resume();check(restored.inTown()&&restored.hp==restored.maxHp&&!restored.story.defeated&&restored.enemies.isEmpty(),"Defeat snapshot resumes with town recovery and reset current wave");
        g=town();at(g,0);g.story.talk(g,0);restored=roundTrip(g);restored.resume();check(restored.story.chapter==0&&restored.gold==0,"Restart during dialogue does not autoaccept quest");
        Controls controls=new Controls();controls.key(restored,"E",true);check(restored.mode==Game.DIALOGUE,"E key opens a nearby NPC dialogue");controls.back(restored);check(restored.mode==Game.PLAY&&restored.story.chapter==0,"Escape closes dialogue without accepting its choices");
        controls.key(restored,"L",true);check(restored.mode==Game.JOURNAL,"L key opens quest journal");controls.back(restored);check(restored.mode==Game.PLAY,"Journal returns to exploration rather than main menu");
        // A real version-one wire-format snapshot: legacy body plus old version marker.
        g=new Game();g.startRun();g.gold=37;g.wave=2;ByteArrayOutputStream stream=new ByteArrayOutputStream();g.save(stream);byte[] old=LegacySaves.snapshot(g,1);
        restored=Game.load(new ByteArrayInputStream(old));check(restored.gold==37&&restored.wave==2&&restored.story.enabled&&restored.story.chapter==3,"Version one combat save migrates to forest with town access");
        System.out.println("ALL "+count+" STORY CHECKS PASSED");
    }
}
