import {
  $createCodeNode,
  $isCodeNode,
} from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent, $getNearestNodeOfType } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CodeIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  LinkIcon,
  MinusIcon,
  Redo2Icon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/classUtils";

const BLOCK_TYPES = {
  paragraph: "Normal",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "Bullet list",
  number: "Numbered list",
  check: "Check list",
  quote: "Quote",
  code: "Code block",
} as const;

type BlockType = keyof typeof BLOCK_TYPES;

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border1" />;
}

export function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [formats, setFormats] = useState<Set<TextFormatType>>(new Set());
  const [isLink, setIsLink] = useState(false);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    const active = new Set<TextFormatType>();
    for (const f of [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
    ] as const) {
      if (selection.hasFormat(f)) active.add(f);
    }
    setFormats(active);

    const node = selection.anchor.getNode();
    const parent = node.getParent();
    setIsLink($isLinkNode(node) || $isLinkNode(parent));

    // Resolve the selection's top-level block to drive the block-type select.
    const anchorNode = selection.anchor.getNode();
    let element =
      anchorNode.getKey() === "root"
        ? anchorNode
        : $findMatchingParent(anchorNode, (e) => {
            const parent = e.getParent();
            return parent !== null && $isRootOrShadowRoot(parent);
          });
    if (element === null) element = anchorNode.getTopLevelElementOrThrow();

    if ($isListNode(element)) {
      const parentList = $getNearestNodeOfType<ListNode>(anchorNode, ListNode);
      const listType = parentList
        ? parentList.getListType()
        : element.getListType();
      setBlockType(
        listType === "bullet"
          ? "bullet"
          : listType === "number"
            ? "number"
            : "check",
      );
    } else if ($isHeadingNode(element)) {
      const tag = element.getTag();
      setBlockType(tag === "h1" || tag === "h2" || tag === "h3" ? tag : "h3");
    } else if ($isCodeNode(element)) {
      setBlockType("code");
    } else if (element.getType() === "quote") {
      setBlockType("quote");
    } else {
      setBlockType("paragraph");
    }
  }, []);

  useEffect(() => {
    const unregisterListener = editor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => refreshToolbar());
      },
    );
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        refreshToolbar();
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterUndo = editor.registerCommand(
      CAN_UNDO_COMMAND,
      (payload) => {
        setCanUndo(payload);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterRedo = editor.registerCommand(
      CAN_REDO_COMMAND,
      (payload) => {
        setCanRedo(payload);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    return () => {
      unregisterListener();
      unregisterSelection();
      unregisterUndo();
      unregisterRedo();
    };
  }, [editor, refreshToolbar]);

  function applyBlockType(type: BlockType) {
    if (type === "bullet") {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      return;
    }
    if (type === "number") {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      return;
    }
    if (type === "check") {
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (type === "paragraph") {
        $setBlocksType(selection, () => $createParagraphNode());
      } else if (type === "quote") {
        $setBlocksType(selection, () => $createQuoteNode());
      } else if (type === "code") {
        $setBlocksType(selection, () => $createCodeNode());
      } else {
        $setBlocksType(selection, () => $createHeadingNode(type));
      }
    });
  }

  function toggleLink() {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const url = window.prompt("Link URL", "https://");
    if (url) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }
  }

  const formatButton = (
    format: TextFormatType,
    Icon: typeof BoldIcon,
    label: string,
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className={cn(formats.has(format) && "bg-accent text-primary")}
      onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
    >
      <Icon />
    </Button>
  );

  const alignButton = (
    align: ElementFormatType,
    Icon: typeof AlignLeftIcon,
    label: string,
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align)}
    >
      <Icon />
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-input-border px-2 py-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2Icon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <Redo2Icon />
      </Button>

      <Divider />

      <Select
        value={blockType}
        onValueChange={(v) => applyBlockType(v as BlockType)}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-[130px] border-none bg-transparent text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(BLOCK_TYPES).map(([value, label]) => (
            <SelectItem key={value} value={value} className="text-xs">
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Divider />

      {formatButton("bold", BoldIcon, "Bold")}
      {formatButton("italic", ItalicIcon, "Italic")}
      {formatButton("underline", UnderlineIcon, "Underline")}
      {formatButton("strikethrough", StrikethroughIcon, "Strikethrough")}
      {formatButton("code", CodeIcon, "Inline code")}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Link"
        className={cn(isLink && "bg-accent text-primary")}
        onClick={toggleLink}
      >
        <LinkIcon />
      </Button>

      <Divider />

      {alignButton("left", AlignLeftIcon, "Align left")}
      {alignButton("center", AlignCenterIcon, "Align center")}
      {alignButton("right", AlignRightIcon, "Align right")}
      {alignButton("justify", AlignJustifyIcon, "Justify")}

      <Divider />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Outdent"
        onClick={() =>
          editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)
        }
      >
        <IndentDecreaseIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Indent"
        onClick={() =>
          editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)
        }
      >
        <IndentIncreaseIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Horizontal rule"
        onClick={() =>
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        }
      >
        <MinusIcon />
      </Button>
    </div>
  );
}
