package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

/** Physics workshop: real interactions, tuned launch setup, journal, reward weapon and save migration. */
public final class PhysicsTests {
    private static int count;
    private static void check(boolean v,String s){if(!v)throw new AssertionError(s);count++;System.out.println("PASS "+s);}
    private static Game town(){Game g=new Game();g.startDream();g.story.dialogue=null;g.mode=Game.PLAY;return g;}
    private static Game workshop(){Game g=town();g.physics.enter(g);g.banner=0;return g;}
    private static Game.Input press(){Game.Input in=new Game.Input();in.attack=true;return in;}
    private static void idle(Game g,int frames){for(int i=0;i<frames;i++)g.update(1f/60,new Game.Input());}
    private static void fire(Game g,float angle,float power,int frames){
        g.physics.launchAngle=angle;g.physics.launchPower=power;g.x=300;g.y=800;
        g.update(1f/60,press());idle(g,frames);
    }
    private static final class Capture implements Painter{
        Set<String> words=new HashSet<>();
        public void rect(float x,float y,float w,float h,int c){}
        public void oval(float x,float y,float w,float h,int c){}
        public void line(float a,float b,float c,float d,float w,int color){}
        public void text(String s,float x,float y,float z,int c,int a){words.add(s);}
        public void image(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float a,boolean f){}
        public void imageRotated(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float a,boolean f,float degrees,float px,float py){}
    }
    public static void main(String[] args)throws Exception{
        Game g=workshop();
        check(g.inPhysics()&&g.worldWidth()==1536,"Physics workshop has its own expanded world");
        g.x=300;g.y=800;g.update(1f/60,press());
        check(g.physics.projectileActive&&g.swing==0,"Operation key now reaches physics mechanisms and consumes one pulse");
        g=workshop();fire(g,45,50,220);
        check(g.physics.targetHits>=1,"Default 45 degree launch actually reaches the first target");
        g=workshop();g.physics.adjust(g,0,5);g.physics.adjust(g,1,5);
        check(g.physics.launchAngle==50&&g.physics.launchPower==55,"Angle and power step by five");
        for(int i=0;i<20;i++){g.physics.adjust(g,0,5);g.physics.adjust(g,1,5);}
        check(g.physics.launchAngle==PhysicsJourney.MAX_ANGLE&&g.physics.launchPower==PhysicsJourney.MAX_POWER,"Launch parameters clamp at the upper bounds");
        for(int i=0;i<20;i++){g.physics.adjust(g,0,-5);g.physics.adjust(g,1,-5);}
        check(g.physics.launchAngle==PhysicsJourney.MIN_ANGLE&&g.physics.launchPower==PhysicsJourney.MIN_POWER,"Launch parameters clamp at the lower bounds");
        float slow=g.physics.launchSpeed();g.physics.adjust(g,1,10);
        check(g.physics.launchSpeed()>slow,"Launch speed scales with chosen power");
        g=workshop();Controls c=new Controls();
        c.down(g,0,440,460);
        check(g.physics.launchAngle==50,"On-screen angle button tunes the launch setup");
        c.down(g,0,505,460);
        check(g.physics.launchPower==45,"On-screen power button tunes the launch setup");
        c.key(g,"X",true);c.key(g,"V",true);
        check(g.physics.launchAngle==55&&g.physics.launchPower==50,"Keyboard shortcuts tune angle and power as well");
        g=workshop();c=new Controls();c.down(g,0,866,428);
        check(c.input.attack,"Physics operation button maps to the attack pulse");
        g=workshop();g.autoAttack=true;idle(g,10);
        check(!g.physics.projectileActive&&g.physics.targetHits==0,"Auto attack cannot fire puzzle mechanisms by itself");
        g=workshop();g.physics.level=1;g.x=PhysicsJourney.MIRRORS[0][0];g.y=PhysicsJourney.MIRRORS[0][1];
        int before=g.physics.mirrorAngles[0];g.update(1f/60,press());
        check(g.physics.mirrorAngles[0]==(before+45)%360,"Mirror rotates from the operation key");
        g=workshop();g.physics.level=2;g.x=PhysicsJourney.CIRCUIT_NODES[0][0];g.y=PhysicsJourney.CIRCUIT_NODES[0][1];
        g.update(1f/60,press());check(g.physics.selectedNode==0,"First circuit node selects from the operation key");
        idle(g,30);g.x=PhysicsJourney.CIRCUIT_NODES[1][0];g.y=PhysicsJourney.CIRCUIT_NODES[1][1];g.update(1f/60,press());
        check(g.physics.wiresPlaced[0],"Second node connects the wire after the attack cooldown");
        g=workshop();g.physics.solved=3;c=new Controls();c.key(g,"L",true);
        check(g.mode==PhysicsJourney.JOURNAL,"L opens the dedicated physics journal inside the workshop");
        Capture capture=new Capture();new Scene().draw(capture,g,1);
        check(capture.words.contains("物理 · 发现札记")&&capture.words.contains("◆ 抛体靶场"),"Physics journal renders discovered puzzles");
        c.back(g);check(g.mode==Game.PLAY,"Leaving the physics journal returns to the workshop");
        g=town();g.physics.solved=1;g.mode=Game.JOURNAL;c=new Controls();c.down(g,0,700,460);
        check(g.mode==PhysicsJourney.JOURNAL,"Town journal offers the physics discovery page once a puzzle is solved");
        g=town();g.physics.solved=31;g.physics.syncFinaleReward(g);
        check(g.arsenal.owned(Arsenal.RESONANCE_STAFF_PLUS),"Completing all five puzzles unlocks the seventh weapon");
        int gold=g.gold,unlocked=g.arsenal.unlocked;g.physics.syncFinaleReward(g);
        check(g.gold==gold&&g.arsenal.unlocked==unlocked,"Finale reward is idempotent");
        g.arsenal.selected=6;g.arsenal.bolts.clear();g.arsenal.attack(g);
        check(g.arsenal.bolts.size()==5&&g.arsenal.bolts.get(0).color==Arsenal.COLORS[6],"Upgraded staff fires five fan-shaped bolts");
        g=town();g.body.enabled=false;g.story.area=Story.FOREST;g.enemies.clear();
        Game.Enemy near=new Game.Enemy(0,101,g.x+60,g.y,200),other=new Game.Enemy(0,102,g.x+100,g.y,200);
        g.enemies.add(near);g.enemies.add(other);
        g.arsenal.unlocked|=1<<6;g.arsenal.selected=6;g.arsenal.bolts.clear();g.arsenal.attack(g);
        Arsenal.Bolt bolt=g.arsenal.bolts.get(0);bolt.x=g.x+60;bolt.y=g.y;bolt.vx=0;bolt.vy=0;bolt.life=2;
        g.arsenal.tick(g,.001f);
        check(near.hp<200&&other.hp<200,"A resonant hit chains damage into a nearby enemy");
        g=town();g.arsenal.unlocked|=1<<6;g.mode=Arsenal.MENU;c=new Controls();c.down(g,0,520,380);
        check(g.arsenal.selected==6,"Seventh armory card is equipable by touch");
        g=town();g.arsenal.unlocked=127;g.arsenal.selected=5;c=new Controls();c.key(g,"Q",true);
        check(g.arsenal.selected==6,"Quick swap cycles through all seven weapons");
        g=workshop();g.physics.launchAngle=62;g.physics.launchPower=73;
        ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);byte[] saved=out.toByteArray();
        Game loaded=Game.load(new ByteArrayInputStream(saved));
        check(saved[7]==10&&loaded.physics.launchAngle==62&&loaded.physics.launchPower==73,"Current format persists tuned launch parameters");
        Game graduate=town();graduate.physics.active=true;graduate.physics.level=4;graduate.physics.solved=31;
        byte[] format7=LegacySaves.snapshot(graduate,7);Game upgraded=Game.load(new ByteArrayInputStream(format7));
        check(format7[7]==7&&upgraded.physics.launchAngle==45&&upgraded.physics.launchPower==50&&upgraded.arsenal.owned(6),"Format 7 graduates migrate with default setup and receive the weapon");
        g=workshop();g.physics.level=0;capture=new Capture();new Scene().draw(capture,g,1);
        check(capture.words.contains("物理 · 发现札记")==false&&capture.words.contains("发射参数"),"Workshop HUD shows the launch parameter panel on the projectile range");
        System.out.println("ALL "+count+" PHYSICS WORKSHOP CHECKS PASSED");
    }
}
