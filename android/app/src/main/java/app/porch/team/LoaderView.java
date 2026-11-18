package app.porch.team;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;

/**
 * Porchbook's loader while the app opens: a ring counting up, Porchbook green turning
 * Porchbook orange, with twinkling dots that take the ring's colour as it fills.
 */
public class LoaderView extends View {
    private static final int DOTS = 36;
    private float shown = 0f;   // what the ring shows (eases toward target)
    private float target = 0f;  // 0..100
    private final long born = System.currentTimeMillis();
    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();

    public LoaderView(Context context) {
        super(context);
        setBackgroundColor(Color.BLACK);
        track.setStyle(Paint.Style.STROKE);
        track.setColor(Color.rgb(58, 63, 57));
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeCap(Paint.Cap.ROUND);
        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeCap(Paint.Cap.ROUND);
        text.setColor(Color.WHITE);
        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        setLayerType(View.LAYER_TYPE_SOFTWARE, null); // for the glow
    }

    /** The real amount loaded (0..100); the ring never goes backwards. */
    public void setProgress(int pct) {
        target = Math.max(target, Math.min(100, pct));
        invalidate();
    }

    private static int colourAt(float share) {
        float s = Math.max(0f, Math.min(1f, share));
        return Color.rgb(Math.round(125 + (248 - 125) * s), Math.round(255 + (160 - 255) * s), Math.round(42 + (24 - 42) * s));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long age = System.currentTimeMillis() - born;
        // While the real amount is low, creep a little so it never looks stuck.
        float creep = Math.min(88f, 88f * (1f - (float) Math.exp(-age / 2600f)));
        float goal = Math.max(target, Math.min(creep, target + 25f));
        shown += (goal - shown) * 0.12f;
        float share = shown / 100f;
        int colour = colourAt(share);

        float w = getWidth(), h = getHeight();
        float cx = w / 2f, cy = h / 2f;
        float unit = Math.min(w, h) / 300f * 0.62f; // the drawing is 300 units wide
        float r = 70 * unit;

        // Dots: two rings, twinkling; lit ones take the ring's colour.
        for (int i = 0; i < DOTS; i++) {
            double a = i / (double) DOTS * Math.PI * 2 - Math.PI / 2;
            boolean lit = i / (float) DOTS < share;
            float[][] rows = {{96, 3.2f, 0.9f}, {112, 2f, 0.55f}};
            for (int k = 0; k < rows.length; k++) {
                float rr = rows[k][0] * unit, sz = rows[k][1] * unit, op = rows[k][2];
                double phase = (age / 2000.0) * Math.PI * 2 + ((i * 7 + k * 3) % 18) * 0.35;
                float tw = (float) (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase)));
                dot.setColor(lit ? colour : Color.WHITE);
                dot.setAlpha(Math.round(255 * op * tw));
                canvas.drawCircle(cx + (float) (rr * Math.cos(a)), cy + (float) (rr * Math.sin(a)), sz, dot);
            }
        }
        box.set(cx - r, cy - r, cx + r, cy + r);
        track.setStrokeWidth(9 * unit);
        canvas.drawArc(box, 0, 360, false, track);
        if (share > 0.002f) {
            glow.setStrokeWidth(12 * unit);
            glow.setColor(colour);
            glow.setAlpha(120);
            glow.setMaskFilter(new BlurMaskFilter(10 * unit, BlurMaskFilter.Blur.NORMAL));
            canvas.drawArc(box, -90, 360 * share, false, glow);
            ring.setStrokeWidth(9 * unit);
            ring.setColor(colour);
            canvas.drawArc(box, -90, 360 * share, false, ring);
        }
        text.setTextSize(34 * unit);
        canvas.drawText(Math.round(shown) + "%", cx, cy + 12 * unit, text);
        postInvalidateOnAnimation();
    }

    /** Ready: run up to 100% quickly, then call done. */
    public void finish(Runnable done) {
        target = 100f;
        ValueAnimator run = ValueAnimator.ofFloat(shown, 100f);
        run.setDuration(Math.max(120, Math.round((100f - shown) * 4)));
        run.addUpdateListener(an -> {
            shown = (float) an.getAnimatedValue();
            invalidate();
        });
        run.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator animation) {
                done.run();
            }
        });
        run.start();
    }
}
