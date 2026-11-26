// The searchable country list (decision 45): type a few letters, tap the country.
import { useId, useState } from "react";
import { findCountries } from "@/lib/porch/countries";

export function CountryPicker({ value, onChange, label = "Country" }: { value: string; onChange: (country: string) => void; label?: string }) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();
  const matches = findCountries(typed);

  if (value && !open) {
    return (
      <div className="ofc-lbl">
        {label}
        <div className="ofc-input country-chosen" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{value}</span>
          <button
            type="button"
            className="welcome-link"
            onClick={() => {
              setTyped("");
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ofc-lbl" style={{ position: "relative" }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="ofc-input"
        value={typed}
        placeholder="Type a few letters, e.g. Ugan"
        autoComplete="off"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={`${id}-list`}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            onChange(matches[0]);
            setOpen(false);
          }
        }}
      />
      {typed.trim() ? (
        <div id={`${id}-list`} role="listbox" className="pb-card" style={{ marginTop: 6, padding: 4, display: "flex", flexDirection: "column" }}>
          {matches.length ? (
            matches.map((country) => (
              <button
                key={country}
                type="button"
                role="option"
                aria-selected={country === value}
                className="ofc-row"
                style={{ textAlign: "left", font: "inherit", fontWeight: 500, padding: "10px 12px", background: "none", border: 0, borderRadius: 10 }}
                onClick={() => {
                  onChange(country);
                  setOpen(false);
                }}
              >
                {country}
              </button>
            ))
          ) : (
            <p className="pb-quiet" style={{ margin: 0, padding: "10px 12px", fontSize: 14, fontWeight: 400 }}>No country by that name.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
