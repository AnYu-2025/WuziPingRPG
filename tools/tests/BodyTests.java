package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

/** End-to-end campaign state, reward ownership, organ geometry and new touch layout. */
public final class BodyTests {
    private static int count;
    private static void check(boolean v,String s){if(!v)throw new AssertionError(s);count++;System.out.println("PASS "+s);}
    private static void dialog(Game g,int choice){Story.Dialogue d=g.story.dialogue;if(d==null)throw new AssertionError("Missing dialogue");while(!d.last()){d.revealed=true;g.story.advance(g);}d.revealed=true;g.story.choose(g,choice);}
    private static void close(Game g){while(g.mode==Game.DIALOGUE)dialog(g,0);}
    private static Game fresh(){Game g=new Game();g.startDream();close(g);return g;}
    private static void accept(Game g){g.x=Town.NPCS[0].x;g.y=Town.NPCS[0].y+24;g.story.talk(g,0);dialog(g,0);}
    private static Game field(){Game g=fresh();accept(g);g.body.enter(g);g.spawnTimer=999;return g;}
    private static void kill(Game g){g.spawnEnemy(0,g.x+40,g.y);g.damageEnemy(g.enemies.get(g.enemies.size()-1),100000,false);}
    private static Game round(Game g)throws Exception{ByteArrayOutputStream o=new ByteArrayOutputStream();g.save(o);return Game.load(new ByteArrayInputStream(o.toByteArray()));}
    private static void geometry(int organ){
        int w=160,h=120;boolean[][] visited=new boolean[w][h];ArrayDeque<int[]> q=new ArrayDeque<>();q.add(new int[]{80,64});visited[80][64]=true;
        int[][] ds={{1,0},{-1,0},{0,1},{0,-1}};int reachable=0,total=0;
        while(!q.isEmpty()){int[] v=q.remove();reachable++;for(int[] d:ds){int x=v[0]+d[0],y=v[1]+d[1];if(x>=0&&x<w&&y>=0&&y<h&&!visited[x][y]&&!BodyJourney.blocked(organ,x*8,y*8,6)){visited[x][y]=true;q.add(new int[]{x,y});}}}
        for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(!BodyJourney.blocked(organ,x*8,y*8,6))total++;
        check(!BodyJourney.blocked(organ,640,510,8)&&!BodyJourney.blocked(organ,640,548,8),"Organ "+organ+" has walkable arrival and vessel portal");
        check(reachable==total,"Organ "+organ+" collision map connects every traversable cell ("+reachable+")");
    }
    public static void main(String[] args)throws Exception{
        Controls c=new Controls();Game g=new Game();c.down(g,1,100,295);check(g.body.enabled&&g.inTown()&&g.mode==Game.DIALOGUE,"New title action starts the body dream rather than legacy forest");
        check(g.story.dialogue.text().contains("中山大学"),"Dream opening retains campus setting and protagonist premise");close(g);
        g.x=480;g.y=112;g.story.interact(g);close(g);check(g.inTown()&&!g.body.briefed,"Vessel gate rejects a missing briefing");
        accept(g);check(g.body.briefed&&g.gold==20&&g.potions==4,"Briefing grants starting supplies once");
        g.story.talk(g,0);close(g);check(g.gold==20&&g.potions==4,"Repeated briefings cannot farm supplies");
        g.body.enter(g);check(g.inBody()&&g.wave==1&&g.body.transit>0,"Blood vessel enters first organ and starts transit visual");
        for(int i=0;i<8;i++)geometry(i);
        g=field();g.body.organ=2;g.wave=3;g.body.cured=3;g.x=400;g.y=340;g.spawnEnemy(0,400,260);Game.Enemy seeker=g.enemies.get(0);
        for(int tick=0;tick<1800;tick++){g.invuln=99;g.update(.05f,new Game.Input());}
        check(Game.dist(g.x,g.y,seeker.x,seeker.y)<30,"Virus finds a real route around a long intestinal fold");
        g=field();for(int i=0;i<3;i++)kill(g);check(g.body.supply[0]==0,"Medicine airdrop stays locked before four defeats");kill(g);check(g.body.supply[0]==1&&g.body.fall[0]>0,"Fourth defeat schedules a falling medicine crate");
        check(!g.blocked(g.body.supplyX[0],g.body.supplyY[0],12),"Airdrop chooses a traversable landing point");
        int stock=g.potions;g.body.claim(g,0);check(g.potions==stock&&g.body.supply[0]==1,"Falling crate cannot be collected early");
        float fall=g.body.fall[0];g.body.returnTown(g);for(int i=0;i<100;i++)g.update(.05f,new Game.Input());check(g.body.fall[0]==fall,"Airdrop descent freezes in the campus hub");g.body.enter(g);
        for(int i=0;i<60;i++)g.update(.05f,new Game.Input());check(g.body.supply[0]==2,"Crate reaches landed state after descent");
        g.x=640;g.y=700;g.body.claim(g,0);check(g.body.supply[0]==2,"Landed crate requires physical pickup proximity");
        g.x=g.body.supplyX[0];g.y=g.body.supplyY[0];g.hp=30;g.body.claim(g,0);check(g.body.supply[0]==3&&g.potions==5&&g.hp==55,"Nearby medicine crate supplies potion and quarter-health recovery");
        g.hp=30;g.body.claim(g,0);check(g.hp==30,"Claimed medicine cannot be replayed for healing");
        for(int i=0;i<4;i++)kill(g);check(g.body.supply[1]==1,"Eighth defeat schedules a weapon airdrop");
        g.body.fall[1]=0;g.body.tick(g,0);g.x=g.body.supplyX[1];g.y=g.body.supplyY[1];float atk=g.attack;g.body.claim(g,1);
        check(g.body.supply[1]==3&&g.attack==atk+4&&g.body.weaponLevel==1,"Weapon crate updates equipment and combat damage");g.body.claim(g,1);check(g.attack==atk+4,"Weapon attack reward cannot be duplicated");
        Game loaded=round(g);loaded.resume();check(loaded.body.enabled&&loaded.body.supply[1]==3&&loaded.attack==g.attack&&loaded.body.kills[0]==8,"Version three restores supply ownership, equipment and organ kills");
        c=new Controls();c.down(g,1,870,280);check(g.mode==BodyJourney.MAP,"Right-side body atlas touch opens vessel route overview");float time=g.elapsed;g.update(.05f,new Game.Input());check(g.elapsed==time,"Full body overview pauses combat");c.back(g);check(g.mode==Game.PLAY,"Back from full body overview restores play");
        c.down(g,1,120,435);c.down(g,2,857,465);check(c.input.mx>0&&c.input.attack,"New action layout retains move and attack multitouch");c.up(1);c.up(2);c.down(g,3,764,465);check(c.input.skill,"New skill button routes to skill action");c.pulsesConsumed();c.down(g,4,755,370);check(c.input.dash,"New dash button does not collide with body atlas");c.pulsesConsumed();c.down(g,5,679,410);check(c.input.potion,"New medicine button routes to potion action");c.clear();
        g=field();g.invuln=0;g.hurt(10000,"test virus");check(g.mode==Game.DEAD&&g.story.defeated&&g.activeRun,"Body defeat keeps a resumable journey");loaded=round(g);loaded.resume();check(loaded.inTown()&&!loaded.story.defeated&&loaded.hp==loaded.maxHp&&loaded.body.organ==0,"Death restart safely recovers in campus hub");
        final ArrayList<String> text=new ArrayList<>();new Scene().draw(new Painter(){public void rect(float x,float y,float w,float h,int color){}public void oval(float x,float y,float w,float h,int color){}public void line(float x,float y,float a,float b,float width,int color){}public void text(String s,float x,float y,float size,int color,int align){text.add(s);}public void image(String name,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip){}},g,2);
        check(text.contains("《病入膏肓》"),"Actual death renderer displays the requested exact Chinese title");
        g=field();g.waveSpawned=g.waveTarget();g.waveKilled=g.waveTarget();g.hp=20;float previousMax=g.maxHp;int previousGold=g.gold;g.update(.05f,new Game.Input());
        check(g.body.cleared()&&g.gold==previousGold+30&&g.maxHp==previousMax+10&&g.hp==g.maxHp&&g.potions==5,"First region clear grants its exact coin, vitality, healing and potion rewards");
        g=field();g.body.supply[0]=3;g.body.kills[0]=4;g.invuln=0;g.hurt(10000,"test");g.body.recover(g);check(g.body.supply[0]==3&&g.body.kills[0]==4,"Death retry preserves claimed airdrops and lifetime organ milestones");
        // Play the real spawn/update loop across all five organs, including actual boss spawn.
        g=field();int totalReward=0;
        for(int region=0;region<8;region++){
            g.spawnTimer=.01f;int guard=0;boolean sawBoss=false,sawWrongFoe=false;
            while(!g.body.cleared()&&guard++<5000){
                if(g.mode==Game.UPGRADE){g.choose(0);continue;}
                g.invuln=99;g.update(.05f,new Game.Input());
                for(Game.Enemy enemy:new ArrayList<Game.Enemy>(g.enemies)){if(enemy.type==4)sawBoss=true;if(enemy.type!=4&&((region==3||region==4||region==7)?enemy.type!=3:enemy.type>2))sawWrongFoe=true;g.damageEnemy(enemy,100000,false);}
            }
            check(g.body.cleared()&&g.waveKilled==BodyJourney.TARGETS[region],"Actual organ "+region+" encounter reaches its defeat target and clears");
            check(!sawWrongFoe&&sawBoss,"Organ "+region+" spawns its correct virus or abnormal-cell family");
            totalReward+=BodyJourney.REWARDS[region];int gold=g.gold;float cap=g.maxHp;g.body.clear(g);check(g.gold==gold&&g.maxHp==cap,"Organ "+region+" cannot repeat first-clear rewards");
            loaded=round(g);loaded.resume();check(loaded.body.cured==g.body.cured&&loaded.body.organ==region,"Organ "+region+" completion and reward ownership survive restart");
            if(region<7){
                g.x=640;g.y=548;g.story.interact(g);check(g.mode==Game.DIALOGUE,"Vessel offers explicit onward travel after clear "+region);dialog(g,0);
                while(g.mode==Game.UPGRADE)g.choose(0);
                check(g.body.organ==region+1&&g.wave==region+2&&g.waveSpawned==0&&g.inBody(),"Vessel advances to next organ without skipping or keeping old enemies");
            }
        }
        check(g.body.cured==255&&g.mode==Game.VICTORY&&g.maxHp>=180&&totalReward==785,"All organ clears reach final victory and award 785 region coins plus vitality");
        g.body.returnTown(g);g.x=Town.NPCS[0].x;g.y=Town.NPCS[0].y+24;g.story.talk(g,0);int gold=g.gold;atk=g.attack;dialog(g,0);close(g);
        check(g.body.ending&&g.gold==gold+180&&g.attack==atk+12&&g.body.weaponLevel==5,"Final report awards 180 coins and named ending weapon");
        g.story.talk(g,0);close(g);check(g.gold==gold+180&&g.attack==atk+12,"Ending report cannot duplicate its currency or weapon");
        loaded=round(g);loaded.resume();check(loaded.body.ending&&loaded.inTown()&&loaded.body.cured==255,"Completed dream remains safely resumable in campus");
        // Produce an exact v2 payload by stripping the new fixed-size body section.
        Game old=new Game();old.startAdventure();close(old);old.gold=77;ByteArrayOutputStream bytes=new ByteArrayOutputStream();old.save(bytes);byte[] v2=LegacySaves.snapshot(old,2);
        loaded=Game.load(new ByteArrayInputStream(v2));check(!loaded.body.enabled&&loaded.inTown()&&loaded.gold==77,"Exact version two snapshot migrates without rewriting its legacy campaign");
        byte[] broken=Arrays.copyOf(bytes.toByteArray(),bytes.size()-3);boolean rejected=false;try{Game.load(new ByteArrayInputStream(broken));}catch(IOException ex){rejected=true;}check(rejected,"Truncated version three body state is rejected");
        ByteArrayOutputStream bodyBytes=new ByteArrayOutputStream();g.body.write(new DataOutputStream(bodyBytes));check(bodyBytes.size()==BodyJourney.SAVE_BYTES,"Documented body snapshot length matches actual wire format");
        System.out.println("ALL "+count+" BODY CHECKS PASSED");
    }
}
