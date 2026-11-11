package cn.wuziping.ember.tests;
import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;
public final class HistoryTests {
 static void check(boolean b,String m){if(!b)throw new AssertionError(m);}
 static void choose(Game g,int c){Story.Dialogue d=g.story.dialogue;check(d!=null,"missing dialogue");while(!d.last()){d.revealed=true;g.story.advance(g);}d.revealed=true;g.story.choose(g,c);}
 static Game roundtrip(Game g)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);return Game.load(new ByteArrayInputStream(out.toByteArray()));}
 static void killAll(Game g){for(Game.Enemy e:new ArrayList<Game.Enemy>(g.enemies)){g.damageEnemy(e,100000,true);while(g.mode==Game.UPGRADE)g.choose(0);}}
 public static void main(String[] args)throws Exception{
  Game g=new Game();g.startDream();choose(g,0);g.x=570;g.y=350;g.spawnEnemy(1,300,300);g.waveSpawned=3;g.waveKilled=2;int initial=g.enemies.size();
  check(g.story.talk(g,10),"entry npc");choose(g,0);check(g.inHistory()&&g.enemies.size()==6,"first fight");choose(g,0);
  g.arsenal.unlocked|=1<<3;g.arsenal.selected=3;g.slash();check(!g.arsenal.bolts.isEmpty(),"equipped ranged weapon fires in history");
  int startLevel=g.level,startXp=g.xp;g.damageEnemy(g.enemies.get(0),100000,true);while(g.mode==Game.UPGRADE)g.choose(0);check(g.level>startLevel||g.xp>startXp,"experience retained on kill");
  g.invuln=0;g.hurt(100000,"test");int savedLevel=g.level,savedXp=g.xp;check(g.mode==Game.DEAD&&g.history.failed(),"death");
  g=roundtrip(g);g.resume();check(g.mode==Game.DEAD,"death after restart");g.history.restart(g);check(g.inHistory()&&g.history.stage==5&&g.level==savedLevel&&g.xp==savedXp,"retry retains xp and resets plot");choose(g,0);
  killAll(g);g.update(.01f,new Game.Input());check(g.mode==Game.DIALOGUE,"bridge intro");choose(g,0);check(g.history.stage==9&&g.enemies.size()==7,"scout battle");
  g=roundtrip(g);g.resume();check(g.inHistory()&&g.history.stage==9,"middle stage save");killAll(g);g.update(.01f,new Game.Input());check(g.mode==Game.DIALOGUE,"ferry dialogue");choose(g,0);check(g.history.stage==6&&g.enemies.size()==9,"jin battle");
  g=roundtrip(g);g.resume();check(g.inHistory()&&g.history.stage==6&&g.enemies.size()==9,"mid-battle save");killAll(g);g.update(.01f,new Game.Input());check(g.mode==Game.DIALOGUE&&g.history.stage==7,"win");int reward=g.gold;choose(g,0);
  check(g.inTown()&&g.enemies.size()==initial&&g.waveSpawned==3&&g.waveKilled==2,"suspended body world restored");check(g.gold==reward,"reward preserved");
  check(g.story.talk(g,10),"re-entry");choose(g,0);choose(g,0);g.history.exit(g);check(g.inTown()&&g.history.stage==0&&g.enemies.size()==initial,"retreat resets chapter and restores world");
  Game h=new Game();h.startDream();choose(h,0);h.history.start(h);choose(h,0);h.invuln=0;h.hurt(99999,"test");
  check(h.mode==Game.DEAD&&h.xp==8,"death gives XP even without a kill");new Controls().down(h,0,480,425);check(h.inTown()&&h.history.stage==0&&h.xp==8,"death exit keeps XP and resets chapter");
  h.history.start(h);choose(h,0);h.title();check(h.mode==Game.TITLE&&h.inTown()&&h.history.stage==0&&h.xp==8,"returning to title retreats");
  byte[] v9=LegacySaves.snapshot(h,9);Game old=Game.load(new ByteArrayInputStream(v9));check(old.history.stage==0,"0.2.5 version 9 saves load");
  Game alt=new Game();alt.startDream();choose(alt,0);alt.history.start(alt);choose(alt,0);killAll(alt);alt.update(.01f,new Game.Input());int levelBefore=alt.level,xpBefore=alt.xp;choose(alt,1);check(alt.history.stage==9&&(alt.level>levelBefore||alt.xp>xpBefore),"protect documents grants XP");
  alt=roundtrip(alt);alt.resume();killAll(alt);alt.update(.01f,new Game.Input());choose(alt,1);check(alt.inTown()&&alt.history.stage==0,"retreat at second choice");
  Game v10state=new Game();v10state.startDream();choose(v10state,0);v10state.history.start(v10state);choose(v10state,0);byte[] v10=LegacySaves.snapshot(v10state,10);Game v10loaded=Game.load(new ByteArrayInputStream(v10));check(v10loaded.history.stage==5&&v10loaded.history.suspended.length>0,"0.2.6 version 10 battle saves load");
  System.out.println("History battles, branching, death, retry, retreat, XP and legacy saves passed");
 }
}
