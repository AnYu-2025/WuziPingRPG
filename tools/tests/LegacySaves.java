package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.Arrays;

/** Emits exact historical tails, so migration tests never feed new fields to old formats. */
final class LegacySaves {
    private interface Section { void write(DataOutputStream out)throws IOException; }
    private static byte[] bytes(Section section)throws IOException{
        ByteArrayOutputStream out=new ByteArrayOutputStream();DataOutputStream data=new DataOutputStream(out);section.write(data);data.flush();return out.toByteArray();
    }
    /** Format 8 is the live save. 7 drops the seventh forge level and tuned launch parameters. */
    static byte[] snapshot(Game g,int version)throws IOException{
        if(version<1||version>9)throw new IllegalArgumentException("Unsupported legacy fixture version");
        ByteArrayOutputStream current=new ByteArrayOutputStream();g.save(current);byte[] currentBytes=current.toByteArray();
        byte[] story=bytes(g.story::write),body=bytes(g.body::write),guest=bytes(g.guest::write);
        byte[] arsenal=bytes(g.arsenal::write),math=bytes(g.math::write),physics=bytes(g.physics::write);
        byte[] oldArsenal=bytes(out->g.arsenal.write(out,false));
        byte[] oldPhysics=bytes(out->g.physics.write(out,false));
        byte[] profile=bytes(out->{out.writeUTF(g.heroName);out.writeInt(g.effectsLevel);});
        byte[] history=bytes(g.history::write);
        int prefix=currentBytes.length-story.length-body.length-guest.length-arsenal.length-math.length-physics.length-profile.length-history.length;
        if(prefix<12)throw new IOException("Invalid current snapshot layout");
        byte[] tail=Arrays.copyOfRange(currentBytes,prefix,currentBytes.length);
        ByteArrayOutputStream expected=new ByteArrayOutputStream();
        expected.write(story);expected.write(body);expected.write(guest);expected.write(arsenal);expected.write(math);expected.write(physics);expected.write(profile);expected.write(history);
        if(!Arrays.equals(tail,expected.toByteArray()))throw new IOException("Snapshot tail does not match section writers");
        if(version==8||version==9){int omit=version==8?history.length:history.length-4;byte[] v=Arrays.copyOf(currentBytes,currentBytes.length-omit);v[7]=(byte)version;return v;}
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(currentBytes,0,prefix);DataOutputStream d=new DataOutputStream(out);
        if(version>=2)d.write(story);
        if(version>=5)d.write(body);
        else if(version>=3){
            BodyJourney b=g.body;d.writeBoolean(b.enabled);d.writeBoolean(b.briefed);d.writeBoolean(b.ending);d.writeInt(b.organ);d.writeInt(b.cured);d.writeInt(b.weaponLevel);
            for(int i=0;i<5;i++)d.writeInt(b.kills[i]);for(int i=0;i<10;i++){d.writeInt(b.supply[i]);d.writeFloat(b.supplyX[i]);d.writeFloat(b.supplyY[i]);d.writeFloat(b.fall[i]);}
        }
        if(version>=4)d.write(guest);
        if(version>=5)d.write(oldArsenal);
        if(version>=6){d.write(math);if(version>=7)d.write(oldPhysics);d.write(profile);}
        d.flush();byte[] result=out.toByteArray();result[7]=(byte)version;return result;
    }
}
