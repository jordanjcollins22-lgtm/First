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

    // ---- gear (tool/armour classes are data components now) ----

    /** Sum of the item's flat bonuses to an attribute when worn or held in that slot. */
    public static double modifierSum(ItemStack stack, Holder<net.minecraft.world.entity.ai.attributes.Attribute> attribute,
                                     net.minecraft.world.entity.EquipmentSlot slot) {
        double[] total = {0};
        stack.forEachModifier(slot, (attr, mod) -> {
            if (attr.is(attribute) && mod.operation() == net.minecraft.world.entity.ai.attributes.AttributeModifier.Operation.ADD_VALUE) {
                total[0] += mod.amount();
            }
        });
        return total[0];
    }

    /** The armour slot this item is worn in, or null when it is not armour. */
    @org.jetbrains.annotations.Nullable
    public static net.minecraft.world.entity.EquipmentSlot armorSlot(ItemStack stack) {
        net.minecraft.world.item.equipment.Equippable eq = stack.get(DataComponents.EQUIPPABLE);
        if (eq == null) return null;
        net.minecraft.world.entity.EquipmentSlot slot = eq.slot();
        return slot.getType() == net.minecraft.world.entity.EquipmentSlot.Type.HUMANOID_ARMOR ? slot : null;
    }

    public static boolean isArmor(ItemStack stack) {
        return armorSlot(stack) != null;
    }

    /** Armour points plus half the toughness, for picking the best piece. */
    public static double armorValue(ItemStack stack) {
        net.minecraft.world.entity.EquipmentSlot slot = armorSlot(stack);
        if (slot == null) return 0;
        return modifierSum(stack, net.minecraft.world.entity.ai.attributes.Attributes.ARMOR, slot)
                + modifierSum(stack, net.minecraft.world.entity.ai.attributes.Attributes.ARMOR_TOUGHNESS, slot) * 0.5;
    }

    /** Swords, axes, spears and the like: items with a weapon component or attack damage. */
    public static boolean isWeapon(ItemStack stack) {
        return stack.has(DataComponents.WEAPON)
                || modifierSum(stack, net.minecraft.world.entity.ai.attributes.Attributes.ATTACK_DAMAGE, net.minecraft.world.entity.EquipmentSlot.MAINHAND) > 0;
    }

    /** Pickaxes, shovels, axes, hoes: items with a tool component. */
    public static boolean isTool(ItemStack stack) {
        return stack.has(DataComponents.TOOL);
    }

    /** How tall a step the mob walks up without jumping. */
    public static void setStep(net.minecraft.world.entity.LivingEntity e, float height) {
        net.minecraft.world.entity.ai.attributes.AttributeInstance a = e.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.STEP_HEIGHT);
        if (a != null) a.setBaseValue(height);
    }

    /** Whether a tamed animal belongs to this player. */
    public static boolean ownedBy(net.minecraft.world.entity.OwnableEntity pet, java.util.UUID player) {
        var ref = pet.getOwnerReference();
        return ref != null && ref.getUUID().equals(player);
    }

    public static boolean ownedBy(net.minecraft.world.entity.animal.equine.AbstractHorse horse, java.util.UUID player) {
        var ref = horse.getOwnerReference();
        return ref != null && ref.getUUID().equals(player);
    }

    // ---- item lists and entities in tags ----

    /** Like 1.20.1's ContainerHelper.saveAllItems: {Items: [{Slot, ...stack}]}. */
    public static CompoundTag saveItems(java.util.List<ItemStack> items) {
        net.minecraft.nbt.ListTag list = new net.minecraft.nbt.ListTag();
        for (int i = 0; i < items.size(); i++) {
            ItemStack st = items.get(i);
            if (st.isEmpty()) continue;
            CompoundTag t = saveStack(st);
            t.putByte("Slot", (byte) i);
            list.add(t);
        }
        CompoundTag out = new CompoundTag();
        out.put("Items", list);
        return out;
    }

    public static void loadItems(CompoundTag tag, java.util.List<ItemStack> items) {
        net.minecraft.nbt.ListTag list = tag.getListOrEmpty("Items");
        for (int i = 0; i < list.size(); i++) {
            CompoundTag t = list.getCompoundOrEmpty(i);
            int slot = t.getByteOr("Slot", (byte) 0) & 255;
            if (slot < items.size()) items.set(slot, loadStack(t));
        }
    }

    /** An entity from saved data, placed by the processor (like 1.20.1's EntityType.loadEntityRecursive). */
    @org.jetbrains.annotations.Nullable
    public static Entity loadEntity(CompoundTag nbt, net.minecraft.server.level.ServerLevel world,
                                    java.util.function.UnaryOperator<Entity> place) {
        net.minecraft.world.level.storage.ValueInput in = net.minecraft.world.level.storage.TagValueInput.create(
                net.minecraft.util.ProblemReporter.DISCARDING, world.registryAccess(), nbt);
        return net.minecraft.world.entity.EntityType.loadEntityRecursive(in, world,
                net.minecraft.world.entity.EntitySpawnReason.LOAD, place::apply);
    }

    /** A player's name by UUID: online players, then the server's name cache. Null when unknown. */
    @org.jetbrains.annotations.Nullable
    public static String playerName(net.minecraft.server.MinecraftServer server, java.util.UUID id) {
        net.minecraft.server.level.ServerPlayer p = server.getPlayerList().getPlayer(id);
        if (p != null) return p.getGameProfile().name();
        return server.services().nameToIdCache().get(id).map(net.minecraft.server.players.NameAndId::name).orElse(null);
    }

    /** An entity type by id, like "minecraft:zombie". */
    public static java.util.Optional<net.minecraft.world.entity.EntityType<?>> entityType(String id) {
        net.minecraft.resources.Identifier key = net.minecraft.resources.Identifier.tryParse(id);
        if (key == null || id.isEmpty()) return java.util.Optional.empty();
        return net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getOptional(key);
    }
}
