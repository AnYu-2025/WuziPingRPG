package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

public final class ExpansionTests {
    private static int count;
    private static void check(boolean v,String s){if(!v)throw new AssertionError(s);count++;System.out.println("PASS "+s);}
    private static Game field(){Game g=new Game();g.startDream();g.story.dialogue=null;g.mode=Game.PLAY;g.body.briefed=true;g.body.enter(g);g.spawnTimer=999;g.invuln=0;g.arsenal.unlocked=63;return g;}
    private static Game round(Game g)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);return Game.load(new ByteArrayInputStream(out.toByteArray()));}
    private static final class Capture implements Painter {
        Map<String,float[]> texts=new HashMap<>();boolean background=false;float width,height;
        Capture(float w,float h){width=w;height=h;}
        public void rect(float x,float y,float w,float h,int color){if(x==0&&y==0&&w>=width&&h>=height)background=true;}
        public void oval(float x,float y,float w,float h,int color){}public void line(float a,float b,float c,float d,float w,int color){}
        public void text(String s,float x,float y,float size,int color,int align){texts.put(s,new float[]{x,y});}
        public void image(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip){}
    }
    public static void main(String[] args)throws Exception{
        int[][] sizes={{1920,1080},{2400,1080},{2750,1236},{3440,1440},{1600,1200},{1280,800}};
        for(int[] size:sizes){
            Viewport v=new Viewport();v.set(size[0],size[1],0,0,0,0);check(Math.abs(v.width*v.scale-size[0])<.01&&Math.abs(v.height*v.scale-size[1])<.01,"Viewport fills "+size[0]+"x"+size[1]+" without letterbox");
            Game g=field();Scene scene=new Scene();scene.layout=v;Capture p=new Capture(v.width,v.height);scene.draw(p,g,2);
            check(p.background&&Math.abs(p.texts.get("移动")[0]-(92+v.left))<.1&&Math.abs(p.texts.get("普攻")[0]-(866+v.right))<.1,"World fills viewport while controls retain left/right anchors at "+size[0]);
            Controls c=new Controls();c.layout=v;c.down(g,1,92+v.left+25,435+v.bottom);c.down(g,2,866+v.right,462+v.bottom);check(c.input.mx>0&&c.input.attack,"Movement and combat hit tests follow viewport at "+size[0]);c.clear();
            c.down(g,3,230+v.left,240+v.top);check(g.mode==Arsenal.MENU,"Armory touch target follows safe left anchor at "+size[0]);
            c.down(g,4,380+v.centerX,458+v.centerY);check(g.mode==Game.PLAY,"Centered modal return button follows viewport at "+size[0]);
        }
        Viewport safe=new Viewport();safe.set(2400,1080,100,0,30,25);check(safe.left*safe.scale>=99.9&&Math.abs((safe.right+940)*safe.scale-(2400-30-20*safe.scale))<.1,"Cutout and bottom safe areas preserve reachable UI margins");
        for(int weapon=0;weapon<6;weapon++){
            Game g=field();g.arsenal.selected=weapon;g.spawnEnemy(0,g.x+32,g.y);Game.Enemy e=g.enemies.get(0);g.slash();
            if(weapon==3||weapon==4){check(!g.arsenal.bolts.isEmpty()&&e.hp==e.maxHp,"Ranged weapon "+weapon+" emits actual travel-time projectiles");for(int tick=0;tick<30;tick++)g.arsenal.tick(g,1f/60);check(e.hp<e.maxHp,"Ranged weapon "+weapon+" projectile collides and damages a target");}
            else check(e.hp<e.maxHp&&g.attackCd>0,"Melee weapon "+weapon+" applies its own damage and cooldown");
            g.enemies.clear();g.arsenal.bolts.clear();g.spawnEnemy(2,g.x+50,g.y);e=g.enemies.get(0);g.castSkill();
            if(weapon==2||weapon==3)check(g.arsenal.bolts.size()==3&&g.skillCd>0,"Weapon "+weapon+" skill launches a real three-lane volley");else check(e.hp<e.maxHp&&g.skillCd>0,"Weapon "+weapon+" skill applies its distinct area strike");
        }
        Game g=field();g.gold=100;float base=g.arsenal.damage(g);g.arsenal.upgrade(g,0);check(g.gold==70&&g.arsenal.forge[0]==1&&g.arsenal.damage(g)>base,"Forging consumes exact coins and raises selected archetype damage");g.gold=0;g.arsenal.upgrade(g,0);check(g.arsenal.forge[0]==1,"Forging with insufficient coins preserves weapon level");
        g.arsenal.unlocked=1;g.arsenal.equip(g,4);check(g.arsenal.selected==0,"Locked weapon cannot be equipped");g.arsenal.unlock(g,4);g.arsenal.equip(g,4);check(g.arsenal.selected==4,"Unlock changes which archetype can actually be equipped");
        g=field();g.arsenal.energy=99;g.arsenal.ultimate(g);check(g.arsenal.energy==99&&g.arsenal.shield==0,"Ultimate rejects incomplete energy");g.arsenal.energy=100;g.spawnEnemy(2,g.x+80,g.y);Game.Enemy tank=g.enemies.get(0);g.arsenal.ultimate(g);check(g.arsenal.energy==0&&g.arsenal.shield==4&&tank.hp<tank.maxHp,"Fully charged ultimate damages strengthened enemies and grants timed protection");
        g=field();g.arsenal.shield=3;g.hurt(20,"test");check(Math.abs(g.hp-88.75f)<.01,"Shield reduces real incoming damage");
        g=field();g.arsenal.selected=2;g.castSkill();Game restored=round(g);check(restored.arsenal.bolts.size()==3&&restored.arsenal.selected==2,"Format five preserves equipped weapon and flying friendly projectiles");
        g.body.returnTown(g);float life=g.arsenal.bolts.get(0).life;for(int i=0;i<30;i++)g.update(.05f,new Game.Input());check(g.arsenal.bolts.get(0).life==life,"Returning to town freezes friendly projectiles as well as enemies");
        HashSet<Integer> kinds=new HashSet<>();
        for(int organ:new int[]{0,1,2,3,7}){
            g=field();g.body.organ=organ;g.wave=organ+1;g.body.cured=(1<<organ)-1;g.spawnEnemy(4,g.x+90,g.y);Game.Enemy boss=g.enemies.get(0);boss.cd=0;g.update(.05f,new Game.Input());check(boss.windup>0,"Boss kind "+Bosses.kind(g)+" telegraphs before attack");
            boss.windup=.01f;boss.bossAttack=organ==0;boss.targetX=g.x;boss.targetY=g.y;float x=boss.x;g.invuln=99;g.update(.05f,new Game.Input());
            check(organ==0?Math.abs(boss.x-x)>10:organ==3?g.enemies.size()>1:!g.shots.isEmpty(),"Boss kind "+Bosses.kind(g)+" resolves dash, summons or its own projectile pattern");kinds.add(Bosses.kind(g));
        }check(kinds.size()==5,"Eight organ encounters include all five distinct boss mechanics");
        // A completed v4 game is extended rather than wiping equipment, rewards or friendship.
        g=field();g.body.organ=4;g.wave=5;g.body.cured=31;g.body.ending=true;g.story.battleWon=true;g.guest.discovered=true;g.guest.stage=2;g.gold=387;g.maxHp=165;g.hp=165;
        restored=Game.load(new ByteArrayInputStream(LegacySaves.snapshot(g,4)));check(restored.body.cured==31&&!restored.body.ending&&!restored.story.battleWon&&restored.gold==387&&restored.guest.stage==2&&restored.maxHp==165,"Completed v4 migration keeps old rewards and friend while opening expansion");restored.body.enter(restored);check(restored.body.organ==5&&restored.wave==6,"Migrated completed game can enter heart expansion without restarting");
        g=field();Controls controls=new Controls();controls.key(g,"B",true);check(g.mode==Arsenal.MENU,"B opens paused armory");controls.back(g);controls.key(g,"Q",true);check(g.arsenal.selected==1,"Q cycles to another owned combat archetype");
        System.out.println("ALL "+count+" EXPANSION CHECKS PASSED");
    }
}
