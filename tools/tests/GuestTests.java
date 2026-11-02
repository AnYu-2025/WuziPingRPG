package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.*;

/** Hidden encounter behavior through real input, dialogue, town updates and save migration. */
public final class GuestTests {
    private static int count;
    private static void check(boolean v,String s){if(!v)throw new AssertionError(s);count++;System.out.println("PASS "+s);}
    private static void dialog(Game g,int choice){Story.Dialogue d=g.story.dialogue;if(d==null)throw new AssertionError("Missing dialogue");while(!d.last()){d.revealed=true;g.story.advance(g);}d.revealed=true;g.story.choose(g,choice);}
    private static void close(Game g){while(g.mode==Game.DIALOGUE)dialog(g,0);}
    private static Game fresh(){Game g=new Game();g.startDream();close(g);return g;}
    private static void nearby(Game g){g.x=g.guest.x-29;g.y=g.guest.y-4;}
    private static Game round(Game g)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();g.save(b);return Game.load(new ByteArrayInputStream(b.toByteArray()));}
    private static final class Capture implements Painter {
        final ArrayList<String> texts=new ArrayList<>();int guestImages=0;float minY=Float.MAX_VALUE,maxY=-1;
        public void rect(float x,float y,float w,float h,int color){}public void oval(float x,float y,float w,float h,int color){}public void line(float x,float y,float a,float b,float width,int color){}
        public void text(String s,float x,float y,float size,int color,int align){texts.add(s);}
        public void image(String name,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip){if(name.equals("nailong.png")){guestImages++;minY=Math.min(minY,y);maxY=Math.max(maxY,y+h);}}
        boolean mentionsGuest(){for(String s:texts)if(s.contains("奶龙"))return true;return false;}
    }
    public static void main(String[] args)throws Exception{
        Game g=fresh();check(!g.guest.discovered&&g.guest.stage==0,"New journey keeps hidden encounter undiscovered");
        Capture cap=new Capture();g.mode=Game.JOURNAL;new Scene().draw(cap,g,1);check(!cap.mentionsGuest(),"Journal gives no advance spoiler before discovery");g.mode=Game.PLAY;
        check(!g.story.interaction(g).contains("奶龙")&&!g.story.talk(g,TownGuest.NPC),"Town spawn gives neither remote talk nor hidden interaction marker");
        float initialX=g.guest.x,initialY=g.guest.y;boolean moved=false;float pathLength=0;
        for(int tick=0;tick<3600;tick++){float x=g.guest.x,y=g.guest.y;g.update(.05f,new Game.Input());pathLength+=Game.dist(x,y,g.guest.x,g.guest.y);if(Game.dist(initialX,initialY,g.guest.x,g.guest.y)>8)moved=true;if(Town.blocked(g.guest.x,g.guest.y,9))throw new AssertionError("Guest crossed a solid boundary");}
        check(moved&&pathLength>250,"Guest walks, pauses and loops autonomously for three virtual minutes");
        check(g.guest.x>=793&&g.guest.x<=873&&g.guest.y>=579&&g.guest.y<=646&&!g.guest.discovered,"Autonomous walk stays in its hidden corner without marking discovery");
        // Actual town collision-map reachability, not a visual-only placement.
        boolean[][] seen=new boolean[120][90];ArrayDeque<int[]> q=new ArrayDeque<>();q.add(new int[]{60,65});seen[60][65]=true;int[][] dirs={{1,0},{-1,0},{0,1},{0,-1}};
        while(!q.isEmpty()){int[] c=q.remove();for(int[] d:dirs){int x=c[0]+d[0],y=c[1]+d[1];if(x>=0&&y>=0&&x<120&&y<90&&!seen[x][y]&&!Town.blocked(x*8,y*8,6)){seen[x][y]=true;q.add(new int[]{x,y});}}}
        boolean reachable=false;for(int y=0;y<90;y++)for(int x=0;x<120;x++)if(seen[x][y]&&Game.dist(x*8,y*8,g.guest.x,g.guest.y)<32)reachable=true;
        check(reachable,"Hidden corner can be reached from town arrival through real collision map");
        nearby(g);float x=g.guest.x,y=g.guest.y;for(int i=0;i<60;i++)g.update(.05f,new Game.Input());check(g.guest.discovered&&g.guest.x==x&&g.guest.y==y,"Approach discovers guest and stops wandering for conversation");
        check(g.story.interaction(g).equals("交谈 · 奶龙"),"Shared interaction button recognizes hidden NPC in body campaign");
        int gold=g.gold;float hp=g.maxHp;Controls controls=new Controls();controls.key(g,"E",true);
        check(g.mode==Game.DIALOGUE&&g.story.dialogue.npc==TownGuest.NPC,"E opens actual named guest dialogue");
        g.story.choose(g,0);check(g.guest.stage==0&&g.gold==gold,"Unread dialogue cannot accept listening or grant rewards");
        for(int i=0;i<60;i++)g.update(.05f,new Game.Input());check(g.guest.x==x&&g.guest.y==y,"Guest position freezes while any dialogue is open");
        dialog(g,1);check(g.guest.stage==0&&g.gold==gold&&g.mode==Game.PLAY,"Leaving politely preserves encounter without reward or penalty");
        g.story.interact(g);dialog(g,0);check(g.guest.stage==1&&g.mode==Game.DIALOGUE&&g.gold==gold&&g.maxHp==hp,"Listening advances to heart-to-heart without prematurely awarding charm");
        controls.back(g);check(g.guest.stage==1&&g.mode==Game.PLAY,"Closing the second conversation retains the listening milestone");
        Game saved=round(g);saved.resume();check(saved.guest.stage==1&&saved.guest.discovered&&saved.guest.x==x&&saved.guest.y==y,"Restart preserves listening and exact roaming position");
        controls.key(saved,"E",true);check(saved.story.dialogue.text().contains("怕自己"),"Returning resumes the unfinished loneliness conversation");dialog(saved,1);
        check(saved.guest.stage==1&&saved.gold==gold,"Declining comfort leaves the friendship open for a later visit");
        saved.story.interact(saved);dialog(saved,0);
        check(saved.guest.stage==2&&saved.gold==gold+60&&saved.maxHp==hp+15&&saved.hp==hp+15,"Kind response awards exact 60 coins and warm-heart vitality charm");
        check(saved.mode==Game.DIALOGUE&&saved.story.dialogue.npc==TownGuest.NPC,"Reward includes a visible thank-you and item explanation");
        cap=new Capture();new Scene().draw(cap,saved,3);check(cap.guestImages>=1&&cap.texts.contains("奶龙"),"Guest dialogue renderer uses generated portrait without invalid NPC index");
        controls.back(saved);saved.story.interact(saved);close(saved);saved.guest.action(saved,202);
        check(saved.gold==gold+60&&saved.maxHp==hp+15,"Repeated talk and repeated action cannot duplicate friendship rewards");
        Game restored=round(saved);restored.resume();check(restored.guest.stage==2&&restored.gold==gold+60&&restored.maxHp==hp+15,"Reward ownership and exact stats persist together across restart");
        restored.story.interact(restored);close(restored);check(restored.gold==gold+60,"Post-restart friend conversation gives no duplicate gold");
        restored.mode=Game.JOURNAL;cap=new Capture();new Scene().draw(cap,restored,4);check(cap.mentionsGuest()&&cap.texts.contains(restored.guest.status()),"Journal reveals the discovered friend and acquired charm");restored.mode=Game.PLAY;
        // Both mobile interaction routes use world-to-screen coordinates of the moving guest.
        g=fresh();nearby(g);controls=new Controls();controls.down(g,1,847,429);check(g.mode==Game.DIALOGUE&&g.story.dialogue.npc==6,"Town touch interaction button opens hidden guest");controls.back(g);
        float cx=Game.clamp(g.x-240,0,Town.WIDTH-480),cy=Game.clamp(g.y-135,0,Town.HEIGHT-270);controls.down(g,2,(g.guest.x-cx)*2,(g.guest.y-cy)*2-26);
        check(g.mode==Game.DIALOGUE&&g.story.dialogue.npc==6,"Direct sprite tap tracks the guest's current world position");controls.back(g);
        g.x=480;g.y=520;int before=g.guest.stage;g.guest.action(g,201);check(g.guest.stage==before,"Out-of-range action cannot skip discovery or listening");
        x=g.guest.x;y=g.guest.y;g.pause();for(int i=0;i<100;i++)g.update(.05f,new Game.Input());check(g.guest.x==x&&g.guest.y==y,"Pause stops town guest movement");g.resume();
        g.body.briefed=true;g.body.enter(g);for(int i=0;i<100;i++)g.update(.05f,new Game.Input());check(g.guest.x==x&&g.guest.y==y,"Leaving town freezes guest patrol without resetting it");
        g.body.returnTown(g);for(int i=0;i<80;i++)g.update(.05f,new Game.Input());check(Game.dist(x,y,g.guest.x,g.guest.y)>1,"Returning to town resumes existing patrol");
        g=new Game();g.startAdventure();close(g);nearby(g);g.story.interact(g);dialog(g,0);dialog(g,0);close(g);
        check(g.guest.stage==2&&!g.body.enabled&&g.gold==60,"Legacy town campaign supports the same optional friend reward");
        g.story.enterForest(g); // chapter zero prevents forest entry; verify after explicit legacy preparation.
        g.story.chapter=2;g.story.enterForest(g);g.invuln=0;g.hurt(99999,"test");g.story.recover(g);
        check(g.guest.stage==2&&g.maxHp==115,"Legacy death recovery retains the charm and friendship");
        g.startDream();check(g.guest.stage==0&&!g.guest.discovered&&g.maxHp==100,"Confirmed new journey resets optional encounter and its per-journey stats");close(g);
        // Exact older wire formats: newly added guest section is absent, not merely ignored.
        g.body.briefed=true;g.body.enter(g);g.gold=79;g.body.supply[0]=3;ByteArrayOutputStream bytes=new ByteArrayOutputStream();g.save(bytes);byte[] v3=Arrays.copyOf(bytes.toByteArray(),bytes.size()-TownGuest.SAVE_BYTES);v3[7]=3;
        restored=Game.load(new ByteArrayInputStream(v3));check(restored.body.enabled&&restored.gold==79&&restored.body.supply[0]==3&&!restored.guest.discovered,"Exact v3 campaign migrates with original progress and fresh hidden guest");
        restored.body.returnTown(restored);nearby(restored);check(restored.story.talk(restored,6),"Migrated v3 save can meet the guest without restarting the journey");
        byte[] bad=Arrays.copyOf(bytes.toByteArray(),bytes.size()-1);boolean rejected=false;try{Game.load(new ByteArrayInputStream(bad));}catch(IOException ex){rejected=true;}check(rejected,"Truncated guest snapshot fails safely");
        ByteArrayOutputStream guestBytes=new ByteArrayOutputStream();g.guest.write(new DataOutputStream(guestBytes));check(guestBytes.size()==TownGuest.SAVE_BYTES,"Guest snapshot size matches migration fixture length");
        byte[] invalid=guestBytes.toByteArray();invalid[4]=3;rejected=false;try{TownGuest.read(new DataInputStream(new ByteArrayInputStream(invalid)));}catch(IOException ex){rejected=true;}check(rejected,"Invalid friendship milestone is rejected");
        g=new Game();g.guest.discovered=true;restored=round(g);check(!restored.activeRun&&restored.guest.discovered,"Inactive profile also round-trips its v4 guest section");
        System.out.println("ALL "+count+" GUEST CHECKS PASSED");
    }
}
