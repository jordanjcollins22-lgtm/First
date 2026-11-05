package com.helpermod;

import net.minecraft.inventory.SimpleInventory;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.PersistentState;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Saved with the world: which helper entity belongs to which player, and each helper's inventory.
 * The inventory lives here (not on the entity) so items are never lost if the helper is
 * unloaded, killed in creative, or re-summoned somewhere else.
 */
public class HelperData extends PersistentState {
    public static final int INVENTORY_SIZE = 27;
    private static final String ID = "helpermod_helpers";

    public final class Entry {
        public UUID entity;
        public boolean active;
        /** Fight mobs that threaten the owner. */
        public boolean guard = true;
        public final SimpleInventory inventory = new SimpleInventory(INVENTORY_SIZE);
        /** The helper's mine: a spiral staircase it digs once and reuses every time it goes underground. */
        public String mineDim;
        public net.minecraft.util.math.BlockPos mineOrigin;
        /** How many steps of the staircase are already dug. */
        public int mineDepth;
        /** Which mob the helper looks like, e.g. "minecraft:creeper". Null means it looks like its owner. */
        public String look;
        /** XP the helper picked up (from ores it mined and mobs it fought), handed over on delivery. */
        public int xp;
        /** How big the helper is: 1 is normal, 0.5 half height, 2 double. */
        public float size = 1f;

        Entry() {
            inventory.addListener(inv -> markDirty());
        }
    }

    private final Map<UUID, Entry> entries = new HashMap<>();

    public static HelperData get(MinecraftServer server) {
        return server.getOverworld().getPersistentStateManager()
                .getOrCreate(HelperData::fromNbt, HelperData::new, ID);
    }

    public Entry get(UUID owner) {
        return entries.get(owner);
    }

    public Entry getOrCreate(UUID owner) {
        return entries.computeIfAbsent(owner, k -> {
            markDirty();
            return new Entry();
        });
    }

    public Map<UUID, Entry> all() {
        return entries;
    }

    private static HelperData fromNbt(NbtCompound nbt) {
        HelperData data = new HelperData();
        NbtList list = nbt.getList("helpers", NbtElement.COMPOUND_TYPE);
        for (int i = 0; i < list.size(); i++) {
            NbtCompound tag = list.getCompound(i);
            Entry entry = data.new Entry();
            UUID owner = tag.getUuid("owner");
            if (tag.containsUuid("entity")) entry.entity = tag.getUuid("entity");
            entry.active = tag.getBoolean("active");
            entry.guard = !tag.contains("guard") || tag.getBoolean("guard");
            entry.inventory.readNbtList(tag.getList("items", NbtElement.COMPOUND_TYPE));
            if (tag.contains("mineDim")) {
                entry.mineDim = tag.getString("mineDim");
                entry.mineOrigin = net.minecraft.util.math.BlockPos.fromLong(tag.getLong("mineOrigin"));
                entry.mineDepth = tag.getInt("mineDepth");
            }
            if (tag.contains("look")) entry.look = tag.getString("look");
            entry.xp = tag.getInt("xp");
            if (tag.contains("size")) entry.size = tag.getFloat("size");
            data.entries.put(owner, entry);
        }
        return data;
    }

    @Override
    public NbtCompound writeNbt(NbtCompound nbt) {
        NbtList list = new NbtList();
        entries.forEach((owner, entry) -> {
            NbtCompound tag = new NbtCompound();
            tag.putUuid("owner", owner);
            if (entry.entity != null) tag.putUuid("entity", entry.entity);
            tag.putBoolean("active", entry.active);
            tag.putBoolean("guard", entry.guard);
            tag.put("items", entry.inventory.toNbtList());
            if (entry.mineDim != null && entry.mineOrigin != null) {
                tag.putString("mineDim", entry.mineDim);
                tag.putLong("mineOrigin", entry.mineOrigin.asLong());
                tag.putInt("mineDepth", entry.mineDepth);
            }
            if (entry.look != null) tag.putString("look", entry.look);
            if (entry.xp > 0) tag.putInt("xp", entry.xp);
            if (entry.size != 1f) tag.putFloat("size", entry.size);
            list.add(tag);
        });
        nbt.put("helpers", list);
        return nbt;
    }
}
