package com.helpermod;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Saved with the world: which helper entity belongs to which player, and each helper's inventory.
 * The inventory lives here (not on the entity) so items are never lost if the helper is
 * unloaded, killed in creative, or re-summoned somewhere else.
 */
public class HelperData extends SavedData {
    /** Room for 6 rows. A new helper can use 3 rows of pockets; every level unlocks 3 more slots. */
    public static final int INVENTORY_SIZE = 54;
    public static final int MAX_LEVEL = 10;
    private static final String ID = "helpermod_helpers";
    private static final SavedDataType<HelperData> TYPE = Compat.dataType(ID, HelperData::new, HelperData::fromNbt, d -> d.save(new CompoundTag()));

    public final class Entry {
        public UUID entity;
        public boolean active;
        /** Fight mobs that threaten the owner. */
        public boolean guard = true;
        public final Pockets inventory = new Pockets();
        /** Work points: 1 per block mined, 5 per mob beaten. The level comes from these. */
        public int work;
        public int level = 1;
        /** The helper's mine: a spiral staircase it digs once and reuses every time it goes underground. */
        public String mineDim;
        public net.minecraft.core.BlockPos mineOrigin;
        /** How many steps of the staircase are already dug. */
        public int mineDepth;
        /** Where the owner placed a Mine Marker, if they did. While it stands, the mine always starts there. */
        public net.minecraft.core.BlockPos mineMarker;
        /** Which mob the helper looks like, e.g. "minecraft:creeper". Null means it looks like its owner. */
        public String look;
        /** XP the helper picked up (from ores it mined and mobs it fought), handed over on delivery. */
        public int xp;
        /** How big the helper is: 1 is normal, 0.5 half height, 2 double. */
        public float size = 1f;

        Entry() {
        }
    }

    private final Map<UUID, Entry> entries = new HashMap<>();

    /** Level 2 at 50 points, 3 at 200, 4 at 450, 5 at 800 ... 10 at 4050. */
    public static int levelFor(int work) {
        return Math.min(MAX_LEVEL, 1 + (int) Math.floor(Math.sqrt(Math.max(0, work) / 50.0)));
    }

    public static int pointsFor(int level) {
        return 50 * (level - 1) * (level - 1);
    }

    public static int pocketsFor(int level) {
        return Math.min(INVENTORY_SIZE, 27 + 3 * (level - 1));
    }

    /** How much faster than normal the helper mines: +10% per level. */
    public static float speedFor(int level) {
        return 1f + 0.1f * (level - 1);
    }

    /** The helper's inventory: only the unlocked pockets can hold anything. */
    public static final class Pockets extends SimpleContainer {
        public int unlocked = 27;

        Pockets() {
            super(INVENTORY_SIZE);
        }

        void fromTag(net.minecraft.nbt.ListTag list) {
            for (int i = 0; i < getContainerSize(); i++) setItem(i, ItemStack.EMPTY);
            for (int i = 0; i < list.size(); i++) {
                CompoundTag t = list.getCompoundOrEmpty(i);
                int slot = t.getByteOr("Slot", (byte) 0) & 255;
                if (slot < getContainerSize()) setItem(slot, Compat.loadStack(t));
            }
        }

        net.minecraft.nbt.ListTag createTag() {
            net.minecraft.nbt.ListTag list = new net.minecraft.nbt.ListTag();
            for (int i = 0; i < getContainerSize(); i++) {
                ItemStack st = getItem(i);
                if (st.isEmpty()) continue;
                CompoundTag t = Compat.saveStack(st);
                t.putByte("Slot", (byte) i);
                list.add(t);
            }
            return list;
        }

        @Override
        public boolean canPlaceItem(int slot, ItemStack stack) {
            return slot < unlocked;
        }

