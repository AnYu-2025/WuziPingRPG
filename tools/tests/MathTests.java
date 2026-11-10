package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

/** Exercise actual movement and shared rendering, not just puzzle flag setters. */
public final class MathTests {
    private static int count;
    private static void check(boolean v,String s){if(!v)throw new AssertionError(s);count++;System.out.println("PASS "+s);}
    private static Game town(){Game g=new Game();g.startDream();g.story.dialogue=null;g.mode=Game.PLAY;return g;}
    private static Game garden(){Game g=town();g.math.enter(g);g.banner=0;return g;}
    private static void close(Game g){g.story.dialogue=null;g.mode=Game.PLAY;}
    private static void walk(Game g,float x,float y){
        int ticks=0;while(Game.dist(g.x,g.y,x,y)>.6f){if(g.mode==Game.DIALOGUE&&g.math.cleared())return;if(g.mode!=Game.PLAY)throw new AssertionError("Unexpected modal while walking");
            float dx=x-g.x,dy=y-g.y,d=Game.dist(x,y,g.x,g.y),n=Math.max(d,g.speed/60);Game.Input input=new Game.Input();input.mx=dx/n;input.my=dy/n;g.update(1f/60,input);
            if(++ticks>12000)throw new AssertionError("Path blocked at "+g.x+","+g.y+" toward "+x+","+y);
        }
    }
    private static void arc(Game g,int from,int to){for(int degree=from;degree<=to&&!g.math.cleared();degree+=2){double a=Math.toRadians(degree);walk(g,768+(float)Math.cos(a)*180,576+(float)Math.sin(a)*180);}}
    private static Game round(Game g)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();g.save(out);return Game.load(new ByteArrayInputStream(out.toByteArray()));}
    private static final class Capture implements Painter{
        float atlasW,atlasH,angle;int rotated;Set<String> words=new HashSet<>();
        public void rect(float x,float y,float w,float h,int c){}public void oval(float x,float y,float w,float h,int c){}public void line(float a,float b,float c,float d,float w,int color){}
        public void text(String s,float x,float y,float z,int c,int a){words.add(s);}
        public void image(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float a,boolean f){if(n.equals("body_atlas.png")){atlasW=w;atlasH=h;}}
        public void imageRotated(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float a,boolean f,float degrees,float px,float py){rotated++;angle=degrees;}
    }
    public static void main(String[] args)throws Exception{
        Game g=garden();check(g.inMath()&&!g.inBody()&&g.worldWidth()==1536&&g.worldHeight()==1152,"Math theme has an independent expanded world");
        walk(g,948,576);check(g.math.circle==1,"Walking to a beacon lights it");walk(g,678,732);check(g.math.circle!=3&&g.math.solved==0,"Cutting across the circle breaks the trail");
        g.math.retry(g);walk(g,948,576);arc(g,0,240);check(g.math.solved==1&&g.mode==Game.DIALOGUE,"Continuous real movement around the circle solves equidistance");
        int gold=g.gold;float max=g.maxHp;check(gold==60&&max==108,"First discovery grants its exact one-time reward");close(g);g.math.tick(g,1f/60);check(g.gold==gold&&g.maxHp==max,"Standing in a solved puzzle cannot farm rewards");
        g.math.enter(g);check(g.math.level==1&&!g.math.cleared(),"Next garden unlocks only after the previous discovery");
        walk(g,460,780);walk(g,1000,780);check(g.math.bridges==1,"Walking a full bridge commits one edge");walk(g,460,780);check(g.math.bridges==0,"Walking a bridge twice resets the uncompleted path");
        g.math.retry(g);walk(g,460,780);int[] route={1,2,0,3,4,2,3};for(int node:route)walk(g,MathJourney.NODES[node][0],MathJourney.NODES[node][1]);
        check(g.math.solved==3&&g.math.bridges==127,"Seven actual bridge crossings form a complete Euler trail");check(g.gold==140&&g.maxHp==116,"Second discovery adds only its own reward");
        g.math.enter(g);check(g.math.level==2,"Final corridor unlocks after the bridges");walk(g,940,700);check((g.math.ribbon&2)==0,"An unmatched orientation cannot activate a marker");
        walk(g,1100,700);walk(g,1158,700);Game.Input right=new Game.Input();right.mx=1;for(int i=0;i<8;i++)g.update(1f/60,right);
        check(g.math.orientation==1&&g.x<420&&Math.abs(g.y-480)<2,"Seam crossing mirrors the transverse coordinate and flips local orientation");
        walk(g,940,700);check((g.math.ribbon&2)!=0,"Matching reversed orientation activates its marker");
        walk(g,1100,700);walk(g,1158,700);for(int i=0;i<8;i++)g.update(1f/60,right);check(g.math.orientation==0,"Two seam crossings restore the local orientation");
        walk(g,540,480);walk(g,780,590);check(g.math.solved==7&&g.gold==240&&g.maxHp==124,"All three movement puzzles complete with distinct rewards");
        close(g);Game restored=round(g);restored.resume();check(restored.inMath()&&restored.mode==Game.PLAY&&restored.math.solved==7,"Completed mathematics save resumes without body-ending redirection");
        restored.math.returnTown(restored);restored=round(restored);restored.resume();check(restored.inTown()&&Math.abs(restored.x-1080)<1,"Returning to expanded campus survives reload");
        g=garden();g.x=1340;g.y=950;restored=round(g);restored.resume();check(restored.x==1340&&restored.y==950,"Expanded math coordinates survive save beyond old world bounds");
        g=town();g.x=1320;g.y=990;restored=round(g);restored.resume();check(restored.x==1320&&restored.y==990,"Expanded town coordinates survive save beyond old bounds");
        g=town();g.body.briefed=true;g.body.enter(g);g.spawnEnemy(2,g.x+30,g.y);g.castSkill();float enemyX=g.enemies.get(0).x;int enemies=g.enemies.size(),kills=g.kills;g.body.returnTown(g);g.math.enter(g);g.autoAttack=true;
        for(int i=0;i<120;i++){Game.Input in=new Game.Input();in.attack=in.skill=in.ultimate=true;g.update(1f/60,in);}
        check(g.hp==g.maxHp&&g.enemies.size()==enemies&&g.enemies.get(0).x==enemyX&&g.kills==kills,"Math movement freezes body combat and ignores attack inputs");
        g.math.returnTown(g);g.body.enter(g);check(g.inBody()&&!g.math.active&&g.enemies.size()==enemies,"Switching back preserves the exact body encounter");
        g=town();g.setHeroName("  星海\n旅人  ");g.effectsLevel=0;restored=round(g);check(restored.heroName.equals("星海旅人")&&restored.effectsLevel==0,"Custom name and gentle effects persist safely");
        g.setHeroName("😀😀😀😀😀😀😀😀😀😀😀😀😀");check(g.heroName.codePointCount(0,g.heroName.length())==12&&!Character.isHighSurrogate(g.heroName.charAt(g.heroName.length()-1)),"Name limit preserves complete Unicode code points");g.setHeroName(" ");check(g.heroName.equals(Game.HERO),"Empty name restores WuziPing");
        g.setHeroName("星海旅人");g.startDream();check(g.heroName.equals("星海旅人"),"New journeys retain the chosen name");check(g.story.dialogue.pages[0].contains("星海旅人")||Arrays.toString(g.story.dialogue.pages).contains("星海旅人"),"Story text uses the chosen name");
        close(g);Controls c=new Controls();g.title();c.down(g,0,700,465);check(g.renamePending,"Title rename button reaches the native editor request");
        for(int version=1;version<=5;version++){Game old=town();byte[] bytes=LegacySaves.snapshot(old,version);restored=Game.load(new ByteArrayInputStream(bytes));check(restored.heroName.equals(Game.HERO)&&!restored.math.active,"Historical save format "+version+" migrates with default new fields");}
        g=town();g.x=1140;g.y=650;g.story.interact(g);check(g.inMath(),"East courtyard portal enters math directly without body quest gate");
        c=new Controls();c.key(g,"N",true);check(g.mode==MathJourney.MAP,"Theme map opens with N");c.down(g,0,250,380);check(g.inMath()&&g.mode==Game.PLAY,"Theme switching is rejected outside the safe town");
        g.math.returnTown(g);c.key(g,"M",true);c.down(g,0,650,380);check(g.inMath(),"Touch theme card enters math from town");g.math.circle=1;c.key(g,"T",true);check(g.math.circle==0,"Retry key clears only the current unsolved puzzle");
        g.mode=Game.PAUSE;c.down(g,0,550,310);check(g.effectsLevel==0&&g.sound,"Effects setting is independent of sound");g.resume();check(g.inMath()&&g.mode==Game.PLAY,"Pausing math resumes the same puzzle");
        g=town();g.body.briefed=true;g.body.enter(g);g.spawnTimer=999;g.invuln=0;g.spawnEnemy(0,g.x+50,g.y);check(Math.abs(g.enemies.get(0).maxHp-40.5f)<.01,"Body normal enemies have 35 percent more health");g.hurt(20,"test");check(g.hp==75,"Body incoming damage increases by 25 percent");
        g.enemies.clear();g.spawnEnemy(4,g.x+80,g.y);check(Math.abs(g.enemies.get(0).maxHp-379.5f)<.1,"Body bosses have 65 percent more base health");
        Capture capture=new Capture();BodyRenderer.atlas(capture,g,829,251,94,125,0,false);check(Math.abs(capture.atlasH/capture.atlasW-1.5f)<.001,"Small body atlas preserves the source aspect ratio");
        g.swing=.19f;new Scene().draw(capture,g,1);float angle=capture.angle;g.swing=.03f;new Scene().draw(capture,g,1);check(capture.rotated>0&&Math.abs(capture.angle-angle)>100,"Rendered sword really rotates through its swing arc");
        g.body.returnTown(g);capture=new Capture();new Scene().draw(capture,g,1);check(capture.words.contains(g.heroName),"Chosen name is rendered in the shared scene");
        int w=Town.WIDTH/8,h=Town.HEIGHT/8;boolean[][] seen=new boolean[w][h];ArrayDeque<int[]> q=new ArrayDeque<>();q.add(new int[]{60,65});seen[60][65]=true;int[][] dirs={{1,0},{-1,0},{0,1},{0,-1}};
        while(!q.isEmpty()){int[] cell=q.remove();for(int[] dir:dirs){int x=cell[0]+dir[0],y=cell[1]+dir[1];if(x>=0&&y>=0&&x<w&&y<h&&!seen[x][y]&&!Town.blocked(x*8,y*8,6)){seen[x][y]=true;q.add(new int[]{x,y});}}}
        check(seen[142][78],"Expanded campus has a traversable path to the mathematical portal");
        g=garden();walk(g,948,576);arc(g,0,60);restored=round(g);restored.resume();arc(restored,60,240);check(restored.math.solved==1,"Mid-circle save resumes the continuous geometry challenge");
        g.math.level=1;g.math.solved=1;g.math.resetState();close(g);g.x=460;g.y=870;walk(g,460,780);walk(g,750,780);restored=round(g);restored.resume();walk(restored,1000,780);check(restored.math.bridges==1,"Mid-bridge save retains the chosen edge and current node");
        g=town();g.body.cured=255;g.body.organ=7;g.wave=8;g.story.battleWon=true;g.math.enter(g);restored=round(g);restored.resume();check(restored.inMath()&&restored.mode==Game.PLAY,"A finished body campaign cannot interrupt mathematics on resume");
        g.math.defeat(g);c=new Controls();c.down(g,0,450,370);check(g.inTown()&&!g.math.failed&&g.hp==g.maxHp,"Math recovery uses its own town return without resetting the body campaign");
        g=new Game();g.setHeroName("尚未出发");restored=round(g);check(!restored.activeRun&&restored.heroName.equals("尚未出发"),"Name persists before the first journey is created");
        g.heroName="bad\nname";boolean rejected=false;try{round(g);}catch(IOException expected){rejected=true;}check(rejected,"Corrupt profile text is rejected rather than reaching the UI");
        g=town();g.math.solved=5;rejected=false;try{round(g);}catch(IOException expected){rejected=true;}check(rejected,"Impossible mathematical progression is rejected on load");
        g=town();g.x=Town.NPCS[4].x;g.y=Town.NPCS[4].y;g.story.interact(g);g.story.dialogue.page=1;g.story.dialogue.revealed=true;g.story.choose(g,0);check(g.inTown()&&g.x==1080&&g.y==660,"Interaction key reaches scholar guidance and the east-courtyard destination");
        for(int[] size:new int[][]{{1920,1080},{2400,1080},{3440,1440},{1600,1200}}){g=garden();Viewport v=new Viewport();v.set(size[0],size[1],50,0,20,15);c=new Controls();c.layout=v;c.down(g,0,850+v.right,245+v.top);check(g.mode==MathJourney.MAP,"Math map touch follows the safe viewport at "+size[0]);c.back(g);g.math.circle=1;c.down(g,0,800+v.right,350+v.bottom);check(g.math.circle==0,"Math retry touch follows the bottom anchor at "+size[0]);}
        Game profile=new Game();profile.startDream();profile.setHeroName("测试旅者");profile.effectsLevel=1;
        profile.math.active=true;profile.math.failed=true;profile.math.level=2;profile.math.solved=3;profile.math.circle=5;profile.math.bridges=9;profile.math.node=3;profile.math.edge=2;profile.math.orientation=1;profile.math.ribbon=6;profile.math.seam=.2f;profile.math.offBand=.1f;profile.math.px=640;profile.math.py=480;
        profile.physics.active=true;profile.physics.failed=true;profile.physics.level=3;profile.physics.solved=7;profile.physics.px=510;profile.physics.py=420;profile.physics.targetHits=2;profile.physics.mirrorAngles=new int[]{10,20,30};
        profile.physics.wiresPlaced[0]=profile.physics.wiresPlaced[2]=profile.physics.wiresPlaced[6]=true;profile.physics.source1X=420;profile.physics.source1Y=500;profile.physics.source2X=900;profile.physics.source2Y=610;profile.physics.temperature[1][2]=55.5f;profile.physics.temperature[4][8]=12.25f;
        profile.physics.launchAngle=62;profile.physics.launchPower=73;profile.arsenal.forge[6]=2;
        ByteArrayOutputStream saved=new ByteArrayOutputStream();profile.save(saved);byte[] format8=saved.toByteArray();
        Game loaded=Game.load(new ByteArrayInputStream(format8));ByteArrayOutputStream again=new ByteArrayOutputStream();loaded.save(again);
        check(Arrays.equals(format8,again.toByteArray())&&loaded.heroName.equals("测试旅者")&&loaded.effectsLevel==1&&loaded.math.level==2&&loaded.math.solved==3&&loaded.math.circle==5&&loaded.math.bridges==9&&loaded.math.failed&&loaded.math.seam==.2f&&loaded.math.px==640&&loaded.physics.level==3&&loaded.physics.solved==7&&loaded.physics.targetHits==2&&loaded.physics.failed&&loaded.physics.mirrorAngles[0]==10&&loaded.physics.mirrorAngles[2]==30&&loaded.physics.wiresPlaced[6]&&loaded.physics.source1Y==500&&loaded.physics.temperature[1][2]==55.5f&&loaded.physics.temperature[4][8]==12.25f&&loaded.physics.launchAngle==62&&loaded.physics.launchPower==73&&loaded.arsenal.forge[6]==2,"Current save, load and save stay byte-identical for custom name, effects, launch setup and seven weapons");
        ByteArrayOutputStream physicsOut=new ByteArrayOutputStream();profile.physics.write(new DataOutputStream(physicsOut));byte[] physicsBytes=physicsOut.toByteArray();
        ByteArrayOutputStream arsenalOut=new ByteArrayOutputStream();profile.arsenal.write(new DataOutputStream(arsenalOut));byte[] arsenalBytes=arsenalOut.toByteArray();
        ByteArrayOutputStream oldArsenalOut=new ByteArrayOutputStream();profile.arsenal.write(new DataOutputStream(oldArsenalOut),false);byte[] oldArsenalBytes=oldArsenalOut.toByteArray();
        byte[] format6=LegacySaves.snapshot(profile,6);Game migrated=Game.load(new ByteArrayInputStream(format6));
        ByteArrayOutputStream freshPhysics=new ByteArrayOutputStream();new PhysicsJourney().write(new DataOutputStream(freshPhysics));
        ByteArrayOutputStream loadedPhysics=new ByteArrayOutputStream();migrated.physics.write(new DataOutputStream(loadedPhysics));
        check(format6[7]==6&&format6.length==format8.length-8-physicsBytes.length-(arsenalBytes.length-oldArsenalBytes.length)&&migrated.heroName.equals("测试旅者")&&migrated.effectsLevel==1&&migrated.math.active&&migrated.math.level==2&&migrated.math.solved==3&&migrated.math.circle==5&&migrated.math.ribbon==6&&migrated.math.node==3&&migrated.math.edge==2&&migrated.math.orientation==1&&migrated.math.offBand==.1f&&migrated.math.py==480&&migrated.physics.launchAngle==45&&migrated.physics.launchPower==50&&Arrays.equals(freshPhysics.toByteArray(),loadedPhysics.toByteArray()),"Format 6 drops physics, restores math, name and effects, and starts physics with default launch setup");
        Game graduate=new Game();graduate.startDream();graduate.physics.active=true;graduate.physics.level=4;graduate.physics.solved=31;
        byte[] format7=LegacySaves.snapshot(graduate,7);Game upgraded=Game.load(new ByteArrayInputStream(format7));
        check(format7[7]==7&&upgraded.physics.solved==31&&upgraded.physics.launchAngle==45&&upgraded.physics.launchPower==50&&upgraded.arsenal.forge[6]==0&&upgraded.arsenal.owned(Arsenal.RESONANCE_STAFF_PLUS),"Format 7 workshop graduates receive the reward weapon and default launch setup on migration");
        // Harder puzzle rules: ordered beacons, degree-gated start, phantom marks and seam budget.
        g=garden();walk(g,678,420);check(g.math.circle==0&&g.math.nextBeacon()==0,"Out-of-order beacon never lights");
        g.math.retry(g);walk(g,948,576);check(g.math.circle==1&&g.math.nextBeacon()==1,"First beacon advances the required order");
        g=garden();g.math.level=1;g.math.solved=1;g.math.resetState();close(g);
        g.x=1000;g.y=780;g.math.tick(g,1f/60);check(g.math.node==-1,"Even-degree node cannot start an Euler trail");
        g.x=460;g.y=780;g.math.tick(g,1f/60);check(g.math.node==0,"Odd-degree node opens the seven bridges");
        g=garden();g.math.level=2;g.math.solved=3;g.math.resetState();close(g);
        g.math.ribbon=1;g.x=700;g.y=700;g.math.tick(g,1f/60);check(g.math.ribbon==0,"Phantom marker clears recorded marks");
        g.math.resetState();g.math.ribbon=3;g.math.node=MathJourney.MAX_CROSSINGS;g.x=1180;g.y=600;g.math.tick(g,1f/60);
        check(g.math.ribbon==0&&g.math.crossings()==0,"Exceeding the seam budget resets the ribbon");
        Capture mathCapture=new Capture();
        for(int lv=0;lv<3;lv++){
            Game t=garden();t.math.level=lv;t.math.solved=lv==0?0:lv==1?1:3;t.math.resetState();
            new Scene().draw(mathCapture,t,1);
        }
        check(mathCapture.words.contains("r = 180")&&mathCapture.words.contains("欧拉路径 · 奇数度顶点只能有 0 或 2 个"),"All three themed math scenes render without throwing");
        g=garden();g.math.level=2;g.math.solved=3;g.math.resetState();g.math.node=4;g.math.ribbon=5;
        restored=round(g);check(restored.math.crossings()==4&&restored.math.ribbon==5,"Reused save fields survive a round trip");
        System.out.println("ALL "+count+" MATHEMATICS AND V0.7 CHECKS PASSED");
    }
}
