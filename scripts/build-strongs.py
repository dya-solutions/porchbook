"""Build the offline Strong's study layer from the public-domain KJV tags.

The displayed Bible is not rewritten. Each tag is kept only when the tagged
English word is the same word as the word Porchbook already shows.
"""

import json
import re
import difflib
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path("/workspace/public/bible/study")
KJV = json.loads(Path("/workspace/public/bible/kjv.json").read_text())
BASE = "https://bibleengine.org/v1"

def tokens(text: str) -> list[str]:
    return [part for part in re.split(r"\s+", text.strip()) if re.search(r"[A-Za-z]", part)]

def norm(word: str) -> str:
    word = word.lower().replace("æ", "ae").replace("œ", "oe").replace("’", "'").replace("'", "")
    return re.sub(r"[^a-z]", "", word)

def strong_id(raw: str) -> str:
    match = re.fullmatch(r"([HG])0*(\d+)", str(raw).upper().replace(" ", "").replace("-", ""))
    if not match:
        return ""
    return f"{match.group(1)}{int(match.group(2))}"

def fetch(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "Porchbook"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.loads(response.read().decode("utf-8"))

def align(display: list[str], tagged: list) -> list[str]:
    left = [norm(word) for word in display]
    right = [norm(item[0]) for item in tagged]
    out = [""] * len(display)
    matcher = difflib.SequenceMatcher(a=left, b=right, autojunk=False)
    for kind, i1, i2, j1, j2 in matcher.get_opcodes():
        if kind != "equal":
            continue
        for offset in range(i2 - i1):
            ids = []
            for number in tagged[j1 + offset][1]:
                cleaned = strong_id(number)
                if cleaned and cleaned not in ids:
                    ids.append(cleaned)
            out[i1 + offset] = "+".join(ids)
    return out

def chapter_job(book: int, chapter: int):
    url = f"{BASE}/kjv/{book:02d}/{chapter:03d}.json"
    try:
        payload = fetch(url)
    except Exception as error:
        return book, chapter, None, str(error)
    return book, chapter, payload, ""

def main():
    jobs = []
    for book_index, book in enumerate(KJV, start=1):
        for chapter in range(1, len(book["chapters"]) + 1):
            jobs.append((book_index, chapter))
    found = {}
    errors = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(chapter_job, book, chapter) for book, chapter in jobs]
        for done in as_completed(futures):
            book, chapter, payload, error = done.result()
            if payload is None:
                errors.append((book, chapter, error))
            else:
                found[(book, chapter)] = payload
    print("chapters", len(found), "errors", len(errors))

    occurrences: dict[str, list[str]] = {}
    mapped = 0
    words = 0
    for book_index, book in enumerate(KJV, start=1):
        chapters = []
        for chapter_index, verses in enumerate(book["chapters"], start=1):
            payload = found.get((book_index, chapter_index)) or {}
            rows = []
            for verse_index, text in enumerate(verses, start=1):
                display = tokens(text)
                tagged = (payload.get(str(verse_index)) or {}).get("w") or []
                tags = align(display, tagged) if tagged else [""] * len(display)
                if len(tags) != len(display):
                    tags = [""] * len(display)
                words += len(display)
                mapped += sum(1 for tag in tags if tag)
                for tag in tags:
                    for number in tag.split("+"):
                        if number:
                            occurrences.setdefault(number, []).append(f"{book_index}:{chapter_index}:{verse_index}")
                rows.append("|".join(tags))
            chapters.append(rows)
        target = ROOT / "tags" / f"{book_index:02d}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(chapters, separators=(",", ":")))
    print("words", words, "mapped", mapped)

    lexicon = {}
    buckets = [(letter, bucket) for letter, last in (("G", 56), ("H", 86)) for bucket in range(last + 1)]
    def lex_job(letter, bucket):
        url = f"{BASE}/lexicon/{letter}/{bucket}.json"
        try:
            return letter, bucket, fetch(url), ""
        except Exception as error:
            return letter, bucket, None, str(error)
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(lex_job, letter, bucket) for letter, bucket in buckets]
        for done in as_completed(futures):
            letter, bucket, payload, error = done.result()
            if not payload:
                errors.append((letter, bucket, error))
                continue
            slim = {}
            for key, entry in payload.items():
                number = strong_id(key)
                if not number or not isinstance(entry, dict):
                    continue
                definition = re.sub(r"\s+", " ", str(entry.get("str") or "")).strip()
                slim[number] = {
                    "o": entry.get("o") or "",
                    "tr": entry.get("tr") or "",
                    "ph": entry.get("ph") or "",
                    "pos": entry.get("pos") or "",
                    "et": entry.get("et") or "",
                    "def": definition[:700],
                }
            lexicon.update(slim)
            target = ROOT / "lex" / letter / f"{bucket}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")))
    print("lexicon", len(lexicon), "errors", len(errors))

    index = [{"id": key, "tr": value["tr"], "o": value["o"]} for key, value in lexicon.items()]
    (ROOT / "lex-index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))

    grouped: dict[tuple[str, int], dict[str, list[str]]] = {}
    for number, refs in occurrences.items():
        letter = number[0]
        bucket = int(number[1:]) // 1000
        grouped.setdefault((letter, bucket), {})[number] = refs
    for (letter, bucket), body in grouped.items():
        target = ROOT / "occ" / letter / f"{bucket}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(body, separators=(",", ":")))
    print("occurrence buckets", len(grouped))
    sample = occurrences.get("G25", [])
    print("G25", len(sample), sample[:8])

if __name__ == "__main__":
    main()
