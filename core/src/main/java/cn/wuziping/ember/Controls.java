package cn.wuziping.ember;

/** Pointer/keyboard input shared by the Android app and desktop test harness. */
public final class Controls {
    public final Game.Input input=new Game.Input();
    public Viewport layout=new Viewport();
    private int movePointer=-1,attackPointer=-1,helpReturn=Game.TITLE,journalReturn=Game.TITLE,mapReturn=Game.PLAY;
    private boolean left,right,up,down,keyAttack;
    public boolean dirty=false;
    public void clear(){movePointer=attackPointer=-1;left=right=up=down=keyAttack=false;input.mx=input.my=0;input.attack=input.skill=input.dash=input.potion=input.ultimate=false;}
    public void down(Game g,int pointer,float x,float y){
        dirty=true;
        if(g.mode!=Game.PLAY){x-=layout.centerX;y-=layout.centerY;}
        if(g.mode==Arsenal.MENU){
            if(box(x,y,340,444,280,40)){g.mode=Game.PLAY;clear();return;}
            for(int i=0;i<6;i++){float a=120+(i%3)*240,b=146+(i/3)*132;if(box(x,y,a+10,b+76,96,31))g.arsenal.equip(g,i);else if(box(x,y,a+116,b+76,96,31))g.arsenal.upgrade(g,i);}return;
        }
        if(g.mode==Game.DIALOGUE){
            Story.Dialogue d=g.story.dialogue;if(d==null){g.mode=Game.PLAY;return;}
            if(d.complete()&&d.last()){
                int count=d.options.length;float width=count==1?570:277;
                for(int i=0;i<count;i++)if(box(x,y,232+i*293,454,width,39)){g.story.choose(g,i);clear();return;}
            }
            if(box(x,y,76,310,808,212))g.story.advance(g);return;
        }
        if(g.mode==Game.TITLE){
            if(box(x,y,588,454,292,31)){g.renamePending=true;return;}
            if(box(x,y,62,273,278,53)){if(g.activeRun)g.resume();else g.startDream();clear();}
            else if(box(x,y,62,340,278,43)){if(g.activeRun)g.mode=8;else{helpReturn=Game.TITLE;g.mode=Game.HELP;}clear();}
            else if(box(x,y,62,416,330,55)){journalReturn=Game.TITLE;g.mode=Game.JOURNAL;}
            return;
        }
        if(g.mode==8){if(box(x,y,310,294,340,46)){g.startDream();clear();}else if(box(x,y,310,355,340,40))g.mode=Game.TITLE;return;}
        if(g.mode==BodyJourney.MAP){if(box(x,y,340,450,280,38)){g.mode=mapReturn;clear();}return;}
        if(g.mode==MathJourney.MAP){
            if(box(x,y,340,455,280,37)){g.mode=mapReturn;clear();return;}
            if(box(x,y,145,365,290,42)||box(x,y,525,365,290,42)){
                if(!g.inTown()){g.mode=mapReturn;g.announce("先回中山大学，再切换主题");}
                else if(x>500)g.math.enter(g);
                else if(!g.body.enabled){g.mode=Game.PLAY;g.announce("旧森林旅程保留中；新开远征可体验身体主题");}
                else if(g.body.briefed&&g.body.cured!=BodyJourney.ALL)g.body.enter(g);
                else{g.math.active=false;g.mode=Game.PLAY;g.announce(g.body.cured==BodyJourney.ALL?"体内八境已净化，可在札记回看":"先与沈砚交谈，领取体内远征任务");}
                clear();
            }return;
        }
        if(g.mode==Game.JOURNAL){if(box(x,y,340,444,280,40)){g.mode=journalReturn;clear();}return;}
        if(g.mode==Game.HELP){if(box(x,y,340,432,280,42)){g.mode=helpReturn;clear();}return;}
        if(g.mode==Game.UPGRADE){for(int i=0;i<3;i++)if(box(x,y,120+i*246,181,228,240)){g.choose(i);clear();return;}return;}
        if(g.mode==Game.PAUSE){
            /* 点面板之外的任何空白处都视为继续旅程，避免玩家被困在菜单里。 */
            if(!box(x,y,304,66,352,435)){g.resume();clear();return;}
            if(box(x,y,340,181,280,46)){g.resume();clear();}
            else if(box(x,y,340,240,280,40)){helpReturn=Game.PAUSE;g.mode=Game.HELP;}
            else if(box(x,y,340,293,134,40))g.sound=!g.sound;
            else if(box(x,y,486,293,134,40))g.effectsLevel=1-g.effectsLevel;
            else if(box(x,y,340,346,280,40)){if(g.story.enabled&&!g.inTown())g.story.enterTown(g);else g.resume();clear();}
            else if(box(x,y,340,399,280,40)){g.title();clear();}
            return;
        }
        if(g.mode==Game.DEAD||g.mode==Game.VICTORY){if(box(x,y,310,350,340,46)){if(g.math.failed)g.math.recover(g);else if(g.story.enabled){if(g.story.defeated)g.story.recover(g);else g.story.enterTown(g);}else g.startRun();clear();}else if(box(x,y,310,410,340,36))g.title();return;}
        if(g.mode!=Game.PLAY)return;
        float rx=x-layout.right,ty=y-layout.top,by=y-layout.bottom,cx=x-layout.centerX,cy=y-layout.centerY;
        if(g.body.enabled&&box(x-layout.left,ty,207,226,66,38)){g.mode=Arsenal.MENU;clear();return;}
        if((g.body.enabled||g.inMath()||g.inTown())&&box(rx,ty,813,226,127,g.inBody()?174:37)){mapReturn=Game.PLAY;g.mode=g.inBody()?BodyJourney.MAP:MathJourney.MAP;clear();return;}
        if(g.inMath()&&box(rx,by,741,337,132,31)){g.math.retry(g);clear();return;}
        if(box(rx,ty,862,19,78,38)){g.pause();clear();return;}
        if(box(rx,ty,716,19,58,38)||box(x-layout.left,ty,18,107,286,83)){journalReturn=Game.PLAY;g.mode=Game.JOURNAL;clear();return;}
        if(box(rx,ty,780,19,76,38)){g.autoAttack=!g.autoAttack;return;}
        if(x-layout.left<350&&by>300&&movePointer==-1){movePointer=pointer;move(g,pointer,x,y);}
        else if((g.inTown()||g.inMath())&&circle(rx,by,847,429,57)){g.story.interact(g);clear();}
        else if(g.inMath())return;
        else if(g.inTown()){
            float camX=Game.clamp(g.x-layout.width/4,0,Math.max(0,Town.WIDTH-layout.width/2)),camY=Game.clamp(g.y-layout.height/4,0,Math.max(0,Town.HEIGHT-layout.height/2));
            if(circle(x,y,(g.guest.x-camX)*2,(g.guest.y-camY)*2-26,32)){if(g.guest.near(g))g.story.talk(g,TownGuest.NPC);clear();return;}
            for(Town.Npc n:Town.NPCS)if(circle(x,y,(n.x-camX)*2,(n.y-camY)*2-18,30)){if(!g.story.talk(g,n.id))g.announce("再靠近"+n.name+"一些，就可以交谈。");clear();break;}
        }
        else if(g.story.enabled&&box(cx,cy,g.inBody()?348:371,281,g.inBody()?264:218,34)&&!g.story.interaction(g).isEmpty()){g.story.interact(g);clear();}
        else if(g.inBody()){
            if(circle(rx,by,645,330,31)){input.ultimate=true;return;}
            if(circle(rx,by,866,462,49)){attackPointer=pointer;input.attack=true;}
            else if(circle(rx,by,768,470,41))input.skill=true;
            else if(circle(rx,by,770,362,36))input.dash=true;
            else if(circle(rx,by,700,414,31))input.potion=true;
        }
        else if(circle(rx,by,866,428,55)){attackPointer=pointer;input.attack=true;}
        else if(circle(rx,by,764,449,44))input.skill=true;
        else if(circle(rx,by,860,330,38))input.dash=true;
        else if(circle(rx,by,748,345,33))input.potion=true;
    }
    public void move(Game g,int pointer,float x,float y){
        if(g.mode!=Game.PLAY)return;
        if(pointer==movePointer){float dx=(x-layout.left-92)/54,dy=(y-layout.bottom-435)/54,n=(float)Math.sqrt(dx*dx+dy*dy);if(n>.12){input.mx=dx/Math.max(1,n);input.my=dy/Math.max(1,n);}else input.mx=input.my=0;}
    }
    public void up(int pointer){if(pointer==movePointer){movePointer=-1;input.mx=input.my=0;}if(pointer==attackPointer){attackPointer=-1;input.attack=keyAttack;}}
    public void pulsesConsumed(){input.skill=input.dash=input.potion=input.ultimate=false;}
    public void back(Game g){
        dirty=true;clear();
        if(g.mode==Game.PLAY)g.pause();else if(g.mode==Game.PAUSE)g.resume();else if(g.mode==Game.HELP)g.mode=helpReturn;else if(g.mode==Game.JOURNAL)g.mode=journalReturn;else if(g.mode==BodyJourney.MAP||g.mode==MathJourney.MAP)g.mode=mapReturn;else if(g.mode==Arsenal.MENU)g.mode=Game.PLAY;else if(g.mode==8)g.title();else if(g.mode==Game.DIALOGUE){g.story.dialogue=null;g.mode=Game.PLAY;}
    }
    public void key(Game g,String key,boolean pressed){
        if("ESCAPE".equals(key)){if(pressed)back(g);return;}
        if(g.mode==Game.DIALOGUE&&pressed){dirty=true;Story.Dialogue d=g.story.dialogue;if(d!=null){if("1".equals(key))g.story.choose(g,0);else if("2".equals(key))g.story.choose(g,1);else if("E".equals(key)||"ENTER".equals(key)||"SPACE".equals(key)){if(d.complete()&&d.last())g.story.choose(g,0);else g.story.advance(g);}}clear();return;}
        if(g.mode==Game.UPGRADE&&pressed){if("1".equals(key))g.choose(0);if("2".equals(key))g.choose(1);if("3".equals(key))g.choose(2);clear();return;}
        if(g.mode!=Game.PLAY)return;
        if(pressed&&"B".equals(key)&&g.body.enabled){g.mode=Arsenal.MENU;dirty=true;clear();return;}
        if(pressed&&"Q".equals(key)&&g.body.enabled){for(int i=1;i<=6;i++){int next=(g.arsenal.selected+i)%6;if(g.arsenal.owned(next)){g.arsenal.equip(g,next);break;}}dirty=true;return;}
        if(pressed&&"R".equals(key))input.ultimate=true;
        if(pressed&&("M".equals(key)||"N".equals(key))&&g.story.enabled){mapReturn=Game.PLAY;g.mode=g.inBody()&&!"N".equals(key)?BodyJourney.MAP:MathJourney.MAP;dirty=true;clear();return;}
        if(pressed&&"T".equals(key)&&g.inMath()){g.math.retry(g);dirty=true;clear();return;}
        if(pressed&&"E".equals(key)){g.story.interact(g);dirty=true;clear();return;}
        if(pressed&&"L".equals(key)){journalReturn=Game.PLAY;g.mode=Game.JOURNAL;dirty=true;clear();return;}
        if("A".equals(key)||"LEFT".equals(key))left=pressed;if("D".equals(key)||"RIGHT".equals(key))right=pressed;
        if("W".equals(key)||"UP".equals(key))up=pressed;if("S".equals(key)||"DOWN".equals(key))down=pressed;
        input.mx=(right?1:0)-(left?1:0);input.my=(down?1:0)-(up?1:0);
        if("J".equals(key)||"SPACE".equals(key)){keyAttack=pressed;input.attack=pressed||attackPointer!=-1;}
        if(pressed){if("K".equals(key))input.skill=true;if("SHIFT".equals(key))input.dash=true;if("H".equals(key))input.potion=true;}
    }
    private boolean box(float x,float y,float a,float b,float w,float h){return x>=a&&x<=a+w&&y>=b&&y<=b+h;}
    private boolean circle(float x,float y,float a,float b,float r){return Game.dist(x,y,a,b)<r;}
}
