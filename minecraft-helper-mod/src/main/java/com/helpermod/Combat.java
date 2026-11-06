package com.helpermod;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.NeutralMob;
import net.minecraft.world.entity.TamableAnimal;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.monster.Creeper;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.phys.AABB;

/** How helpers pick fights, choose weapons and armor, and hit things. */
public final class Combat {
    private Combat() {}

    public static final double REACH_SQ = 3.0 * 3.0;
    public static final double CHASE_SPEED = 0.8;
    private static final double GUARD_RADIUS = 12;
    private static final double MAX_CHASE = 24;

    // ---------------------------------------------------------------------------------------
    // Picking a target
    // ---------------------------------------------------------------------------------------

    /**
     * In order: whatever the owner is fighting, whatever hurt the owner, then hostile mobs going
     * after the owner or the helper. While collecting, the helper only defends itself and nearby owner.
     */
    public static LivingEntity findThreat(Mob helper, ServerPlayer owner, boolean busy,
                                          java.util.Set<UUID> ignored) {
        boolean sameWorld = helper.level() == owner.level();
        if (sameWorld && helper.distanceToSqr(owner) < MAX_CHASE * MAX_CHASE) {
            LivingEntity hitByOwner = owner.getLastHurtMob();
            if (hitByOwner != null && owner.tickCount - owner.getLastHurtMobTimestamp() < 100
                    && canFight(helper, owner, hitByOwner, true)) {
                return hitByOwner;
            }
            LivingEntity hurtOwner = owner.getLastHurtByMob();
            if (hurtOwner != null && canFight(helper, owner, hurtOwner, false)) return hurtOwner;
        }

        ServerLevel world = (ServerLevel) helper.level();
        AABB area = helper.getBoundingBox().inflate(GUARD_RADIUS);
        if (sameWorld && !busy) area = area.minmax(owner.getBoundingBox().inflate(GUARD_RADIUS));
        List<Mob> mobs = world.getEntitiesOfClass(Mob.class, area, e ->
                e instanceof Enemy && canFight(helper, owner, e, false) && !ignored.contains(e.getUUID())
                        && (helper.hasLineOfSight(e) || (sameWorld && e.distanceToSqr(owner) < 6 * 6))
                        && (e.getTarget() == owner || e.getTarget() == helper
                        || (!busy && isAlwaysHostile(e) && sameWorld && e.distanceToSqr(owner) < 8 * 8)));
        return mobs.stream().min(Comparator.comparingDouble(helper::distanceToSqr)).orElse(null);
    }

    private static boolean isAlwaysHostile(Mob e) {
        return !(e instanceof NeutralMob) && !(e instanceof Creeper);
    }

    /** Never fight players, other helpers, or anyone's pets; creepers only if the owner started it. */
    private static boolean canFight(Mob helper, ServerPlayer owner, LivingEntity target,
                                    boolean ownerStarted) {
        if (target == helper || target == owner || !target.isAlive() || target.isRemoved()) return false;
        if (target.level() != helper.level()) return false;
        if (target instanceof Player) return false;
        if (target.getTags().contains(Helper.TAG)) return false;
        if (target instanceof TamableAnimal pet && pet.isTame()) return false;
        if (target instanceof Creeper && !ownerStarted) return false;
        if (!ownerStarted && !(target instanceof Enemy)) return false;
        return helper.distanceToSqr(target) < MAX_CHASE * MAX_CHASE;
    }

    public static boolean stillWorthFighting(Mob helper, ServerPlayer owner, LivingEntity target,
                                             int ticks) {
        if (!target.isAlive() || target.isRemoved() || target.level() != helper.level()) return false;
        if (ticks > 20 * 30) return false; // don't chase forever
        return helper.distanceToSqr(target) <= MAX_CHASE * MAX_CHASE;
    }

    // ---------------------------------------------------------------------------------------
    // Gear
    // ---------------------------------------------------------------------------------------

    private static double modifierSum(ItemStack stack, Attribute attribute) {
        double total = 0;
        for (AttributeModifier mod : stack.getAttributeModifiers(EquipmentSlot.MAINHAND).get(attribute)) {
            if (mod.getOperation() == AttributeModifier.Operation.ADDITION) total += mod.getAmount();
        }
        return total;
    }

    private static float damageOf(ItemStack weapon) {
        return 1f + (float) modifierSum(weapon, Attributes.ATTACK_DAMAGE);
    }

