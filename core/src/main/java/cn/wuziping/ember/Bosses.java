package cn.wuziping.ember;

/** Five visually and mechanically distinct guardians, assigned across eight organs. */
public final class Bosses {
    public static final String[] NAMES={"气旋噬菌体","棘冠孢王","脉冲猎手","增殖巢母","神经执政者"};
    public static final int[] TYPES={0,1,2,3,3,0,2,4};
    public static int kind(Game g){return TYPES[g.body.organ];}
    public static String name(Game g){return NAMES[kind(g)];}
    private static void shot(Game g,Game.Enemy e,double a,float speed,int damage){if(g.shots.size()<256)g.shots.add(new Game.Shot(e.x,e.y,(float)Math.cos(a)*speed,(float)Math.sin(a)*speed,damage));}
    public static void tick(Game g,Game.Enemy e,float dt){
        int kind=kind(g);boolean angry=e.hp<e.maxHp*.45f;
        if(e.windup>0){e.windup-=dt;if(e.windup>0)return;
            double aim=Math.atan2(g.y-e.y,g.x-e.x);
            if(kind==0&&e.bossAttack){
                float distance=Game.dist(e.x,e.y,e.targetX,e.targetY);for(int i=1;i<=12;i++){float t=i/12f,nx=e.x+(e.targetX-e.x)*t,ny=e.y+(e.targetY-e.y)*t;if(g.blocked(nx,ny,12))break;e.x=nx;e.y=ny;}
                if(Game.dist(g.x,g.y,e.targetX,e.targetY)<48)g.hurt(24,"气旋冲撞");
            }else if(kind==1){int n=angry?24:16;for(int i=0;i<n;i++)shot(g,e,i*Math.PI*2/n+g.elapsed*.2,angry?80:60,13);}
            else if(kind==2){for(int i=-3;i<=3;i++)shot(g,e,aim+i*.13,angry?145:115,14);}
            else if(kind==3&&!e.bossAttack){
                for(int i=0;i<2&&g.enemies.size()<18;i++){float x=e.x+(i==0?-40:40),y=e.y+24;if(!g.blocked(x,y,10)){g.spawnEnemy(3,x,y);Game.Enemy add=g.enemies.get(g.enemies.size()-1);add.id=-Math.abs(add.id+100);}}
            }else if(kind==4){for(int i=0;i<14;i++){double a=i*Math.PI/7+g.elapsed*.6;shot(g,e,a,angry?110:80,16);shot(g,e,a+.16,50,11);}}
            else if(e.bossAttack){if(Game.dist(g.x,g.y,e.targetX,e.targetY)<60)g.hurt(28,"巢母震击");}
            else for(int i=-2;i<=2;i++)shot(g,e,aim+i*.24,85,13);
            e.cd=(kind==2?1.9f:kind==3?3.1f:2.7f)*(angry?.70f:1);
        }else if(e.cd<=0){e.bossAttack=kind==0?g.rand()<.65f:kind==3?g.rand()<.5f:false;e.windup=angry?.65f:1.0f;e.targetX=g.x;e.targetY=g.y;}
    }
}
