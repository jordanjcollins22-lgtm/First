package com.helpermod;

import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.enchantment.Enchantments;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.attribute.EntityAttribute;
import net.minecraft.entity.attribute.EntityAttributeModifier;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.mob.Angerable;
import net.minecraft.entity.mob.CreeperEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.entity.passive.TameableEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ItemStack;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.MathHelper;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

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
    public static LivingEntity findThreat(MobEntity helper, ServerPlayerEntity owner, boolean busy,
                                          java.util.Set<UUID> ignored) {
        boolean sameWorld = helper.getWorld() == owner.getWorld();
        if (sameWorld && helper.squaredDistanceTo(owner) < MAX_CHASE * MAX_CHASE) {
            LivingEntity hitByOwner = owner.getAttacking();
            if (hitByOwner != null && owner.age - owner.getLastAttackTime() < 100
                    && canFight(helper, owner, hitByOwner, true)) {
                return hitByOwner;
            }
            LivingEntity hurtOwner = owner.getAttacker();
            if (hurtOwner != null && canFight(helper, owner, hurtOwner, false)) return hurtOwner;
        }

        ServerWorld world = (ServerWorld) helper.getWorld();
        Box area = helper.getBoundingBox().expand(GUARD_RADIUS);
        if (sameWorld && !busy) area = area.union(owner.getBoundingBox().expand(GUARD_RADIUS));
        List<MobEntity> mobs = world.getEntitiesByClass(MobEntity.class, area, e ->
                e instanceof Monster && canFight(helper, owner, e, false) && !ignored.contains(e.getUuid())
                        && (helper.canSee(e) || (sameWorld && e.squaredDistanceTo(owner) < 6 * 6))
                        && (e.getTarget() == owner || e.getTarget() == helper
                        || (!busy && isAlwaysHostile(e) && sameWorld && e.squaredDistanceTo(owner) < 8 * 8)));
        return mobs.stream().min(Comparator.comparingDouble(helper::squaredDistanceTo)).orElse(null);
    }

    private static boolean isAlwaysHostile(MobEntity e) {
        return !(e instanceof Angerable) && !(e instanceof CreeperEntity);
    }

    /** Never fight players, other helpers, or anyone's pets; creepers only if the owner started it. */
    private static boolean canFight(MobEntity helper, ServerPlayerEntity owner, LivingEntity target,
                                    boolean ownerStarted) {
        if (target == helper || target == owner || !target.isAlive() || target.isRemoved()) return false;
        if (target.getWorld() != helper.getWorld()) return false;
        if (target instanceof PlayerEntity) return false;
        if (target.getCommandTags().contains(Helper.TAG)) return false;
        if (target instanceof TameableEntity pet && pet.isTamed()) return false;
        if (target instanceof CreeperEntity && !ownerStarted) return false;
        if (!ownerStarted && !(target instanceof Monster)) return false;
        return helper.squaredDistanceTo(target) < MAX_CHASE * MAX_CHASE;
    }

    public static boolean stillWorthFighting(MobEntity helper, ServerPlayerEntity owner, LivingEntity target,
                                             int ticks) {
        if (!target.isAlive() || target.isRemoved() || target.getWorld() != helper.getWorld()) return false;
        if (ticks > 20 * 30) return false; // don't chase forever
        return helper.squaredDistanceTo(target) <= MAX_CHASE * MAX_CHASE;
    }

    // ---------------------------------------------------------------------------------------
    // Gear
    // ---------------------------------------------------------------------------------------

    private static double modifierSum(ItemStack stack, EntityAttribute attribute) {
        double total = 0;
        for (EntityAttributeModifier mod : stack.getAttributeModifiers(EquipmentSlot.MAINHAND).get(attribute)) {
            if (mod.getOperation() == EntityAttributeModifier.Operation.ADDITION) total += mod.getValue();
        }
        return total;
    }

    private static float damageOf(ItemStack weapon) {
        return 1f + (float) modifierSum(weapon, EntityAttributes.GENERIC_ATTACK_DAMAGE);
    }

    private static double attackSpeedOf(ItemStack weapon) {
        return Math.max(0.5, 4.0 + modifierSum(weapon, EntityAttributes.GENERIC_ATTACK_SPEED));
    }

    /** Best weapon by damage per second, or -1 for fists. */
    public static int bestWeaponSlot(SimpleInventory inv) {
        int best = -1;
        double bestDps = 4.0; // fists: 1 damage, 4 hits a second
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            if (stack.isEmpty() || !Mining.isUsableTool(stack)) continue;
            if (modifierSum(stack, EntityAttributes.GENERIC_ATTACK_DAMAGE) <= 0) continue;
            double dps = damageOf(stack) * attackSpeedOf(stack);
            if (dps > bestDps) {
                bestDps = dps;
                best = i;
            }
        }
        return best;
    }

    /** Wear the best armor from the inventory, so you can see your helper gear up. */
    public static void wearBestArmor(MobEntity helper, SimpleInventory inv) {
        for (EquipmentSlot slot : new EquipmentSlot[]{
                EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
            ItemStack best = ItemStack.EMPTY;
            double bestScore = 0;
            for (int i = 0; i < inv.size(); i++) {
                ItemStack stack = inv.getStack(i);
                if (!(stack.getItem() instanceof ArmorItem armor) || armor.getSlotType() != slot) continue;
                double score = armor.getProtection() + armor.getToughness() * 0.5
                        + EnchantmentHelper.getLevel(Enchantments.PROTECTION, stack) * 0.1;
                if (score > bestScore) {
                    bestScore = score;
                    best = stack;
                }
            }
            if (!ItemStack.areEqual(helper.getEquippedStack(slot), best)) helper.equipStack(slot, best.copy());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Hitting
    // ---------------------------------------------------------------------------------------

    /** Swing at the target with the best weapon. Returns the cooldown in ticks before the next swing. */
    public static int attack(MobEntity helper, LivingEntity target, SimpleInventory inv) {
        int slot = bestWeaponSlot(inv);
        ItemStack weapon = slot >= 0 ? inv.getStack(slot) : ItemStack.EMPTY;
        if (!ItemStack.areEqual(helper.getMainHandStack(), weapon)) {
            helper.equipStack(EquipmentSlot.MAINHAND, weapon.copy());
        }
        float damage = damageOf(weapon) + EnchantmentHelper.getAttackDamage(weapon, target.getGroup());
        helper.swingHand(net.minecraft.util.Hand.MAIN_HAND);
        boolean hit = target.damage(helper.getDamageSources().mobAttack(helper), damage);
        if (hit) {
            int knockback = EnchantmentHelper.getLevel(Enchantments.KNOCKBACK, weapon);
            float yaw = helper.getYaw() * MathHelper.RADIANS_PER_DEGREE;
            target.takeKnockback(0.4 + knockback * 0.5, MathHelper.sin(yaw), -MathHelper.cos(yaw));
            int fire = EnchantmentHelper.getLevel(Enchantments.FIRE_ASPECT, weapon);
            if (fire > 0) target.setOnFireFor(4 * fire);
            if (!weapon.isEmpty() && weapon.isDamageable()) {
                weapon.damage(1, helper, e -> {});
                inv.markDirty();
            }
            helper.getWorld().playSound(null, helper.getX(), helper.getY(), helper.getZ(),
                    SoundEvents.ENTITY_PLAYER_ATTACK_STRONG, SoundCategory.NEUTRAL, 0.8f, 1f);
        }
        return Math.max(5, (int) Math.round(20.0 / attackSpeedOf(weapon)));
    }
}
