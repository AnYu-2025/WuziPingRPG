package cn.wuziping.ember;

import java.io.*;

/** Optional, unmarked town encounter. Discovery, listening and kindness are separate milestones. */
public final class TownGuest {
    public static final int NPC=6,SAVE_BYTES=26;
    private static final float[][] PATH={{836,616},{864,614},{840,588},{802,616},{839,637}};
    public float x=836,y=616,wait=.8f,walk=0;
    public int waypoint=1,stage=0;
    public boolean discovered=false,left=true,moving=false;
    public boolean near(Game g){return g.inTown()&&Game.dist(g.x,g.y,x,y)<43;}
    public String status(){return stage==2?"暖心护符 · 生命上限 +15":stage==1?"奶龙向你敞开心扉 · 仍需要陪伴":"与奶龙相遇 · 试着听它说说话";}
    public void tick(Game g,float dt){
        if(!g.inTown()||g.mode!=Game.PLAY)return;
        float distance=Game.dist(g.x,g.y,x,y);
        if(distance<62)discovered=true;
        moving=false;
        // A nearby visitor gets its full attention; the player never has to chase dialogue.
        if(distance<55)return;
        if(wait>0){wait=Math.max(0,wait-dt);return;}
        float dx=PATH[waypoint][0]-x,dy=PATH[waypoint][1]-y,d=(float)Math.sqrt(dx*dx+dy*dy);
        if(d<1){waypoint=(waypoint+1)%PATH.length;wait=1.4f;return;}
        float step=Math.min(d,12*dt),nx=x+dx/d*step,ny=y+dy/d*step;
        if(!Town.blocked(nx,ny,9)){x=nx;y=ny;left=dx<0;walk+=dt;moving=true;}
        else{waypoint=(waypoint+1)%PATH.length;wait=.4f;}
    }
    public boolean talk(Game g){
        if(g.mode!=Game.PLAY||!near(g))return false;
        discovered=true;moving=false;
        if(stage==0)g.story.begin(g,NPC,new String[]{
            "奶龙|咦……你看得见我？大家都从广场那边走，我还以为，这里永远不会有人来了。",
            "伍子平|我刚好走到这里。你一直一个人待着吗？",
            "奶龙|我走来走去，想找个能一起说话的人，又怕突然出现会打扰别人。你……愿意在这里待一会儿吗？"
        },new String[]{"我坐下来，听你说","我有点事，晚点再来"},new int[]{201,200});
        else if(stage==1)heartToHeart(g);
        else g.story.begin(g,NPC,new String[]{
            "奶龙|伍子平！我今天也在散步。现在听见脚步声，我会想：是不是朋友来看我了？",
            "伍子平|路过就来坐一会儿。今天有什么想告诉我的？",
            "奶龙|今天的风铃响了三次，花也开了一朵。我都记着，等你回来一起看。"
        },new String[]{"陪你看看花","下次再来找你"},new int[]{200,200});
        return true;
    }
    private void heartToHeart(Game g){
        g.story.begin(g,NPC,new String[]{
            "奶龙|其实，我不是不喜欢热闹。我只是怕自己笨笨的，说的话没有意思，大家听一会儿就会走。",
            "伍子平|原来你担心的是这个。我愿意听，慢慢说就好。",
            "奶龙|那你下次路过，还会来看我吗？不用带礼物，记得我在这里就好。"
        },new String[]{"你值得被惦记，我会来看你","我先赶路，回头再聊"},new int[]{202,200});
    }
    public void action(Game g,int action){
        if(!near(g))return;
        if(action==201&&stage==0){stage=1;heartToHeart(g);}
        else if(action==202&&stage==1){
            stage=2;g.gold+=60;g.maxHp+=15;g.hp=Math.min(g.maxHp,g.hp+15);
            g.announce("隐藏相遇完成 · 暖心护符 / 60 金币");
            if(g.sounds.size()<32)g.sounds.add("level");
            g.story.begin(g,NPC,new String[]{
                "奶龙|谢谢你愿意坐下来。原来有人认真听我说话，心里真的会暖起来。",
                "奶龙|这枚暖心护符送给你，还有我攒下的六十枚金币。带着它出发吧，累了就回来坐坐。",
                "旁白|你获得了「暖心护符」，本次旅程生命上限增加十五点。奶龙的脚步也轻快了些，安静的角落里多了一份等待。"
            },new String[]{"收下心意 · 我们是朋友了"},new int[]{200});
        }
    }
    public void write(DataOutputStream out)throws IOException{
        out.writeBoolean(discovered);out.writeInt(stage);out.writeFloat(x);out.writeFloat(y);out.writeFloat(wait);out.writeInt(waypoint);out.writeFloat(walk);out.writeBoolean(left);
    }
    public static TownGuest read(DataInputStream in)throws IOException{
        TownGuest n=new TownGuest();n.discovered=in.readBoolean();n.stage=in.readInt();n.x=in.readFloat();n.y=in.readFloat();n.wait=in.readFloat();n.waypoint=in.readInt();n.walk=in.readFloat();n.left=in.readBoolean();
        if(n.stage<0||n.stage>2||n.stage>0&&!n.discovered||!finite(n.x)||!finite(n.y)||!finite(n.wait)||!finite(n.walk)||n.wait<0||n.wait>2||n.walk<0||n.x<793||n.x>873||n.y<579||n.y>646||n.waypoint<0||n.waypoint>=PATH.length||Town.blocked(n.x,n.y,9))throw new IOException("Invalid hidden guest state");
        return n;
    }
    private static boolean finite(float f){return !Float.isNaN(f)&&!Float.isInfinite(f);}
}
