package com.helpermod;

import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.ItemEnchantments;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

import java.util.function.Function;
import java.util.function.Supplier;

/** Small bridges for things Minecraft 26 does differently from 1.20.1, so the rest of the code stays readable. */
public final class Compat {
    private Compat() {}

    /** Saved data stored as one compound tag, like 1.20.1's SavedData#save/load. Keep the result in a static field. */
    public static <T extends SavedData> SavedDataType<T> dataType(String id, Supplier<T> create,
                                                                  Function<CompoundTag, T> load, Function<T, CompoundTag> save) {
        String path = id.startsWith(HelperMod.MOD_ID + "_") ? id.substring(HelperMod.MOD_ID.length() + 1) : id;
        return new SavedDataType<>(Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, path), create,
                CompoundTag.CODEC.xmap(load, save), null);
    }

    /** An enchantment from the world's registry (enchantments are data-driven now). */
    public static Holder<Enchantment> ench(Level level, ResourceKey<Enchantment> key) {
        return level.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(key);
    }

    public static Holder<Enchantment> ench(Entity entity, ResourceKey<Enchantment> key) {
        return ench(entity.level(), key);
    }

    /** The level of an enchantment on a stack, 0 when absent. */
    public static int enchLevel(ResourceKey<Enchantment> key, ItemStack stack) {
        ItemEnchantments all = stack.getOrDefault(DataComponents.ENCHANTMENTS, ItemEnchantments.EMPTY);
        for (var e : all.entrySet()) if (e.getKey().is(key)) return e.getIntValue();
        return 0;
    }

    /** Swing an arm, shown to everyone nearby. */
    public static void swing(net.minecraft.world.entity.LivingEntity e, net.minecraft.world.InteractionHand hand) {
        e.swing(hand, net.minecraft.world.item.component.SwingAnimation.DEFAULT, true);
    }

    /** Knock an entity back like a normal hit. */
    public static void knockback(net.minecraft.world.entity.LivingEntity e, double strength, double x, double z) {
        e.knockback(strength, x, z, e.damageSources().generic(), 0f);
    }

    /** Teleport keeping the given facing, across worlds if needed. */
    public static boolean teleport(Entity e, net.minecraft.server.level.ServerLevel level, double x, double y, double z, float yaw, float pitch) {
        return e.teleportTo(level, x, y, z, java.util.Set.of(), yaw, pitch, true);
    }

    /** A sound only this player hears. */
    public static void notifySound(net.minecraft.server.level.ServerPlayer p, net.minecraft.sounds.SoundEvent sound,
                                   net.minecraft.sounds.SoundSource source, float volume, float pitch) {
        p.connection.send(new net.minecraft.network.protocol.game.ClientboundSoundPacket(
                net.minecraft.core.Holder.direct(sound), source, p.getX(), p.getY(), p.getZ(), volume, pitch, p.getRandom().nextLong()));
    }

    public static void notifySound(net.minecraft.server.level.ServerPlayer p, net.minecraft.core.Holder<net.minecraft.sounds.SoundEvent> sound,
                                   net.minecraft.sounds.SoundSource source, float volume, float pitch) {
        p.connection.send(new net.minecraft.network.protocol.game.ClientboundSoundPacket(
                sound, source, p.getX(), p.getY(), p.getZ(), volume, pitch, p.getRandom().nextLong()));
    }

    /** Whether an item can be eaten. */
    public static boolean edible(ItemStack s) {
        return s.has(DataComponents.FOOD);
    }

    /** An item's plain name, like "Iron Ingot". */
    public static net.minecraft.network.chat.Component name(net.minecraft.world.item.Item item) {
        return net.minecraft.network.chat.Component.translatable(item.getDescriptionId());
    }

    // ---- item custom data (1.20.1 item NBT) ----

    /** A copy of the item's custom data, or null when it has none (like 1.20.1's getTag()). */
    @org.jetbrains.annotations.Nullable
    public static CompoundTag tag(ItemStack stack) {
        net.minecraft.world.item.component.CustomData data = stack.get(DataComponents.CUSTOM_DATA);
        return data == null ? null : data.copyTag();
    }

    public static boolean hasTag(ItemStack stack) {
        return stack.has(DataComponents.CUSTOM_DATA);
    }

    /** Change the item's custom data in place (like editing 1.20.1's getOrCreateTag()). */
    public static void editTag(ItemStack stack, java.util.function.Consumer<CompoundTag> edit) {
        net.minecraft.world.item.component.CustomData.update(DataComponents.CUSTOM_DATA, stack, edit);
    }

    /** Lore lines under the item name. */
    public static void lore(ItemStack stack, java.util.List<net.minecraft.network.chat.Component> lines) {
        stack.set(DataComponents.LORE, new net.minecraft.world.item.component.ItemLore(lines));
    }

    // ---- saving item stacks ----

    private static net.minecraft.server.MinecraftServer server;

    static void serverStarting(net.minecraft.server.MinecraftServer s) { server = s; }

    static void serverStopped() { server = null; }

    public static net.minecraft.core.HolderLookup.Provider registries() {
        return server != null ? server.registryAccess() : net.minecraft.core.RegistryAccess.EMPTY;
    }

    /** An item stack as a compound tag (empty tag for an empty stack). */
    public static CompoundTag saveStack(ItemStack stack) {
        if (stack.isEmpty()) return new CompoundTag();
        net.minecraft.nbt.Tag t = ItemStack.CODEC.encodeStart(registries().createSerializationContext(net.minecraft.nbt.NbtOps.INSTANCE), stack)
                .result().orElse(null);
        return t instanceof CompoundTag c ? c : new CompoundTag();
    }

    /** The stack saved by saveStack, or an empty stack. */
    public static ItemStack loadStack(CompoundTag tag) {
        if (tag == null || tag.isEmpty()) return ItemStack.EMPTY;
        return ItemStack.CODEC.parse(registries().createSerializationContext(net.minecraft.nbt.NbtOps.INSTANCE), tag)
                .result().orElse(ItemStack.EMPTY);
    }

    // ---- UUIDs in tags ----

    public static void putUUID(CompoundTag tag, String key, java.util.UUID id) {
        tag.store(key, net.minecraft.core.UUIDUtil.CODEC, id);
    }

    @org.jetbrains.annotations.Nullable
    public static java.util.UUID getUUID(CompoundTag tag, String key) {
        return tag.read(key, net.minecraft.core.UUIDUtil.CODEC).orElse(null);
    }

    public static net.minecraft.nbt.Tag uuidTag(java.util.UUID id) {
        return new net.minecraft.nbt.IntArrayTag(net.minecraft.core.UUIDUtil.uuidToIntArray(id));
    }

    @org.jetbrains.annotations.Nullable
    public static java.util.UUID uuidOf(net.minecraft.nbt.Tag tag) {
        return tag instanceof net.minecraft.nbt.IntArrayTag a && a.getAsIntArray().length == 4
                ? net.minecraft.core.UUIDUtil.uuidFromIntArray(a.getAsIntArray()) : null;
    }

    /** An enchantment from the running server's registry (for building items outside a world). */
    public static Holder<Enchantment> ench(ResourceKey<Enchantment> key) {
        return registries().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(key);
    }
}
