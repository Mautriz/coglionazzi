import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorState, EditorThemeClasses } from "lexical";
import type { RefObject } from "react";
import { cn } from "~/lib/classUtils";
import { CodeHighlightPlugin } from "./CodeHighlightPlugin";
import { EditorControlPlugin, type EditorControl } from "./EditorControlPlugin";
import { SubmitPlugin } from "./SubmitPlugin";
import { ToolbarPlugin } from "./ToolbarPlugin";

/** Maps Lexical's theme slots onto the classes in styles/editor.css. */
const theme: EditorThemeClasses = {
  paragraph: "editor-paragraph",
  heading: {
    h1: "editor-h1",
    h2: "editor-h2",
    h3: "editor-h3",
    h4: "editor-h3",
    h5: "editor-h3",
    h6: "editor-h3",
  },
  quote: "editor-quote",
  link: "editor-link",
  text: {
    bold: "editor-text-bold",
    italic: "editor-text-italic",
    underline: "editor-text-underline",
    strikethrough: "editor-text-strikethrough",
    underlineStrikethrough: "editor-text-underline-strikethrough",
    code: "editor-text-code",
  },
  list: {
    ul: "editor-ul",
    ol: "editor-ol",
    listitem: "editor-li",
    nested: {
      listitem: "editor-nested-li",
    },
    listitemChecked: "editor-li-checked",
    listitemUnchecked: "editor-li-unchecked",
  },
  hr: "editor-hr",
  hrSelected: "selected",
  code: "editor-code",
  codeHighlight: {
    atrule: "editor-token-attr",
    attr: "editor-token-attr",
    boolean: "editor-token-property",
    builtin: "editor-token-class",
    cdata: "editor-token-comment",
    char: "editor-token-string",
    class: "editor-token-class",
    "class-name": "editor-token-class",
    comment: "editor-token-comment",
    constant: "editor-token-property",
    deleted: "editor-token-property",
    doctype: "editor-token-comment",
    entity: "editor-token-operator",
    function: "editor-token-function",
    important: "editor-token-keyword",
    inserted: "editor-token-selector",
    keyword: "editor-token-keyword",
    namespace: "editor-token-keyword",
    number: "editor-token-property",
    operator: "editor-token-operator",
    prolog: "editor-token-comment",
    property: "editor-token-property",
    punctuation: "editor-token-punctuation",
    regex: "editor-token-keyword",
    selector: "editor-token-selector",
    string: "editor-token-string",
    symbol: "editor-token-property",
    tag: "editor-token-property",
    url: "editor-token-operator",
    variable: "editor-token-variable",
  },
};

const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;
const EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/;

const AUTO_LINK_MATCHERS = [
  (text: string) => {
    const match = URL_REGEX.exec(text);
    if (match === null) return null;
    const fullMatch = match[0];
    return {
      index: match.index,
      length: fullMatch.length,
      text: fullMatch,
      url: fullMatch.startsWith("http") ? fullMatch : `https://${fullMatch}`,
    };
  },
  (text: string) => {
    const match = EMAIL_REGEX.exec(text);
    if (match === null) return null;
    return {
      index: match.index,
      length: match[0].length,
      text: match[0],
      url: `mailto:${match[0]}`,
    };
  },
];

/** Rich text editor with the standard local editing feature set (playground
 *  style): history, headings/quote/code blocks, lists + checklists, links +
 *  autolink, markdown shortcuts, alignment/indentation, horizontal rules.
 *
 *  Uncontrolled; pass `initialState` (a serialized editor state JSON string)
 *  to restore content and `onChange` to observe edits. */
export function RichTextEditor({
  initialState,
  onChange,
  onSubmit,
  submitOnEnter = false,
  placeholder = "Write something…",
  className,
  namespace = "editor",
  readOnly = false,
  controlRef,
}: {
  /** Serialized editor state JSON (from `onChange`). */
  initialState?: string;
  onChange?: (serializedState: string) => void;
  /** Fires on Cmd/Ctrl+Enter (and bare Enter when `submitOnEnter`). */
  onSubmit?: () => void;
  /** Imperative clear/focus handle (to reset a composer in place). */
  controlRef?: RefObject<EditorControl | null>;
  /** Submit on a plain Enter (Shift+Enter = newline). For comment-style
   *  composers; leave off for document-style fields. */
  submitOnEnter?: boolean;
  placeholder?: string;
  className?: string;
  namespace?: string;
  /** Render-only: no toolbar, no chrome, not editable. */
  readOnly?: boolean;
}) {
  const initialConfig = {
    namespace,
    theme,
    editorState: initialState,
    editable: !readOnly,
    onError(error: Error) {
      console.error(error);
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      HorizontalRuleNode,
    ],
  };

  function handleChange(editorState: EditorState) {
    onChange?.(JSON.stringify(editorState.toJSON()));
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        className={cn(
          !readOnly &&
            "rounded-md border border-input-border bg-input-background focus-within:border-ring/60",
          className,
        )}
      >
        {!readOnly && <ToolbarPlugin />}
        <div className="editor-shell">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "editor-input",
                  readOnly && "min-h-0! p-0!",
                )}
                aria-placeholder={readOnly ? "" : placeholder}
                placeholder={() =>
                  readOnly ? null : (
                    <div className="editor-placeholder">{placeholder}</div>
                  )
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>

      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <LinkPlugin />
      <ClickableLinkPlugin />
      <AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />
      <MarkdownShortcutPlugin />
      <TabIndentationPlugin />
      <HorizontalRulePlugin />
      <CodeHighlightPlugin />
      {onChange && (
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      )}
      {onSubmit && (
        <SubmitPlugin onSubmit={onSubmit} submitOnEnter={submitOnEnter} />
      )}
      {controlRef && <EditorControlPlugin controlRef={controlRef} />}
    </LexicalComposer>
  );
}
