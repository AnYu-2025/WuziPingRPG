package cn.wuziping.ember;

import java.io.*;
import java.util.*;

/** Platform independent simulation. Coordinates are world pixels, time is seconds. */
public final class Game {
    public static final int TITLE=0, PLAY=1, UPGRADE=2, PAUSE=3, DEAD=4, VICTORY=5, HELP=6, JOURNAL=7, DIALOGUE=9;
    public static final int WORLD_W=1280, WORLD_H=960, FINAL_WAVE=5;
    public static final String HERO="伍子平";
    public int mode=TITLE, wave=1, level=1, xp=0, kills=0, gold=0, potions=3;
    public int waveSpawned=0, waveKilled=0, totalRuns=0, bestWave=0, lifetimeKills=0, bank=0;
    public float x=640, y=510, hp=100, maxHp=100, attack=16, speed=65, attackDelay=.43f;
    public float attackCd=0, skillCd=0, dashCd=0, potionCd=0, invuln=0, elapsed=0, facing=0;
    public float swing=0, skillFlash=0, dashTime=0, dashX=1, dashY=0, spawnTimer=1, intermission=0, banner=0;
    public String bannerText="", lastCause="";
    public boolean activeRun=false, sound=true, autoAttack=false;
    public int pendingUpgrades=0;
    public final int[] upgrades=new int[8], choices=new int[3];
    public final ArrayList<Enemy> enemies=new ArrayList<>();
    public final ArrayList<Drop> drops=new ArrayList<>();
    public final ArrayList<Shot> shots=new ArrayList<>();
    public final ArrayList<Effect> effects=new ArrayList<>();
    public final ArrayList<Obstacle> obstacles=new ArrayList<>();
    public final ArrayDeque<String> sounds=new ArrayDeque<>();
    public Story story=new Story();
    public BodyJourney body=new BodyJourney();
    public TownGuest guest=new TownGuest();
    public Arsenal arsenal=new Arsenal();
    public MathJourney math=new MathJourney();
    public PhysicsJourney physics=new PhysicsJourney();
    public HistoryJourney history=new HistoryJourney();
    public String heroName=HERO;public boolean renamePending=false;public int effectsLevel=1;
    /** True while the game runs embedded behind the 天工 editor (show editor-return hints). */
    public boolean editorHost=false;
    public final Vfx vfx=new Vfx();
    private final BodyNavigation bodyNavigation=new BodyNavigation();
    private final ArrayList<Enemy> enemySnapshot=new ArrayList<>();
    private long rng=710221L;
    public static final String[] UPGRADE_NAMES={"淬火之刃","旅者体魄","疾风步履","连击心得","星火共鸣","拾光之环","破绽洞察","生命余烬"};
    public static final String[] UPGRADE_DESC={"攻击力 +5","生命上限 +25，并恢复 35","移动速度 +8%","普攻间隔缩短 10%","星火斩伤害与范围提高","经验拾取范围 +16","暴击概率 +8%","每次击败敌人恢复 2 点生命"};
    public static final String[] WAVE_NAMES={"苔原初遇","林间暗影","失落哨站","长夜将至","遗迹守卫"};

    public static final class Input {
        public float mx,my; public boolean attack,skill,dash,potion,ultimate;
    }
    public static final class Enemy {
        public int type,id; public float x,y,hp,maxHp,cd=1,hit=0,windup=0,targetX,targetY,knockX,knockY;
        public boolean bossAttack=false;
        public Enemy(int t,int i,float a,float b,float h){type=t;id=i;x=a;y=b;hp=maxHp=h;}
        public float radius(){return type==4?17:(type==2?10:7);}
    }
    public static final class Drop { public float x,y; public int type,value; public Drop(float a,float b,int t,int v){x=a;y=b;type=t;value=v;} }
    public static final class Shot { public float x,y,vx,vy,life; public int damage; public Shot(float a,float b,float c,float d,int hit){x=a;y=b;vx=c;vy=d;life=5;damage=hit;} }
    public static final class Effect { public float x,y,time,max; public int color; public String text; public Effect(float a,float b,String t,int c,float life){x=a;y=b;text=t;color=c;time=max=life;} }
    public static final class Obstacle {public float x,y,r;public int kind;public Obstacle(float a,float b,float c,int k){x=a;y=b;r=c;kind=k;} }

