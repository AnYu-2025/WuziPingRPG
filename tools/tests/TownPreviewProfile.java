package cn.wuziping.ember.tests;
import cn.wuziping.ember.*;
import java.io.*;
/** Isolated UI fixture; does not read or overwrite the player's own save. */
public final class TownPreviewProfile {
    public static void main(String[] args)throws Exception{
        Game game=new Game();game.startAdventure();game.story.dialogue=null;game.mode=Game.PLAY;game.x=450;game.y=340;
        try(OutputStream out=new FileOutputStream(args[0])){game.save(out);}
        System.out.println("Isolated town interaction profile created.");
    }
}
