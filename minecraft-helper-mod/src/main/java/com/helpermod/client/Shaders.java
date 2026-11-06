package com.helpermod.client;

import java.io.Reader;
import java.io.Writer;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Properties;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/**
 * Helper Shaders: a full-screen look (colour grading, soft glow around bright things, vignette) made from vanilla
 * post-effect shaders in assets/helpermod/post_effect, so no other mod is needed. Press F6 to switch it on and off,
 * or /shaders vibrant|sunset|night|off. The choice is kept in config/helpermod-shaders.properties.
 */
final class Shaders {
    private Shaders() {}

    static final String[] LOOKS = {"vibrant", "sunset", "night"};
    static boolean enabled = false;
    static String look = "vibrant";
    private static final int KEY = 295; // GLFW_KEY_F6
    private static boolean keyWasDown;
    private static boolean failed;

    static Identifier id() {
        return Identifier.fromNamespaceAndPath("helpermod", look);
    }

    static void tick(Minecraft client) {
        if (client.level == null) return;
        boolean down = keyDown(client);
        if (down && !keyWasDown && ClientCompat.screen(client) == null) {
            enabled = !enabled;
            failed = false;
            save();
            tell(client, enabled ? "Shaders on: " + nice(look) + " (F6 or /shaders to change)" : "Shaders off");
        }
        keyWasDown = down;
        if (failed) return;
        // Keep it applied: the game drops post effects when you change view (spectating a mob, F5...).
        Identifier now = current(client.gameRenderer);
        boolean ours = now != null && now.getNamespace().equals("helpermod");
        if (enabled && (!ours || !now.equals(id()))) apply(client, id());
        else if (!enabled && ours) clear(client.gameRenderer);
    }

    static String nice(String l) {
        return Character.toUpperCase(l.charAt(0)) + l.substring(1);
    }

    static void tell(Minecraft client, String text) {
        if (client.player != null) client.player.sendOverlayMessage(Component.literal(text).withStyle(ChatFormatting.AQUA));
    }

    // ---------------------------------------------------------------------------------------
    // GameRenderer's post effect, found by type so renames between versions don't matter
    // ---------------------------------------------------------------------------------------

    private static Method setter, clearer;
    private static Field idField, activeField;
    private static boolean looked;

    private static void look() {
        if (looked) return;
        looked = true;
        for (Method m : GameRenderer.class.getDeclaredMethods()) {
            if (Modifier.isStatic(m.getModifiers())) continue;
            String n = m.getName().toLowerCase(Locale.ROOT);
            if (m.getParameterCount() == 1 && m.getParameterTypes()[0] == Identifier.class && m.getReturnType() == void.class
                    && (n.contains("post") || setter == null)) {
                if (setter == null || n.contains("post")) setter = m;
            }
            if (m.getParameterCount() == 0 && m.getReturnType() == void.class && n.contains("clear") && n.contains("post")) clearer = m;
        }
        for (Field f : GameRenderer.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            String n = f.getName().toLowerCase(Locale.ROOT);
            if (f.getType() == Identifier.class && (idField == null || n.contains("post"))) idField = f;
            if (f.getType() == boolean.class && n.contains("effect") && n.contains("active")) activeField = f;
        }
        for (var x : new java.lang.reflect.AccessibleObject[]{setter, clearer, idField, activeField}) {
            if (x != null) x.setAccessible(true);
        }
        if (setter == null) com.helpermod.HelperMod.LOG.warn("Helper shaders: couldn't find how to set a post effect");
    }

    private static Identifier current(GameRenderer r) {
        look();
        try {
            if (idField == null) return null;
            if (activeField != null && !activeField.getBoolean(r)) return null;
            return (Identifier) idField.get(r);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    private static void apply(Minecraft client, Identifier id) {
        look();
        try {
            if (setter == null) throw new IllegalStateException("no post effect setter");
            setter.invoke(client.gameRenderer, id);
        } catch (ReflectiveOperationException | RuntimeException e) {
            failed = true;
            com.helpermod.HelperMod.LOG.warn("Helper shaders: couldn't switch on " + id, e);
            tell(client, "Sorry, the shaders couldn't start on this version of Minecraft.");
        }
    }

    private static void clear(GameRenderer r) {
        look();
        try {
            if (clearer != null) clearer.invoke(r);
            else if (activeField != null) activeField.setBoolean(r, false);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
        }
    }

    // ---------------------------------------------------------------------------------------
    // The F6 key, read straight from the window so it needs no key binding API
    // ---------------------------------------------------------------------------------------

    private static Method handle;

    private static boolean keyDown(Minecraft client) {
        try {
            Object window = client.getWindow();
            if (handle == null) {
                for (Method m : window.getClass().getMethods()) {
                    if (m.getParameterCount() == 0 && m.getReturnType() == long.class
                            && (m.getName().equals("handle") || m.getName().equals("getWindow"))) handle = m;
                }
                if (handle == null) return false;
            }
            long h = (long) handle.invoke(window);
            return org.lwjgl.glfw.GLFW.glfwGetKey(h, KEY) == org.lwjgl.glfw.GLFW.GLFW_PRESS;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            return false;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------------------------

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("helpermod-shaders.properties");
    }

    static void load() {
        Properties p = new Properties();
        try (Reader r = Files.newBufferedReader(file())) {
            p.load(r);
        } catch (Exception e) {
            return;
        }
        enabled = "true".equals(p.getProperty("enabled"));
        String l = p.getProperty("look", look);
        for (String x : LOOKS) if (x.equals(l)) look = l;
    }

    static void save() {
        Properties p = new Properties();
        p.setProperty("enabled", String.valueOf(enabled));
        p.setProperty("look", look);
        try (Writer w = Files.newBufferedWriter(file())) {
            p.store(w, "Helper Buddies shaders");
        } catch (Exception ignored) {
        }
    }

    /** /shaders [on|off|vibrant|sunset|night]. */
    static String command(String arg) {
        failed = false;
        if (arg == null) enabled = !enabled;
        else if (arg.equals("on")) enabled = true;
        else if (arg.equals("off")) enabled = false;
        else {
            look = arg;
            enabled = true;
        }
        save();
        return enabled ? "Shaders on: " + nice(look) + ". F6 switches them off, /shaders vibrant|sunset|night changes the look."
                : "Shaders off. F6 or /shaders on brings them back.";
    }
}