        @Override
        public ItemStack addItem(ItemStack stack) {
            ItemStack rest = stack.copy();
            for (int i = 0; i < unlocked && !rest.isEmpty(); i++) { // top up matching stacks first
                ItemStack here = getItem(i);
                if (here.isEmpty() || !ItemStack.isSameItemSameComponents(here, rest)) continue;
                int move = Math.min(rest.getCount(), Math.min(here.getMaxStackSize(), getMaxStackSize()) - here.getCount());
                if (move <= 0) continue;
                here.grow(move);
                rest.shrink(move);
                setChanged();
            }
            for (int i = 0; i < unlocked && !rest.isEmpty(); i++) {
                if (!getItem(i).isEmpty()) continue;
                setItem(i, rest.copy());
                rest.setCount(0);
            }
            return rest.isEmpty() ? ItemStack.EMPTY : rest;
        }
    }

    public static HelperData get(MinecraftServer server) {
        return server.overworld().getDataStorage()
                .computeIfAbsent(TYPE);
    }

    public Entry get(UUID owner) {
        return entries.get(owner);
    }

    public Entry getOrCreate(UUID owner) {
        return entries.computeIfAbsent(owner, k -> {
            setDirty();
            return new Entry();
        });
    }

    public Map<UUID, Entry> all() {
        return entries;
    }

    private static HelperData fromNbt(CompoundTag nbt) {
        HelperData data = new HelperData();
        ListTag list = nbt.getListOrEmpty("helpers");
        for (int i = 0; i < list.size(); i++) {
            CompoundTag tag = list.getCompoundOrEmpty(i);
            Entry entry = data.new Entry();
            UUID owner = Compat.getUUID(tag, "owner");
            if (tag.contains("entity")) entry.entity = Compat.getUUID(tag, "entity");
            entry.active = tag.getBooleanOr("active", false);
            entry.guard = tag.getBooleanOr("guard", true);
            entry.work = tag.getIntOr("work", 0); // before the items, so every unlocked pocket is there to fill
            entry.level = levelFor(entry.work);
            entry.inventory.unlocked = pocketsFor(entry.level);
            entry.inventory.fromTag(tag.getListOrEmpty("items"));
            if (tag.contains("mineDim")) {
                entry.mineDim = tag.getStringOr("mineDim", "");
                entry.mineOrigin = net.minecraft.core.BlockPos.of(tag.getLongOr("mineOrigin", 0L));
                entry.mineDepth = tag.getIntOr("mineDepth", 0);
                if (tag.contains("mineMarker")) entry.mineMarker = net.minecraft.core.BlockPos.of(tag.getLongOr("mineMarker", 0L));
            }
            if (tag.contains("look")) entry.look = tag.getStringOr("look", "");
            entry.xp = tag.getIntOr("xp", 0);
            if (tag.contains("size")) entry.size = tag.getFloatOr("size", 0f);
            data.entries.put(owner, entry);
        }
        return data;
    }

        /** Pocket contents change without telling the saved data, so always save. */
    @Override
    public boolean isDirty() {
        return true;
    }

    public CompoundTag save(CompoundTag nbt) {
        ListTag list = new ListTag();
        entries.forEach((owner, entry) -> {
            CompoundTag tag = new CompoundTag();
            Compat.putUUID(tag, "owner", owner);
            if (entry.entity != null) Compat.putUUID(tag, "entity", entry.entity);
            tag.putBoolean("active", entry.active);
            tag.putBoolean("guard", entry.guard);
            tag.put("items", entry.inventory.createTag());
            if (entry.mineDim != null && entry.mineOrigin != null) {
                tag.putString("mineDim", entry.mineDim);
                tag.putLong("mineOrigin", entry.mineOrigin.asLong());
                tag.putInt("mineDepth", entry.mineDepth);
                if (entry.mineMarker != null) tag.putLong("mineMarker", entry.mineMarker.asLong());
            }
            if (entry.look != null) tag.putString("look", entry.look);
            if (entry.xp > 0) tag.putInt("xp", entry.xp);
            if (entry.work > 0) tag.putInt("work", entry.work);
            if (entry.size != 1f) tag.putFloat("size", entry.size);
            list.add(tag);
        });
        nbt.put("helpers", list);
        return nbt;
    }
}
