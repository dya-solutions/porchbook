import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadOfficeBook, saveOfficeBook } from "@/lib/porch/office-book";
import { fieldClass, primaryButtonClass, quietButtonClass } from "@/components/porch/bits";
import { BookHide } from "@/components/porch/hide";

const PAGE = 700;

function pagesOf(body: string): string[] {
  const pages = body.length ? body.split("\f") : [""];
  return pages.length ? pages : [""];
}

export function AccountBook({ officeKey }: { officeKey: string }) {
  const { user } = useCurrentUserState();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<string[]>([""]);
  const [canEdit, setCanEdit] = useState(false);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const seed = {
    displayName: user?.displayName ?? "",
    email: user?.primaryEmail ?? null,
    imageUrl: user?.profileImageUrl ?? null,
  };

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancel = false;
    loadOfficeBook({ data: { ...seed, key: officeKey } })
      .then((result) => {
        if (cancel || !result.ok) return;
        setTitle(result.title);
        setPages(pagesOf(result.body));
        setCanEdit(result.canEdit);
        setIndex(0);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, officeKey]);

  const last = pages.length;
  const at = Math.min(index, last);

  async function save() {
    setBusy(true);
    setNote("");
    const result = await saveOfficeBook({
      data: { ...seed, key: officeKey, title, body: pages.map((page) => page.trimEnd()).join("\f").slice(0, 8400) },
    });
    setBusy(false);
    setNote(result.ok ? "Saved." : result.error);
  }

  function write(value: string) {
    const next = value.slice(0, PAGE);
    setPages((current) => current.map((page, i) => (i === at - 1 ? next : page)));
  }

  return (
    <>
      <button type="button" className="mt-4 block" onClick={() => setOpen(true)}>
        <span className="relative flex h-44 w-32 overflow-hidden rounded-md shadow-[6px_10px_14px_rgba(0,0,0,0.4)]" style={{ transform: "rotateY(-18deg)" }}>
          <span className="w-4 shrink-0 bg-black" />
          <BookHide className="relative flex flex-1 flex-col items-center justify-center px-2 text-center">
            <span className="butterfly butterfly-still absolute right-1.5 bottom-1.5 size-5">
              <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
              <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
            </span>
            <span className="book-title absolute top-2 right-8 left-1 text-right text-xs leading-tight">Accountability</span>
          </BookHide>
        </span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#2a1c12]">
          <div className="flex items-center justify-between px-3 py-2 text-[#f6edd8]">
            <button type="button" aria-label="Close the book" className="grid size-11 place-items-center" onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
            <p className="text-sm">Turn the page</p>
            {canEdit ? (
              <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </button>
            ) : (
              <span className="w-16" />
            )}
          </div>
          <div className="flex flex-1 items-center justify-center px-3 pb-6">
            <div className="relative h-[min(78dvh,680px)] w-[min(92vw,420px)]">
              <article className="flex h-full flex-col overflow-hidden rounded-md bg-[#f6edd8] text-[#1c140c] shadow-[12px_16px_30px_rgba(0,0,0,0.35)]">
                {at === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center bg-[#14300a] px-8 text-center text-[#f6edd8]">
                    <span className="butterfly butterfly-still relative h-20 w-24">
                      <img src="/wing-left.png?v=5" alt="" className="butterfly-wing butterfly-left" />
                      <img src="/wing-right.png?v=5" alt="" className="butterfly-wing butterfly-right" />
                    </span>
                    {canEdit ? (
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={80}
                        placeholder="Title"
                        aria-label="Title"
                        className={`${fieldClass} mt-6 text-center text-[#1c140c]`}
                      />
                    ) : (
                      <h2 className="mt-6 font-display text-4xl leading-none">{title || "Accountability"}</h2>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col px-6 py-6">
                    <p className="text-xs font-semibold text-[#6a5436]">Accountability</p>
                    {canEdit ? (
                      <textarea
                        value={pages[at - 1] ?? ""}
                        onChange={(event) => write(event.target.value)}
                        maxLength={PAGE}
                        placeholder="Write the accountability"
                        className="mt-3 min-h-0 flex-1 resize-none bg-transparent text-lg leading-snug text-[#1c140c] outline-none"
                      />
                    ) : (
                      <p className="mt-3 flex-1 whitespace-pre-wrap text-lg leading-snug">{pages[at - 1] || "Nothing written yet."}</p>
                    )}
                    <p className="pt-3 text-center text-[11px] text-[#6a5436]">Property of Phaneroo Ministries Mbarara</p>
                  </div>
                )}
              </article>
              {at > 0 ? (
                <button type="button" aria-label="Previous page" className="absolute inset-y-0 left-0 w-10" onClick={() => setIndex((value) => Math.max(0, value - 1))} />
              ) : null}
              {at < last ? (
                <button type="button" aria-label="Next page" className="absolute inset-y-0 right-0 w-10" onClick={() => setIndex((value) => Math.min(last, value + 1))} />
              ) : null}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 pb-4 text-sm text-[#f6edd8]">
            <span>{note}</span>
            {canEdit && at === last && pages.length < 12 ? (
              <button
                type="button"
                className={quietButtonClass}
                onClick={() => {
                  setPages((current) => [...current, ""]);
                  setIndex(pages.length + 1);
                }}
              >
                Another page
              </button>
            ) : (
              <span>
                {at + 1} / {last + 1}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
