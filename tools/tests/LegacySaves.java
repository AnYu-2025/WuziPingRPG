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
    static byte[] snapshot(Game g,int version)throws IOException{
        if(version<1||version>7)throw new IllegalArgumentException("Unsupported legacy fixture version");
        if(version>=6)return profileSnapshot(g,version);
        if(!g.arsenal.bolts.isEmpty())throw new IOException("Fixture requires no friendly projectiles");
        ByteArrayOutputStream current=new ByteArrayOutputStream();g.save(current);
        byte[] currentBytes=current.toByteArray();
        byte[] story=bytes(g.story::write),body=bytes(g.body::write),guest=bytes(g.guest::write),arsenal=bytes(g.arsenal::write),math=bytes(g.math::write),physics=bytes(g.physics::write);
        byte[] profile=bytes(out->{out.writeUTF(g.heroName);out.writeInt(g.effectsLevel);});
        int prefix=currentBytes.length-story.length-body.length-guest.length-arsenal.length-math.length-physics.length-profile.length;
        if(prefix<12)throw new IOException("Invalid current snapshot layout");
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(Arrays.copyOf(current.toByteArray(),prefix));DataOutputStream d=new DataOutputStream(out);
        if(version>=2)d.write(story);
        if(version>=5)d.write(body);
        else if(version>=3){
            BodyJourney b=g.body;d.writeBoolean(b.enabled);d.writeBoolean(b.briefed);d.writeBoolean(b.ending);d.writeInt(b.organ);d.writeInt(b.cured);d.writeInt(b.weaponLevel);
            for(int i=0;i<5;i++)d.writeInt(b.kills[i]);for(int i=0;i<10;i++){d.writeInt(b.supply[i]);d.writeFloat(b.supplyX[i]);d.writeFloat(b.supplyY[i]);d.writeFloat(b.fall[i]);}
        }
        if(version>=4)d.write(guest);
        if(version>=5)d.write(arsenal);
        d.flush();byte[] result=out.toByteArray();result[7]=(byte)version;return result;
    }
    /** Format 7 is the live save. Format 6 is that save with the physics section removed and the version byte set to 6. */
    private static byte[] profileSnapshot(Game g,int version)throws IOException{
        ByteArrayOutputStream current=new ByteArrayOutputStream();g.save(current);byte[] currentBytes=current.toByteArray();
        byte[] story=bytes(g.story::write),body=bytes(g.body::write),guest=bytes(g.guest::write),arsenal=bytes(g.arsenal::write),math=bytes(g.math::write),physics=bytes(g.physics::write);
        byte[] profile=bytes(out->{out.writeUTF(g.heroName);out.writeInt(g.effectsLevel);});
        int prefix=currentBytes.length-story.length-body.length-guest.length-arsenal.length-math.length-physics.length-profile.length;
        if(prefix<12)throw new IOException("Invalid current snapshot layout");
        byte[] tail=Arrays.copyOfRange(currentBytes,prefix,currentBytes.length);
        ByteArrayOutputStream expected=new ByteArrayOutputStream();expected.write(story);expected.write(body);expected.write(guest);expected.write(arsenal);expected.write(math);expected.write(physics);expected.write(profile);
        if(!Arrays.equals(tail,expected.toByteArray()))throw new IOException("Snapshot tail does not match section writers");
        if(version==7)return currentBytes;
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(currentBytes,0,prefix);out.write(story);out.write(body);out.write(guest);out.write(arsenal);out.write(math);out.write(profile);
        byte[] result=out.toByteArray();result[7]=(byte)6;return result;
    }
}
