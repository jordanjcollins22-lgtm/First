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
            list.add(tag);
        });
        nbt.put("helpers", list);
        return nbt;
    }
}