    public Game(){buildWorld();}
    private void buildWorld(){
        long old=rng; rng=80421;
        for(int i=0;i<240;i++){
            float a=24+rand()*(WORLD_W-48), b=24+rand()*(WORLD_H-48);
            if(Math.abs(a-640)<45 || Math.abs(b-480)<25 || dist(a,b,640,510)<95) continue;
            obstacles.add(new Obstacle(a,b,rand()<.76f?9:8,rand()<.76f?0:1));
        }
        rng=old;
    }
    public float rand(){rng^=rng<<13;rng^=rng>>>7;rng^=rng<<17;return (rng & 0x7fffffffL)/2147483648f;}
    public static float dist(float a,float b,float c,float d){float x=a-c,y=b-d;return (float)Math.sqrt(x*x+y*y);}
    public static float clamp(float v,float a,float b){return Math.max(a,Math.min(b,v));}
    public int requiredXp(){return 9+(level-1)*6;}
    public int waveTarget(){return body.enabled?BodyJourney.TARGETS[body.organ]:wave==5?7:5+wave*3;}
    public boolean hasSave(){return activeRun;}
    public void startRun(){
        story=new Story();body=new BodyJourney();guest=new TownGuest();arsenal=new Arsenal();math=new MathJourney();physics=new PhysicsJourney();history=new HistoryJourney();
        mode=PLAY;activeRun=true;wave=level=1;xp=kills=gold=waveSpawned=waveKilled=pendingUpgrades=0;potions=3;
        x=640;y=510;hp=maxHp=100;attack=16;speed=65;attackDelay=.43f;facing=0;
        elapsed=attackCd=skillCd=dashCd=potionCd=invuln=swing=skillFlash=dashTime=intermission=0;
        spawnTimer=1.3f;Arrays.fill(upgrades,0);enemies.clear();drops.clear();shots.clear();effects.clear();sounds.clear();vfx.clear();
        rng=System.nanoTime()|1;totalRuns++;announce("第一波 · 苔原初遇");
    }
    public void startAdventure(){startRun();story.enabled=true;story.area=Story.TOWN;x=480;y=520;banner=0;story.opening(this);}
    public void startDream(){startRun();body.enabled=true;story.enabled=true;story.area=Story.TOWN;x=480;y=520;banner=0;body.opening(this);}
    public boolean inTown(){return story.enabled&&story.area==Story.TOWN;}
    public boolean inHistory(){return history.active()&&!inTown();}
    public boolean inBody(){return body.enabled&&!inTown()&&!math.active&&!physics.active&&!inHistory();}
    public boolean inMath(){return math.active&&!inTown()&&!physics.active&&!inHistory();}
    public boolean inPhysics(){return physics.active&&!inTown()&&!inHistory();}
    public int worldWidth(){return inTown()?Town.WIDTH:inPhysics()?PhysicsJourney.WIDTH:inMath()?MathJourney.WIDTH:WORLD_W;}
    public int worldHeight(){return inTown()?Town.HEIGHT:inPhysics()?PhysicsJourney.HEIGHT:inMath()?MathJourney.HEIGHT:WORLD_H;}
    public void resume(){if(activeRun){if(history.failed()){mode=DEAD;return;}if(inHistory()){mode=pendingUpgrades>0?UPGRADE:PLAY;return;}if(physics.failed){physics.recover(this);return;}if(physics.active){mode=pendingUpgrades>0?UPGRADE:PLAY;return;}if(math.failed){math.recover(this);return;}if(math.active){mode=pendingUpgrades>0?UPGRADE:PLAY;return;}if(body.enabled){body.resume(this);return;}if(story.defeated){story.recover(this);return;}if(story.enabled&&story.battleWon&&!inTown()){story.enterTown(this);return;}mode=pendingUpgrades>0?UPGRADE:PLAY;}}
    public void pause(){if(mode==PLAY)mode=PAUSE;}
    public void title(){if(inHistory())history.exit(this);mode=TITLE;}
    public void announce(String s){bannerText=s;banner=3;}
    private void sound(String s){if(sounds.size()<32)sounds.add(s);}
    public void update(float dt,Input in){
        dt=clamp(dt,0,.05f);
        if(mode==DIALOGUE){story.tick(dt);return;}
        if(mode!=PLAY)return;
        if(inHistory()&&pendingUpgrades>0){mode=UPGRADE;return;}
        if(!inTown())elapsed+=dt;banner=Math.max(0,banner-dt);vfx.tick(dt);
        float norm=(float)Math.sqrt(in.mx*in.mx+in.my*in.my), mx=in.mx,my=in.my;
        if(norm>1){mx/=norm;my/=norm;}
        if(norm>.1)facing=(float)Math.atan2(my,mx);
        if(inTown()){move(mx*speed*1.2f*dt,my*speed*1.2f*dt);guest.tick(this,dt);return;}
        if(inMath()){
            invuln=Math.max(0,invuln-dt);dashCd=Math.max(0,dashCd-dt);move(mx*speed*dt,my*speed*dt);math.tick(this,dt);return;
        }
        if(inPhysics()){
            // Puzzle interactions consume one attack pulse each; without this the whole
            // workshop was unreachable because swing was never set outside combat.
            invuln=Math.max(0,invuln-dt);dashCd=Math.max(0,dashCd-dt);
            attackCd=Math.max(0,attackCd-dt);swing=Math.max(0,swing-dt);
            if(in.attack&&attackCd<=0){attackCd=attackDelay;swing=.2f;sound("slash");}
            move(mx*speed*dt,my*speed*dt);physics.tick(this,dt);return;
        }
        if(inBody()){body.tick(this,dt);arsenal.tick(this,dt);if(in.ultimate)arsenal.ultimate(this);}
        else if(inHistory())arsenal.tick(this,dt);
        attackCd=Math.max(0,attackCd-dt);skillCd=Math.max(0,skillCd-dt);dashCd=Math.max(0,dashCd-dt);
        potionCd=Math.max(0,potionCd-dt);invuln=Math.max(0,invuln-dt);swing=Math.max(0,swing-dt);skillFlash=Math.max(0,skillFlash-dt);
        for(int i=effects.size()-1;i>=0;i--){Effect e=effects.get(i);e.time-=dt;e.y-=dt*8;if(e.time<=0)effects.remove(i);}
        if(in.dash && dashCd<=0){
            dashX=norm>.1?mx:(float)Math.cos(facing);dashY=norm>.1?my:(float)Math.sin(facing);
            dashTime=.18f;dashCd=2.6f;invuln=.38f;sound("dash");vfx.burst(x,y,0xff9fd8cc,7,46,.26f,2.6f);
        }
        if(dashTime>0){dashTime-=dt;move(dashX*240*dt,dashY*240*dt);vfx.trail(x,y);}
        else move(mx*speed*dt,my*speed*dt);
        if(in.potion && potionCd<=0 && potions>0 && hp<maxHp){potions--;hp=Math.min(maxHp,hp+maxHp*.5f);potionCd=3;sound("heal");popup(x,y-20,"+生命",0xff91e3a0);vfx.ring(x,y,0xff91e3a0,14,42);vfx.burst(x,y-8,0xffb6f0c4,8,28,.4f,3);}
        if((in.attack||autoAttack)&&attackCd<=0)slash();
        if(in.skill&&skillCd<=0)castSkill();
        if(mode!=PLAY)return;
        updateEnemies(dt);
        if(mode!=PLAY)return;
        updateShots(dt);collect(dt);
        if(mode!=PLAY)return;
        if(inHistory()){history.update(this);return;}
        if(story.enabled&&story.battleWon)return;
        if(body.enabled){
            if(body.cleared())return;
            if(waveSpawned<waveTarget()){spawnTimer-=dt;if(spawnTimer<=0){spawnNext();spawnTimer=Math.max(.42f,1.2f-body.organ*.10f);}}
            else if(enemies.isEmpty())body.clear(this);
            return;
        }
        if(intermission>0){intermission-=dt;if(intermission<=0){wave++;waveSpawned=waveKilled=0;spawnTimer=1;announce("第 "+wave+" 波 · "+WAVE_NAMES[wave-1]);if(wave==5)sound("boss");}}
        else if(waveSpawned<waveTarget()){
            spawnTimer-=dt;
            if(spawnTimer<=0){spawnNext();spawnTimer=Math.max(.6f,1.65f-wave*.15f);}
        } else if(enemies.isEmpty()){
            if(wave==FINAL_WAVE){finish(true);}
            else {intermission=4;hp=Math.min(maxHp,hp+15);potions=Math.min(5,potions+1);gold+=15;announce("区域净化 · 恢复生命，补给药剂");sound("level");}
        }
    }
    private void move(float dx,float dy){
        float nx=clamp(x+dx,18,worldWidth()-18),ny=clamp(y+dy,18,worldHeight()-18);
        if(!blocked(nx,y,6))x=nx;if(!blocked(x,ny,6))y=ny;
    }
    public boolean blocked(float a,float b,float r){if(inTown())return Town.blocked(a,b,r);if(inPhysics())return physics.blocked(a,b,r);if(inMath())return math.blocked(a,b,r);if(inHistory())return false;if(inBody())return BodyJourney.blocked(body.organ,a,b,r);for(Obstacle o:obstacles)if(dist(a,b,o.x,o.y)<r+o.r)return true;return false;}
    private void spawnNext(){
        int type;
        if(body.enabled)type=body.enemyType(this);
        else if(wave==5 && waveSpawned==0)type=4;
        else {float f=rand();type=wave==1?0:(f<.35?0:f<.65?1:f<.85?2:3);}
        float a=x,b=y;boolean valid=false;
        for(int n=0;n<40;n++){
            double ang=rand()*Math.PI*2;float radius=155+rand()*65;
            a=clamp(x+(float)Math.cos(ang)*radius,24,WORLD_W-24);b=clamp(y+(float)Math.sin(ang)*radius,24,WORLD_H-24);
            if(!blocked(a,b,type==4?18:12)&&dist(a,b,x,y)>90){valid=true;break;}
        }
        if(!valid)return;
        spawnEnemy(type,a,b);waveSpawned++;
    }
    public void spawnEnemy(int type,float a,float b){
        float base=type==4?(inBody()?(230+body.organ*45)*1.65f:600):type==2?75:type==3?42:type==1?22:30;
        enemies.add(new Enemy(type,kills+waveSpawned+enemies.size()+1,a,b,base*(1+(wave-1)*.13f)*(inBody()&&type!=4?1.35f:1)));
    }
    public void slash(){
        if(inTown()||inMath())return;
        if(inBody()||inHistory()){arsenal.attack(this);sound("slash");return;}
        attackCd=attackDelay;swing=.2f;sound("slash");
        Enemy nearest=null;float best=58;
        for(Enemy e:enemies){float d=dist(x,y,e.x,e.y);if(d<best){best=d;nearest=e;}}
        if(nearest!=null)facing=(float)Math.atan2(nearest.y-y,nearest.x-x);
        vfx.arc(x,y,facing,2.15f,0xffe8c98a,11);vfx.kick(1.1f);
        for(int i=enemies.size()-1;i>=0;i--){
            Enemy e=enemies.get(i);float d=dist(x,y,e.x,e.y);
            float dot=d<.01f?1:((e.x-x)*(float)Math.cos(facing)+(e.y-y)*(float)Math.sin(facing))/d;
            if(d<39+e.radius()&&dot>-.15f){boolean crit=rand()<.08f+.08f*upgrades[6];damageEnemy(e,attack*(crit?1.8f:1),crit);}
        }
    }
    public void castSkill(){
        if(inTown()||inMath())return;
        if(inBody()||inHistory()){arsenal.skill(this);sound("skill");return;}
        skillCd=Math.max(4,8-upgrades[4]*.35f);skillFlash=.48f;sound("skill");vfx.ring(x,y,0xfff2c77c,20,78);vfx.kick(3.2f);
        float radius=68+upgrades[4]*9;
        for(int i=enemies.size()-1;i>=0;i--){Enemy e=enemies.get(i);if(dist(x,y,e.x,e.y)<radius+e.radius())damageEnemy(e,attack*(2.5f+upgrades[4]*.35f),true);}
    }
    public void damageEnemy(Enemy e,float damage,boolean crit){
        if(e.hp<=0)return;
        e.hp-=damage;e.hit=.15f;float d=Math.max(1,dist(x,y,e.x,e.y));e.knockX=(e.x-x)/d*70;e.knockY=(e.y-y)/d*70;
        popup(e.x,e.y-18,""+(int)damage,crit?0xffffd37a:0xfff9f2db);
        vfx.burst(e.x,e.y-6,crit?0xffffd37a:0xfff4e2c2,crit?14:7,crit?72:48,crit?.5f:.32f,crit?4.2f:2.8f);vfx.kick(crit?3.4f:1.35f);
        if(e.hp<=0){
            enemies.remove(e);kills++;if(e.id>=0&&!inHistory())waveKilled++;
            if(inHistory()){gainXp(e.type==4?24:6);sound("kill");return;}if(inBody())arsenal.energy=Math.min(100,arsenal.energy+8);gold+=e.type==4?100:e.type==2?5:2;
            drops.add(new Drop(e.x,e.y,0,e.type==4?30:e.type==2?6:3));
            drops.add(new Drop(e.x+7,e.y,1,e.type==4?50:1));
            if(rand()<.1)drops.add(new Drop(e.x-7,e.y,2,12));
            if(upgrades[7]>0)hp=Math.min(maxHp,hp+2*upgrades[7]);
            if(inBody())body.onKill(this);sound("kill");
        }else sound("hit");
    }
    public void hurt(float damage,String cause){
        if(invuln>0||mode!=PLAY||inTown())return;
        if(inBody())damage*=1.25f;if(inBody()&&arsenal.shield>0)damage*=.45f;hp=Math.max(0,hp-damage);invuln=.7f;popup(x,y-23,"-"+(int)damage,0xffff8c7c);sound("hurt");
        vfx.burst(x,y-8,0xffff6d62,12,68,.38f,3.2f);vfx.kick(5.4f);flashHurt();
        if(hp<=0){lastCause=cause;finish(false);}
    }
    private void updateEnemies(float dt){
        if(inBody())bodyNavigation.prepare(this);
        enemySnapshot.clear();enemySnapshot.addAll(enemies);
        for(Enemy e:enemySnapshot){
            e.hit=Math.max(0,e.hit-dt);e.cd-=dt;
            float dx=x-e.x,dy=y-e.y,d=Math.max(.1f,dist(x,y,e.x,e.y));
            if(e.type==4&&inBody())Bosses.tick(this,e,dt);
            else if(e.type==4){
                if(e.windup>0){e.windup-=dt;if(e.windup<=0){
                    if(e.bossAttack){if(dist(x,y,e.targetX,e.targetY)<53)hurt(26,inBody()?"增殖核心的重击":"遗迹守卫的重击");}
                    else {for(int j=0;j<12;j++){double a=j*Math.PI/6;shots.add(new Shot(e.x,e.y,(float)Math.cos(a)*60,(float)Math.sin(a)*60,15));}}
                    e.cd=2.5f;
                }}else if(e.cd<=0){e.bossAttack=rand()<.65;e.windup=1;e.targetX=x;e.targetY=y;sound("warn");}
            }
            if(e.type==3 && e.cd<=0){shots.add(new Shot(e.x,e.y,dx/d*65,dy/d*65,10+wave));e.cd=2.3f;}
            float v=e.type==1?43:e.type==2?21:e.type==3?(d<100?-8:18):e.type==4?20:27;
            if(inBody())v*=e.type==1?1.3f:1.25f;if(e.windup>0)v=0;
            float moveX=dx/d,moveY=dy/d;
            if(inBody()&&v>0){bodyNavigation.direction(this,e);float length=Math.max(.1f,(float)Math.sqrt(bodyNavigation.dx*bodyNavigation.dx+bodyNavigation.dy*bodyNavigation.dy));moveX=bodyNavigation.dx/length;moveY=bodyNavigation.dy/length;}
            float nx=e.x+moveX*v*dt+e.knockX*dt,ny=e.y+moveY*v*dt+e.knockY*dt;
            e.knockX*=Math.max(0,1-9*dt);e.knockY*=Math.max(0,1-9*dt);
            // Soft separation prevents a stack of enemies from becoming one invisible damage source.
            for(Enemy other:enemies){if(other==e)continue;float sep=dist(e.x,e.y,other.x,other.y);if(sep>.1&&sep<e.radius()+other.radius()){nx+=(e.x-other.x)/sep*10*dt;ny+=(e.y-other.y)/sep*10*dt;}}
            // Local steering keeps a chasing enemy from waiting forever behind a tree.
            if(v>0&&blocked(nx,ny,e.radius()*.6f)){
                double base=Math.atan2(moveY,moveX);float sign=(e.id%2==0)?1:-1;
                for(int turn=1;turn<=6;turn++){
                    double angle=base+sign*((turn+1)/2)*.58*(turn%2==1?1:-1);
                    float ax=e.x+(float)Math.cos(angle)*v*dt,ay=e.y+(float)Math.sin(angle)*v*dt;
                    if(!blocked(ax,ay,e.radius()*.6f)){nx=ax;ny=ay;break;}
                }
            }
            if(!blocked(nx,e.y,e.radius()*.6f))e.x=clamp(nx,15,WORLD_W-15);
            if(!blocked(e.x,ny,e.radius()*.6f))e.y=clamp(ny,15,WORLD_H-15);
            if(dist(x,y,e.x,e.y)<e.radius()+7)hurt(e.type==4?22:e.type==2?16:8+wave,inBody()?(e.type==4?Bosses.name(this):BodyJourney.FOES[e.type]):e.type==4?"遗迹守卫":"迷雾中的魔物");
            if(mode!=PLAY)return;
        }
    }
    private void updateShots(float dt){
        for(int i=shots.size()-1;i>=0;i--){Shot s=shots.get(i);s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;
            boolean hit=dist(x,y,s.x,s.y)<10;
            if(hit)hurt(s.damage,inBody()?"异常细胞的增殖弹幕":"暗影弹幕");
            if(hit||s.life<=0||s.x<0||s.y<0||s.x>WORLD_W||s.y>WORLD_H)shots.remove(i);
        }
    }
    private void collect(float dt){
        int earned=0;float range=32+upgrades[5]*16;
        for(int i=drops.size()-1;i>=0;i--){Drop p=drops.get(i);float d=dist(x,y,p.x,p.y);
            if(d<12){if(p.type==0)earned+=p.value;else if(p.type==1)gold+=p.value;else{hp=Math.min(maxHp,hp+p.value);popup(x,y-18,"+"+p.value,0xff91e3a0);}vfx.burst(p.x,p.y,p.type==1?0xffe8c27a:p.type==2?0xff91e3a0:0xff9fd7c8,8,36,.4f,2.6f);drops.remove(i);sound("pickup");}
            else if(d<range){p.x+=(x-p.x)/d*145*dt;p.y+=(y-p.y)/d*145*dt;}
        }
        if(earned>0)gainXp(earned);
    }
    public void gainXp(int amount){
        xp+=amount;
        while(xp>=requiredXp()){xp-=requiredXp();level++;pendingUpgrades++;hp=Math.min(maxHp,hp+10);}
        if(pendingUpgrades>0){rollChoices();mode=UPGRADE;sound("level");}
    }
    private void rollChoices(){
        for(int i=0;i<3;i++){int c;boolean duplicate;do{c=(int)(rand()*8)%8;duplicate=false;for(int j=0;j<i;j++)if(choices[j]==c)duplicate=true;}while(duplicate);choices[i]=c;}
    }
    public void choose(int slot){
        if(mode!=UPGRADE||slot<0||slot>=3)return;
        int id=choices[slot];upgrades[id]++;
        if(id==0)attack+=5;else if(id==1){maxHp+=25;hp=Math.min(maxHp,hp+35);}else if(id==2)speed=Math.min(120,speed*1.08f);else if(id==3)attackDelay=Math.max(.16f,attackDelay*.9f);
        pendingUpgrades--;sound("pickup");
        if(pendingUpgrades>0)rollChoices();else mode=PLAY;
    }
    public void finish(boolean won){
        if(!activeRun)return;
        if(inHistory()){history.defeat(this);return;}
        if(inMath()){math.defeat(this);return;}
        if(body.enabled){body.settle(this,won);sound(won?"level":"death");return;}
        if(story.enabled){story.settle(this,won);sound(won?"level":"death");return;}
        activeRun=false;mode=won?VICTORY:DEAD;bestWave=Math.max(bestWave,wave);lifetimeKills+=kills;bank+=gold;sound(won?"level":"death");
    }
    public void popup(float a,float b,String t,int color){if(effects.size()<90)effects.add(new Effect(a,b,t,color,.8f));}
    private void flashHurt(){vfx.flash=Math.max(vfx.flash,.58f);}
    public String quest(){if(inHistory())return history.objective();if(physics.active)return physics.objective(this);if(math.active)return math.objective(this);if(body.enabled)return body.objective(this);if(story.enabled&&(inTown()||story.battleWon))return story.objective();return wave==5?"击败遗迹守卫，找回星火":"净化此地的魔物  "+waveKilled+" / "+waveTarget();}

