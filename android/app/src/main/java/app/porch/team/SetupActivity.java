package app.porch.team;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class SetupActivity extends AppCompatActivity {
    private static final String CHANGE = "app.porch.team.CHANGE";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        boolean changing = CHANGE.equals(getIntent().getAction());
        if (!changing && PorchStore.hasUrl(this)) {
            openPorch();
            return;
        }
        setContentView(R.layout.activity_setup);
        EditText address = findViewById(R.id.address);
        TextView error = findViewById(R.id.error);
        String existing = PorchStore.getUrl(this);
        if (!existing.isEmpty()) address.setText(existing);
        findViewById(R.id.continue_button).setOnClickListener(view -> {
            String normalized = PorchStore.normalize(address.getText().toString());
            if (normalized == null) {
                error.setText(R.string.address_error);
                error.setVisibility(View.VISIBLE);
                return;
            }
            PorchStore.setUrl(this, normalized);
            openPorch();
        });
    }

    private void openPorch() {
        startActivity(new Intent(this, PorchLauncher.class));
        finish();
    }
}
