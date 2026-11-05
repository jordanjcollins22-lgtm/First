package com.helpermod;

import net.fabricmc.fabric.api.resource.ResourceManagerHelper;
import net.fabricmc.fabric.api.resource.ResourcePackActivationType;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

/**
 * Extra real planets (Europa, Io, Titan, Ceres, Pluto) for Ad Astra.
 *
 * The planets are plain Ad Astra data: planet files, dimensions, terrain, ores and sky renderers,
 * kept in the built-in pack resourcepacks/space. The pack is only switched on when Ad Astra is
 * installed, because the dimensions use Ad Astra's terrain functions and its orbit biome.
 */
final class Space {
    private Space() {}

    static void register() {
        if (!FabricLoader.getInstance().isModLoaded("ad_astra")) {
            HelperMod.LOG.info("Ad Astra not installed, so the extra planets stay off");
            return;
        }
        FabricLoader.getInstance().getModContainer(HelperMod.MOD_ID).ifPresent(mod -> {
            boolean ok = ResourceManagerHelper.registerBuiltinResourcePack(
                    new Identifier(HelperMod.MOD_ID, "space"), mod,
                    Text.literal("Helper Buddies: real planets"), ResourcePackActivationType.ALWAYS_ENABLED);
            HelperMod.LOG.info(ok ? "Added Europa, Io, Titan, Ceres and Pluto to Ad Astra" : "Could not add the extra planets");
        });
    }
}
