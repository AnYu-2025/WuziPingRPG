package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

/** Behavioral checks of combat, input, progression and resumable state. */
public final class GameTests {
    private static int count=0;
    private static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);count++;System.out.println("PASS "+name);}
    private static Game fresh(){Game g=new Game();g.startRun();g.obstacles.clear();g.spawnTimer=999;return g;}
    public static void main(String[] args)throws Exception{
        Game g=fresh();Game.Input input=new Game.Input();input.mx=1;input.my=1;
        float ox=g.x,oy=g.y;g.update(.05f,input);check(Math.abs(Game.dist(ox,oy,g.x,g.y)-g.speed*.05)<.01,"Diagonal movement is normalized");
        g.x=Game.WORLD_W-18;g.update(.05f,input);check(g.x<=Game.WORLD_W-18,"World bounds constrain movement");
        g=fresh();g.obstacles.add(new Game.Obstacle(g.x+12,g.y,8,0));float x=g.x;input.mx=1;input.my=0;g.update(.05f,input);check(g.x==x,"Solid tree collision blocks movement");
        g=fresh();g.spawnEnemy(0,g.x+20,g.y);Game.Enemy e=g.enemies.get(0);g.slash();check(e.hp<e.maxHp,"Melee damages a nearby enemy");
        g.castSkill();check(g.enemies.isEmpty()&&g.kills==1,"Skill finishes enemy and increments kills");check(!g.drops.isEmpty(),"Defeated enemies drop loot");
        g=fresh();float hp=g.hp;g.hurt(20,"test");g.hurt(20,"test");check(g.hp==hp-20,"Damage grants a real invulnerability window");
        input=new Game.Input();input.dash=true;g.update(.016f,input);check(g.dashCd>0&&g.invuln>0,"Dash starts cooldown and invulnerability");
        g=fresh();g.hp=20;input=new Game.Input();input.potion=true;g.update(.016f,input);check(g.potions==2&&g.hp==70,"Potion consumes stock and restores half max HP");
        g=fresh();g.gainXp(50);check(g.mode==Game.UPGRADE&&g.pendingUpgrades>1,"Large XP reward queues every earned upgrade");
        check(g.choices[0]!=g.choices[1]&&g.choices[1]!=g.choices[2]&&g.choices[0]!=g.choices[2],"Upgrade choices are distinct");
        int before=g.pendingUpgrades;g.choose(0);check(g.pendingUpgrades==before-1,"Exactly one upgrade is consumed");while(g.pendingUpgrades>0)g.choose(0);check(g.mode==Game.PLAY,"Game resumes after all pending upgrades");
        g=fresh();g.pause();x=g.x;input=new Game.Input();input.mx=1;g.update(.05f,input);check(g.x==x&&g.elapsed==0,"Pause freezes movement and game time");
        g=fresh();g.wave=4;g.waveSpawned=g.waveTarget();g.update(.05f,new Game.Input());check(g.intermission>0,"Clearing a wave starts a supply intermission");
        for(int i=0;i<85;i++)g.update(.05f,new Game.Input());check(g.wave==5,"Intermission advances to boss wave");
        g=fresh();g.wave=5;g.waveSpawned=g.waveTarget();g.update(.016f,new Game.Input());check(g.mode==Game.VICTORY&&!g.activeRun,"Final wave clear ends in victory");
        int bank=g.bank;g.finish(true);check(g.bank==bank,"Finish rewards cannot be granted twice");
        g=fresh();g.hurt(1000,"test");check(g.mode==Game.DEAD&&!g.activeRun&&g.totalRuns==1,"Lethal damage finalizes a run");
        g=fresh();g.wave=3;g.hp=72;g.gold=123;g.spawnEnemy(3,g.x+70,g.y-20);g.drops.add(new Game.Drop(g.x,g.y+20,0,3));g.shots.add(new Game.Shot(12,15,2,3,8));g.gainXp(18);
        ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);Game restored=Game.load(new ByteArrayInputStream(out.toByteArray()));
        check(restored.mode==Game.TITLE&&restored.activeRun,"Restored game starts at a safe title screen");restored.resume();
        check(restored.mode==Game.UPGRADE&&restored.pendingUpgrades==g.pendingUpgrades,"Pending choice survives process restart");
        check(restored.gold==123&&restored.hp==g.hp&&restored.enemies.size()==1&&restored.drops.size()==1&&restored.shots.size()==1,"Snapshot preserves combat, resources and entities");
        boolean rejected=false;try{Game.load(new ByteArrayInputStream(new byte[]{1,2,3,4,5}));}catch(IOException expected){rejected=true;}check(rejected,"Truncated or foreign saves are rejected");
        Controls c=new Controls();g=fresh();c.down(g,11,120,435);c.down(g,22,857,433);check(c.input.mx>0&&c.input.attack,"Independent touch pointers support moving while attacking");c.up(11);check(c.input.mx==0&&c.input.attack,"Releasing joystick does not release attack");c.up(22);check(!c.input.attack,"Attack ends on its own pointer release");
        c.down(g,33,120,435);c.back(g);check(g.mode==Game.PAUSE&&c.input.mx==0,"Pausing clears held inputs");
        g.mode=Game.TITLE;c.down(g,44,100,350);check(g.mode==8&&g.activeRun,"New run asks before replacing an active save");c.down(g,44,400,375);check(g.mode==Game.TITLE&&g.activeRun,"Cancel preserves active journey");
        g=fresh();g.wave=5;g.spawnEnemy(4,g.x+60,g.y);e=g.enemies.get(0);e.windup=.01f;e.bossAttack=true;e.targetX=g.x;e.targetY=g.y;g.update(.02f,new Game.Input());check(g.hp<100,"Boss telegraphed strike resolves into damage");
        g=fresh();g.wave=5;g.spawnEnemy(4,g.x+60,g.y);e=g.enemies.get(0);e.windup=.01f;e.bossAttack=true;e.targetX=g.x-200;e.targetY=g.y;g.update(.02f,new Game.Input());check(g.hp==100,"Moving outside boss telegraph avoids damage");
        g=fresh();g.spawnEnemy(0,g.x+65,g.y);e=g.enemies.get(0);g.obstacles.add(new Game.Obstacle(g.x+35,g.y,9,0));
        for(int tick=0;tick<240;tick++)g.update(1f/60,new Game.Input());
        check(Game.dist(g.x,g.y,e.x,e.y)<30,"Chasing enemy steers around a blocking tree");
        // Seed-independent soak: run the actual update loop, exercising deaths and replays.
        g=fresh();g.spawnTimer=.2f;input=new Game.Input();g.autoAttack=true;int transitions=0;
        for(int tick=0;tick<60000;tick++){
            if(g.mode==Game.UPGRADE){g.choose(tick%3);transitions++;}
            if(g.mode==Game.DEAD||g.mode==Game.VICTORY){g.startRun();transitions++;}
            Game.Enemy nearest=null;float near=Float.MAX_VALUE;for(Game.Enemy foe:g.enemies){float dd=Game.dist(g.x,g.y,foe.x,foe.y);if(dd<near){near=dd;nearest=foe;}}
            input.mx=nearest==null?0:(nearest.x-g.x)/Math.max(1,near);input.my=nearest==null?0:(nearest.y-g.y)/Math.max(1,near);input.skill=true;input.dash=tick%180==0;input.potion=g.hp<g.maxHp*.45;
            g.update(1f/60,input);g.sounds.clear();
            if(Float.isNaN(g.x)||Float.isNaN(g.y)||Float.isNaN(g.hp)||g.enemies.size()>100)throw new AssertionError("Soak invalid state");
        }
        check(transitions>0,"1000-second simulation soak survives progression, death and replay");
        System.out.println("ALL "+count+" CHECKS PASSED");
    }
}