    private static double attackSpeedOf(ItemStack weapon) {
        return Math.max(0.5, 4.0 + modifierSum(weapon, Attributes.ATTACK_SPEED));
    }

    /** Best weapon by damage per second, or -1 for fists. */
    public static int bestWeaponSlot(SimpleContainer inv) {
        int best = -1;
        double bestDps = 4.0; // fists: 1 damage, 4 hits a second
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack stack = inv.getItem(i);
            if (stack.isEmpty() || !Mining.isUsableTool(stack)) continue;
            if (modifierSum(stack, Attributes.ATTACK_DAMAGE) <= 0) continue;
            double dps = damageOf(stack) * attackSpeedOf(stack);
            if (dps > bestDps) {
                bestDps = dps;
                best = i;
            }
        }
        return best;
    }

    /** Wear the best armor from the inventory, so you can see your helper gear up. */
    public static void wearBestArmor(Mob helper, SimpleContainer inv) {
        for (EquipmentSlot slot : new EquipmentSlot[]{
                EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
            ItemStack best = ItemStack.EMPTY;
            double bestScore = 0;
            for (int i = 0; i < inv.getContainerSize(); i++) {
                ItemStack stack = inv.getItem(i);
                if (!(stack.getItem() instanceof ArmorItem armor) || armor.getEquipmentSlot() != slot) continue;
                double score = armor.getDefense() + armor.getToughness() * 0.5
                        + EnchantmentHelper.getItemEnchantmentLevel(Enchantments.ALL_DAMAGE_PROTECTION, stack) * 0.1;
                if (score > bestScore) {
                    bestScore = score;
                    best = stack;
                }
            }
            if (!ItemStack.matches(helper.getItemBySlot(slot), best)) helper.setItemSlot(slot, best.copy());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Hitting
    // ---------------------------------------------------------------------------------------

    /**
     * Mobs only drop XP when a player hurt them recently. Count the helper's hit as its owner's,
     * so what it kills drops XP for the helper to bring back.
     */
    private static void creditOwner(Mob helper, LivingEntity target) {
        java.util.UUID owner = Helper.ownerOf(helper);
        if (owner == null || helper.getServer() == null) return;
        net.minecraft.server.level.ServerPlayer player = helper.getServer().getPlayerList().getPlayer(owner);
        if (player == null) return;
        ((com.helpermod.mixin.LivingEntityAccessor) target).helpermod$setAttackingPlayer(player);
        ((com.helpermod.mixin.LivingEntityAccessor) target).helpermod$setPlayerHitTimer(100);
    }

    /** Swing at the target with the best weapon. Returns the cooldown in ticks before the next swing. */
    public static int attack(Mob helper, LivingEntity target, SimpleContainer inv,
                             java.util.function.Consumer<String> onWornOut) {
        int slot = bestWeaponSlot(inv);
        ItemStack weapon = slot >= 0 ? inv.getItem(slot) : ItemStack.EMPTY;
        if (!ItemStack.matches(helper.getMainHandItem(), weapon)) {
            helper.setItemSlot(EquipmentSlot.MAINHAND, weapon.copy());
        }
        float damage = damageOf(weapon) + EnchantmentHelper.getDamageBonus(weapon, target.getMobType());
        helper.swing(net.minecraft.world.InteractionHand.MAIN_HAND);
        creditOwner(helper, target);
        boolean hit = target.hurt(helper.damageSources().mobAttack(helper), damage);
        if (hit) {
            int knockback = EnchantmentHelper.getItemEnchantmentLevel(Enchantments.KNOCKBACK, weapon);
            float yaw = helper.getYRot() * Mth.DEG_TO_RAD;
            target.knockback(0.4 + knockback * 0.5, Mth.sin(yaw), -Mth.cos(yaw));
            int fire = EnchantmentHelper.getItemEnchantmentLevel(Enchantments.FIRE_ASPECT, weapon);
            if (fire > 0) target.setSecondsOnFire(4 * fire);
            if (!weapon.isEmpty() && weapon.isDamageableItem()) {
                weapon.hurtAndBreak(1, helper, e -> {});
                inv.setChanged();
                if (!Mining.isUsableTool(weapon)) onWornOut.accept(weapon.getHoverName().getString());
            }
            helper.level().playSound(null, helper.getX(), helper.getY(), helper.getZ(),
                    SoundEvents.PLAYER_ATTACK_STRONG, SoundSource.NEUTRAL, 0.8f, 1f);
        }
        return Math.max(5, (int) Math.round(20.0 / attackSpeedOf(weapon)));
    }
}
