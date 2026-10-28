package dev.relaydeck.mobile;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.content.res.ColorStateList;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Shared light, web-like primitives. No third-party bitmap assets or remote fonts. */
final class ChatGptMobileStyle {
    static final int WHITE = Color.rgb(255,255,255);
    static final int INK = Color.rgb(24,24,24);
    static final int MUTED = Color.rgb(114,114,114);
    static final int HAIRLINE = Color.rgb(232,232,232);
    static final int SOFT = Color.rgb(246,246,246);
    static final int SOFT_PRESSED = Color.rgb(236,236,236);
    static final int BLUE = Color.rgb(53,91,224);

    private ChatGptMobileStyle() {}

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable shape(Context context, int fill, float radiusDp, int... stroke) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(context, radiusDp));
        if (stroke.length >= 2) shape.setStroke(dp(context, stroke[0]), stroke[1]);
        return shape;
    }

    static GradientDrawable capsule(Context context, int fill) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(context, 999));
        return shape;
    }

    static GradientDrawable outlinedCapsule(Context context, int fill, int stroke) {
        GradientDrawable shape = capsule(context, fill);
        shape.setStroke(dp(context, 1), stroke);
        return shape;
    }

    static TextView text(Context context, String value, float size, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setIncludeFontPadding(false);
        view.setTextIsSelectable(false);
        view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        return view;
    }

    static TextView actionText(Context context, String label, int color, Runnable action) {
        TextView view = text(context, label, 13, color, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8));
        view.setBackground(pressable(context, capsule(context, SOFT), SOFT_PRESSED, 0));
        view.setOnClickListener(v -> { if (action != null) action.run(); });
        return view;
    }

    static Button circularIcon(Context context, String icon, String description, int fill, int tint) {
        Button button = new Button(context);
        button.setText("");
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(context, 13), dp(context, 13), dp(context, 13), dp(context, 13));
        UiIcon image = new UiIcon(icon, tint);
        image.setBounds(0, 0, dp(context, 22), dp(context, 22));
        button.setCompoundDrawables(image, null, null, null);
        button.setBackground(pressable(context, capsule(context, fill), SOFT_PRESSED, 0));
        button.setContentDescription(description);
        button.setStateListAnimator(null);
        button.setElevation(0);
        return button;
    }

    static Drawable pressable(Context context, Drawable content, int ripple, float elevation) {
        RippleDrawable drawable = new RippleDrawable(
            ColorStateList.valueOf(ripple),
            content,
            null
        );
        return drawable;
    }

    static LinearLayout row(Context context) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    static LinearLayout column(Context context) {
        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        return column;
    }

    static LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    static LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    static LinearLayout.LayoutParams weight(int weight) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight);
    }

    static void setMargins(View view, int left, int top, int right, int bottom) {
        if (view.getLayoutParams() instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            params.setMargins(left, top, right, bottom);
            view.setLayoutParams(params);
        }
    }

    /** Floating composer used by the home and conversation screens. */
    static LinearLayout composerBar(Context context, View left, View input, View right) {
        LinearLayout shell = row(context);
        shell.setPadding(dp(context, 8), dp(context, 7), dp(context, 8), dp(context, 7));
        shell.setBackground(outlinedCapsule(context, WHITE, HAIRLINE));
        shell.setElevation(dp(context, 7));
        if (left != null) shell.addView(left, new LinearLayout.LayoutParams(dp(context, 42), dp(context, 42)));
        input.setBackgroundColor(Color.TRANSPARENT);
        shell.addView(input, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (right != null) shell.addView(right, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(context, 44)));
        return shell;
    }

    static TextView chip(Context context, String value, int fill, int color) {
        TextView chip = text(context, value, 12, color, true);
        chip.setGravity(Gravity.CENTER);
        chip.setPadding(dp(context, 10), dp(context, 6), dp(context, 10), dp(context, 6));
        chip.setBackground(capsule(context, fill));
        return chip;
    }

    static void divider(LinearLayout parent, Context context) {
        View line = new View(context);
        line.setBackgroundColor(HAIRLINE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 1));
        params.topMargin = dp(context, 8);
        params.bottomMargin = dp(context, 8);
        parent.addView(line, params);
    }
}
