// All nations, for the searchable country list (decision 45). Kept here in the code: free, no service.
// The 193 UN member states, plus Kosovo, Palestine, Taiwan and Vatican City.
export const COUNTRIES: readonly string[] = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia",
  "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo (Brazzaville)", "Congo (DR)",
  "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland",
  "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
  "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania",
  "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius",
  "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia",
  "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
  "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland",
  "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "São Tomé and Príncipe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands",
  "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Türkiye", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

/** Other names people type, so a few letters still find the country. */
const ALSO: Record<string, string[]> = {
  "United Kingdom": ["UK", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  "United States": ["USA", "US", "America"],
  "United Arab Emirates": ["UAE", "Dubai"],
  "Congo (DR)": ["DRC", "Democratic Republic of the Congo", "Zaire"],
  "Congo (Brazzaville)": ["Republic of the Congo"],
  "Côte d'Ivoire": ["Ivory Coast", "Cote d'Ivoire"],
  "Czechia": ["Czech Republic"],
  "Eswatini": ["Swaziland"],
  "Türkiye": ["Turkey", "Turkiye"],
  "Myanmar": ["Burma"],
  "Cabo Verde": ["Cape Verde"],
  "Timor-Leste": ["East Timor"],
  "São Tomé and Príncipe": ["Sao Tome"],
  "South Korea": ["Korea"],
  "Netherlands": ["Holland"],
};

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The countries matching what was typed: names starting with it first, then names containing it. */
export function findCountries(typed: string, limit = 8): string[] {
  const q = plain(typed);
  if (!q) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of COUNTRIES) {
    const names = [name, ...(ALSO[name] ?? [])].map(plain);
    if (names.some((n) => n.startsWith(q) || n.split(/[\s(-]+/).some((word) => word.startsWith(q)))) starts.push(name);
    else if (names.some((n) => n.includes(q))) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The country's proper name from the list ("" when it isn't one). */
export function knownCountry(value: unknown): string {
  if (typeof value !== "string") return "";
  const q = plain(value);
  return COUNTRIES.find((name) => plain(name) === q) ?? "";
}
