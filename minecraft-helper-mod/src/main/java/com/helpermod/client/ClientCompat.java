package com.helpermod.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

/** Small client bridges for calls whose names moved in newer Minecraft. */
final class ClientCompat {
    private ClientCompat() {}

    /** The menu that's open right now, or null when the player is just playing. */
    static Screen screen(Minecraft client) {
        for (Object owner : new Object[]{client, client.gui}) {
            if (owner == null) continue;
            for (Class<?> c = owner.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
                for (var f : c.getDeclaredFields()) {
                    if (!Screen.class.isAssignableFrom(f.getType()) || java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
                    try {
                        f.setAccessible(true);
                        return (Screen) f.get(owner);
                    } catch (Throwable ignored) {
                    }
                }
            }
        }
        return null;
    }

    private static java.lang.reflect.Field hideField;
    private static Object hideOwnerKind; // "options" or "gui"
    private static boolean hideLooked;

    /** Whether the HUD is hidden (F1). Found by name, since the field moved in newer Minecraft. */
    static boolean hudHidden(Minecraft client) {
        if (!hideLooked) {
            hideLooked = true;
            for (Object[] owner : new Object[][]{{"options", client.options}, {"gui", client.gui}}) {
                if (owner[1] == null || hideField != null) continue;
                for (Class<?> c = owner[1].getClass(); c != null && c != Object.class && hideField == null; c = c.getSuperclass()) {
                    for (var f : c.getDeclaredFields()) {
                        String n = f.getName().toLowerCase();
                        if (f.getType() == boolean.class && !java.lang.reflect.Modifier.isStatic(f.getModifiers())
                                && (n.equals("hidegui") || n.equals("hidehud") || n.equals("hidden") || n.equals("hudhidden"))) {
                            try {
                                f.setAccessible(true);
                                hideField = f;
                                hideOwnerKind = owner[0];
                            } catch (Throwable ignored) {
                            }
                            break;
                        }
                    }
                }
            }
        }
        if (hideField == null) return false;
        try {
            return hideField.getBoolean("options".equals(hideOwnerKind) ? client.options : client.gui);
        } catch (Throwable e) {
            return false;
        }
    }

    static void show(Minecraft client, Screen screen) {
        client.setScreenAndShow(screen);
    }

    /** Open a web page in the player's browser. */
    static void openUri(String uri) {
        Object os = net.minecraft.util.Util.getPlatform();
        for (Object target : new Object[]{os, null}) {
            Class<?> c = target == null ? net.minecraft.util.Util.class : target.getClass();
            for (var m : c.getMethods()) {
                if (!m.getName().toLowerCase().startsWith("open") || m.getParameterCount() != 1) continue;
                try {
                    Class<?> p = m.getParameterTypes()[0];
                    if (p == String.class) { m.invoke(target, uri); return; }
                    if (p == java.net.URI.class) { m.invoke(target, java.net.URI.create(uri)); return; }
                } catch (Throwable ignored) {
                }
            }
        }
        try {
            new ProcessBuilder(System.getProperty("os.name").toLowerCase().contains("win")
                    ? new String[]{"rundll32", "url.dll,FileProtocolHandler", uri}
                    : new String[]{"xdg-open", uri}).start();
        } catch (Exception ignored) {
        }
    }
}
