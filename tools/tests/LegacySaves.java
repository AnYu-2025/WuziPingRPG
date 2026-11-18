package cn.wuziping.ember.tests;

import cn.wuziping.ember.*;
import java.io.*;

/** Writes historical fixtures directly, independent of the current save format. */
final class LegacySaves {
    private static void ints(DataOutputStream out, int... values) throws IOException {
        for (int value : values) out.writeInt(value);
    }

    private static void floats(DataOutputStream out, float... values) throws IOException {
        for (float value : values) out.writeFloat(value);
    }

    private static void writeCombat(DataOutputStream out, Game g) throws IOException {
        ints(out, g.wave, g.level, g.xp, g.kills, g.gold, g.potions, g.waveSpawned, g.waveKilled, g.pendingUpgrades);
        floats(out, g.x, g.y, g.hp, g.maxHp, g.attack, g.speed, g.attackDelay, g.attackCd,
                g.skillCd, g.dashCd, g.potionCd, g.invuln, g.elapsed, g.facing, g.spawnTimer, g.intermission);
        out.writeLong(710221L); // Fixed RNG state for reproducible migration fixtures.
        ints(out, g.upgrades);
        ints(out, g.choices);
        out.writeInt(g.enemies.size());
        for (Game.Enemy enemy : g.enemies) {
            ints(out, enemy.type, enemy.id);
            floats(out, enemy.x, enemy.y, enemy.hp, enemy.maxHp, enemy.cd, enemy.hit, enemy.windup,
                    enemy.targetX, enemy.targetY, enemy.knockX, enemy.knockY);
            out.writeBoolean(enemy.bossAttack);
        }
        out.writeInt(g.drops.size());
        for (Game.Drop drop : g.drops) {
            floats(out, drop.x, drop.y);
            ints(out, drop.type, drop.value);
        }
        out.writeInt(g.shots.size());
        for (Game.Shot shot : g.shots) {
            floats(out, shot.x, shot.y, shot.vx, shot.vy, shot.life);
            out.writeInt(shot.damage);
        }
    }

    static byte[] snapshot(Game g, int version) throws IOException {
        if (version < 1 || version > 11) throw new IllegalArgumentException("Unsupported legacy fixture version");
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(buffer);
        ints(out, 0x575A5052, version, g.totalRuns, g.bestWave, g.lifetimeKills, g.bank);
        out.writeBoolean(g.sound);
        out.writeBoolean(g.autoAttack);
        out.writeBoolean(g.activeRun);
        if (g.activeRun) writeCombat(out, g);
        if (version >= 2) g.story.write(out);
        if (version >= 5) g.body.write(out);
        else if (version >= 3) {
            BodyJourney body = g.body;
            out.writeBoolean(body.enabled);
            out.writeBoolean(body.briefed);
            out.writeBoolean(body.ending);
            ints(out, body.organ, body.cured, body.weaponLevel);
            for (int i = 0; i < 5; i++) out.writeInt(body.kills[i]);
            for (int i = 0; i < 10; i++) {
                out.writeInt(body.supply[i]);
                floats(out, body.supplyX[i], body.supplyY[i], body.fall[i]);
            }
        }
        if (version >= 4) g.guest.write(out);
        if (version >= 5) g.arsenal.write(out, version >= 8);
        if (version >= 6) {
            g.math.write(out);
            if (version >= 7) g.physics.write(out, version >= 8);
            out.writeUTF(g.heroName);
            out.writeInt(g.effectsLevel);
        }
        if (version >= 9) out.writeInt(g.history.stage);
        if (version >= 10) {
            byte[] suspended = g.history.suspended;
            if (suspended.length > 0) suspended = snapshot(Game.load(new ByteArrayInputStream(suspended)), version);
            out.writeInt(suspended.length);
            out.write(suspended);
        }
        out.flush();
        return buffer.toByteArray();
    }
}
