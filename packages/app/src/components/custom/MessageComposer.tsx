import { SendIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { EditorControl } from "~/components/editor/EditorControlPlugin";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Button } from "~/components/ui/button";

/** The one shared message composer (comments, chat, …). Lexical rich text,
 *  sends on ⌘/Ctrl+Enter ONLY (bare Enter = newline), lean styling. Clears
 *  itself on send. `initialState` prefills it (for editing). */
export function MessageComposer({
  onSubmit,
  initialState,
  placeholder = "Write a message…",
  busy = false,
  namespace = "composer",
  autoClear = true,
  submitLabel = "Send",
}: {
  onSubmit: (body: string) => void;
  initialState?: string;
  placeholder?: string;
  busy?: boolean;
  namespace?: string;
  /** Remount empty after submit (off for edit composers that unmount). */
  autoClear?: boolean;
  submitLabel?: string;
}) {
  const controlRef = useRef<EditorControl | null>(null);
  const draftRef = useRef<string | null>(initialState ?? null);
  const [hasText, setHasText] = useState(Boolean(initialState));

  function submit() {
    if (!draftRef.current || !hasText || busy) return;
    onSubmit(draftRef.current);
    if (autoClear) {
      draftRef.current = null;
      setHasText(false);
      // Clear in place and keep the caret here, so ⌘/Ctrl+Enter lets you fire
      // off the next message without re-clicking the box.
      controlRef.current?.clear();
      controlRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <RichTextEditor
        namespace={namespace}
        initialState={initialState}
        placeholder={`${placeholder} (⌘/Ctrl+Enter)`}
        onSubmit={submit}
        controlRef={controlRef}
        onChange={(json) => {
          draftRef.current = json;
          // Cheap "has any text" check without parsing the whole tree.
          setHasText(json.includes('"text":"'));
        }}
        className="text-sm"
      />
      <div>
        <Button
          type="button"
          size="sm"
          disabled={!hasText || busy}
          onClick={submit}
        >
          <SendIcon className="size-3.5" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
