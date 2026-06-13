import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical";
import { useEffect } from "react";

/** Keyboard submit for the editor.
 *  - Cmd/Ctrl+Enter always submits (the document-friendly shortcut).
 *  - When `submitOnEnter`, a bare Enter also submits and Shift+Enter inserts
 *    a newline (Discord-style — used for the comment composer). */
export function SubmitPlugin({
  onSubmit,
  submitOnEnter = false,
}: {
  onSubmit: () => void;
  submitOnEnter?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event) return false;
        const modEnter = event.metaKey || event.ctrlKey;
        const plainEnter = submitOnEnter && !event.shiftKey;
        if (modEnter || plainEnter) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit, submitOnEnter]);

  return null;
}
