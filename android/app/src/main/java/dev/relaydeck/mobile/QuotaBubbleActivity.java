package dev.relaydeck.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** A lightweight quota bubble opened from the home-screen widget. */
public final class QuotaBubbleActivity extends Activity {
    private Dialog dialog;
    private BroadcastReceiver usageReceiver;
    private TextView status;
    private QuotaRow primary;
    private QuotaRow secondary;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(Color.TRANSPARENT);
        dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(buildContent());
        dialog.setCanceledOnTouchOutside(true);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setDimAmount(0.42f);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            window.setGravity(Gravity.BOTTOM);
            window.setWindowAnimations(R.style.QuotaBubbleAnimation);
        }
        dialog.setOnDismissListener(ignored -> finish());
        usageReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { render(); }
        };
        IntentFilter filter = new IntentFilter(SessionService.USAGE_UPDATE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usageReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(usageReceiver, filter);
        dialog.show();
        render();
    }

    @Override protected void onDestroy() {
        if (usageReceiver != null) {
            try { unregisterReceiver(usageReceiver); } catch (Exception ignored) {}
            usageReceiver = null;
        }
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        dialog = null;
        super.onDestroy();
    }

    private View buildContent() {
        int surface = getColorCompat("#F7F6F3");
        int ink = getColorCompat("#24231F");
        int muted = getColorCompat("#77746D");
        int divider = getColorCompat("#DEDAD2");
        int green = getColorCompat("#477A59");
        int blue = getColorCompat("#52728E");

        FrameLayout scrim = new FrameLayout(this);
        scrim.setPadding(dp(14), dp(20), dp(14), dp(14));
        scrim.setOnClickListener(view -> dismiss());

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(18), dp(16), dp(18), dp(16));
        bubble.setBackground(bubbleBackground(surface, divider));
        bubble.setOnClickListener(view -> {});

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView mascot = new TextView(this);
        mascot.setText("◕");
        mascot.setTextSize(23);
        mascot.setGravity(Gravity.CENTER);
        mascot.setTextColor(surface);
        mascot.setBackground(roundRect(green, 18));
        top.addView(mascot, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(11), 0, 0, 0);
        TextView title = text("RelayDeck 额度", 17, ink);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        titles.addView(title);
        status = text("正在读取…", 11, muted);
        titles.addView(status);
        LinearLayout.LayoutParams titleSpace = new LinearLayout.LayoutParams(0, -2, 1);
        top.addView(titles, titleSpace);

        TextView close = text("×", 24, muted);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("关闭额度气泡");
        close.setOnClickListener(view -> dismiss());
        top.addView(close, new LinearLayout.LayoutParams(dp(38), dp(40)));
        bubble.addView(top);

        View rule = new View(this);
        rule.setBackgroundColor(divider);
        LinearLayout.LayoutParams ruleSpace = new LinearLayout.LayoutParams(-1, dp(1));
        ruleSpace.topMargin = dp(13);
        ruleSpace.bottomMargin = dp(13);
        bubble.addView(rule, ruleSpace);

        primary = new QuotaRow(green);
        secondary = new QuotaRow(blue);
        bubble.addView(primary.view);
        bubble.addView(secondary.view);

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        actions.setPadding(0, dp(13), 0, 0);
        TextView refresh = text("刷新", 12, ink);
        refresh.setGravity(Gravity.CENTER);
        refresh.setBackground(outlineButton(divider));
        refresh.setOnClickListener(view -> { refresh(); render(); });
        actions.addView(refresh, new LinearLayout.LayoutParams(dp(62), dp(34)));

        TextView open = text("打开 RelayDeck", 12, ink);
        open.setGravity(Gravity.CENTER);
        open.setBackground(outlineButton(divider));
        open.setOnClickListener(view -> {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            dismiss();
        });
        LinearLayout.LayoutParams openSpace = new LinearLayout.LayoutParams(dp(118), dp(34));
        openSpace.leftMargin = dp(8);
        actions.addView(open, openSpace);
        bubble.addView(actions);

        TextView hint = text("点击气泡外关闭，额度每 60 秒更新", 10, muted);
        hint.setGravity(Gravity.END);
        LinearLayout.LayoutParams hintSpace = new LinearLayout.LayoutParams(-1, -2);
        hintSpace.topMargin = dp(9);
        bubble.addView(hint, hintSpace);

        FrameLayout.LayoutParams bubbleSpace = new FrameLayout.LayoutParams(-1, -2);
        bubbleSpace.gravity = Gravity.BOTTOM;
        scrim.addView(bubble, bubbleSpace);
        return scrim;
    }

    private void render() {
        if (primary == null || status == null) return;
        JSONObject connection = null;
        JSONObject value = null;
        boolean live = false;
        boolean online = false;
        try {
            connection = new SecureSession(this).load();
            if (connection != null) {
                String fingerprint = connection.optString("fingerprint");
                try { value = new UsageCache(this, fingerprint).load(); } catch (Exception ignored) {}
                live = SessionService.running && SessionService.usageReceivedAt > 0
                    && fingerprint.equals(SessionService.usageComputer) && SessionService.usage != null;
                if (live) value = SessionService.usage;
                online = SessionService.running && SessionService.latest != null
                    && fingerprint.equals(SessionService.latest.optString("computer"))
                    && SessionService.latest.optBoolean("online");
            }
        } catch (Exception ignored) {}
        boolean paired = connection != null;
        status.setText(UsagePresentation.widgetStatus(value, paired, live, online, System.currentTimeMillis()));
        primary.render(value == null ? null : value.optJSONObject("primary"), "短周期");
        secondary.render(value == null ? null : value.optJSONObject("secondary"), "长周期");
        if (!(value != null && value.optBoolean("available"))) {
            status.setText(paired ? "暂无额度数据，请保持电脑在线" : "尚未完成配对");
        }
    }

    private void refresh() {
        try {
            startForegroundService(new Intent(this, SessionService.class).setAction(SessionService.ACTION_REFRESH_USAGE));
        } catch (Exception ignored) {}
    }

    private void dismiss() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        else finish();
    }

    private final class QuotaRow {
        final LinearLayout view;
        final TextView percent;
        final TextView detail;
        final View progress;
        final GradientDrawable fill;
        final int color;

        QuotaRow(int color) {
            this.color = color;
            view = new LinearLayout(QuotaBubbleActivity.this);
            view.setGravity(Gravity.CENTER_VERTICAL);
            view.setPadding(0, dp(6), 0, dp(8));

            LinearLayout labels = new LinearLayout(QuotaBubbleActivity.this);
            labels.setOrientation(LinearLayout.VERTICAL);
            percent = text("--", 22, color);
            percent.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            labels.addView(percent);
            detail = text("等待数据", 10, getColorCompat("#77746D"));
            labels.addView(detail);
            view.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));

            FrameLayout meter = new FrameLayout(QuotaBubbleActivity.this);
            View track = new View(QuotaBubbleActivity.this);
            track.setBackground(roundRect(getColorCompat("#E5E1DA"), 4));
            progress = new View(QuotaBubbleActivity.this);
            fill = roundRect(color, 4);
            progress.setBackground(fill);
            meter.addView(track, new FrameLayout.LayoutParams(-1, dp(7), Gravity.CENTER_VERTICAL));
            meter.addView(progress, new FrameLayout.LayoutParams(0, dp(7), Gravity.START | Gravity.CENTER_VERTICAL));
            LinearLayout.LayoutParams meterSpace = new LinearLayout.LayoutParams(dp(108), dp(22));
            meterSpace.leftMargin = dp(12);
            view.addView(meter, meterSpace);
        }

        void render(JSONObject window, String fallback) {
            float remaining = UsagePresentation.remaining(window);
            percent.setText(remaining < 0 ? "--" : Math.round(remaining) + "%");
            String period = UsagePresentation.period(window, fallback);
            long reset = window == null ? 0 : window.optLong("resetsAt");
            String resetText;
            if (reset <= 0) resetText = "重置时间未知";
            else if (reset * 1000L <= System.currentTimeMillis()) resetText = "等待窗口刷新";
            else resetText = "重置于 " + new SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(new Date(reset * 1000L));
            detail.setText(period + " · " + resetText);
            ViewGroup.LayoutParams raw = progress.getLayoutParams();
            int width = Math.round(dp(108) * (remaining < 0 ? 0 : remaining) / 100f);
            raw.width = Math.max(remaining <= 0 ? 0 : dp(4), width);
            progress.setLayoutParams(raw);
            fill.setColor(remaining < 0 ? getColorCompat("#D1CDC6") : color);
            view.setContentDescription(period + "，剩余 " + (remaining < 0 ? "未知" : Math.round(remaining) + "%") + "，" + resetText);
        }
    }

    private TextView text(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setIncludeFontPadding(false);
        return text;
    }

    private GradientDrawable bubbleBackground(int fill, int stroke) {
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{fill, getColorCompat("#EEEAE2")});
        background.setCornerRadius(dp(27));
        background.setStroke(dp(1), stroke);
        return background;
    }

    private GradientDrawable outlineButton(int stroke) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(getColorCompat("#FFFDF8"));
        background.setCornerRadius(dp(12));
        background.setStroke(dp(1), stroke);
        return background;
    }

    private GradientDrawable roundRect(int color, int radius) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radius));
        return background;
    }

    private int getColorCompat(String color) { return Color.parseColor(color); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
