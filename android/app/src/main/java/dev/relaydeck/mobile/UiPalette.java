package dev.relaydeck.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

final class UiPalette {
    private static final java.util.WeakHashMap<Context,UiPalette> palettes=new java.util.WeakHashMap<>();
    static synchronized UiPalette of(Context context){UiPalette value=palettes.get(context);if(value==null){value=new UiPalette(context);palettes.put(context,value);}return value;}
    final boolean dark;
    final int background, foreground, muted, accent;
    final int surface, raised, subtle, border, borderStrong, active, userBubble;
    final int success, warning, danger, codeBackground;
    UiPalette(Context context) {
        SharedPreferences p=context.getSharedPreferences("display",Context.MODE_PRIVATE);
        dark=SolarTheme.dark(p.getString("mode","light"),p.getBoolean("solar",false),p.contains("latitude"),
            Double.longBitsToDouble(p.getLong("latitude",0)),Double.longBitsToDouble(p.getLong("longitude",0)),System.currentTimeMillis());
        background=dark?Color.rgb(17,17,17):Color.rgb(247,246,243);
        foreground=dark?Color.rgb(244,244,245):Color.rgb(28,28,27);
        muted=dark?Color.rgb(161,161,170):Color.rgb(103,103,99);
        accent=dark?Color.rgb(232,226,215):Color.rgb(47,45,41);
        surface=dark?Color.rgb(24,24,27):Color.rgb(255,255,253);
        raised=dark?Color.rgb(35,35,38):Color.rgb(239,238,234);
        subtle=dark?Color.rgb(21,21,23):Color.rgb(242,240,236);
        border=dark?Color.rgb(49,49,53):Color.rgb(222,219,212);
        borderStrong=dark?Color.rgb(66,66,71):Color.rgb(201,197,189);
        active=dark?Color.rgb(39,39,42):Color.rgb(236,234,229);
        userBubble=dark?Color.rgb(48,48,52):Color.rgb(232,230,225);
        success=dark?Color.rgb(112,165,125):Color.rgb(63,115,81);
        warning=dark?Color.rgb(214,160,75):Color.rgb(154,106,25);
        danger=dark?Color.rgb(224,108,95):Color.rgb(181,72,60);
        codeBackground=dark?Color.rgb(20,20,22):Color.rgb(242,240,236);
    }
    static int color(Context context,int original) {
        if(of(context).dark)return original;
        int r=Color.red(original),g=Color.green(original),b=Color.blue(original);
        if(Math.max(r,Math.max(g,b))<=90) {
            int spread=Math.max(r,Math.max(g,b))-Math.min(r,Math.min(g,b));
            if(spread<5){int light=Math.min(250,268-(r+g+b)/3);return Color.rgb(light,light,light);}
            return Color.rgb(238,244,240);
        }
        return original;
    }
}