    /** Versioned binary snapshot: no framework dependencies, no Java object deserialization. */
    public void save(OutputStream stream)throws IOException{
        DataOutputStream o=new DataOutputStream(stream);o.writeInt(0x575A5052);o.writeInt(10);
        o.writeInt(totalRuns);o.writeInt(bestWave);o.writeInt(lifetimeKills);o.writeInt(bank);o.writeBoolean(sound);o.writeBoolean(autoAttack);o.writeBoolean(activeRun);
        if(!activeRun){story.write(o);body.write(o);guest.write(o);arsenal.write(o);math.write(o);physics.write(o);o.writeUTF(heroName);o.writeInt(effectsLevel);history.write(o);o.flush();return;}
        int[] ints={wave,level,xp,kills,gold,potions,waveSpawned,waveKilled,pendingUpgrades};for(int n:ints)o.writeInt(n);
        float[] fs={x,y,hp,maxHp,attack,speed,attackDelay,attackCd,skillCd,dashCd,potionCd,invuln,elapsed,facing,spawnTimer,intermission};for(float f:fs)o.writeFloat(f);
        o.writeLong(rng);for(int n:upgrades)o.writeInt(n);for(int n:choices)o.writeInt(n);
        o.writeInt(enemies.size());for(Enemy e:enemies){o.writeInt(e.type);o.writeInt(e.id);float[] ef={e.x,e.y,e.hp,e.maxHp,e.cd,e.hit,e.windup,e.targetX,e.targetY,e.knockX,e.knockY};for(float f:ef)o.writeFloat(f);o.writeBoolean(e.bossAttack);}
        o.writeInt(drops.size());for(Drop p:drops){o.writeFloat(p.x);o.writeFloat(p.y);o.writeInt(p.type);o.writeInt(p.value);}
        o.writeInt(shots.size());for(Shot p:shots){o.writeFloat(p.x);o.writeFloat(p.y);o.writeFloat(p.vx);o.writeFloat(p.vy);o.writeFloat(p.life);o.writeInt(p.damage);}story.write(o);body.write(o);guest.write(o);arsenal.write(o);math.write(o);physics.write(o);o.writeUTF(heroName);o.writeInt(effectsLevel);history.write(o);o.flush();
    }
    public static Game load(InputStream stream)throws IOException{
        DataInputStream i=new DataInputStream(stream);if(i.readInt()!=0x575A5052)throw new IOException("Unsupported save");int version=i.readInt();if(version<1||version>10)throw new IOException("Unsupported save version");Game g=new Game();
        g.totalRuns=bounded(i.readInt(),0,1000000);g.bestWave=bounded(i.readInt(),0,8);g.lifetimeKills=bounded(i.readInt(),0,100000000);g.bank=bounded(i.readInt(),0,100000000);g.sound=i.readBoolean();g.autoAttack=i.readBoolean();g.activeRun=i.readBoolean();if(!g.activeRun){if(version>=2)g.story=Story.read(i);if(version>=3)g.body=BodyJourney.read(i,version>=5?8:5);if(version>=4)g.guest=TownGuest.read(i);if(version>=5)g.arsenal=Arsenal.read(i,version);if(version>=6)g.math=MathJourney.read(i);if(version>=7)g.physics=PhysicsJourney.read(i,version);else g.physics=new PhysicsJourney();g.physics.syncFinaleReward(g);if(version>=6)g.readProfileExtras(i,version);if(version>=9)g.history=HistoryJourney.read(i,version);return g;}
        g.wave=bounded(i.readInt(),1,8);g.level=bounded(i.readInt(),1,10000);g.xp=bounded(i.readInt(),0,1000000);g.kills=bounded(i.readInt(),0,100000);g.gold=bounded(i.readInt(),0,10000000);g.potions=bounded(i.readInt(),0,100);g.waveSpawned=bounded(i.readInt(),0,100);g.waveKilled=bounded(i.readInt(),0,100);g.pendingUpgrades=bounded(i.readInt(),0,100);
        float[] f=new float[16];for(int n=0;n<f.length;n++){f[n]=i.readFloat();if(Float.isNaN(f[n])||Float.isInfinite(f[n]))throw new IOException("Nonfinite save");}
        g.x=clamp(f[0],18,WORLD_W-18);g.y=clamp(f[1],18,WORLD_H-18);g.hp=f[2];g.maxHp=f[3];g.attack=f[4];g.speed=f[5];g.attackDelay=f[6];g.attackCd=f[7];g.skillCd=f[8];g.dashCd=f[9];g.potionCd=f[10];g.invuln=f[11];g.elapsed=f[12];g.facing=f[13];g.spawnTimer=f[14];g.intermission=f[15];
        if(g.maxHp<1||g.hp<=0||g.hp>g.maxHp||g.attack<1||g.speed<1||g.attackDelay<=0)throw new IOException("Invalid player stats");
        g.rng=i.readLong();for(int n=0;n<8;n++)g.upgrades[n]=bounded(i.readInt(),0,10000);for(int n=0;n<3;n++)g.choices[n]=bounded(i.readInt(),0,7);
        for(int n=bounded(i.readInt(),0,256);n>0;n--){int t=bounded(i.readInt(),0,4),id=i.readInt();Enemy e=new Enemy(t,id,i.readFloat(),i.readFloat(),i.readFloat());e.maxHp=i.readFloat();e.cd=i.readFloat();e.hit=i.readFloat();e.windup=i.readFloat();e.targetX=i.readFloat();e.targetY=i.readFloat();e.knockX=i.readFloat();e.knockY=i.readFloat();e.bossAttack=i.readBoolean();g.enemies.add(e);}
        for(int n=bounded(i.readInt(),0,4096);n>0;n--)g.drops.add(new Drop(i.readFloat(),i.readFloat(),bounded(i.readInt(),0,2),bounded(i.readInt(),1,10000)));
        for(int n=bounded(i.readInt(),0,4096);n>0;n--){Shot s=new Shot(i.readFloat(),i.readFloat(),i.readFloat(),i.readFloat(),0);s.life=i.readFloat();s.damage=i.readInt();g.shots.add(s);}
        if(version>=2)g.story=Story.read(i);else{g.story.enabled=true;g.story.area=Story.FOREST;g.story.chapter=3;g.story.forestX=g.x;g.story.forestY=g.y;}
        if(version>=3){g.body=BodyJourney.read(i,version>=5?8:5);if(g.body.enabled&&(!g.story.enabled||g.wave!=g.body.organ+1))throw new IOException("Mismatched body state");}
        if(version>=4)g.guest=TownGuest.read(i);
        if(version>=5)g.arsenal=Arsenal.read(i,version);
        else if(g.body.enabled){g.arsenal.unlocked=(1<<Math.min(6,g.body.organ+2))-1;if(g.body.cured==31){g.story.battleWon=false;g.body.ending=false;}}
        if(version>=6)g.math=MathJourney.read(i);
        if(version>=7)g.physics=PhysicsJourney.read(i,version);
        else g.physics=new PhysicsJourney();
        g.physics.syncFinaleReward(g);
        if(version>=6){g.readProfileExtras(i,version);if(g.inMath()){g.x=clamp(f[0],18,MathJourney.WIDTH-18);g.y=clamp(f[1],18,MathJourney.HEIGHT-18);}}
        if(version>=7&&g.inPhysics()){g.x=clamp(f[0],18,PhysicsJourney.WIDTH-18);g.y=clamp(f[1],18,PhysicsJourney.HEIGHT-18);}
        if(version>=9)g.history=HistoryJourney.read(i,version);
        if(g.inTown()){g.x=clamp(f[0],78,Town.WIDTH-78);g.y=clamp(f[1],98,Town.HEIGHT-66);}
        g.mode=TITLE;return g;
    }
    public void setHeroName(String value){
        String n=value==null?"":value.replaceAll("[\\p{Cntrl}]", "").trim();if(n.isEmpty())n=HERO;if(n.codePointCount(0,n.length())>12)n=n.substring(0,n.offsetByCodePoints(0,12));heroName=n;
    }
    private void readProfileExtras(DataInputStream in,int version)throws IOException{
        String name=in.readUTF();if(name.isEmpty()||name.codePointCount(0,name.length())>12||!name.equals(name.trim())||name.matches(".*[\\p{Cntrl}].*"))throw new IOException("Invalid hero name");heroName=name;effectsLevel=bounded(in.readInt(),0,1);
    }
    private static int bounded(int n,int lo,int hi)throws IOException{if(n<lo||n>hi)throw new IOException("Save value out of range");return n;}
}
