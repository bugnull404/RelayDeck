package dev.relaydeck.mobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.view.View;

/** Quiet web-style startup mark: one fade, one short scale reveal, no particles. */
final class LaunchAnimationView extends View {
    private static final int PAPER=Color.rgb(250,250,250);
    private static final int INK=Color.rgb(24,24,24);
    private static final int MUTED=Color.rgb(114,114,114);

    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path mark=new Path();
    private ValueAnimator animator;
    private float progress;

    LaunchAnimationView(Context context) {
        super(context);
        setBackgroundColor(PAPER);
        setClickable(true);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    void play(Runnable finished) {
        animator=ValueAnimator.ofFloat(0f,1f);
        animator.setDuration(680);
        animator.setInterpolator(new android.view.animation.LinearInterpolator());
        animator.addUpdateListener(animation->{
            progress=(float)animation.getAnimatedValue();
            float fadeOut=progress<.82f?1f:Math.max(0f,1f-(progress-.82f)/.18f);
            setAlpha(fadeOut);
            invalidate();
        });
        animator.addListener(new AnimatorListenerAdapter(){
            @Override public void onAnimationEnd(Animator animation){finished.run();}
        });
        animator.start();
    }

    private float dp(float value) {
        return value*getResources().getDisplayMetrics().density;
    }

    private static float smooth(float value) {
        value=Math.max(0f,Math.min(1f,value));
        return value*value*(3f-2f*value);
    }

    private void ink(int color,float opacity) {
        paint.setColor(color);
        paint.setAlpha(Math.round(255*Math.max(0f,Math.min(1f,opacity))));
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float cx=getWidth()/2f,cy=getHeight()*.45f;
        float reveal=smooth(progress/.26f);
        float scale=.96f+.04f*smooth(progress/.42f);

        canvas.save();
        canvas.translate(cx,cy-dp(4f)*smooth(progress/.7f));
        canvas.scale(scale,scale);
        paint.setStyle(Paint.Style.FILL);
        ink(INK,reveal);
        canvas.drawRoundRect(-dp(36),-dp(36),dp(36),dp(36),dp(20),dp(20),paint);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(3.1f));
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        ink(Color.WHITE,reveal);
        mark.reset();
        mark.moveTo(-dp(13),-dp(11));
        mark.lineTo(-dp(24),0);
        mark.lineTo(-dp(13),dp(11));
        mark.moveTo(dp(13),-dp(11));
        mark.lineTo(dp(24),0);
        mark.lineTo(dp(13),dp(11));
        mark.moveTo(dp(5),-dp(18));
        mark.lineTo(-dp(5),dp(18));
        canvas.drawPath(mark,paint);
        canvas.restore();

        paint.setStyle(Paint.Style.FILL);
        paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(dp(22));
        ink(INK,reveal);
        canvas.drawText("RelayDeck",cx,cy+dp(86),paint);

        paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));
        paint.setTextSize(dp(11));
        ink(MUTED,reveal*.9f);
        canvas.drawText("远程 Codex",cx,cy+dp(108),paint);
    }

    @Override protected void onDetachedFromWindow() {
        if(animator!=null){
            animator.removeAllListeners();
            animator.cancel();
            animator=null;
        }
        super.onDetachedFromWindow();
    }
}
