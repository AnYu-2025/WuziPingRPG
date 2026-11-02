package cn.wuziping.ember.desktop;

import cn.wuziping.ember.*;
import java.awt.*;
import java.awt.event.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import javax.swing.*;

/** Executable desktop harness with the very same Game, Controls and Scene as the APK. */
public final class Desktop extends JPanel implements cn.wuziping.ember.Painter {
    private final HashMap<String,BufferedImage> images=new HashMap<>();
    private final Game game;
    private final Controls controls=new Controls();
    private final Scene scene=new Scene();
    private final Viewport viewport=new Viewport();
    private Graphics2D g;
    private long last=System.nanoTime(),start=last;
    private float scale=1,ox,oy;
    private File saveFile=new File("desktop-journey.bin");
    public Desktop(Game state)throws Exception{
        game=state;
        for(String n:new String[]{"tiles.png","actors.png","objects.png","icons.png","town.png","town_tiles.png","town_props.png","npcs.png","body_tiles.png","body_enemies.png","body_atlas.png","nailong.png","bosses.png","weapons.png"}){
            InputStream in=Desktop.class.getResourceAsStream("/"+n);
            if(in==null)in=new FileInputStream("app/src/main/assets/"+n);
            try(InputStream stream=in){images.put(n,ImageIO.read(stream));}
        }
        setPreferredSize(new Dimension(1440,810));setFocusable(true);
        addMouseListener(new MouseAdapter(){public void mousePressed(MouseEvent e){requestFocusInWindow();controls.down(game,0,(e.getX()-ox)/scale,(e.getY()-oy)/scale);repaint();}public void mouseReleased(MouseEvent e){controls.up(0);}});
        addMouseMotionListener(new MouseMotionAdapter(){public void mouseDragged(MouseEvent e){controls.move(game,0,(e.getX()-ox)/scale,(e.getY()-oy)/scale);}});
        addKeyListener(new KeyAdapter(){public void keyPressed(KeyEvent e){controls.key(game,key(e),true);}public void keyReleased(KeyEvent e){controls.key(game,key(e),false);}});
        addFocusListener(new FocusAdapter(){public void focusLost(FocusEvent e){game.pause();controls.clear();persist();}});
    }
    private String key(KeyEvent e){switch(e.getKeyCode()){case KeyEvent.VK_ESCAPE:return "ESCAPE";case KeyEvent.VK_SHIFT:return "SHIFT";case KeyEvent.VK_SPACE:return "SPACE";default:return KeyEvent.getKeyText(e.getKeyCode()).toUpperCase(Locale.ROOT);}}
    private void persist(){try(OutputStream o=new FileOutputStream(saveFile)){game.save(o);}catch(IOException e){e.printStackTrace();}}
    public void start(){new javax.swing.Timer(16,e->{
        long now=System.nanoTime();float dt=Math.min(.05f,(now-last)/1e9f);last=now;
        game.update(dt,controls.input);controls.pulsesConsumed();game.sounds.clear();if(game.mode!=Game.PLAY)controls.clear();
        if(controls.dirty){persist();controls.dirty=false;}repaint();
    }).start();}
    @Override public void paintComponent(Graphics graphics){super.paintComponent(graphics);g=(Graphics2D)graphics.create();render(getWidth(),getHeight(),(System.nanoTime()-start)/1e9f);g.dispose();}
    private void render(int w,int h,float t){g.setColor(new Color(0xff091415,true));g.fillRect(0,0,w,h);viewport.set(w,h,0,0,0,0);scale=viewport.scale;ox=oy=0;scene.layout=viewport;controls.layout=viewport;g.translate(ox,oy);g.scale(scale,scale);g.clipRect(0,0,(int)Math.ceil(viewport.width),(int)Math.ceil(viewport.height));g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);scene.joyX=controls.input.mx;scene.joyY=controls.input.my;scene.draw(this,game,t);}
    public void screenshot(File out,float time)throws IOException{screenshot(out,time,1920,1080);}
    public void screenshot(File out,float time,int width,int height)throws IOException{BufferedImage im=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);g=im.createGraphics();render(width,height,time);g.dispose();ImageIO.write(im,"png",out);}
    @Override public void rect(float x,float y,float w,float h,int c){g.setColor(new Color(c,true));g.fill(new java.awt.geom.Rectangle2D.Float(x,y,w,h));}
    @Override public void oval(float x,float y,float w,float h,int c){g.setColor(new Color(c,true));g.fill(new java.awt.geom.Ellipse2D.Float(x,y,w,h));}
    @Override public void line(float a,float b,float c,float d,float width,int color){g.setColor(new Color(color,true));g.setStroke(new BasicStroke(width));g.draw(new java.awt.geom.Line2D.Float(a,b,c,d));}
    private Font uiFont(float size){
        String[] names={"Microsoft YaHei","Noto Sans CJK SC","Noto Sans CJK JP","WenQuanYi Micro Hei","Droid Sans Fallback","SansSerif"};
        for(String name:names){Font face=new Font(name,Font.PLAIN,1);if(face.canDisplay('伍')||"SansSerif".equals(name))return face.deriveFont(size);}
        return new Font("SansSerif",Font.PLAIN,1).deriveFont(size);
    }
    @Override public void text(String s,float x,float y,float size,int c,int align){
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,RenderingHints.VALUE_TEXT_ANTIALIAS_ON);g.setFont(uiFont(size));g.setColor(new Color(c,true));float width=g.getFontMetrics().stringWidth(s);g.drawString(s,x-(align==1?width/2:align==2?width:0),y);
    }
    @Override public void image(String n,int sx,int sy,int sw,int sh,float x,float y,float w,float h,float alpha,boolean flip){
        Composite old=g.getComposite();g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER,alpha));
        int dx=(int)x,dy=(int)y,dw=(int)w,dh=(int)h;
        g.drawImage(images.get(n),flip?dx+dw:dx,dy,flip?dx:dx+dw,dy+dh,sx,sy,sx+sw,sy+sh,null);g.setComposite(old);
    }
    public static void main(String[] args)throws Exception{
        if(args.length>0&&args[0].equals("--screenshots")){
            File dir=new File(args.length>1?args[1]:"artifacts/screenshots");dir.mkdirs();Game game=new Game();Desktop d=new Desktop(game);
            d.screenshot(new File(dir,"01-title.png"),2);
            game.startRun();game.wave=3;game.level=4;game.kills=19;game.gold=57;game.hp=76;game.xp=11;game.elapsed=126;game.banner=0;
            game.spawnEnemy(0,game.x+40,game.y+10);game.spawnEnemy(1,game.x-30,game.y-40);game.spawnEnemy(2,game.x+75,game.y-20);game.spawnEnemy(3,game.x-65,game.y+30);
            for(int j=0;j<12;j++)game.drops.add(new Game.Drop(game.x-55+j*10,game.y+35+j%3*4,j%4==0?1:0,3));
            game.swing=.12f;game.skillFlash=.2f;game.vfx.burst(game.x+40,game.y+8,0xffffd37a,12,62,.7f,3.6f);game.vfx.kick(2.4f);
            game.popup(game.x+42,game.y-8,"36",0xffffd37a);game.popup(game.x-28,game.y-4,"18",0xfff9f2db);
            d.screenshot(new File(dir,"02-battle.png"),8);
            game.gainXp(100);d.screenshot(new File(dir,"03-upgrade.png"),8);
            game.mode=Game.PLAY;game.enemies.clear();game.wave=5;game.spawnEnemy(4,game.x+55,game.y-35);Game.Enemy boss=game.enemies.get(0);boss.hp=boss.maxHp*.66f;boss.windup=.65f;boss.bossAttack=true;boss.targetX=game.x-10;boss.targetY=game.y+25;
            d.screenshot(new File(dir,"04-boss.png"),10);
            game.mode=Game.PAUSE;d.screenshot(new File(dir,"05-pause.png"),10);
            game.mode=Game.HELP;d.screenshot(new File(dir,"06-help.png"),10);
            game.mode=Game.VICTORY;d.screenshot(new File(dir,"07-victory.png"),10);
            game.startAdventure();game.story.dialogue=null;game.mode=Game.PLAY;game.x=450;game.y=470;game.banner=0;
            d.screenshot(new File(dir,"08-town.png"),5);
            game.x=450;game.y=340;game.story.talk(game,0);game.story.dialogue.revealed=true;
            d.screenshot(new File(dir,"09-dialogue.png"),6);
            game.story.dialogue.page=game.story.dialogue.pages.length-1;game.story.dialogue.revealed=true;
            d.screenshot(new File(dir,"10-dialogue-choice.png"),6);
            game.story.choose(game,0);game.mode=Game.JOURNAL;
            d.screenshot(new File(dir,"11-quest-journal.png"),6);
            game.mode=Game.PLAY;game.x=535;game.y=144;game.story.talk(game,1);game.story.dialogue.revealed=true;
            d.screenshot(new File(dir,"12-north-gate.png"),6);
            game.startDream();game.story.dialogue.revealed=true;d.screenshot(new File(dir,"13-dream-opening.png"),5);
            game.story.dialogue=null;game.mode=Game.PLAY;game.body.briefed=true;game.body.enter(game);game.body.transit=0;game.banner=0;
            game.spawnEnemy(0,game.x+56,game.y-32);game.spawnEnemy(1,game.x-42,game.y-38);game.spawnEnemy(2,game.x+80,game.y+5);
            game.body.supply[0]=1;game.body.fall[0]=1.2f;game.body.supplyX[0]=game.x+90;game.body.supplyY[0]=game.y-25;
            d.screenshot(new File(dir,"14-airway-airdrop.png"),8);
            game.mode=BodyJourney.MAP;d.screenshot(new File(dir,"15-body-vessel-route.png"),8);
            game.mode=Game.PLAY;game.body.organ=1;game.wave=2;game.body.cured=1;game.enemies.clear();game.spawnEnemy(2,game.x+55,game.y-35);game.body.supply[2]=2;game.body.supplyX[2]=game.x-64;game.body.supplyY[2]=game.y-26;
            d.screenshot(new File(dir,"16-lung.png"),9);
            game.body.organ=2;game.wave=3;game.body.cured=3;d.screenshot(new File(dir,"17-intestine.png"),9);
            game.body.organ=3;game.wave=4;game.body.cured=7;game.enemies.clear();game.spawnEnemy(3,game.x+60,game.y-30);d.screenshot(new File(dir,"18-liver.png"),9);
            game.body.organ=4;game.wave=5;game.body.cured=15;game.enemies.clear();game.spawnEnemy(4,game.x+45,game.y-34);game.enemies.get(0).windup=.8f;game.enemies.get(0).bossAttack=true;game.enemies.get(0).targetX=game.x-20;game.enemies.get(0).targetY=game.y+15;
            d.screenshot(new File(dir,"19-cell-core.png"),10);
            game.lastCause="增殖核心的重击";game.mode=Game.DEAD;d.screenshot(new File(dir,"20-body-defeat.png"),10);
            game.mode=Game.PLAY;game.body.organ=7;game.wave=8;game.body.cured=255;game.enemies.clear();game.body.supply[9]=3;game.body.weaponLevel=4;game.mode=Game.JOURNAL;d.screenshot(new File(dir,"21-body-rewards.png"),10);
            game.mode=Game.VICTORY;d.screenshot(new File(dir,"22-body-victory.png"),10);
            game.body.returnTown(game);game.x=Town.NPCS[0].x;game.y=Town.NPCS[0].y+24;game.story.talk(game,0);game.story.dialogue.page=2;game.story.dialogue.revealed=true;d.screenshot(new File(dir,"23-ending-reward.png"),10);
            game.startDream();game.story.dialogue=null;game.mode=Game.PLAY;game.x=game.guest.x-29;game.y=game.guest.y-4;game.guest.tick(game,0);game.banner=0;
            d.screenshot(new File(dir,"24-hidden-encounter.png"),5);
            game.story.interact(game);game.story.dialogue.page=2;game.story.dialogue.revealed=true;d.screenshot(new File(dir,"25-nailong-listening.png"),5);
            game.story.choose(game,0);game.story.dialogue.page=2;game.story.dialogue.revealed=true;d.screenshot(new File(dir,"26-nailong-comfort.png"),5);
            game.story.choose(game,0);game.story.dialogue.page=2;game.story.dialogue.revealed=true;d.screenshot(new File(dir,"27-nailong-reward.png"),5);
            game.story.choose(game,0);game.banner=0;d.screenshot(new File(dir,"28-nailong-friend.png"),5);
            game.mode=Game.JOURNAL;d.screenshot(new File(dir,"29-friend-journal.png"),5);
            game.mode=Game.PLAY;game.body.briefed=true;game.body.cured=0;game.body.organ=0;game.wave=1;game.body.enter(game);game.body.transit=0;game.invuln=0;game.banner=0;game.arsenal.unlocked=63;game.gold=220;
            game.mode=Arsenal.MENU;d.screenshot(new File(dir,"30-armory.png"),8);
            game.mode=Game.PLAY;game.arsenal.selected=3;game.arsenal.energy=100;game.spawnEnemy(4,game.x+75,game.y-35);game.arsenal.attack(game);d.screenshot(new File(dir,"31-wide-20x9.png"),8,2400,1080);
            d.screenshot(new File(dir,"32-ultrawide.png"),8,3440,1440);
            d.screenshot(new File(dir,"33-tablet-4x3.png"),8,1600,1200);
            game.enemies.clear();game.arsenal.bolts.clear();game.body.organ=5;game.body.cured=31;game.wave=6;game.spawnEnemy(4,game.x+70,game.y-35);d.screenshot(new File(dir,"34-heart.png"),8,2400,1080);
            game.body.organ=6;game.body.cured=63;game.wave=7;d.screenshot(new File(dir,"35-kidney.png"),8,2400,1080);
            game.body.organ=7;game.body.cured=127;game.wave=8;d.screenshot(new File(dir,"36-brain-boss.png"),8,2400,1080);
            game.mode=BodyJourney.MAP;d.screenshot(new File(dir,"37-eight-regions.png"),8,2400,1080);
            game.mode=Game.PLAY;game.banner=0;game.body.transit=0;game.hp=28;game.maxHp=120;game.attackCd=0;game.skillCd=0;game.swing=.16f;game.skillFlash=.34f;game.arsenal.selected=0;game.arsenal.shield=3.2f;game.arsenal.energy=100;
            game.vfx.burst(game.x+34,game.y-6,0xffffd37a,16,78,.7f,4);game.vfx.ring(game.x,game.y,0xffe07a45,16,64);game.vfx.nova=.4f;game.vfx.shake=5.5f;game.vfx.flash=.28f;
            game.popup(game.x+30,game.y-26,"86",0xffffd37a);game.popup(game.x-18,game.y-8,"24",0xfff9f2db);game.popup(game.x+4,game.y-16,"-12",0xffff8c7c);
            d.screenshot(new File(dir,"38-combat-fx.png"),9);
            System.out.println("Rendered 38 shared-layout screenshots to "+dir.getAbsolutePath());return;
        }
        Game loaded=new Game();File save=new File(args.length>1&&args[0].equals("--profile")?args[1]:"desktop-journey.bin");if(save.exists())try(InputStream in=new FileInputStream(save)){loaded=Game.load(in);}catch(IOException ignored){}
        final Desktop d=new Desktop(loaded);d.saveFile=save;SwingUtilities.invokeLater(()->{JFrame f=new JFrame("伍子平 · 星火远征 v0.6 — 桌面调试版");f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);f.setContentPane(d);f.pack();f.setLocationRelativeTo(null);f.setVisible(true);d.requestFocusInWindow();d.start();});
    }
}
