package com.helpermod.mixin;

import it.unimi.dsi.fastutil.objects.Object2IntMap;
import net.minecraft.entity.Entity;
import net.minecraft.entity.data.DataTracker;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(DataTracker.class)
public interface DataTrackerAccessor {
    @Accessor("TRACKED_ENTITIES")
    static Object2IntMap<Class<? extends Entity>> helpermod$getTrackedEntities() {
        throw new AssertionError();
    }
}
