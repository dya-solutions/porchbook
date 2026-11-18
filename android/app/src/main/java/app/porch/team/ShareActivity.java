package app.porch.team;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import org.json.JSONObject;

/**
 * "Share → Porchbook" from a notes app (or anywhere with text): keeps the shared words and opens
 * Porchbook's library, which offers to add them as a new note. Nothing is kept unless you add it.
 */
public class ShareActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent got = getIntent();
        String text = got.getStringExtra(Intent.EXTRA_TEXT);
        String subject = got.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null) {
            CharSequence styled = got.getCharSequenceExtra(Intent.EXTRA_TEXT);
            text = styled == null ? "" : styled.toString();
        }
        if (!text.trim().isEmpty()) {
            try {
                JSONObject shared = new JSONObject();
                shared.put("title", subject == null ? "" : subject);
                shared.put("text", text.length() > 200000 ? text.substring(0, 200000) : text);
                PorchLauncher.pendingShare = shared.toString();
            } catch (Exception ignored) {
                // nothing to add
            }
        }
        String home = PorchStore.getUrl(this);
        if (home.isEmpty()) {
            startActivity(new Intent(this, SetupActivity.class));
        } else {
            Uri at = Uri.parse(home);
            String library = at.getScheme() + "://" + at.getAuthority() + "/read?shared=1";
            Intent open = new Intent(this, PorchLauncher.class);
            open.putExtra(PorchLauncher.EXTRA_URL, library);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(open);
        }
        finish();
    }
}
