package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;
import java.util.Arrays;

/** Emits exact historical tails, so migration tests never feed new fields to old formats. */
final class LegacySaves {
    static byte[] snapshot(Game g,int version)throws IOException{
        if(!g.arsenal.bolts.isEmpty())throw new IOException("Fixture requires no friendly projectiles");
        ByteArrayOutputStream current=new ByteArrayOutputStream();g.save(current);
        int prefix=current.size()-BodyJourney.SAVE_BYTES-TownGuest.SAVE_BYTES-Arsenal.EMPTY_SAVE_BYTES-(version==1?25:0);
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(Arrays.copyOf(current.toByteArray(),prefix));DataOutputStream d=new DataOutputStream(out);
        if(version>=3){BodyJourney b=g.body;d.writeBoolean(b.enabled);d.writeBoolean(b.briefed);d.writeBoolean(b.ending);d.writeInt(b.organ);d.writeInt(b.cured);d.writeInt(b.weaponLevel);
            for(int i=0;i<5;i++)d.writeInt(b.kills[i]);for(int i=0;i<10;i++){d.writeInt(b.supply[i]);d.writeFloat(b.supplyX[i]);d.writeFloat(b.supplyY[i]);d.writeFloat(b.fall[i]);}}
        if(version>=4)g.guest.write(d);d.flush();byte[] bytes=out.toByteArray();bytes[7]=(byte)version;return bytes;
    }
}
