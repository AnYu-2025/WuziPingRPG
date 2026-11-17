import cn.wuziping.ember.*;
import java.io.*;

public class OpenWorldTest {
    static int pass=0,fail=0;
    static void check(boolean b,String name){if(b){pass++;System.out.println("PASS "+name);}else{fail++;System.out.println("FAIL "+name);}}
    public static void main(String[] a)throws Exception{
        Game g=new Game();
        g.startOpen();
        check(g.inOpen(),"startOpen enters open world");
        check(g.world.isDiscovered(OpenWorld.SOUTH),"south discovered on start");
        check(!g.world.blocked(1000,1520,6),"south plaza walkable");
        // 连通性 BFS：从南校广场到各城池中心与遗址
        int tw=OpenWorld.W/8,th=OpenWorld.H/8;
        boolean[] seen=new boolean[tw*th];
        java.util.ArrayDeque<int[]> q=new java.util.ArrayDeque<>();
        int sx=(int)(1000/8),sy=(int)(1520/8);
        q.add(new int[]{sx,sy});seen[sy*tw+sx]=true;
        int[] dx={1,-1,0,0},dy={0,0,1,-1};
        while(!q.isEmpty()){
            int[] c=q.poll();
            for(int k=0;k<4;k++){
                int nx=c[0]+dx[k],ny=c[1]+dy[k];
                if(nx<0||ny<0||nx>=tw||ny>=th)continue;
                if(seen[ny*tw+nx])continue;
                if(g.world.terrainBlocked(nx*8+4,ny*8+4,3))continue;
                seen[ny*tw+nx]=true;q.add(new int[]{nx,ny});
            }
        }
        for(OpenWorld.Region rg:OpenWorld.REGIONS){
            int rx=(int)(rg.x/8),ry=(int)(rg.y/8);
            check(seen[ry*tw+rx],"reachable "+rg.name);
        }
        // 营地刷怪：把玩家放到营地旁
        OpenWorld.Camp c0=OpenWorld.CAMPS[0];
        g.x=c0.x+60;g.y=c0.y;g.invuln=999;
        for(int i=0;i<200;i++){g.world.tick(g,0.05f);}
        int campEnemies=0;for(Game.Enemy e:g.enemies)if(e.campId==0)campEnemies++;
        check(campEnemies>0,"camp spawns masked enemies");
        check(campEnemies<=4,"camp cap respected");
        // 击杀结算
        Game.Enemy target=null;for(Game.Enemy e:g.enemies)if(e.campId==0){target=e;break;}
        int goldBefore=g.gold;
        g.damageEnemy(target,9999,false);
        check(g.gold>goldBefore,"camp kill grants gold");
        check(g.world.campProgress[0]>=1,"camp progress counted");
        // 剧情：接取 -> 交付
        OpenWorld.Npc n0=OpenWorld.NPCS[0];
        g.x=n0.x;g.y=n0.y+10;
        g.world.talk(g,n0);
        check(g.mode==Game.DIALOGUE,"npc talk opens dialogue");
        g.story.dialogue.revealed=true;
        while(!g.story.dialogue.last()){g.story.advance(g);g.story.dialogue.revealed=true;}
        g.story.choose(g,0); // accept
        check(g.world.stage[OpenWorld.SOUTH]==1,"quest accepted");
        // 凑够击杀再交付
        for(int i=0;i<6;i++)g.world.campProgress[0]++;
        g.world.talk(g,n0);
        g.story.dialogue.revealed=true;
        while(!g.story.dialogue.last()){g.story.advance(g);g.story.dialogue.revealed=true;}
        g.story.choose(g,0);
        check(g.world.stage[OpenWorld.SOUTH]==2,"quest delivered");
        // 存档往返
        ByteArrayOutputStream bo=new ByteArrayOutputStream();
        g.save(bo);
        Game g2=Game.load(new ByteArrayInputStream(bo.toByteArray()));
        check(g2.world.enabled,"save/load world enabled");
        check(g2.world.stage[OpenWorld.SOUTH]==2,"save/load quest stage");
        check(g2.world.discovered==g.world.discovered,"save/load discovered");
        check(Math.abs(g2.x-g.x)<1,"save/load position");
        // 旧版本兼容：v11 存档仍可读（world 默认）
        check(g2.inOpen(),"loaded run in open world");
        // 真·v11 非运行存档可读：复用 v12 非运行流，仅把版本号改回 11（world 块在尾部，旧读取器不读）
        Game g3=new Game();
        ByteArrayOutputStream b3=new ByteArrayOutputStream();
        g3.save(b3);
        byte[] raw=b3.toByteArray();
        raw[4]=0;raw[5]=0;raw[6]=0;raw[7]=11;
        Game g4=Game.load(new ByteArrayInputStream(raw));
        check(!g4.world.enabled,"v11 save loads with default world");
        System.out.println("RESULT pass="+pass+" fail="+fail);
        if(fail>0)System.exit(1);
    }
}