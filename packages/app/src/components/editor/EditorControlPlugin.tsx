import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot } from "lexical";
import { useImperativeHandle, type RefObject } from "react";

/** Imperative handle for a composer: clear its content and focus it WITHOUT
 *  remounting (which would lose focus). */
export interface EditorControl {
  clear: () => void;
  focus: () => void;
}

/** Exposes `clear`/`focus` on `controlRef` so the parent can reset the editor
 *  in place after a send and keep the caret in it for the next message. */
export function EditorControlPlugin({
  controlRef,
}: {
  controlRef: RefObject<EditorControl | null>;
}) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(
    controlRef,
    () => ({
      clear: () => {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      },
      focus: () => editor.focus(),
    }),
    [editor],
  );

  return null;
}
