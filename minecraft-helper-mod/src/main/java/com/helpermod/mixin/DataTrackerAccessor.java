package com.helpermod.mixin;

import it.unimi.dsi.fastutil.objects.Object2IntMap;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(SynchedEntityData.class)
public interface DataTrackerAccessor {
    @Accessor("TRACKED_ENTITIES")
    static Object2IntMap<Class<? extends Entity>> helpermod$getTrackedEntities() {
        throw new AssertionError();
    }
}
