package cn.wuziping.ember.tests;
import cn.wuziping.ember.*;
import java.io.*;
public final class HistoryTests {
 static void check(boolean b,String m){if(!b)throw new AssertionError(m);}
 static void talk(Game g,int id){Town.Npc n=Town.NPCS[id];g.x=n.x;g.y=n.y;check(g.story.talk(g,id),"NPC inaccessible "+id);}
 static void choose(Game g,int c){Story.Dialogue d=g.story.dialogue;check(d!=null,"missing dialogue");while(!d.last()){d.revealed=true;g.story.advance(g);}d.revealed=true;g.story.choose(g,c);}
 static Game roundtrip(Game g)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);return Game.load(new ByteArrayInputStream(out.toByteArray()));}
 public static void main(String[] args)throws Exception{
  Game g=new Game();g.startDream();choose(g,0);talk(g,10);choose(g,0);check(g.history.stage==1,"start");
  talk(g,11);choose(g,1);check(g.history.stage==1,"wrong answer advances");choose(g,0);talk(g,11);choose(g,0);check(g.history.stage==2,"printer");choose(g,0);
  g=roundtrip(g);check(g.history.stage==2,"save lost progress");g.resume();talk(g,12);choose(g,0);check(g.history.stage==3,"evidence");choose(g,0);
  talk(g,10);int before=g.gold;choose(g,0);check(g.history.stage==4&&g.gold==before+120,"reward");
  talk(g,10);choose(g,0);check(g.gold==before+120,"repeat reward");g=roundtrip(g);check(g.history.stage==4,"completion lost");
  System.out.println("History quest, wrong answer, reward and save roundtrip passed");
 }
}
