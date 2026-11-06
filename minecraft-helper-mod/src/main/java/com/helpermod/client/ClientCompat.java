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
